import {
  buildMimeMessage,
  encodeRaw,
  normalizeGmailDraft,
  normalizeGmailHistory,
  normalizeGmailLabel,
  normalizeGmailMessage,
  normalizeGmailProfile,
  normalizeGmailThread,
  type GmailComposeInput,
} from "@/lib/connectors/adapters/gmail-map";
import { asRecord, assertRequiredParams } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Gmail connector — official Gmail API v1 only
 * (https://developers.google.com/gmail/api/reference/rest).
 *
 * Owns authentication, API calls, MIME composition for the official `raw`
 * field, normalization, pagination (`pageToken` / `nextPageToken`) and error
 * mapping. No AI, business logic, CRM or database access. The OAuth access
 * token lives in the Credential Vault and is injected by `authorize` only.
 */

export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/** Least-privilege scope per operation group (documented Gmail scopes). */
export const GMAIL_SCOPES = {
  readonly: "https://www.googleapis.com/auth/gmail.readonly",
  send: "https://www.googleapis.com/auth/gmail.send",
  compose: "https://www.googleapis.com/auth/gmail.compose",
  modify: "https://www.googleapis.com/auth/gmail.modify",
  labels: "https://www.googleapis.com/auth/gmail.labels",
  /** Only permanent delete / batchDelete require full mailbox access. */
  full: "https://mail.google.com/",
} as const;

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  media_upload_send:
    "The /upload/gmail/v1 media endpoint needs a multipart or resumable binary upload; the JSON runtime sends messages through the `raw` field only (up to 5 MB).",
  http_batch_endpoint:
    "The Google HTTP batch endpoint needs a multipart/mixed request and response; the connector uses the official JSON batchModify / batchDelete methods instead.",
  attachment_binary_download:
    "messages.attachments.get returns base64url data in JSON (supported); streaming raw bytes to storage is not part of the JSON runtime.",
  idempotency_key:
    "The Gmail API publishes no idempotency header or request id for send; duplicate sends stay guarded by ZYRONEX execution idempotency and results carry Gmail message/thread ids.",
  push_payload_contains_message:
    "Gmail push notifications carry only emailAddress + historyId; the message must be read with history.list / messages.get.",
  pubsub_oidc_signature_verification:
    "Verifying the Pub/Sub push OIDC JWT signature needs Google's rotating JWKS fetched asynchronously; the synchronous shared verifier checks the configured audience, issuer and expiry only.",
  gmail_settings_admin:
    "Settings (filters, forwarding addresses, delegates, send-as) need gmail.settings.* scopes and are outside the connector scope.",
  permanent_delete_without_full_scope:
    "messages.delete / threads.delete / batchDelete require https://mail.google.com/; with the default least-privilege scopes use trash instead.",
  search_outside_mailbox: "Gmail search only covers the authorized user's own mailbox; there is no cross-user search.",
};

type Kind = "message" | "messages" | "thread" | "threads" | "label" | "labels" | "draft" | "drafts" | "profile" | "history" | "attachment" | "raw" | "empty";

type Spec = {
  verb: HttpMethod;
  path: (p: Record<string, unknown>) => string;
  kind: Kind;
  required?: string[];
  /** Response key that holds the page of items. */
  collection?: string;
  paginated?: boolean;
  /** Query params: snake_case input → Gmail name. */
  query?: Record<string, string>;
  body?: (p: Record<string, unknown>) => unknown;
  scope: keyof typeof GMAIL_SCOPES;
};

const enc = (v: unknown) => encodeURIComponent(String(v));

function compose(p: Record<string, unknown>): GmailComposeInput {
  const out: GmailComposeInput = {};
  for (const key of ["from", "to", "cc", "bcc", "reply_to", "subject", "text", "html", "headers", "in_reply_to", "references", "attachments"] as const)
    if (p[key] !== undefined) (out as Record<string, unknown>)[key] = p[key];
  return out;
}

