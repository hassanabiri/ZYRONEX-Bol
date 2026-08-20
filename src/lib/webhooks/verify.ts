import { createHmac, timingSafeEqual } from "node:crypto";

import { getConnector } from "@/lib/connectors/registry";
import type { WebhookVerification, WebhookVerifier, WebhookVerifierInput } from "@/lib/webhooks/types";

/**
 * Per-connector webhook verification.
 *
 * The ingress is provider-agnostic: it only asks the registry for the verifier
 * that belongs to a connector. Adding Salla, Zid or Shopify later is one entry
 * in `VERIFIERS` — the ingress, storage, retry and dead-letter layers never
 * change. Secrets are compared in constant time and never returned.
 */

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function hmacHex(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function replayed(timestampMs: number | undefined, input: WebhookVerifierInput): boolean {
  if (timestampMs === undefined) return false;
  return Math.abs(input.nowMs - timestampMs) > input.replayWindowMs;
}

/**
 * Generic HMAC verifier used by the HTTP/REST connector and by any provider
 * that signs with `sha256(secret, timestamp.body)` or `sha256(secret, body)`.
 */
const genericVerifier: WebhookVerifier = (input) => {
  const body = record(input.payload);
  const meta = {
    eventId: firstString(
      input.headers["x-zyronex-event-id"],
      input.headers["x-request-id"],
      body["event_id"],
      body["id"],
    ),
    eventType: firstString(input.headers["x-zyronex-event"], body["type"], body["event"], body["event_type"]),
  };

  if (!input.secret) return { ok: false, reason: "missing_secret", message: "No signing secret is configured", ...meta };

  const header =
    input.headers["x-zyronex-signature"] ??
    input.headers["x-signature-256"] ??
    input.headers["x-hub-signature-256"] ??
    input.headers["x-signature"];
  if (!header) return { ok: false, reason: "invalid_signature", message: "Signature header is missing", ...meta };

  // Format A: `t=<unix>,v1=<hex>` (timestamped, replay-protected).
  const parts = Object.fromEntries(
    header
      .split(",")
      .map((chunk) => chunk.trim().split("="))
      .filter((pair): pair is [string, string] => pair.length === 2),
  );
  if (parts["t"] && parts["v1"]) {
    const timestampMs = Number(parts["t"]) * 1000;
    if (!Number.isFinite(timestampMs))
      return { ok: false, reason: "invalid_signature", message: "Signature timestamp is not a number", ...meta };
    if (replayed(timestampMs, input))
      return { ok: false, reason: "replay", message: "Signature timestamp is outside the replay window", ...meta };
    if (!safeEqual(parts["v1"], hmacHex(input.secret, `${parts["t"]}.${input.raw}`)))
      return { ok: false, reason: "invalid_signature", message: "Signature does not match", ...meta };
    return { ok: true, timestampMs, ...meta };
  }

  // Format B: bare (optionally `sha256=`-prefixed) hex digest of the raw body.
  const provided = header.startsWith("sha256=") ? header.slice(7) : header;
  if (!safeEqual(provided, hmacHex(input.secret, input.raw)))
    return { ok: false, reason: "invalid_signature", message: "Signature does not match", ...meta };
  return { ok: true, ...meta };
};

/** Slack: `v0=hmac(secret, "v0:<ts>:<raw>")` plus its own replay window. */
const slackVerifier: WebhookVerifier = (input) => {
  const body = record(input.payload);
  const meta = {
    eventId: firstString(body["event_id"], input.headers["x-slack-request-timestamp"]),
    eventType: firstString(record(body["event"])["type"], body["type"]),
  };
  if (!input.secret) return { ok: false, reason: "missing_secret", message: "No signing secret is configured", ...meta };

  const signature = input.headers["x-slack-signature"];
  const timestamp = input.headers["x-slack-request-timestamp"];
  if (!signature || !timestamp)
    return { ok: false, reason: "invalid_signature", message: "Slack signature headers are missing", ...meta };

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs))
    return { ok: false, reason: "invalid_signature", message: "Slack timestamp is not a number", ...meta };
  if (replayed(timestampMs, input))
    return { ok: false, reason: "replay", message: "Slack timestamp is outside the replay window", ...meta };

  if (!safeEqual(signature, `v0=${hmacHex(input.secret, `v0:${timestamp}:${input.raw}`)}`))
    return { ok: false, reason: "invalid_signature", message: "Slack signature does not match", ...meta };
  return { ok: true, timestampMs, ...meta };
};

/** Google push notifications: channel token + message number as the event id. */
const googleVerifier: WebhookVerifier = (input) => {
  const meta = {
    eventId: firstString(
      input.headers["x-goog-message-number"] && input.headers["x-goog-channel-id"]
        ? `${input.headers["x-goog-channel-id"]}:${input.headers["x-goog-message-number"]}`
        : undefined,
      input.headers["x-goog-message-number"],
      input.headers["x-goog-resource-id"],
    ),
    eventType: firstString(input.headers["x-goog-resource-state"], "sync"),
  };
  if (!input.secret) return { ok: false, reason: "missing_secret", message: "No channel token is configured", ...meta };

  const token = input.headers["x-goog-channel-token"];
  if (!token || !safeEqual(token, input.secret))
    return { ok: false, reason: "invalid_signature", message: "Channel token does not match", ...meta };
  return { ok: true, ...meta };
};

const VERIFIERS: Record<string, WebhookVerifier> = {
  http: genericVerifier,
  slack: slackVerifier,
  google: googleVerifier,
};

/** Resolves a verifier through the connector registry, aliases included. */
export function getWebhookVerifier(connectorId: string): WebhookVerifier {
  const canonical = getConnector(connectorId)?.id ?? connectorId;
  return VERIFIERS[canonical] ?? genericVerifier;
}

export function registerWebhookVerifier(connectorId: string, verifier: WebhookVerifier) {
  VERIFIERS[connectorId] = verifier;
}

export function verifyWebhook(connectorId: string, input: WebhookVerifierInput): WebhookVerification {
  return getWebhookVerifier(connectorId)(input);
}

export const __testing = { hmacHex };
