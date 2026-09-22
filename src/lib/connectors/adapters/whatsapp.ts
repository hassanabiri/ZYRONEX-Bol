import { asRecord, assertRequiredParams, pickInto } from "@/lib/connectors/adapters/shared";
import {
  normalizeWhatsAppMedia,
  normalizeWhatsAppPhoneNumber,
  normalizeWhatsAppSendResult,
  normalizeWhatsAppTemplate,
} from "@/lib/connectors/adapters/whatsapp-map";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * WhatsApp Business Cloud connector.
 *
 * Official Meta Graph / WhatsApp Cloud API only. Like every ZYRONEX adapter it
 * owns four concerns and nothing else: API communication, credential injection,
 * mapping/normalization and error handling. No business logic, no AI, no CRM
 * decisions and no database access live here — ZYRONEX keeps all of that.
 *
 * `phone_number_id` and `business_account_id` belong to the connection, so
 * `buildCall` emits placeholders that `authorize` replaces with the credential
 * values (params may still override them explicitly).
 */

export const WHATSAPP_API_VERSION = "v23.0";
const GRAPH_HOST = "https://graph.facebook.com";
/** Replaced in `authorize` with the connection's own identifiers. */
const PHONE_PLACEHOLDER = "phone-number-id-placeholder";
const WABA_PLACEHOLDER = "business-account-id-placeholder";
const DEFAULT_PAGE_SIZE = 50;

type Kind = "send" | "template" | "media" | "phone_number" | "raw";

type Spec = {
  method: HttpMethod;
  /** `:id` placeholders are filled from params. */
  path: string;
  kind?: Kind;
  /** Collection endpoints follow Graph cursor pagination (`data` + `paging`). */
  list?: boolean;
  required?: string[];
  query?: string[];
  /** Params copied into the JSON body (empty array = pass `body`/`data` through). */
  body?: string[];
  /** Adds `messaging_product: "whatsapp"` as the Cloud API requires. */
  messaging?: boolean;
  /** Forces `type` on a send payload (template / reaction / …). */
  forceType?: string;
};

const SEND_BODY = [
  "to",
  "type",
  "text",
  "image",
  "audio",
  "video",
  "document",
  "sticker",
  "location",
  "contacts",
  "interactive",
  "reaction",
  "template",
  "context",
  "preview_url",
  "biz_opaque_callback_data",
];

const OPERATIONS: Record<string, Spec> = {
  // ---- Messages -----------------------------------------------------------
  send_message: {
    method: "POST",
    path: `/${PHONE_PLACEHOLDER}/messages`,
    kind: "send",
    required: ["to", "type"],
    body: SEND_BODY,
    messaging: true,
  },
  send_template: {
    method: "POST",
    path: `/${PHONE_PLACEHOLDER}/messages`,
    kind: "send",
    required: ["to", "template"],
    body: SEND_BODY,
    messaging: true,
    forceType: "template",
  },
  send_reply: {
    method: "POST",
    path: `/${PHONE_PLACEHOLDER}/messages`,
    kind: "send",
    required: ["to", "type", "reply_to_message_id"],
    body: SEND_BODY,
    messaging: true,
  },
  mark_message_read: {
    method: "POST",
    path: `/${PHONE_PLACEHOLDER}/messages`,
    kind: "raw",
    required: ["message_id"],
    body: ["message_id", "typing_indicator"],
    messaging: true,
  },
  // ---- Media --------------------------------------------------------------
  get_media: { method: "GET", path: "/:media_id", kind: "media", required: ["media_id"], query: ["phone_number_id"] },
  delete_media: { method: "DELETE", path: "/:media_id", kind: "raw", required: ["media_id"] },
  // ---- Templates ----------------------------------------------------------
  list_templates: {
    method: "GET",
    path: `/${WABA_PLACEHOLDER}/message_templates`,
    kind: "template",
    list: true,
    query: ["name", "language", "status", "category", "fields"],
  },
  create_template: {
    method: "POST",
    path: `/${WABA_PLACEHOLDER}/message_templates`,
    kind: "template",
    required: ["name", "language", "category", "components"],
    body: ["name", "language", "category", "components", "allow_category_change"],
  },
  delete_template: {
    method: "DELETE",
    path: `/${WABA_PLACEHOLDER}/message_templates`,
    kind: "raw",
    required: ["name"],
    query: ["name", "hsm_id"],
  },
  // ---- Account / phone numbers -------------------------------------------
  list_phone_numbers: {
    method: "GET",
    path: `/${WABA_PLACEHOLDER}/phone_numbers`,
    kind: "phone_number",
    list: true,
    query: ["fields"],
  },
  get_phone_number: { method: "GET", path: `/${PHONE_PLACEHOLDER}`, kind: "phone_number", query: ["fields"] },
  get_business_profile: {
    method: "GET",
    path: `/${PHONE_PLACEHOLDER}/whatsapp_business_profile`,
    kind: "raw",
    query: ["fields"],
  },
  update_business_profile: {
    method: "POST",
    path: `/${PHONE_PLACEHOLDER}/whatsapp_business_profile`,
    kind: "raw",
    body: ["about", "address", "description", "email", "vertical", "websites", "profile_picture_handle"],
    messaging: true,
  },
  // ---- Webhook subscriptions ---------------------------------------------
  list_subscribed_apps: { method: "GET", path: `/${WABA_PLACEHOLDER}/subscribed_apps`, kind: "raw", list: true },
  subscribe_app: { method: "POST", path: `/${WABA_PLACEHOLDER}/subscribed_apps`, kind: "raw", body: [] },
  unsubscribe_app: { method: "DELETE", path: `/${WABA_PLACEHOLDER}/subscribed_apps`, kind: "raw" },
};

