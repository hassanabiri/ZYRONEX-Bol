import { slackEventId, slackEventType } from "@/lib/connectors/adapters/slack-map";
import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";

import { getConnector } from "@/lib/connectors/registry";
import { messengerEventType } from "@/lib/connectors/adapters/messenger-map";
import { discordEventId, discordEventType } from "@/lib/connectors/adapters/discord-map";
import { graphNotificationEventId, graphNotificationEventType, parseGraphNotifications } from "@/lib/connectors/adapters/microsoft-graph-map";
import { parseGmailPush } from "@/lib/connectors/adapters/gmail-map";
import { telegramEventType, telegramUpdateDateSeconds } from "@/lib/connectors/adapters/telegram-map";
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
    // Official `event_id` is stable across Slack retries (X-Slack-Retry-Num);
    // envelopes without one fall back to the ingress raw-body fingerprint.
    eventId: slackEventId(body),
    eventType: slackEventType(body),
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
 * Gmail push notifications via Cloud Pub/Sub push subscriptions.
 * The envelope is only a change signal ({ emailAddress, historyId }).
 * Authentication: the push OIDC token's audience must equal the endpoint
 * secret (a private audience configured on the subscription), with a Google
 * issuer and an unexpired token. Dedupe uses the official Pub/Sub messageId;
 * replay protection uses publishTime. JWKS signature verification is tracked
 * as technical debt (needs an async key fetch the sync contract cannot do).
 */
