import {
  normalizeInstagramAccount,
  normalizeInstagramComment,
  normalizeInstagramContainer,
  normalizeInstagramConversation,
  normalizeInstagramInsight,
  normalizeInstagramMedia,
  normalizeInstagramMessage,
  normalizeInstagramSendResult,
} from "@/lib/connectors/adapters/instagram-map";
import { asRecord, assertRequiredParams, pickInto } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Instagram connector (official Meta Instagram Graph API only).
 *
 * Like every ZYRONEX adapter it owns four concerns and nothing else: API
 * communication, credential injection, normalization and error handling. No
 * business logic, no AI, no CRM decisions and no database access live here.
 *
 * Only officially documented endpoints are implemented. Anything Meta does not
 * document for Instagram Business/Creator accounts (binary media upload,
 * unsolicited DMs outside the official messaging window, editing or deleting a
 * sent message, reading personal accounts) is intentionally absent rather than
 * worked around — see UNSUPPORTED_OPERATIONS.
 *
 * The Instagram professional account id belongs to the connection, so
 * `buildCall` emits a placeholder that `authorize` replaces with the credential
 * value.
 */

export const INSTAGRAM_API_VERSION = "v23.0";
const GRAPH_HOST = "https://graph.facebook.com";
/** Replaced in `authorize` with the connection's own Instagram account id. */
const IG_PLACEHOLDER = "instagram-account-id-placeholder";
const DEFAULT_PAGE_SIZE = 25;

/**
 * Documented, deliberate gaps. Meta does not offer these on the official
 * Instagram Graph API surface, so ZYRONEX exposes no workaround for them.
 */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  upload_media_binary:
    "Instagram publishing accepts a publicly reachable image_url/video_url (or a resumable upload session), not a JSON binary upload.",
  edit_message: "The Instagram Messaging API has no endpoint to edit or delete a message that was already sent.",
  delete_media: "Published Instagram media cannot be deleted through the official API.",
  edit_caption: "Captions of published media cannot be edited through the official API.",
  send_unsolicited_message:
    "Messages are only allowed inside the official 24-hour messaging window (or with the human_agent tag); there is no API to open a conversation.",
  read_personal_accounts: "The API only serves Instagram Business and Creator accounts connected to the app.",
  idempotency_key:
    "Meta publishes no idempotency header for Instagram; publishing is made idempotent by the official two-step creation_id container.",
};

type Kind =
  | "account"
  | "media"
  | "comment"
  | "message"
  | "message_send"
  | "conversation"
  | "container"
  | "insight"
  | "raw";

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
};

