import { timingSafeEqual } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { decryptCredentials, encryptCredentials } from "@/lib/integrations/crypto.server";
import { enqueueExecution } from "@/lib/execution/engine.server";
import type { WorkflowGraph } from "@/lib/execution/graph";
import { handleWebhook, processWebhookRetries } from "@/lib/webhooks/core";
import { isSlackResponseUrl, postSlackResponse, sealSlackResponseUrls, type SlackResponseMessage } from "@/lib/webhooks/slack-response";
import type {
  WebhookEndpointRecord,
  WebhookEventRecord,
  WebhookResponse,
  WebhookStore,
} from "@/lib/webhooks/types";

/**
 * Supabase-backed implementation of the webhook store, plus the single public
 * entry point used by `/api/public/webhooks/{slug}`.
 *
 * Credentials and signing secrets are decrypted here and nowhere else: they are
 * never written to `webhook_events`, `webhook_deliveries`, execution steps or
 * any response body.
 */

type Admin = SupabaseClient<Database>;

async function admin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Admin;
}

/** Headers we are willing to persist. Anything auth-bearing is dropped. */
const HEADER_DENYLIST = /(authorization|cookie|signature|token|secret|api[-_]?key)/i;

export function safeHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = HEADER_DENYLIST.test(key) ? "[redacted]" : value.slice(0, 512);
  }
  return out;
}

function decodeSecret(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  try {
    const values = decryptCredentials(ciphertext);
    return values["signing_secret"] ?? values["secret"] ?? null;
  } catch {
    return null;
  }
}

type EndpointRow = Database["public"]["Tables"]["webhook_endpoints"]["Row"] & {
  secret_ciphertext?: string | null;
  connector?: string | null;
  workflow_id?: string | null;
  replay_window_seconds?: number | null;
};

function toEndpoint(row: EndpointRow): WebhookEndpointRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    integrationId: row.integration_id,
    workflowId: row.workflow_id ?? null,
    connector: row.connector ?? "http",
    enabled: row.enabled && row.direction === "incoming",
    events: row.events ?? [],
    secret: decodeSecret(row.secret_ciphertext ?? null),
    replayWindowSeconds: row.replay_window_seconds ?? 300,
    maxAttempts: Math.max(1, row.retry_limit ?? 5),
    expectedSenderEmail: ((row as Record<string, unknown>)["expected_sender_email"] as string | null | undefined) ?? null,
  };
}

/** Turns a verified event into a run on the Server Execution Runtime. */
async function startExecutionFromEvent(input: {
  endpoint: WebhookEndpointRecord;
  event: WebhookEventRecord;
}): Promise<{ executionId: string } | null> {
  const { endpoint, event } = input;
  if (!endpoint.workflowId) return null;

  const client = await admin();
  const { data: workflow, error } = await client
    .from("workflows")
    .select("id, name, version, graph, status, workspace_id")
    .eq("id", endpoint.workflowId)
    // Workspace isolation: an endpoint can only ever run its own tenant's flow.
    .eq("workspace_id", endpoint.workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!workflow) {
    const missing = new Error("Linked workflow is not available in this workspace");
    (missing as { retryable?: boolean }).retryable = false;
    throw missing;
  }

  const execution = await enqueueExecution({
    workspaceId: endpoint.workspaceId,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    workflowName: workflow.name,
    graph: (workflow.graph ?? { nodes: [], edges: [] }) as unknown as WorkflowGraph,
    trigger: "webhook",
    maxAttempts: 3,
    idempotencyKey: `webhook:${event.id}`,
  });
  return { executionId: execution.id };
}

