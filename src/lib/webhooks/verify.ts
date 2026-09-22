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

/**
 * Salla: official webhook security strategies.
 * - `signature`: `x-salla-signature` = hex HMAC-SHA256 of the raw body.
 * - `token`: `authorization` header equals the configured token.
 * The event id is derived from the official envelope `{ event, merchant, data }`.
 */
const sallaVerifier: WebhookVerifier = (input) => {
  const body = record(input.payload);
  const data = record(body["data"]);
  const eventType = firstString(input.headers["x-salla-event"], body["event"]);
  const meta = {
    eventId: firstString(
      input.headers["x-salla-webhook-id"],
      data["id"] !== undefined ? `${eventType ?? "event"}:${String(data["id"])}:${String(body["created_at"] ?? "")}` : undefined,
      body["id"],
    ),
    eventType,
  };

  if (!input.secret) return { ok: false, reason: "missing_secret", message: "No Salla webhook secret is configured", ...meta };

  const signature = input.headers["x-salla-signature"];
  if (signature) {
    const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    if (!safeEqual(provided, hmacHex(input.secret, input.raw)))
      return { ok: false, reason: "invalid_signature", message: "Salla signature does not match", ...meta };
    return { ok: true, ...meta };
  }

  const token = input.headers["authorization"];
  if (token && safeEqual(token.replace(/^Bearer\s+/i, ""), input.secret)) return { ok: true, ...meta };

  return { ok: false, reason: "invalid_signature", message: "Salla security header is missing or invalid", ...meta };
};

/**
 * Zid: official webhook security options.
 * - `x-zid-signature`: hex HMAC-SHA256 of the raw body (optionally `sha256=`).
 * - subscriber token: the shared secret sent back on the `authorization` (or
 *   `x-zid-token`) header configured when the webhook was subscribed.
 * The event id combines the event name with the resource id so a redelivered
 * event is idempotent in the Webhook Engine.
 */
const zidVerifier: WebhookVerifier = (input) => {
  const body = record(input.payload);
  const data = Object.keys(record(body["data"])).length > 0 ? record(body["data"]) : body;
  const eventType = firstString(input.headers["x-zid-event"], body["event"], body["event_type"]);
  const meta = {
    eventId: firstString(
      input.headers["x-zid-webhook-id"],
      input.headers["x-zid-delivery-id"],
      data["id"] !== undefined
        ? `${eventType ?? "event"}:${String(data["id"])}:${String(data["updated_at"] ?? data["created_at"] ?? "")}`
        : undefined,
      body["id"],
    ),
    eventType,
  };

  if (!input.secret) return { ok: false, reason: "missing_secret", message: "No Zid webhook secret is configured", ...meta };

  const signature = input.headers["x-zid-signature"];
  if (signature) {
    const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
    if (!safeEqual(provided, hmacHex(input.secret, input.raw)))
      return { ok: false, reason: "invalid_signature", message: "Zid signature does not match", ...meta };
    return { ok: true, ...meta };
  }

  const token = input.headers["x-zid-token"] ?? input.headers["authorization"];
  if (token && safeEqual(token.replace(/^Bearer\s+/i, ""), input.secret)) return { ok: true, ...meta };

  return { ok: false, reason: "invalid_signature", message: "Zid security header is missing or invalid", ...meta };
};

/**
 * Shopify: official webhook security — `X-Shopify-Hmac-Sha256` is the base64
 * HMAC-SHA256 of the raw body computed with the app's client secret. The
 * delivery id (`X-Shopify-Webhook-Id`) makes redeliveries idempotent.
 */
const shopifyVerifier: WebhookVerifier = (input) => {
  const body = record(input.payload);
  const eventType = firstString(input.headers["x-shopify-topic"], body["topic"]);
  const meta = {
    eventId: firstString(
      input.headers["x-shopify-webhook-id"],
      body["id"] !== undefined
        ? `${eventType ?? "event"}:${String(body["id"])}:${String(body["updated_at"] ?? body["created_at"] ?? "")}`
        : undefined,
    ),
    eventType,
  };

  if (!input.secret)
    return { ok: false, reason: "missing_secret", message: "No Shopify webhook secret is configured", ...meta };

  const signature = input.headers["x-shopify-hmac-sha256"];
  if (!signature)
    return { ok: false, reason: "invalid_signature", message: "Shopify signature header is missing", ...meta };

  const expected = createHmac("sha256", input.secret).update(input.raw, "utf8").digest("base64");
  if (!safeEqual(signature, expected))
    return { ok: false, reason: "invalid_signature", message: "Shopify signature does not match", ...meta };

  return { ok: true, ...meta };
};

