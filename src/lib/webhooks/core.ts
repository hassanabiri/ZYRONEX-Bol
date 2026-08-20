import { createHash, randomUUID } from "node:crypto";

import { redactString } from "@/lib/connectors/errors";
import { verifyWebhook } from "@/lib/webhooks/verify";
import type {
  WebhookEndpointRecord,
  WebhookEventRecord,
  WebhookResponse,
  WebhookStore,
} from "@/lib/webhooks/types";

/**
 * Webhook Engine — provider-agnostic ingress pipeline.
 *
 * Verify → deduplicate → persist → hand over to the Server Execution Runtime.
 * Business logic never runs inside a webhook: the event becomes an execution,
 * so retries, leases, timeouts and cancellation stay the runtime's job.
 *
 * Everything here is pure with respect to storage (`WebhookStore`), so the full
 * pipeline is unit-testable without a database or a network.
 */

const RETRY_BASE_MS = 30_000;
const RETRY_CAP_MS = 3_600_000;

/** Exponential backoff with jitter for redelivery of a failed event. */
export function retryDelayMs(attempt: number): number {
  const base = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** Stable fallback id so an unsigned/duplicated body still deduplicates. */
export function fingerprintEvent(endpointId: string, raw: string): string {
  return `sha256:${createHash("sha256").update(`${endpointId}:${raw}`).digest("hex").slice(0, 32)}`;
}

function reject(
  status: number,
  error: WebhookResponse["body"]["error"],
  traceId: string,
  message: string,
): WebhookResponse {
  return { status, body: { ok: false, status: "rejected", trace_id: traceId, error: error!, message } };
}

export type IngressInput = {
  slug: string;
  rawBody: string;
  headers: Record<string, string>;
  store: WebhookStore;
  nowMs?: number;
  traceId?: string;
};

export async function handleWebhook(input: IngressInput): Promise<WebhookResponse> {
  const traceId = input.traceId ?? randomUUID();
  const nowMs = input.nowMs ?? Date.now();
  const startedAt = nowMs;

  const endpoint = await input.store.findEndpoint(input.slug);
  // A wrong slug and a foreign-workspace slug are indistinguishable to callers.
  if (!endpoint) return reject(404, "unknown_endpoint", traceId, "Webhook endpoint not found");
  if (!endpoint.enabled) return reject(403, "disabled", traceId, "Webhook endpoint is disabled");

  let payload: unknown = {};
  let malformed = false;
  try {
    payload = input.rawBody.length > 0 ? JSON.parse(input.rawBody) : {};
  } catch {
    malformed = true;
  }

  const verification = verifyWebhook(endpoint.connector, {
    raw: input.rawBody,
    headers: input.headers,
    payload,
    secret: endpoint.secret,
    nowMs,
    replayWindowMs: Math.max(1, endpoint.replayWindowSeconds) * 1000,
  });

  if (!verification.ok) {
    await input.store.recordDelivery({
      workspaceId: endpoint.workspaceId,
      endpointId: endpoint.id,
      event: verification.eventType ?? "unknown",
      attempt: 1,
      success: false,
      signatureValid: false,
      statusCode: verification.reason === "replay" ? 408 : 401,
      latencyMs: Math.max(0, Date.now() - startedAt),
      error: redactString(verification.message ?? "Verification failed"),
    });
    const status = verification.reason === "missing_secret" ? 500 : verification.reason === "replay" ? 408 : 401;
    return reject(status, verification.reason ?? "invalid_signature", traceId, verification.message ?? "Rejected");
  }

  // Verified callers only: never disclose parse details to an unsigned caller.
  if (malformed) return reject(400, "malformed_payload", traceId, "Request body is not valid JSON");

  const eventType = verification.eventType ?? "unknown";
  if (endpoint.events.length > 0 && !endpoint.events.includes(eventType) && !endpoint.events.includes("*"))
    return {
      status: 202,
      body: { ok: true, status: "discarded", trace_id: traceId, error: "unsupported_event", message: "Event is not subscribed" },
    };

  const eventId = verification.eventId ?? fingerprintEvent(endpoint.id, input.rawBody);
  const inserted = await input.store.insertEvent({
    workspaceId: endpoint.workspaceId,
    endpointId: endpoint.id,
    integrationId: endpoint.integrationId,
    connector: endpoint.connector,
    eventId,
    eventType,
    traceId,
    signatureValid: true,
    maxAttempts: endpoint.maxAttempts,
    payload,
    headers: input.headers,
  });

  // Idempotency: a redelivered event is acknowledged but never processed twice.
  if (inserted.duplicate)
    return { status: 200, body: { ok: true, status: "duplicate", trace_id: traceId, event_id: eventId } };

  const event: WebhookEventRecord = {
    id: inserted.id,
    workspaceId: endpoint.workspaceId,
    endpointId: endpoint.id,
    eventId,
    eventType,
    traceId,
    attempts: 0,
    maxAttempts: endpoint.maxAttempts,
    payload,
    status: "received",
  };

  const outcome = await deliverEvent(input.store, endpoint, event, startedAt);
  return outcome;
}

/** Hands one stored event to the Execution Runtime, applying retry rules. */
export async function deliverEvent(
  store: WebhookStore,
  endpoint: WebhookEndpointRecord,
  event: WebhookEventRecord,
  startedAt = Date.now(),
): Promise<WebhookResponse> {
  const attempt = event.attempts + 1;
  await store.updateEvent(event.id, { status: "processing", attempts: attempt });

  try {
    const started = await store.startExecution({ endpoint, event });
    await store.updateEvent(event.id, {
      status: "processed",
      executionId: started?.executionId ?? null,
      error: null,
      processedAt: new Date().toISOString(),
    });
    await store.recordDelivery({
      workspaceId: endpoint.workspaceId,
      endpointId: endpoint.id,
      event: event.eventType,
      attempt,
      success: true,
      signatureValid: true,
      statusCode: 202,
      latencyMs: Math.max(0, Date.now() - startedAt),
    });
    return {
      status: 202,
      body: { ok: true, status: "processed", trace_id: event.traceId, event_id: event.eventId },
    };
  } catch (error) {
    const message = redactString(error instanceof Error ? error.message : "Execution could not be started");
    const retryable = !(error instanceof Error && (error as { retryable?: boolean }).retryable === false);
    const exhausted = !retryable || attempt >= event.maxAttempts;

    await store.updateEvent(event.id, {
      status: exhausted ? "dead_letter" : "failed",
      attempts: attempt,
      error: message,
      nextAttemptAt: new Date(Date.now() + retryDelayMs(attempt)).toISOString(),
    });
    await store.recordDelivery({
      workspaceId: endpoint.workspaceId,
      endpointId: endpoint.id,
      event: event.eventType,
      attempt,
      success: false,
      signatureValid: true,
      statusCode: exhausted ? 500 : 503,
      latencyMs: Math.max(0, Date.now() - startedAt),
      error: message,
    });
    return {
      status: 202,
      body: {
        ok: false,
        status: exhausted ? "dead_letter" : "failed",
        trace_id: event.traceId,
        event_id: event.eventId,
        error: "execution_failed",
        message,
      },
    };
  }
}

/** Redelivery sweep: retries due events, dead-letters exhausted ones. */
export async function processWebhookRetries(store: WebhookStore, limit = 25) {
  if (!store.dueEvents) return { retried: 0, processed: 0, deadLettered: 0 };
  const due = await store.dueEvents(limit);
  let processed = 0;
  let deadLettered = 0;
  for (const item of due) {
    const result = await deliverEvent(store, item.endpoint, item);
    if (result.body.status === "processed") processed += 1;
    if (result.body.status === "dead_letter") deadLettered += 1;
  }
  return { retried: due.length, processed, deadLettered };
}