const OPERATIONS: Record<string, Spec> = {
  // ---- Account -------------------------------------------------------------
  get_account: { method: "GET", path: `/${IG_PLACEHOLDER}`, kind: "account", query: ["fields"] },
  get_account_insights: {
    method: "GET",
    path: `/${IG_PLACEHOLDER}/insights`,
    kind: "insight",
    list: true,
    required: ["metric"],
    query: ["metric", "period", "metric_type", "breakdown", "timeframe", "since", "until"],
  },

  // ---- Media (read) --------------------------------------------------------
  list_media: { method: "GET", path: `/${IG_PLACEHOLDER}/media`, kind: "media", list: true, query: ["fields", "since", "until"] },
  get_media: { method: "GET", path: "/:media_id", kind: "media", required: ["media_id"], query: ["fields"] },
  get_media_insights: {
    method: "GET",
    path: "/:media_id/insights",
    kind: "insight",
    list: true,
    required: ["media_id", "metric"],
    query: ["metric", "breakdown"],
  },

  // ---- Publishing (official two-step container flow) -----------------------
  create_media_container: {
    method: "POST",
    path: `/${IG_PLACEHOLDER}/media`,
    kind: "container",
    body: [
      "image_url",
      "video_url",
      "cover_url",
      "media_type",
      "caption",
      "location_id",
      "user_tags",
      "product_tags",
      "collaborators",
      "is_carousel_item",
      "children",
      "share_to_feed",
      "thumb_offset",
      "alt_text",
      "upload_type",
    ],
  },
  publish_media: {
    method: "POST",
    path: `/${IG_PLACEHOLDER}/media_publish`,
    kind: "container",
    required: ["creation_id"],
    body: ["creation_id"],
  },
  get_media_container: {
    method: "GET",
    path: "/:container_id",
    kind: "container",
    required: ["container_id"],
    query: ["fields"],
  },
  get_publishing_limit: {
    method: "GET",
    path: `/${IG_PLACEHOLDER}/content_publishing_limit`,
    kind: "raw",
    list: true,
    query: ["fields", "since"],
  },

  // ---- Comments ------------------------------------------------------------
  list_media_comments: {
    method: "GET",
    path: "/:media_id/comments",
    kind: "comment",
    list: true,
    required: ["media_id"],
    query: ["fields"],
  },
  get_comment: { method: "GET", path: "/:comment_id", kind: "comment", required: ["comment_id"], query: ["fields"] },
  reply_to_comment: {
    method: "POST",
    path: "/:comment_id/replies",
    kind: "raw",
    required: ["comment_id", "message"],
    body: ["message"],
  },
  hide_comment: { method: "POST", path: "/:comment_id", kind: "raw", required: ["comment_id", "hide"], body: ["hide"] },
  delete_comment: { method: "DELETE", path: "/:comment_id", kind: "raw", required: ["comment_id"] },

  // ---- Messaging -----------------------------------------------------------
  send_message: {
    method: "POST",
    path: `/${IG_PLACEHOLDER}/messages`,
    kind: "message_send",
    required: ["recipient_id", "message"],
    body: ["recipient", "message", "messaging_type", "tag"],
  },
  send_reply: {
    method: "POST",
    path: `/${IG_PLACEHOLDER}/messages`,
    kind: "message_send",
    required: ["recipient_id", "message", "reply_to_message_id"],
    body: ["recipient", "message", "messaging_type", "tag"],
  },
  send_sender_action: {
    method: "POST",
    path: `/${IG_PLACEHOLDER}/messages`,
    kind: "raw",
    required: ["recipient_id", "sender_action"],
    body: ["recipient", "sender_action"],
  },
  list_conversations: {
    method: "GET",
    path: `/${IG_PLACEHOLDER}/conversations`,
    kind: "conversation",
    list: true,
    query: ["platform", "user_id", "fields"],
  },
  get_conversation: {
    method: "GET",
    path: "/:conversation_id",
    kind: "conversation",
    required: ["conversation_id"],
    query: ["fields"],
  },
  get_message: { method: "GET", path: "/:message_id", kind: "message", required: ["message_id"], query: ["fields"] },

  // ---- Webhook subscriptions ----------------------------------------------
  list_subscribed_apps: { method: "GET", path: `/${IG_PLACEHOLDER}/subscribed_apps`, kind: "raw", list: true },
  subscribe_app: {
    method: "POST",
    path: `/${IG_PLACEHOLDER}/subscribed_apps`,
    kind: "raw",
    body: ["subscribed_fields"],
  },
  unsubscribe_app: { method: "DELETE", path: `/${IG_PLACEHOLDER}/subscribed_apps`, kind: "raw" },
};

function mapEntity(kind: Kind | undefined, value: unknown): Record<string, unknown> {
  if (kind === "account") return normalizeInstagramAccount(value) as unknown as Record<string, unknown>;
  if (kind === "media") return normalizeInstagramMedia(value) as unknown as Record<string, unknown>;
  if (kind === "comment") return normalizeInstagramComment(value) as unknown as Record<string, unknown>;
  if (kind === "conversation") return normalizeInstagramConversation(value) as unknown as Record<string, unknown>;
  if (kind === "message") return normalizeInstagramMessage(value) as unknown as Record<string, unknown>;
  if (kind === "message_send") return normalizeInstagramSendResult(value) as unknown as Record<string, unknown>;
  if (kind === "container") return normalizeInstagramContainer(value) as unknown as Record<string, unknown>;
  if (kind === "insight") return normalizeInstagramInsight(value) as unknown as Record<string, unknown>;
  return asRecord(value);
}

/** Meta numeric ids; reject anything that could rewrite the request path. */
function safeId(value: string): string {
  const trimmed = value.trim();
  return /^[0-9]{5,}$/.test(trimmed) ? trimmed : "";
}

