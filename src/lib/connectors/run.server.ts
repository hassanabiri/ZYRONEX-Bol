import { randomUUID } from "node:crypto";

import type { Database } from "@/integrations/supabase/types";
import { checkConnectorHealth, runConnectorOperation, type ConnectorEvent } from "@/lib/connectors/core";
import { ConnectorError, redact } from "@/lib/connectors/errors";
import { getConnector } from "@/lib/connectors/registry";
import { resolveIntegrationCredentials } from "@/lib/connectors/vault.server";
import type { ConnectorHealth, ConnectorResult } from "@/lib/connectors/types";

/**
 * Server-side entry point that binds an adapter to a workspace connection.
 * The Server Execution Runtime calls this; it never learns anything about a
 * specific provider, and no credential ever leaves this module.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const LOG_KIND: Record<ConnectorEvent["level"], Database["public"]["Enums"]["integration_log_kind"]> = {
  info: "response",
  warn: "retry",
  error: "error",
};

/** Buffers redacted breadcrumbs and flushes them to `integration_logs`. */
function createLogger(workspaceId: string, integrationId: string | null) {
  const events: ConnectorEvent[] = [];
  return {
    onEvent: (event: ConnectorEvent) => events.push(event),
    flush: async () => {
      if (events.length === 0) return;
      const client = await admin();
      await client
        .from("integration_logs")
        .insert(
          events.map((event) => ({
            workspace_id: workspaceId,
            integration_id: integrationId,
            kind: LOG_KIND[event.level],
            message: String(redact(`[${event.connector}:${event.operation}] ${event.message}`)),
            status_code: event.status ?? null,
            latency_ms: event.durationMs ?? null,
            payload: { trace_id: event.traceId, attempt: event.attempt ?? null },
          })) as never,
        )
        .then(
          () => undefined,
          () => undefined,
        );
    },
  };
}

export type ConnectorInvocation = {
  workspaceId: string;
  connectorId?: string;
  integrationId?: string;
  provider?: string;
  operation: string;
  params?: Record<string, unknown>;
  cursor?: string | null;
  maxPages?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  traceId?: string;
  fetchImpl?: typeof fetch;
};

export async function invokeConnector(invocation: ConnectorInvocation): Promise<ConnectorResult> {
  const traceId = invocation.traceId ?? randomUUID();
  const adapterId = invocation.connectorId ?? invocation.provider ?? "http";
  const adapter = getConnector(adapterId);
  if (!adapter)
    return {
      ok: false,
      connector: adapterId,
      operation: invocation.operation,
      error: { kind: "unsupported", message: `No connector registered for "${adapterId}"`, retryable: false },
      attempts: 0,
      durationMs: 0,
      traceId,
    };

  let credentials: Record<string, string> = {};
  let integrationId: string | null = invocation.integrationId ?? null;

  if (invocation.integrationId || invocation.provider) {
    try {
      const resolved = await resolveIntegrationCredentials(invocation.workspaceId, {
        ...(invocation.integrationId ? { integrationId: invocation.integrationId } : {}),
        ...(invocation.provider ? { provider: invocation.provider } : {}),
      });
      credentials = resolved.credentials;
      integrationId = resolved.id;
    } catch (error) {
      const failure = error instanceof ConnectorError ? error : new ConnectorError("provider", "Credential lookup failed");
      return {
        ok: false,
        connector: adapter.id,
        operation: invocation.operation,
        error: { kind: failure.kind, message: failure.message, retryable: failure.retryable },
        attempts: 0,
        durationMs: 0,
        traceId,
      };
    }
  }

  const logger = createLogger(invocation.workspaceId, integrationId);
  const result = await runConnectorOperation({
    adapter,
    credentials,
    traceId,
    input: {
      operation: invocation.operation,
      params: invocation.params ?? {},
      cursor: invocation.cursor ?? null,
      maxPages: invocation.maxPages ?? 1,
    },
    ...(invocation.timeoutMs ? { timeoutMs: invocation.timeoutMs } : {}),
    ...(invocation.maxAttempts ? { maxAttempts: invocation.maxAttempts } : {}),
    ...(invocation.fetchImpl ? { fetchImpl: invocation.fetchImpl } : {}),
    onEvent: logger.onEvent,
  });
  await logger.flush();
  return result;
}

/** Live health check through the real transport, for a stored connection. */
export async function connectorHealth(options: {
  workspaceId: string;
  integrationId: string;
  connectorId?: string;
  fetchImpl?: typeof fetch;
}): Promise<ConnectorHealth> {
  const resolved = await resolveIntegrationCredentials(options.workspaceId, {
    integrationId: options.integrationId,
  });
  const adapter = getConnector(options.connectorId ?? resolved.provider);
  if (!adapter)
    return {
      connector: options.connectorId ?? resolved.provider,
      healthy: false,
      latencyMs: 0,
      message: "No connector adapter is registered for this provider yet",
    };

  const logger = createLogger(options.workspaceId, resolved.id);
  const health = await checkConnectorHealth({
    adapter,
    credentials: resolved.credentials,
    traceId: randomUUID(),
    onEvent: logger.onEvent,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  await logger.flush();
  return health;
}