function sendBody(p: Record<string, unknown>): Record<string, unknown> {
  const raw = encodeRaw(buildMimeMessage(compose(p)));
  return { raw, ...(p["thread_id"] ? { threadId: String(p["thread_id"]) } : {}) };
}

function replySubject(subject: unknown): string | undefined {
  if (typeof subject !== "string") return undefined;
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

function replyBody(p: Record<string, unknown>) {
  const refs = [
    ...(Array.isArray(p["references"]) ? (p["references"] as string[]) : typeof p["references"] === "string" ? [p["references"]] : []),
  ];
  const inReplyTo = String(p["in_reply_to"]);
  if (!refs.includes(inReplyTo)) refs.push(inReplyTo);
  const subject = replySubject(p["subject"]);
  return sendBody({ ...p, ...(subject ? { subject } : {}), references: refs.join(" ") });
}

function forwardBody(p: Record<string, unknown>) {
  const original = String(p["original_raw"]).replace(/-/g, "+").replace(/_/g, "/");
  const subject = typeof p["subject"] === "string" ? (/^fwd?:/i.test(p["subject"]) ? p["subject"] : `Fwd: ${p["subject"]}`) : "Fwd:";
  const attachments = [
    ...(Array.isArray(p["attachments"]) ? (p["attachments"] as GmailComposeInput["attachments"] & object) : []),
    { filename: "forwarded-message.eml", mime_type: "message/rfc822", content_base64: original },
  ];
  const { thread_id: _drop, ...rest } = p;
  return sendBody({ ...rest, subject, attachments });
}

function labelBody(p: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (p["name"] !== undefined) out["name"] = p["name"];
  if (p["message_list_visibility"] !== undefined) out["messageListVisibility"] = p["message_list_visibility"];
  if (p["label_list_visibility"] !== undefined) out["labelListVisibility"] = p["label_list_visibility"];
  if (p["color"] !== undefined) out["color"] = p["color"];
  return out;
}

function modifyBody(p: Record<string, unknown>) {
  const add = p["add_label_ids"];
  const remove = p["remove_label_ids"];
  if (!Array.isArray(add) && !Array.isArray(remove))
    throw new ConnectorError("invalid_request", "`add_label_ids` or `remove_label_ids` is required", { retryable: false });
  return { ...(Array.isArray(add) ? { addLabelIds: add } : {}), ...(Array.isArray(remove) ? { removeLabelIds: remove } : {}) };
}

function idsBody(p: Record<string, unknown>) {
  const ids = p["ids"];
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 1000)
    throw new ConnectorError("invalid_request", "`ids` must be a list of 1–1000 message ids", { retryable: false });
  return { ids };
}

const LIST_QUERY = { query: "q", label_ids: "labelIds", include_spam_trash: "includeSpamTrash" };