export const instagramConnector: ConnectorAdapter = {
  id: "instagram",
  label: "Instagram",
  capabilities: ["read", "write", "messaging", "files", "pagination", "webhook", "health_check"],
  credentials: {
    kind: "bearer",
    required: ["access_token", "instagram_account_id"],
    optional: ["ig_user_id", "page_id", "app_secret", "verify_token"],
  },
  operations: Object.keys(OPERATIONS),
  healthOperation: "get_account",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation];
    if (!spec)
      throw new ConnectorError("unsupported", `Unknown Instagram operation "${operation}"`, { retryable: false });

    assertRequiredParams(operation, params, spec.required);

    const path = spec.path.replace(/:([a-z_]+)/g, (_match, key: string) => encodeURIComponent(String(params[key])));

    const query: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(pickInto(params, spec.query)))
      query[key] = Array.isArray(value) ? value.join(",") : (value as string | number);
    if (spec.list) {
      // Graph API pages with opaque cursors: `after` continues the walk.
      query["limit"] = Number(params["limit"] ?? DEFAULT_PAGE_SIZE);
      if (cursor) query["after"] = String(cursor);
    }
    if (operation === "list_conversations" && query["platform"] === undefined) query["platform"] = "instagram";

    const hasBody = spec.method !== "GET" && spec.method !== "DELETE";
    let payload: Record<string, unknown> = {};
    if (hasBody) {
      payload = spec.body?.length === 0 ? asRecord(params["body"] ?? params["data"]) : pickInto(params, spec.body);

      if (spec.kind === "message_send" || operation === "send_sender_action") {
        // Messaging is `{ recipient: { id }, message | sender_action }`.
        if (payload["recipient"] === undefined) payload["recipient"] = { id: String(params["recipient_id"]) };
        const message = params["message"];
        if (message !== undefined)
          payload["message"] = typeof message === "string" ? { text: message } : asRecord(message);
        // Replies are protocol-level on the Messaging API: `message.reply_to.mid`.
        if (params["reply_to_message_id"] !== undefined) {
          const body = asRecord(payload["message"]);
          if (body["reply_to"] === undefined)
            payload["message"] = { ...body, reply_to: { mid: String(params["reply_to_message_id"]) } };
        }
      }
      if (operation === "hide_comment") payload["hide"] = Boolean(params["hide"]);
    }

    return {
      method: spec.method,
      url: `${GRAPH_HOST}/${INSTAGRAM_API_VERSION}${path}`,
      headers: { accept: "application/json", ...(hasBody ? { "content-type": "application/json" } : {}) },
      query,
      ...(hasBody ? { body: payload } : {}),
      paginated: Boolean(spec.list),
    };
  },

  /**
   * Instagram Graph authenticates with a bearer token bound to one professional
   * account, so the account id must resolve before a single byte leaves the
   * runtime.
   */
  authorize: (call, credentials) => {
    const token = credentials["access_token"];
    if (!token)
      throw new ConnectorError("auth", "The Instagram account is not connected yet", { retryable: false });

    let url = call.url;
    if (url.includes(IG_PLACEHOLDER)) {
      const accountId = safeId(credentials["instagram_account_id"] ?? credentials["ig_user_id"] ?? "");
      if (!accountId)
        throw new ConnectorError("auth", "The Instagram professional account ID is missing from this connection", {
          retryable: false,
        });
      url = url.replace(IG_PLACEHOLDER, accountId);
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
      `Instagram request failed (${status})`;
    const message = `Instagram: ${detail}`;

    // Official throttling codes, independent of the HTTP status.
    if ([4, 17, 32, 613, 80002, 80004].includes(code) || status === 429)
      return { kind: "rate_limit", message, retryable: true };
    if ([190, 102, 463, 467].includes(code) || subcode === 463 || status === 401)
      return { kind: "auth", message, retryable: false };
    if ([10, 200, 210, 230, 299, 3].includes(code) || status === 403)
      return { kind: "forbidden", message, retryable: false };
    if ([24, 803].includes(code) || status === 404) return { kind: "not_found", message, retryable: false };
    if ([1, 2].includes(code) || status >= 500) return { kind: "provider", message, retryable: true };
    if (status >= 400 || hasError) return { kind: "invalid_request", message, retryable: false };
    return null;
  },

  /**
   * Graph reports quota through `X-App-Usage` / `X-Business-Use-Case-Usage`,
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
        const flat = asRecord(parsed);
        // `X-App-Usage` is a flat object; `X-Business-Use-Case-Usage` maps an
        // account id to an array of per-account usage objects.
        const first = Array.isArray(parsed)
          ? parsed[0]
          : flat["call_count"] !== undefined
            ? flat
            : Object.values(flat).flatMap((value) => (Array.isArray(value) ? value : [value]))[0];
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
      throw new ConnectorError("malformed_response", "Instagram returned an empty response body", { retryable: false });

    if (!spec?.list) return { items: [mapEntity(spec?.kind, body)], cursor: null, raw: payload };

    const data = body["data"];
    if (!Array.isArray(data))
      throw new ConnectorError("malformed_response", "Instagram list response did not contain a collection", {
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