export function createSupabaseWebhookStore(): WebhookStore {
  return {
    async findEndpoint(slug) {
      const client = await admin();
      const { data, error } = await client
        .from("webhook_endpoints")
        .select("*")
        .eq("slug", slug)
        .maybeSingle();
      if (error) throw error;
      return data ? toEndpoint(data as EndpointRow) : null;
    },

    async insertEvent(row) {
      const client = await admin();
      const { data, error } = await client
        .from("webhook_events")
        .insert({
          workspace_id: row.workspaceId,
          endpoint_id: row.endpointId,
          integration_id: row.integrationId,
          connector: row.connector,
          event_id: row.eventId,
          event_type: row.eventType,
          trace_id: row.traceId,
          signature_valid: row.signatureValid,
          max_attempts: row.maxAttempts,
          payload: (row.connector === "slack"
            ? sealSlackResponseUrls(row.payload, (url) => encryptCredentials({ response_url: url }))
            : row.payload) as never,
          headers: safeHeaders(row.headers) as never,
          status: "received",
        } as never)
        .select("id")
        .single();

      if (error) {
        if (error.code === "23505") {
          const { data: existing } = await client
            .from("webhook_events")
            .select("id")
            .eq("endpoint_id", row.endpointId)
            .eq("event_id", row.eventId)
            .maybeSingle();
          return { duplicate: true, id: existing?.id ?? row.eventId };
        }
        throw error;
      }
      await client
        .from("webhook_endpoints")
        .update({ last_event_at: new Date().toISOString() })
        .eq("id", row.endpointId);
      return { duplicate: false, id: (data as { id: string }).id };
    },

    async updateEvent(id, patch) {
      const client = await admin();
      await client
        .from("webhook_events")
        .update({
          ...(patch.status ? { status: patch.status } : {}),
          ...(patch.attempts !== undefined ? { attempts: patch.attempts } : {}),
          ...(patch.error !== undefined ? { error: patch.error } : {}),
          ...(patch.executionId !== undefined ? { execution_id: patch.executionId } : {}),
          ...(patch.nextAttemptAt ? { next_attempt_at: patch.nextAttemptAt } : {}),
          ...(patch.processedAt ? { processed_at: patch.processedAt } : {}),
        } as never)
        .eq("id", id);
    },

    async recordDelivery(row) {
      const client = await admin();
      await client
        .from("webhook_deliveries")
        .insert({
          workspace_id: row.workspaceId,
          endpoint_id: row.endpointId,
          event: row.event,
          direction: "incoming",
          attempt: row.attempt,
          success: row.success,
          signature_valid: row.signatureValid,
          status_code: row.statusCode,
          latency_ms: row.latencyMs,
          error: row.error ?? null,
        } as never)
        .then(
          () => undefined,
          () => undefined,
        );
    },

    startExecution: startExecutionFromEvent,

    async dueEvents(limit) {
      const client = await admin();
      const { data, error } = await client
        .from("webhook_events")
        .select("*")
        .eq("status", "failed")
        .lte("next_attempt_at", new Date().toISOString())
        .order("next_attempt_at", { ascending: true })
        .limit(limit);
      if (error) throw error;

      const rows = (data ?? []) as Record<string, unknown>[];
      const out: (WebhookEventRecord & { endpoint: WebhookEndpointRecord })[] = [];
      for (const row of rows) {
        const { data: endpointRow } = await client
          .from("webhook_endpoints")
          .select("*")
          .eq("id", String(row["endpoint_id"]))
          .maybeSingle();
        if (!endpointRow) continue;
        out.push({
          id: String(row["id"]),
          workspaceId: String(row["workspace_id"]),
          endpointId: String(row["endpoint_id"]),
          eventId: String(row["event_id"]),
          eventType: String(row["event_type"]),
          traceId: String(row["trace_id"]),
          attempts: Number(row["attempts"] ?? 0),
          maxAttempts: Number(row["max_attempts"] ?? 5),
          payload: row["payload"],
          status: "failed",
          endpoint: toEndpoint(endpointRow as EndpointRow),
        });
      }
      return out;
    },
  };
}

/** Public ingress used by the `/api/public/webhooks/{slug}` route. */
export async function receiveWebhook(options: {
  slug: string;
  rawBody: string;
  headers: Record<string, string>;
  query?: Record<string, string>;
}): Promise<WebhookResponse> {
  return handleWebhook({
    ...(options.query ? { query: options.query } : {}),
    slug: options.slug,
    rawBody: options.rawBody,
    headers: options.headers,
    store: createSupabaseWebhookStore(),
  });
}

/**
 * Meta's subscription handshake (`hub.mode=subscribe`). Providers that verify an
 * endpoint with a GET challenge answer here; every other connector keeps the
 * existing 405. The verify token is compared against the endpoint's stored
 * secret and never echoed back.
 */
export async function verifyWebhookChallenge(options: {
  slug: string;
  mode: string | null;
  token: string | null;
  challenge: string | null;
}): Promise<{ ok: boolean; challenge: string }> {
  if (options.mode !== "subscribe" || !options.token || !options.challenge) return { ok: false, challenge: "" };
  const endpoint = await createSupabaseWebhookStore().findEndpoint(options.slug);
  if (!endpoint || !endpoint.enabled || !endpoint.secret) return { ok: false, challenge: "" };
  const expected = Buffer.from(endpoint.secret);
  const provided = Buffer.from(options.token);
  const match = expected.length === provided.length && timingSafeEqual(expected, provided);
  return match ? { ok: true, challenge: options.challenge } : { ok: false, challenge: "" };
}

export function runWebhookRetrySweep(limit = 25) {
  return processWebhookRetries(createSupabaseWebhookStore(), limit);
}

/** Sends a delayed Slack reply using a sealed `response_url` from a stored event. */
export async function sendSlackDelayedResponse(sealed: string, message: SlackResponseMessage) {
  let url: string | undefined;
  try {
    url = decryptCredentials(sealed)["response_url"];
  } catch {
    return { ok: false, status: 0, error: "response_url could not be unsealed" };
  }
  if (!isSlackResponseUrl(url)) return { ok: false, status: 0, error: "response_url is invalid" };
  return postSlackResponse({ responseUrl: url, message });
}