const OPERATIONS: Record<string, Spec> = {
  // ---- Identity / health -----------------------------------------------------
  get_profile: { verb: "GET", path: () => "/profile", kind: "profile", scope: "readonly" },

  // ---- Messages --------------------------------------------------------------
  list_messages: { verb: "GET", path: () => "/messages", kind: "messages", collection: "messages", paginated: true, query: LIST_QUERY, scope: "readonly" },
  search_messages: {
    verb: "GET", path: () => "/messages", kind: "messages", collection: "messages", paginated: true, required: ["query"], query: LIST_QUERY, scope: "readonly",
  },
  get_message: {
    verb: "GET", path: (p) => `/messages/${enc(p["message_id"])}`, kind: "message", required: ["message_id"],
    query: { format: "format", metadata_headers: "metadataHeaders" }, scope: "readonly",
  },
  send_message: { verb: "POST", path: () => "/messages/send", kind: "message", required: ["to"], body: sendBody, scope: "send" },
  reply_message: {
    verb: "POST", path: () => "/messages/send", kind: "message", required: ["to", "thread_id", "in_reply_to"], body: replyBody, scope: "send",
  },
  forward_message: {
    verb: "POST", path: () => "/messages/send", kind: "message", required: ["to", "original_raw"], body: forwardBody, scope: "send",
  },
  modify_message: {
    verb: "POST", path: (p) => `/messages/${enc(p["message_id"])}/modify`, kind: "message", required: ["message_id"], body: modifyBody, scope: "modify",
  },
  trash_message: { verb: "POST", path: (p) => `/messages/${enc(p["message_id"])}/trash`, kind: "message", required: ["message_id"], scope: "modify" },
  untrash_message: { verb: "POST", path: (p) => `/messages/${enc(p["message_id"])}/untrash`, kind: "message", required: ["message_id"], scope: "modify" },
  delete_message: { verb: "DELETE", path: (p) => `/messages/${enc(p["message_id"])}`, kind: "empty", required: ["message_id"], scope: "full" },
  batch_modify_messages: {
    verb: "POST", path: () => "/messages/batchModify", kind: "empty", required: ["ids"],
    body: (p) => ({ ...idsBody(p), ...modifyBody(p) }), scope: "modify",
  },
  batch_delete_messages: { verb: "POST", path: () => "/messages/batchDelete", kind: "empty", required: ["ids"], body: idsBody, scope: "full" },
  get_attachment: {
    verb: "GET", path: (p) => `/messages/${enc(p["message_id"])}/attachments/${enc(p["attachment_id"])}`, kind: "attachment",
    required: ["message_id", "attachment_id"], scope: "readonly",
  },

  // ---- Threads ---------------------------------------------------------------
  list_threads: { verb: "GET", path: () => "/threads", kind: "threads", collection: "threads", paginated: true, query: LIST_QUERY, scope: "readonly" },
  get_thread: {
    verb: "GET", path: (p) => `/threads/${enc(p["thread_id"])}`, kind: "thread", required: ["thread_id"],
    query: { format: "format", metadata_headers: "metadataHeaders" }, scope: "readonly",
  },
  modify_thread: {
    verb: "POST", path: (p) => `/threads/${enc(p["thread_id"])}/modify`, kind: "thread", required: ["thread_id"], body: modifyBody, scope: "modify",
  },
  trash_thread: { verb: "POST", path: (p) => `/threads/${enc(p["thread_id"])}/trash`, kind: "thread", required: ["thread_id"], scope: "modify" },
  untrash_thread: { verb: "POST", path: (p) => `/threads/${enc(p["thread_id"])}/untrash`, kind: "thread", required: ["thread_id"], scope: "modify" },
  delete_thread: { verb: "DELETE", path: (p) => `/threads/${enc(p["thread_id"])}`, kind: "empty", required: ["thread_id"], scope: "full" },

  // ---- Labels ----------------------------------------------------------------
  list_labels: { verb: "GET", path: () => "/labels", kind: "labels", collection: "labels", scope: "labels" },
  get_label: { verb: "GET", path: (p) => `/labels/${enc(p["label_id"])}`, kind: "label", required: ["label_id"], scope: "labels" },
  create_label: { verb: "POST", path: () => "/labels", kind: "label", required: ["name"], body: labelBody, scope: "labels" },
  update_label: { verb: "PATCH", path: (p) => `/labels/${enc(p["label_id"])}`, kind: "label", required: ["label_id"], body: labelBody, scope: "labels" },
  delete_label: { verb: "DELETE", path: (p) => `/labels/${enc(p["label_id"])}`, kind: "empty", required: ["label_id"], scope: "labels" },

  // ---- Drafts ----------------------------------------------------------------
  list_drafts: {
    verb: "GET", path: () => "/drafts", kind: "drafts", collection: "drafts", paginated: true,
    query: { query: "q", include_spam_trash: "includeSpamTrash" }, scope: "compose",
  },
  get_draft: { verb: "GET", path: (p) => `/drafts/${enc(p["draft_id"])}`, kind: "draft", required: ["draft_id"], query: { format: "format" }, scope: "compose" },
  create_draft: { verb: "POST", path: () => "/drafts", kind: "draft", body: (p) => ({ message: sendBody(p) }), scope: "compose" },
  update_draft: {
    verb: "PUT", path: (p) => `/drafts/${enc(p["draft_id"])}`, kind: "draft", required: ["draft_id"],
    body: (p) => ({ id: String(p["draft_id"]), message: sendBody(p) }), scope: "compose",
  },
  delete_draft: { verb: "DELETE", path: (p) => `/drafts/${enc(p["draft_id"])}`, kind: "empty", required: ["draft_id"], scope: "compose" },
  send_draft: { verb: "POST", path: () => "/drafts/send", kind: "message", required: ["draft_id"], body: (p) => ({ id: String(p["draft_id"]) }), scope: "compose" },

  // ---- History / push watch --------------------------------------------------
  list_history: {
    verb: "GET", path: () => "/history", kind: "history", collection: "history", paginated: true, required: ["start_history_id"],
    query: { start_history_id: "startHistoryId", history_types: "historyTypes", label_id: "labelId" }, scope: "readonly",
  },
  watch_mailbox: {
    verb: "POST", path: () => "/watch", kind: "raw", required: ["topic_name"],
    body: (p) => ({
      topicName: p["topic_name"],
      ...(Array.isArray(p["label_ids"]) ? { labelIds: p["label_ids"] } : {}),
      ...(p["label_filter_behavior"] ? { labelFilterBehavior: p["label_filter_behavior"] } : {}),
    }),
    scope: "readonly",
  },
  stop_watch: { verb: "POST", path: () => "/stop", kind: "empty", scope: "readonly" },
};

