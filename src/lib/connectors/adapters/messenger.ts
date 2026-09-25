import { facebookPagesConnector } from "@/lib/connectors/adapters/facebook-pages";
import {
  normalizeMessengerConversation,
  normalizeMessengerMessage,
  normalizeMessengerSendResult,
  normalizeMessengerUserProfile,
} from "@/lib/connectors/adapters/messenger-map";
import { asRecord, assertRequiredParams, pickInto } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage } from "@/lib/connectors/types";

/**
 * Messenger connector (official Meta Messenger Platform via the Graph API).
 *
 * Owns authentication, API calls, normalization and error mapping — nothing
 * else. No AI, business logic, CRM or database access. All calls use the Page
 * access token of the Messenger-enabled Page (`pages_messaging`).
 */

export const MESSENGER_API_VERSION = "v23.0";
const GRAPH_HOST = "https://graph.facebook.com";
/** Replaced in `authorize` with the connection's own Page id. */
const PAGE_PLACEHOLDER = "messenger-page-id-placeholder";
const DEFAULT_PAGE_SIZE = 25;

export const MESSAGING_TYPES = ["RESPONSE", "UPDATE", "MESSAGE_TAG"] as const;
/** Official message tags for sending outside the 24-hour standard window. */
export const MESSAGE_TAGS = ["CONFIRMED_EVENT_UPDATE", "POST_PURCHASE_UPDATE", "ACCOUNT_UPDATE", "HUMAN_AGENT"] as const;
export const SENDER_ACTIONS = ["typing_on", "typing_off", "mark_seen"] as const;
export const ATTACHMENT_TYPES = ["image", "audio", "video", "file", "template"] as const;

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  send_unsolicited_message:
    "Outside the 24-hour standard messaging window Meta only allows the official message tags (or approved features); free-form outreach is rejected.",
  edit_message: "The Send API has no endpoint to edit a message after it has been delivered.",
  delete_message: "The Send API has no endpoint to unsend/delete a delivered message for the recipient.",
  upload_media_binary:
    "The Attachment Upload API is used with a publicly reachable url; multipart binary upload is not part of the JSON runtime.",
  lookup_user_by_phone_or_email:
    "Messenger identifies people only by Page-scoped IDs (PSID); resolving a phone/email to a PSID is not generally available.",
  read_personal_inbox: "Only the connected Page's conversations are accessible; personal Messenger inboxes are never exposed.",
  broadcast_messages: "The Messenger broadcast/subscription messaging API is retired by Meta.",
  idempotency_key:
    "Meta publishes no idempotency header for the Send API; webhook dedupe uses official mids and duplicate sends stay guarded by the ZYRONEX runtime.",
};

type Kind = "message" | "conversation" | "send" | "profile" | "raw";

type Spec = {
  method: HttpMethod;
  path: string;
  kind?: Kind;
  list?: boolean;
  required?: string[];
  query?: string[];
  body?: string[];
};

const P = `/${PAGE_PLACEHOLDER}`;

const OPERATIONS: Record<string, Spec> = {
  // ---- Page / account -------------------------------------------------------
  get_page: { method: "GET", path: P, kind: "raw", query: ["fields"] },

  // ---- Send API --------------------------------------------------------------
  send_message: { method: "POST", path: `${P}/messages`, kind: "send", required: ["recipient_id"] },
  send_reply: { method: "POST", path: `${P}/messages`, kind: "send", required: ["recipient_id", "reply_to_mid"] },
  send_attachment: { method: "POST", path: `${P}/messages`, kind: "send", required: ["recipient_id", "attachment_type"] },
  send_sender_action: { method: "POST", path: `${P}/messages`, kind: "send", required: ["recipient_id", "sender_action"] },
  upload_attachment: {
    method: "POST",
    path: `${P}/message_attachments`,
    kind: "send",
    required: ["attachment_type", "url"],
  },

  // ---- Conversations API -----------------------------------------------------
  list_conversations: {
    method: "GET",
    path: `${P}/conversations`,
    kind: "conversation",
    list: true,
    query: ["fields", "user_id", "folder"],
  },
  get_conversation: {
    method: "GET",
    path: "/:conversation_id",
    kind: "conversation",
    required: ["conversation_id"],
    query: ["fields"],
  },
  list_conversation_messages: {
    method: "GET",
    path: "/:conversation_id/messages",
    kind: "message",
    list: true,
    required: ["conversation_id"],
    query: ["fields"],
  },
  get_message: { method: "GET", path: "/:message_id", kind: "message", required: ["message_id"], query: ["fields"] },

  // ---- User Profile API ------------------------------------------------------
  get_user_profile: { method: "GET", path: "/:psid", kind: "profile", required: ["psid"], query: ["fields"] },

  // ---- Messenger Profile API (page-level config) -----------------------------
  get_messenger_profile: { method: "GET", path: `${P}/messenger_profile`, kind: "raw", list: true, required: ["fields"], query: ["fields"] },
  set_messenger_profile: {
    method: "POST",
    path: `${P}/messenger_profile`,
    kind: "raw",
    body: ["get_started", "greeting", "persistent_menu", "ice_breakers", "whitelisted_domains"],
  },
  delete_messenger_profile: { method: "DELETE", path: `${P}/messenger_profile`, kind: "raw", required: ["fields"] },

  // ---- Webhook subscriptions -------------------------------------------------
  list_subscribed_apps: { method: "GET", path: `${P}/subscribed_apps`, kind: "raw", list: true },
  subscribe_app: { method: "POST", path: `${P}/subscribed_apps`, kind: "raw", required: ["subscribed_fields"] },
  unsubscribe_app: { method: "DELETE", path: `${P}/subscribed_apps`, kind: "raw" },
};