function mapEntity(kind: Kind | undefined, value: unknown): Record<string, unknown> {
  if (kind === "send") return normalizeWhatsAppSendResult(value) as unknown as Record<string, unknown>;
  if (kind === "template") return normalizeWhatsAppTemplate(value) as unknown as Record<string, unknown>;
  if (kind === "media") return normalizeWhatsAppMedia(value) as unknown as Record<string, unknown>;
  if (kind === "phone_number") return normalizeWhatsAppPhoneNumber(value) as unknown as Record<string, unknown>;
  return asRecord(value);
}

/** Meta ids are numeric strings; reject anything that could rewrite the path. */
function safeId(value: string): string {
  const trimmed = value.trim();
  return /^[0-9]{5,}$/.test(trimmed) ? trimmed : "";
}

export const whatsappConnector: ConnectorAdapter = {
  id: "whatsapp",
  label: "WhatsApp Business Cloud",
  capabilities: ["read", "write", "messaging", "files", "pagination", "webhook", "health_check"],
  credentials: {
    kind: "bearer",
    required: ["access_token", "phone_number_id"],
    optional: ["business_account_id", "waba_id", "app_secret", "verify_token"],
  },
  operations: Object.keys(OPERATIONS),
  healthOperation: "get_phone_number",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown WhatsApp operation "${operation}"`, { retryable: false });

    assertRequiredParams(operation, params, spec.required);

    const path = spec.path.replace(/:([a-z_]+)/g, (_match, key: string) => encodeURIComponent(String(params[key])));

    const query: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(pickInto(params, spec.query))) query[key] = value as string | number;
    if (spec.list) {
      // Graph API pages with opaque cursors: `after` continues the walk.
      query["limit"] = Number(params["limit"] ?? DEFAULT_PAGE_SIZE);
      if (cursor) query["after"] = String(cursor);
    }

    const hasBody = spec.method !== "GET" && spec.method !== "DELETE";
    let payload: Record<string, unknown> = {};
    if (hasBody) {
      const passthrough =
        spec.body?.length === 0 ? asRecord(params["body"] ?? params["data"]) : pickInto(params, spec.body);
      payload = { ...(spec.messaging ? { messaging_product: "whatsapp" } : {}), ...passthrough };

      if (spec.kind === "send") {
        payload["recipient_type"] = params["recipient_type"] ?? "individual";
        if (spec.forceType) payload["type"] = spec.forceType;
        // Replies are protocol-level on the Cloud API: `context.message_id`.
        if (params["reply_to_message_id"] !== undefined && payload["context"] === undefined)
          payload["context"] = { message_id: String(params["reply_to_message_id"]) };
        // Idempotency: WhatsApp has no idempotency header, but the official
        // `biz_opaque_callback_data` is echoed back on every status webhook,
        // so the runtime's key travels with the message and returns with it.
        if (params["idempotency_key"] !== undefined && payload["biz_opaque_callback_data"] === undefined)
          payload["biz_opaque_callback_data"] = String(params["idempotency_key"]);
      }
      if (operation === "mark_message_read") payload["status"] = "read";
    }

    return {
      method: spec.method,
      url: `${GRAPH_HOST}/${WHATSAPP_API_VERSION}${path}`,
      headers: { accept: "application/json", ...(hasBody ? { "content-type": "application/json" } : {}) },
      query,
      ...(hasBody ? { body: payload } : {}),
      paginated: Boolean(spec.list),
    };
  },

  /**
   * Cloud API authenticates with a bearer token scoped to one phone number and
   * one WhatsApp Business Account, so both identifiers must resolve before a
   * single byte leaves the runtime.
   */
  authorize: (call, credentials) => {
    const token = credentials["access_token"];
    if (!token) throw new ConnectorError("auth", "The WhatsApp Business account is not connected yet", { retryable: false });

    let url = call.url;
    if (url.includes(PHONE_PLACEHOLDER)) {
      const phoneNumberId = safeId(credentials["phone_number_id"] ?? "");
      if (!phoneNumberId)
        throw new ConnectorError("auth", "The WhatsApp phone number ID is missing from this connection", {
          retryable: false,
        });
      url = url.replace(PHONE_PLACEHOLDER, phoneNumberId);
    }
    if (url.includes(WABA_PLACEHOLDER)) {
      const wabaId = safeId(credentials["business_account_id"] ?? credentials["waba_id"] ?? "");
      if (!wabaId)
        throw new ConnectorError("auth", "The WhatsApp Business Account ID is missing from this connection", {
          retryable: false,
        });
      url = url.replace(WABA_PLACEHOLDER, wabaId);
    }

    return { ...call, url, headers: { ...call.headers, authorization: `Bearer ${token}` } };
  },

  /** Graph answers with `{ error: { message, type, code, error_subcode } }`. */
  mapError: (status, payload) => {
    const body = asRecord(payload);
    const error = asRecord(body["error"]);
    const hasError = Object.keys(error).length > 0;
    if (status < 400 && !hasError) return null;

    const code = Number(error["code"]);
    const subcode = Number(error["error_subcode"]);
    const detail =
      (typeof error["error_user_msg"] === "string" && error["error_user_msg"]) ||
      (typeof error["message"] === "string" && error["message"]) ||
      `WhatsApp request failed (${status})`;
    const message = `WhatsApp: ${detail}`;

    // Official rate-limit / throughput codes, independent of the HTTP status.
    if ([4, 80007, 130429, 131048, 131056].includes(code) || status === 429)
      return { kind: "rate_limit", message, retryable: true };
    if ([190, 102, 463, 467].includes(code) || subcode === 463 || status === 401)
      return { kind: "auth", message, retryable: false };
    if ([10, 200, 299, 3, 131031].includes(code) || status === 403) return { kind: "forbidden", message, retryable: false };
    if ([33, 803].includes(code) || status === 404) return { kind: "not_found", message, retryable: false };
    if ([1, 2, 131000, 131016, 131026, 131047].includes(code) && status >= 500)
      return { kind: "provider", message, retryable: true };
    if ([1, 2, 131000, 131016].includes(code)) return { kind: "provider", message, retryable: true };
    if (status >= 500) return { kind: "provider", message, retryable: true };
    if (status >= 400 || hasError) return { kind: "invalid_request", message, retryable: false };
    return null;
  },

  /**
   * Graph reports quota through `X-Business-Use-Case-Usage` (per-WABA JSON),
   * plus `Retry-After` when Meta asks the caller to back off.
   */
  readRateLimit: (headers): RateLimitInfo | undefined => {
    const usageHeader = headers.get("x-business-use-case-usage") ?? headers.get("x-app-usage");
    const retryAfter = headers.get("retry-after");
    if (!usageHeader && !retryAfter) return undefined;

    const info: RateLimitInfo = {};
    if (usageHeader) {
      try {
        const parsed = JSON.parse(usageHeader) as unknown;
        const first = Array.isArray(parsed)
          ? parsed[0]
          : Object.values(asRecord(parsed)).flatMap((value) => (Array.isArray(value) ? value : [value]))[0];
        const usage = asRecord(first);
        const used = Number(usage["call_count"]);
        if (Number.isFinite(used)) {
          info.limit = 100;
          info.remaining = Math.max(0, 100 - used);
        }
        const minutes = Number(usage["estimated_time_to_regain_access"]);
        if (Number.isFinite(minutes) && minutes > 0) info.retryAfterMs = minutes * 60_000;
      } catch {
        // A malformed quota header must never fail a successful call.
      }
    }
    const seconds = Number(retryAfter);
    if (retryAfter && Number.isFinite(seconds)) info.retryAfterMs = Math.max(0, seconds) * 1000;
    return info;
  },

  normalize: (operation, payload): NormalizedPage => {
    const spec = OPERATIONS[operation];
    const body = asRecord(payload);
    if (Object.keys(body).length === 0)
      throw new ConnectorError("malformed_response", "WhatsApp returned an empty response body", { retryable: false });

    if (!spec?.list) return { items: [mapEntity(spec?.kind, body)], cursor: null, raw: payload };

    const data = body["data"];
    if (!Array.isArray(data))
      throw new ConnectorError("malformed_response", "WhatsApp list response did not contain a collection", {
        retryable: false,
      });

    const paging = asRecord(body["paging"]);
    const cursors = asRecord(paging["cursors"]);
    const after = typeof cursors["after"] === "string" ? cursors["after"] : null;
    // Graph keeps returning an `after` cursor on the last page; only a `next`
    // link means another page actually exists.
    const cursor = paging["next"] ? after : null;

    return { items: data.map((item) => mapEntity(spec.kind, item)), cursor, raw: payload };
  },
};