export const GMAIL_OPERATIONS = Object.keys(OPERATIONS);

/** Least-privilege scope required by an operation (for UI/permission checks). */
export function gmailScopeFor(operation: string): string | undefined {
  const spec = OPERATIONS[operation];
  return spec ? GMAIL_SCOPES[spec.scope] : undefined;
}

function buildUrl(spec: Spec, params: Record<string, unknown>, cursor: string | null | undefined): string {
  const url = new URL(`${GMAIL_API_BASE}${spec.path(params)}`);
  for (const [from, to] of Object.entries(spec.query ?? {})) {
    const value = params[from];
    if (value === undefined || value === null || value === "") continue;
    // Gmail documents repeated query params for list values (labelIds, historyTypes, metadataHeaders).
    if (Array.isArray(value)) for (const v of value) url.searchParams.append(to, String(v));
    else url.searchParams.set(to, String(value));
  }
  if (spec.paginated) {
    const limit = Math.min(Math.max(Number(params["limit"] ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    url.searchParams.set("maxResults", String(limit));
    if (cursor) url.searchParams.set("pageToken", cursor);
  }
  return url.toString();
}

function normalizeByKind(kind: Kind, value: unknown): Record<string, unknown> {
  switch (kind) {
    case "message":
    case "messages":
      return normalizeGmailMessage(value);
    case "thread":
    case "threads":
      return normalizeGmailThread(value);
    case "label":
    case "labels":
      return normalizeGmailLabel(value);
    case "draft":
    case "drafts":
      return normalizeGmailDraft(value);
    case "history":
      return normalizeGmailHistory(value);
    case "profile":
      return normalizeGmailProfile(value);
    default:
      return asRecord(value);
  }
}

const RATE_REASONS = ["rateLimitExceeded", "userRateLimitExceeded", "quotaExceeded", "dailyLimitExceeded", "backendError"];

export const gmailConnector: ConnectorAdapter = {
  id: "google_mail",
  label: "Gmail",
  capabilities: ["read", "write", "messaging", "search", "pagination", "files", "webhook", "health_check"],
  credentials: { kind: "oauth2", required: ["access_token"], optional: ["refresh_token"] },
  operations: GMAIL_OPERATIONS,
  healthOperation: "get_profile",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    if (UNSUPPORTED_OPERATIONS[operation])
      throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS[operation]}`, { retryable: false });
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Gmail operation "${operation}"`, { retryable: false });
    assertRequiredParams(operation, params, spec.required);
    const url = buildUrl(spec, params, cursor);
    const headers: Record<string, string> = { accept: "application/json" };
    if (spec.verb === "GET" || spec.verb === "DELETE" || !spec.body)
      return { method: spec.verb, url, headers, ...(spec.paginated ? { paginated: true } : {}) };
    return { method: spec.verb, url, headers: { ...headers, "content-type": "application/json; charset=utf-8" }, body: spec.body(params) };
  },

  authorize: (call, credentials) => {
    const token = (credentials["access_token"] ?? "").trim();
    if (!token) throw new ConnectorError("auth", "The Gmail account is not connected yet", { retryable: false });
    return { ...call, headers: { ...call.headers, authorization: `Bearer ${token}` } };
  },

  /** Google's `{ error: { code, message, status, errors:[{reason}] } }` envelope. */
  mapError: (status, payload) => {
    if (status < 400) return null;
    const error = asRecord(asRecord(payload)["error"]);
    const message = String(error["message"] ?? `Gmail request failed (${status})`);
    const reasons = Array.isArray(error["errors"]) ? (error["errors"] as unknown[]).map((e) => String(asRecord(e)["reason"] ?? "")) : [];
    const gstatus = String(error["status"] ?? "");
    if (status === 401) return { kind: "auth", message: `Gmail rejected the token: ${message}`, retryable: false };
    if (status === 429 || gstatus === "RESOURCE_EXHAUSTED" || reasons.some((r) => RATE_REASONS.slice(0, 4).includes(r)))
      return { kind: "rate_limit", message: `Gmail quota exceeded: ${message}`, retryable: true };
    if (status === 403) {
      if (reasons.includes("insufficientPermissions") || gstatus === "PERMISSION_DENIED" || /scope/i.test(message))
        return { kind: "forbidden", message: `Gmail scope missing: ${message}`, retryable: false };
      return { kind: "forbidden", message: `Gmail denied the request: ${message}`, retryable: false };
    }
    if (status === 404) return { kind: "not_found", message: `Gmail resource not found: ${message}`, retryable: false };
    if (status >= 500) return { kind: "provider", message: `Gmail is temporarily unavailable: ${message}`, retryable: true };
    return { kind: "invalid_request", message: `Gmail rejected the request: ${message}`, retryable: false };
  },

  readRateLimit: (headers): RateLimitInfo | undefined => {
    const retryAfter = headers.get("retry-after");
    if (!retryAfter) return undefined;
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return { retryAfterMs: Math.max(0, seconds) * 1000, remaining: 0 };
    const at = Date.parse(retryAfter);
    return Number.isFinite(at) ? { retryAfterMs: Math.max(0, at - Date.now()), remaining: 0, resetAt: new Date(at).toISOString() } : undefined;
  },

  normalize: (operation, payload): NormalizedPage => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Gmail operation "${operation}"`, { retryable: false });
    if (spec.kind === "empty") return { items: [{ ok: true, operation }], cursor: null, raw: payload };
    const body = asRecord(payload);
    if (payload !== null && typeof payload !== "object")
      throw new ConnectorError("malformed_response", "Gmail returned a non-JSON body", { retryable: false });

    if (spec.kind === "attachment")
      return { items: [{ attachment_id: body["attachmentId"] ?? null, size: body["size"] ?? null, data: body["data"] ?? null }], cursor: null, raw: payload };

    if (!spec.collection) return { items: [normalizeByKind(spec.kind, body)], cursor: null, raw: payload };

    const list = body[spec.collection];
    if (list !== undefined && !Array.isArray(list))
      throw new ConnectorError("malformed_response", `Gmail response field "${spec.collection}" is not a list`, { retryable: false });
    const token = body["nextPageToken"];
    return {
      items: Array.isArray(list) ? list.map((v) => normalizeByKind(spec.kind, v)) : [],
      cursor: typeof token === "string" && token.length > 0 ? token : null,
      raw: payload,
    };
  },
};