const DEFAULT_FIELDS: Record<string, string> = {
  list_conversations: "id,updated_time,message_count,unread_count,participants,link",
  list_conversation_messages: "id,created_time,from,to,message,attachments",
  get_message: "id,created_time,from,to,message,attachments",
  get_user_profile: "first_name,last_name,profile_pic",
  get_page: "id,name,category,username",
};

function mapEntity(kind: Kind | undefined, value: unknown): Record<string, unknown> {
  if (kind === "message") return normalizeMessengerMessage(value) as unknown as Record<string, unknown>;
  if (kind === "conversation") return normalizeMessengerConversation(value) as unknown as Record<string, unknown>;
  if (kind === "send") return normalizeMessengerSendResult(value) as unknown as Record<string, unknown>;
  if (kind === "profile") return normalizeMessengerUserProfile(value) as unknown as Record<string, unknown>;
  return asRecord(value);
}

/** Graph ids: numeric, `t_…` conversation ids, or `m_…` message ids. */
function safeObjectId(value: unknown): string {
  const raw = String(value ?? "").trim();
  return /^([0-9]{3,}|t_[A-Za-z0-9_-]{3,}|m_[A-Za-z0-9_-]{3,})$/.test(raw) ? raw : "";
}

function safePageId(value: string): string {
  const trimmed = value.trim();
  return /^[0-9]{5,}$/.test(trimmed) ? trimmed : "";
}

function invalid(message: string): never {
  throw new ConnectorError("invalid_request", message, { retryable: false });
}

function oneOf<T extends readonly string[]>(list: T, value: unknown, label: string): T[number] {
  const v = String(value ?? "");
  if (!(list as readonly string[]).includes(v)) invalid(`\`${label}\` must be one of ${list.join(", ")}`);
  return v as T[number];
}

/** Builds the official Send API body; enforces messaging_type/tag rules. */
function sendBody(operation: string, params: Record<string, unknown>): Record<string, unknown> {
  const recipient = { id: String(params["recipient_id"]) };
  if (operation === "send_sender_action")
    return { recipient, sender_action: oneOf(SENDER_ACTIONS, params["sender_action"], "sender_action") };

  const messagingType = oneOf(MESSAGING_TYPES, params["messaging_type"] ?? "RESPONSE", "messaging_type");
  const body: Record<string, unknown> = { recipient, messaging_type: messagingType };
  if (messagingType === "MESSAGE_TAG") body["tag"] = oneOf(MESSAGE_TAGS, params["tag"], "tag");

  let message: Record<string, unknown>;
  if (operation === "send_attachment") {
    const type = oneOf(ATTACHMENT_TYPES, params["attachment_type"], "attachment_type");
    const payload: Record<string, unknown> = {};
    if (type === "template") {
      if (!params["template_payload"]) invalid("`template_payload` is required for template attachments");
      Object.assign(payload, asRecord(params["template_payload"]));
    } else if (params["attachment_id"]) payload["attachment_id"] = String(params["attachment_id"]);
    else if (typeof params["url"] === "string" && /^https:\/\//.test(params["url"])) {
      payload["url"] = params["url"];
      if (params["is_reusable"] !== undefined) payload["is_reusable"] = Boolean(params["is_reusable"]);
    } else invalid("`attachment_id` or an https `url` is required for send_attachment");
    message = { attachment: { type, payload } };
  } else {
    const text = typeof params["text"] === "string" ? params["text"] : "";
    if (!text) invalid(`\`text\` is required for ${operation}`);
    message = { text };
    if (Array.isArray(params["quick_replies"])) message["quick_replies"] = params["quick_replies"];
  }
  if (params["metadata"] !== undefined) message["metadata"] = String(params["metadata"]);
  body["message"] = message;
  if (operation === "send_reply") body["reply_to"] = { mid: String(params["reply_to_mid"]) };
  return body;
}