/**
 * WooCommerce: official webhook security — `X-WC-Webhook-Signature` is the
 * base64 HMAC-SHA256 of the raw body computed with the webhook's secret. The
 * delivery id (`X-WC-Webhook-Delivery-ID`) makes redeliveries idempotent.
 */
const woocommerceVerifier: WebhookVerifier = (input) => {
  const body = record(input.payload);
  const eventType = firstString(
    input.headers["x-wc-webhook-topic"],
    input.headers["x-wc-webhook-resource"] && input.headers["x-wc-webhook-event"]
      ? `${input.headers["x-wc-webhook-resource"]}.${input.headers["x-wc-webhook-event"]}`
      : undefined,
  );
  const meta = {
    eventId: firstString(
      input.headers["x-wc-webhook-delivery-id"],
      body["id"] !== undefined
        ? `${eventType ?? "event"}:${String(body["id"])}:${String(body["date_modified_gmt"] ?? body["date_modified"] ?? "")}`
        : undefined,
    ),
    eventType,
  };

  if (!input.secret)
    return { ok: false, reason: "missing_secret", message: "No WooCommerce webhook secret is configured", ...meta };

  const signature = input.headers["x-wc-webhook-signature"];
  if (!signature)
    return { ok: false, reason: "invalid_signature", message: "WooCommerce signature header is missing", ...meta };

  const expected = createHmac("sha256", input.secret).update(input.raw, "utf8").digest("base64");
  if (!safeEqual(signature, expected))
    return { ok: false, reason: "invalid_signature", message: "WooCommerce signature does not match", ...meta };

  return { ok: true, ...meta };
};

/**
 * WhatsApp Business Cloud (Meta): official webhook security — `X-Hub-Signature-256`
 * is `sha256=<hex HMAC-SHA256 of the raw body>` computed with the Meta app
 * secret. Meta retries a delivery until it gets a 200, so the event id is the
 * message id (or the message id + status), which makes redeliveries idempotent.
 */
const whatsappVerifier: WebhookVerifier = (input) => {
  const body = record(input.payload);
  const entry = record(Array.isArray(body["entry"]) ? body["entry"][0] : undefined);
  const change = record(Array.isArray(entry["changes"]) ? entry["changes"][0] : undefined);
  const value = record(change["value"]);
  const message = record(Array.isArray(value["messages"]) ? value["messages"][0] : undefined);
  const status = record(Array.isArray(value["statuses"]) ? value["statuses"][0] : undefined);

  const eventType = firstString(
    Object.keys(message).length > 0 ? "message.received" : undefined,
    Object.keys(status).length > 0 ? "message.status" : undefined,
    change["field"],
  );
  const meta = {
    eventId: firstString(
      message["id"],
      status["id"] !== undefined
        ? `${String(status["id"])}:${String(status["status"] ?? "")}:${String(status["timestamp"] ?? "")}`
        : undefined,
      entry["id"] !== undefined ? `${String(entry["id"])}:${String(entry["time"] ?? "")}` : undefined,
    ),
    eventType,
  };

  if (!input.secret)
    return { ok: false, reason: "missing_secret", message: "No WhatsApp app secret is configured", ...meta };

  const signature = input.headers["x-hub-signature-256"];
  if (!signature)
    return { ok: false, reason: "invalid_signature", message: "WhatsApp signature header is missing", ...meta };

  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (!safeEqual(provided, hmacHex(input.secret, input.raw)))
    return { ok: false, reason: "invalid_signature", message: "WhatsApp signature does not match", ...meta };

  return { ok: true, ...meta };
};

const VERIFIERS: Record<string, WebhookVerifier> = {
  http: genericVerifier,
  slack: slackVerifier,
  google: googleVerifier,
  salla: sallaVerifier,
  zid: zidVerifier,
  shopify: shopifyVerifier,
  woocommerce: woocommerceVerifier,
  whatsapp: whatsappVerifier,
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