const gmailVerifier: WebhookVerifier = (input) => {
  const push = parseGmailPush(input.payload);
  const meta = {
    eventId: push.messageId ? `pubsub:${push.messageId}` : undefined,
    eventType: "gmail.mailbox_changed",
  };
  if (!input.secret) return { ok: false, reason: "missing_secret", message: "No push audience is configured", ...meta };
  if (!push.messageId || !push.emailAddress || !push.historyId)
    return { ok: false, reason: "malformed_payload", message: "Not a Gmail Pub/Sub push envelope", ...meta };

  const auth = input.headers["authorization"] ?? "";
  const jwt = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  let claims: Record<string, unknown> = {};
  try {
    claims = record(JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")));
  } catch {
    claims = {};
  }
  const aud = typeof claims["aud"] === "string" ? claims["aud"] : "";
  if (!jwt || !aud || !safeEqual(aud, input.secret))
    return { ok: false, reason: "invalid_signature", message: "Push token audience does not match", ...meta };
  const iss = String(claims["iss"] ?? "");
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com")
    return { ok: false, reason: "invalid_signature", message: "Push token issuer is not Google", ...meta };
  const exp = Number(claims["exp"]);
  if (!Number.isFinite(exp) || exp * 1000 <= input.nowMs)
    return { ok: false, reason: "invalid_signature", message: "Push token is expired", ...meta };

  const timestampMs = push.publishTime ? Date.parse(push.publishTime) : NaN;
  if (!Number.isFinite(timestampMs)) return { ok: false, reason: "malformed_payload", message: "publishTime is missing", ...meta };
  if (replayed(timestampMs, input))
    return { ok: false, reason: "replay", message: "Push publishTime is outside the replay window", ...meta };
  return { ok: true, timestampMs, ...meta };
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

/**
 * Instagram (Meta): official webhook security — `X-Hub-Signature-256` is
 * `sha256=<hex HMAC-SHA256 of the raw body>` computed with the Meta app secret.
 * Meta retries a delivery until it gets a 200, so the event id is the message
 * id (`entry[].messaging[].message.mid`) or the changed object id, which makes
 * redeliveries idempotent. `entry[].time` also feeds replay protection.
 */
const instagramVerifier: WebhookVerifier = (input) => {
  const body = record(input.payload);
  const entry = record(Array.isArray(body["entry"]) ? body["entry"][0] : undefined);
  const messaging = record(Array.isArray(entry["messaging"]) ? entry["messaging"][0] : undefined);
  const message = record(messaging["message"]);
  const reaction = record(messaging["reaction"]);
  const change = record(Array.isArray(entry["changes"]) ? entry["changes"][0] : undefined);
  const value = record(change["value"]);

  const eventType = firstString(
    Object.keys(message).length > 0 ? "message.received" : undefined,
    Object.keys(reaction).length > 0 ? "message.reaction" : undefined,
    change["field"] === "comments" ? "comment.created" : undefined,
    change["field"],
    Object.keys(messaging).length > 0 ? "messaging" : undefined,
  );
  const meta = {
    eventId: firstString(
      message["mid"],
      reaction["mid"] !== undefined
        ? `${String(reaction["mid"])}:${String(reaction["action"] ?? "")}:${String(messaging["timestamp"] ?? "")}`
        : undefined,
      value["id"] !== undefined
        ? `${eventType ?? "event"}:${String(value["id"])}:${String(value["timestamp"] ?? entry["time"] ?? "")}`
        : undefined,
      entry["id"] !== undefined ? `${String(entry["id"])}:${String(entry["time"] ?? "")}` : undefined,
    ),
    eventType,
  };

  if (!input.secret)
    return { ok: false, reason: "missing_secret", message: "No Instagram app secret is configured", ...meta };

  const signature = input.headers["x-hub-signature-256"];
  if (!signature)
    return { ok: false, reason: "invalid_signature", message: "Instagram signature header is missing", ...meta };

  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (!safeEqual(provided, hmacHex(input.secret, input.raw)))
    return { ok: false, reason: "invalid_signature", message: "Instagram signature does not match", ...meta };

  // Meta sends `entry[].time` in seconds; outside the window it is a replay.
  const entryTime = Number(entry["time"]);
  const timestampMs = Number.isFinite(entryTime) ? (entryTime > 1e11 ? entryTime : entryTime * 1000) : undefined;
  if (replayed(timestampMs, input))
    return { ok: false, reason: "replay", message: "Instagram event is outside the replay window", ...meta };

  return { ok: true, ...(timestampMs === undefined ? {} : { timestampMs }), ...meta };
};

/**
 * Facebook Pages (Meta): official webhook security — `X-Hub-Signature-256` is
 * `sha256=<hex HMAC-SHA256 of the raw body>` with the Meta app secret. Page
 * `feed` changes carry `item` + `verb` + the object id, which yields a stable
 * event id so Meta redeliveries are deduplicated; `entry[].time` feeds replay
 * protection.
 */
const facebookPagesVerifier: WebhookVerifier = (input) => {
  const body = record(input.payload);
  const entry = record(Array.isArray(body["entry"]) ? body["entry"][0] : undefined);
  const change = record(Array.isArray(entry["changes"]) ? entry["changes"][0] : undefined);
  const value = record(change["value"]);
  const field = typeof change["field"] === "string" ? change["field"] : undefined;
  const item = typeof value["item"] === "string" ? value["item"] : undefined;
  const verb = typeof value["verb"] === "string" ? value["verb"] : undefined;
  const eventType = firstString(field && item ? `${field}.${item}.${verb ?? "event"}` : undefined, field);
  const objectId = firstString(value["comment_id"], value["post_id"], value["id"]);
  const actor = firstString(record(value["from"])["id"]);
  const meta = {
    eventId: firstString(
      objectId !== undefined
        ? `${eventType ?? "event"}:${objectId}:${item === "reaction" ? `${actor ?? ""}:${String(value["reaction_type"] ?? "")}:` : ""}${String(value["created_time"] ?? entry["time"] ?? "")}`
        : undefined,
      entry["id"] !== undefined ? `${String(entry["id"])}:${String(entry["time"] ?? "")}` : undefined,
    ),
    eventType,
  };

  if (!input.secret)
    return { ok: false, reason: "missing_secret", message: "No Facebook app secret is configured", ...meta };
  const signature = input.headers["x-hub-signature-256"];
  if (!signature)
    return { ok: false, reason: "invalid_signature", message: "Facebook signature header is missing", ...meta };
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (!safeEqual(provided, hmacHex(input.secret, input.raw)))
    return { ok: false, reason: "invalid_signature", message: "Facebook signature does not match", ...meta };

  const entryTime = Number(entry["time"]);
  const timestampMs = Number.isFinite(entryTime) ? (entryTime > 1e11 ? entryTime : entryTime * 1000) : undefined;
  if (replayed(timestampMs, input))
    return { ok: false, reason: "replay", message: "Facebook event is outside the replay window", ...meta };

  return { ok: true, ...(timestampMs === undefined ? {} : { timestampMs }), ...meta };
};

/**
 * Messenger (Meta Messenger Platform): official webhook security —
 * `X-Hub-Signature-256` = `sha256=<hex HMAC-SHA256 of the raw body>` with the
 * Meta app secret. Event ids come only from official identifiers (message mid,
 * delivery mids/watermark, read watermark, reaction mid+action, postback mid),
 * so Meta redeliveries are deduplicated by the central engine. The messaging
 * item `timestamp` (ms) — or `entry[].time` — feeds replay protection.
 */
const messengerVerifier: WebhookVerifier = (input) => {
  const body = record(input.payload);
  const entry = record(Array.isArray(body["entry"]) ? body["entry"][0] : undefined);
  const item = record(Array.isArray(entry["messaging"]) ? entry["messaging"][0] : undefined);
  const eventType = Object.keys(item).length > 0 ? messengerEventType(item) : undefined;
  const message = record(item["message"]);
  const delivery = record(item["delivery"]);
  const read = record(item["read"]);
  const reaction = record(item["reaction"]);
  const postback = record(item["postback"]);
  const sender = firstString(record(item["sender"])["id"]) ?? "";
  const mids = Array.isArray(delivery["mids"]) ? delivery["mids"].map(String).join(",") : "";
  const meta = {
    eventId: firstString(
      message["mid"] !== undefined ? `${eventType}:${String(message["mid"])}` : undefined,
      Object.keys(delivery).length > 0 ? `message.delivered:${sender}:${mids}:${String(delivery["watermark"] ?? "")}` : undefined,
      Object.keys(read).length > 0 ? `message.read:${sender}:${String(read["watermark"] ?? "")}` : undefined,
      reaction["mid"] !== undefined
        ? `message.reaction:${String(reaction["mid"])}:${String(reaction["action"] ?? "")}:${String(reaction["reaction"] ?? "")}`
        : undefined,
      postback["mid"] !== undefined ? `postback:${String(postback["mid"])}` : undefined,
      entry["id"] !== undefined ? `${eventType ?? "event"}:${String(entry["id"])}:${sender}:${String(item["timestamp"] ?? entry["time"] ?? "")}` : undefined,
    ),
    eventType,
  };

  if (!input.secret) return { ok: false, reason: "missing_secret", message: "No Messenger app secret is configured", ...meta };
  const signature = input.headers["x-hub-signature-256"];
  if (!signature) return { ok: false, reason: "invalid_signature", message: "Messenger signature header is missing", ...meta };
  const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  if (!safeEqual(provided, hmacHex(input.secret, input.raw)))
    return { ok: false, reason: "invalid_signature", message: "Messenger signature does not match", ...meta };

  const raw = Number(item["timestamp"] ?? entry["time"]);
  const timestampMs = Number.isFinite(raw) ? (raw > 1e11 ? raw : raw * 1000) : undefined;
  if (replayed(timestampMs, input))
    return { ok: false, reason: "replay", message: "Messenger event is outside the replay window", ...meta };

  return { ok: true, ...(timestampMs === undefined ? {} : { timestampMs }), ...meta };
};

/** Telegram keeps undelivered updates for at most 24 hours (Bot API docs). */
const TELEGRAM_MAX_UPDATE_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Telegram Bot API webhooks carry no body signature. The official mechanism
 * is `X-Telegram-Bot-Api-Secret-Token`, echoing the `secret_token` given to
 * `setWebhook`. Replay protection = constant-time secret check + dedupe on the
 * official monotonic `update_id` + rejecting payloads older than Telegram's own
 * 24h retention (Telegram legitimately retries, so the short generic window
 * would drop valid redeliveries).
 */
const telegramVerifier: WebhookVerifier = (input) => {
  const body = record(input.payload);
  const updateId = body["update_id"];
  const eventType = telegramEventType(body);
  const meta = {
    eventId: typeof updateId === "number" && Number.isInteger(updateId) ? `update:${updateId}` : undefined,
    eventType,
  };

  if (!input.secret) return { ok: false, reason: "missing_secret", message: "No Telegram webhook secret token is configured", ...meta };
  const provided = input.headers["x-telegram-bot-api-secret-token"];
  if (!provided) return { ok: false, reason: "invalid_signature", message: "Telegram secret token header is missing", ...meta };
  if (!safeEqual(provided, input.secret))
    return { ok: false, reason: "invalid_signature", message: "Telegram secret token does not match", ...meta };

  if (!meta.eventId) return { ok: false, reason: "malformed_payload", message: "Telegram update has no update_id", ...meta };
  if (!eventType) return { ok: false, reason: "unsupported_event", message: "Telegram update type is not recognised", ...meta };

  const seconds = telegramUpdateDateSeconds(body);
  const timestampMs = seconds === undefined ? undefined : seconds * 1000;
  if (timestampMs !== undefined && input.nowMs - timestampMs > TELEGRAM_MAX_UPDATE_AGE_MS)
    return { ok: false, reason: "replay", message: "Telegram update is older than the 24h delivery window", ...meta };

  return { ok: true, ...(timestampMs === undefined ? {} : { timestampMs }), ...meta };
};

/** DER prefix of an Ed25519 SubjectPublicKeyInfo (RFC 8410). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function ed25519Valid(publicKeyHex: string, message: string, signatureHex: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(null, Buffer.from(message), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/**
 * Discord Interactions endpoint + Webhook Events. Official security: Ed25519
 * signature (`X-Signature-Ed25519`) over `X-Signature-Timestamp + rawBody`,
 * verified with the application's public key (stored as the endpoint secret).
 * Replay protection = signed timestamp inside the endpoint replay window +
 * dedupe on the official interaction id / Webhook Event identity.
 */
const discordVerifier: WebhookVerifier = (input) => {
  const meta = { eventId: discordEventId(input.payload), eventType: discordEventType(input.payload) };
  if (!input.secret) return { ok: false, reason: "missing_secret", message: "No Discord application public key is configured", ...meta };
  const signature = input.headers["x-signature-ed25519"];
  const timestamp = input.headers["x-signature-timestamp"];
  if (!signature || !timestamp) return { ok: false, reason: "invalid_signature", message: "Discord signature headers are missing", ...meta };
  if (!ed25519Valid(input.secret.trim(), timestamp + input.raw, signature))
    return { ok: false, reason: "invalid_signature", message: "Discord signature does not match", ...meta };

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) return { ok: false, reason: "invalid_signature", message: "Discord signature timestamp is not a number", ...meta };
  if (replayed(timestampMs, input)) return { ok: false, reason: "replay", message: "Discord request is outside the replay window", ...meta };
  if (!meta.eventType) return { ok: false, reason: "unsupported_event", message: "Discord event type is not recognised", ...meta };

  return { ok: true, timestampMs, ...meta };
};

/**
 * Microsoft Graph change notifications. Official validation for basic
 * notifications = every item's `clientState` equals the secret set on the
 * subscription (the endpoint secret). Replay protection: notifications for an
 * already-expired subscription are rejected. Dedupe uses official fields only
 * (subscriptionId + changeType/lifecycleEvent + resource id + etag).
 * Subscription validation (`validationToken` echo) needs a text/plain body the
 * shared ingress cannot return — tracked as technical debt.
 */
const microsoftGraphVerifier: WebhookVerifier = (input) => {
  const list = parseGraphNotifications(input.payload);
  const meta = { eventId: graphNotificationEventId(list), eventType: graphNotificationEventType(list) };
  if (!input.secret) return { ok: false, reason: "missing_secret", message: "No Graph clientState is configured", ...meta };
  if (!list.length)
    return { ok: false, reason: "unsupported_event", message: "Not a Graph notification collection (validationToken requests need an in-body echo)", ...meta };
  for (const n of list) {
    if (!n.clientState || !safeEqual(n.clientState, input.secret))
      return { ok: false, reason: "invalid_signature", message: "Graph clientState does not match", ...meta };
  }
  if (!meta.eventId || !meta.eventType) return { ok: false, reason: "malformed_payload", message: "Graph notification is missing official identifiers", ...meta };
  for (const n of list) {
    const exp = n.subscriptionExpiration ? Date.parse(n.subscriptionExpiration) : NaN;
    if (Number.isFinite(exp) && exp < input.nowMs - input.replayWindowMs)
      return { ok: false, reason: "replay", message: "Notification belongs to an expired subscription", ...meta };
  }
  return { ok: true, ...meta };
};

const VERIFIERS: Record<string, WebhookVerifier> = {
  http: genericVerifier,
  slack: slackVerifier,
  google: googleVerifier,
  google_mail: gmailVerifier,
  salla: sallaVerifier,
  zid: zidVerifier,
  shopify: shopifyVerifier,
  woocommerce: woocommerceVerifier,
  whatsapp: whatsappVerifier,
  instagram: instagramVerifier,
  facebook_pages: facebookPagesVerifier,
  messenger: messengerVerifier,
  telegram: telegramVerifier,
  discord: discordVerifier,
  microsoft_graph: microsoftGraphVerifier,
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