export const messengerConnector: ConnectorAdapter = {
  id: "messenger",
  label: "Messenger",
  capabilities: ["read", "write", "messaging", "files", "pagination", "webhook", "health_check"],
  credentials: {
    kind: "bearer",
    required: ["access_token", "page_id"],
    optional: ["user_access_token", "app_secret", "verify_token"],
  },
  operations: Object.keys(OPERATIONS),
  healthOperation: "get_page",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Messenger operation "${operation}"`, { retryable: false });
    assertRequiredParams(operation, params, spec.required);

    const path = spec.path.replace(/:([a-z_]+)/g, (_m, key: string) => {
      const id = safeObjectId(params[key]);
      if (!id) invalid(`\`${key}\` is not a valid Messenger id`);
      return id;
    });

    const query: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(pickInto(params, spec.query)))
      query[key] = Array.isArray(value) ? value.join(",") : (value as string | number);
    if (spec.method === "GET" && !query["fields"] && DEFAULT_FIELDS[operation]) query["fields"] = DEFAULT_FIELDS[operation];
    if (operation === "list_conversations") query["platform"] = "messenger";
    if (spec.list && operation !== "get_messenger_profile") {
      query["limit"] = Number(params["limit"] ?? DEFAULT_PAGE_SIZE);
      if (cursor) query["after"] = String(cursor);
    }

    let body: Record<string, unknown> | undefined;
    if (operation.startsWith("send_")) body = sendBody(operation, params);
    else if (operation === "upload_attachment") {
      const type = oneOf(["image", "audio", "video", "file"] as const, params["attachment_type"], "attachment_type");
      if (typeof params["url"] !== "string" || !/^https:\/\//.test(params["url"])) invalid("`url` must be an https URL");
      body = { message: { attachment: { type, payload: { url: params["url"], is_reusable: true } } } };
    } else if (operation === "subscribe_app") {
      const fields = params["subscribed_fields"];
      body = { subscribed_fields: Array.isArray(fields) ? fields.join(",") : String(fields) };
    } else if (operation === "delete_messenger_profile") {
      const fields = params["fields"];
      body = { fields: Array.isArray(fields) ? fields : [String(fields)] };
    } else if (spec.method === "POST") body = pickInto(params, spec.body);

    return {
      method: spec.method,
      url: `${GRAPH_HOST}/${MESSENGER_API_VERSION}${path}`,
      headers: { "content-type": "application/json", accept: "application/json" },
      query,
      ...(body ? { body } : {}),
      paginated: Boolean(spec.list),
    };
  },

  authorize: (call, credentials) => {
    const token = credentials["access_token"];
    if (!token) throw new ConnectorError("auth", "The Messenger Page is not connected yet", { retryable: false });
    let url = call.url;
    if (url.includes(PAGE_PLACEHOLDER)) {
      const pageId = safePageId(credentials["page_id"] ?? "");
      if (!pageId) throw new ConnectorError("auth", "The Messenger Page ID is missing from this connection", { retryable: false });
      url = url.replace(PAGE_PLACEHOLDER, pageId);
    }
    return { ...call, url, headers: { ...call.headers, authorization: `Bearer ${token}` } };
  },

  /** Same Graph error envelope and official codes as the other Meta adapters. */
  mapError: (status, payload) => {
    const mapped = facebookPagesConnector.mapError?.(status, payload);
    return mapped ? { ...mapped, message: mapped.message.replace(/^Facebook Pages/, "Messenger") } : null;
  },

  /** Graph quota headers (`X-App-Usage`, `X-Page-Usage`, BUC) + `Retry-After`. */
  readRateLimit: (headers, payload) => facebookPagesConnector.readRateLimit?.(headers, payload),

  normalize: (operation, payload): NormalizedPage => {
    const spec = OPERATIONS[operation];
    const body = asRecord(payload);
    if (Object.keys(body).length === 0)
      throw new ConnectorError("malformed_response", "Messenger returned an empty response body", { retryable: false });
    if (!spec?.list) return { items: [mapEntity(spec?.kind, body)], cursor: null, raw: payload };

    const data = body["data"];
    if (!Array.isArray(data))
      throw new ConnectorError("malformed_response", "Messenger list response did not contain a collection", { retryable: false });
    const paging = asRecord(body["paging"]);
    const after = asRecord(paging["cursors"])["after"];
    const cursor = paging["next"] && typeof after === "string" ? after : null;
    return { items: data.map((item) => mapEntity(spec.kind, item)), cursor, raw: payload };
  },
};
