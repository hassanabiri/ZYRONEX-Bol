import {
  INTERCOM_HOSTS,
  intercomRegion,
  normalizeIntercomAdmin,
  normalizeIntercomCompany,
  normalizeIntercomContact,
  normalizeIntercomConversation,
  normalizeIntercomEntity,
} from "@/lib/connectors/adapters/intercom-map";
import { asRecord, assertRequiredParams } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Intercom connector — official Intercom REST API only (pinned `Intercom-Version`).
 *
 * Hosts are the official regional endpoints (US / EU / AU), selected from the
 * vault `region` value — never from caller input. Calls are built against a
 * placeholder origin and re-homed in `authorize`.
 *
 * Pagination: `pages.next.starting_after` cursors (contacts, conversations,
 * search); page numbers for companies, tags-free lists. Only the opaque token
 * is carried, never a URL.
 *
 * No AI, routing, assignment rules, SLAs or any support business logic.
 */

export const INTERCOM_API_VERSION = "2.11";
export const INTERCOM_PLACEHOLDER_ORIGIN = "https://workspace.intercom.invalid";
const MAX_PER_PAGE = 150;

export function intercomOrigin(region: unknown): string {
  const r = intercomRegion(region);
  if (!r) throw new ConnectorError("auth", "The Intercom region must be one of the official regions (us, eu, au)", { retryable: false });
  return INTERCOM_HOSTS[r];
}

export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  idempotency_key: "Intercom documents no idempotency header; duplicate writes stay guarded by ZYRONEX execution idempotency.",
  upload_attachment: "Binary file upload needs a binary/multipart transfer the JSON runtime does not carry; replies accept official attachment_urls instead.",
  download_attachment: "Attachment URLs return binary content, which the JSON runtime does not carry.",
  webhook_subscription_management: "Intercom webhook topics are configured on the app in the Developer Hub; there is no public REST API to manage subscriptions.",
  delete_conversation: "Conversation deletion is an irreversible administrative action outside the connector scope.",
  edit_conversation_part: "Sent conversation parts cannot be edited through a supported public endpoint.",
  merge_contacts: "Merging a lead into a user is irreversible identity administration outside the connector scope.",
  manage_data_attribute_schema: "Creating/updating data attribute definitions changes the workspace schema; only definitions are read.",
  manage_admins_teams: "Admin and team administration is not exposed by the public API beyond away status; read-only is provided.",
  token_refresh: "Intercom OAuth access tokens do not expire and no refresh grant is documented.",
  oauth_revoke: "Intercom documents no token revocation endpoint; access ends when the workspace uninstalls the app.",
  fin_ai_and_routing: "Fin/AI agents, assignment rules and workflows are business logic owned by ZYRONEX.",
};

type Kind = "contact" | "contacts" | "company" | "companies" | "conversation" | "conversations" | "admin" | "admins" | "entity" | "list" | "deleted";
type Paging = "cursor" | "page";
type Params = Record<string, unknown>;
type Spec = {
  verb: HttpMethod;
  path: (p: Params) => string;
  kind: Kind;
  /** Response key holding the rows (`data`, `admins`, `teams`...). */
  key?: string;
  required?: string[];
  paging?: Paging;
  /** POST search: cursor goes into the body `pagination` object. */
  bodyPaging?: boolean;
  query?: (p: Params) => Record<string, string>;
  body?: (p: Params) => Record<string, unknown>;
};

const invalid = (m: string) => new ConnectorError("invalid_request", m, { retryable: false });

export function assertIntercomId(value: unknown, field = "id"): string {
  const id = String(value ?? "");
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw invalid(`\`${field}\` must be an Intercom id`);
  return id;
}

export function assertCursor(paging: Paging, value: string): string {
  if (paging === "page" ? !/^[1-9]\d{0,5}$/.test(value) : !/^[A-Za-z0-9+/=_-]{1,1024}$/.test(value))
    throw invalid("Pagination cursor is not an official Intercom cursor");
  return value;
}

function attrs(p: Params, key = "fields"): Record<string, unknown> {
  const v = p[key];
  if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid(`\`${key}\` must be an object of Intercom attributes`);
  for (const k of Object.keys(v)) if (!/^[a-z_][a-z0-9_]{0,63}$/.test(k)) throw invalid(`\`${k}\` is not an official Intercom attribute name`);
  return v as Record<string, unknown>;
}

const SEARCH_OPERATORS = new Set(["=", "!=", "IN", "NIN", ">", "<", "~", "!~", "^", "$"]);

/** Validates the documented Intercom search query shape; it is passed through verbatim. */
export function assertSearchQuery(q: unknown, depth = 0): Record<string, unknown> {
  const node = asRecord(q);
  if (depth > 2) throw invalid("Intercom search supports at most two levels of nesting");
  const op = node["operator"];
  if (op === "AND" || op === "OR") {
    const value = node["value"];
    if (!Array.isArray(value) || !value.length || value.length > 15) throw invalid("Intercom AND/OR needs 1–15 nested filters");
    value.forEach((v) => assertSearchQuery(v, depth + 1));
    return node;
  }
  if (typeof node["field"] !== "string" || !/^[A-Za-z0-9_.]{1,128}$/.test(node["field"])) throw invalid("Intercom search filter needs a `field`");
  if (typeof op !== "string" || !SEARCH_OPERATORS.has(op)) throw invalid("Intercom search `operator` is not an official operator");
  if (!("value" in node)) throw invalid("Intercom search filter needs a `value`");
  return node;
}

function adminAction(p: Params): { type: "admin"; admin_id: string } {
  return { type: "admin", admin_id: assertIntercomId(p["admin_id"], "admin_id") };
}

function urls(p: Params): string[] | undefined {
  const v = p["attachment_urls"];
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length > 10 || v.some((u) => typeof u !== "string" || !/^https:\/\/[^\s]+$/.test(u))) throw invalid("`attachment_urls` must be up to 10 https URLs");
  return v as string[];
}

const id = (p: Params, field = "id") => assertIntercomId(p[field], field);

const OPERATIONS: Record<string, Spec> = {
  // ---- Identity -----------------------------------------------------------------
  get_me: { verb: "GET", path: () => "/me", kind: "admin" },
  list_admins: { verb: "GET", path: () => "/admins", kind: "admins", key: "admins" },
  get_admin: { verb: "GET", path: (p) => `/admins/${id(p)}`, kind: "admin", required: ["id"] },
  list_teams: { verb: "GET", path: () => "/teams", kind: "list", key: "teams" },
  get_team: { verb: "GET", path: (p) => `/teams/${id(p)}`, kind: "entity", required: ["id"] },

  // ---- Contacts -------------------------------------------------------------------
  create_contact: { verb: "POST", path: () => "/contacts", kind: "contact", required: ["fields"], body: (p) => {
    const f = attrs(p);
    if (f["role"] !== undefined && f["role"] !== "user" && f["role"] !== "lead") throw invalid("`role` must be user or lead");
    if (!f["email"] && !f["external_id"] && !f["role"]) throw invalid("Intercom needs `email`, `external_id` or `role` to create a contact");
    return f;
  } },
  get_contact: { verb: "GET", path: (p) => `/contacts/${id(p)}`, kind: "contact", required: ["id"] },
  update_contact: { verb: "PUT", path: (p) => `/contacts/${id(p)}`, kind: "contact", required: ["id", "fields"], body: (p) => attrs(p) },
  delete_contact: { verb: "DELETE", path: (p) => `/contacts/${id(p)}`, kind: "deleted", required: ["id"] },
  archive_contact: { verb: "POST", path: (p) => `/contacts/${id(p)}/archive`, kind: "entity", required: ["id"] },
  unarchive_contact: { verb: "POST", path: (p) => `/contacts/${id(p)}/unarchive`, kind: "entity", required: ["id"] },
  list_contacts: { verb: "GET", path: () => "/contacts", kind: "contacts", key: "data", paging: "cursor" },
  search_contacts: { verb: "POST", path: () => "/contacts/search", kind: "contacts", key: "data", required: ["query"], paging: "cursor", bodyPaging: true, body: (p) => ({ query: assertSearchQuery(p["query"]), ...(p["sort"] ? { sort: asRecord(p["sort"]) } : {}) }) },
  attach_contact_company: { verb: "POST", path: (p) => `/contacts/${id(p, "contact_id")}/companies`, kind: "company", required: ["contact_id", "company_id"], body: (p) => ({ id: id(p, "company_id") }) },
  detach_contact_company: { verb: "DELETE", path: (p) => `/contacts/${id(p, "contact_id")}/companies/${id(p, "company_id")}`, kind: "company", required: ["contact_id", "company_id"] },
  list_contact_companies: { verb: "GET", path: (p) => `/contacts/${id(p, "contact_id")}/companies`, kind: "companies", key: "data", required: ["contact_id"] },

  // ---- Companies (create = official create-or-update by company_id) -----------
  create_or_update_company: { verb: "POST", path: () => "/companies", kind: "company", required: ["fields"], body: (p) => {
    const f = attrs(p);
    if (!f["company_id"] && !f["name"]) throw invalid("Intercom needs `company_id` or `name`");
    return f;
  } },
  get_company: { verb: "GET", path: (p) => `/companies/${id(p)}`, kind: "company", required: ["id"] },
  find_company: { verb: "GET", path: () => "/companies", kind: "company", query: (p) => {
    const out: Record<string, string> = {};
    if (typeof p["company_id"] === "string" && p["company_id"]) out["company_id"] = p["company_id"];
    if (typeof p["name"] === "string" && p["name"]) out["name"] = p["name"];
    if (!Object.keys(out).length) throw invalid("`company_id` or `name` is required");
    return out;
  } },
  update_company: { verb: "PUT", path: (p) => `/companies/${id(p)}`, kind: "company", required: ["id", "fields"], body: (p) => attrs(p) },
  delete_company: { verb: "DELETE", path: (p) => `/companies/${id(p)}`, kind: "deleted", required: ["id"] },
  list_companies: { verb: "POST", path: () => "/companies/list", kind: "companies", key: "data", paging: "page" },
  list_company_contacts: { verb: "GET", path: (p) => `/companies/${id(p, "company_id")}/contacts`, kind: "contacts", key: "data", required: ["company_id"] },

  // ---- Conversations --------------------------------------------------------------
  get_conversation: { verb: "GET", path: (p) => `/conversations/${id(p)}`, kind: "conversation", required: ["id"], query: (p) => (p["display_as"] === "plaintext" ? { display_as: "plaintext" } : {}) },
  list_conversations: { verb: "GET", path: () => "/conversations", kind: "conversations", key: "conversations", paging: "cursor" },
  search_conversations: { verb: "POST", path: () => "/conversations/search", kind: "conversations", key: "conversations", required: ["query"], paging: "cursor", bodyPaging: true, body: (p) => ({ query: assertSearchQuery(p["query"]), ...(p["sort"] ? { sort: asRecord(p["sort"]) } : {}) }) },
  create_conversation: { verb: "POST", path: () => "/conversations", kind: "entity", required: ["contact_id", "body"], body: (p) => {
    const t = p["contact_type"] ?? "user";
    if (t !== "user" && t !== "lead" && t !== "contact") throw invalid("`contact_type` must be user, lead or contact");
    return { from: { type: t, id: id(p, "contact_id") }, body: String(p["body"]) };
  } },
  update_conversation: { verb: "PUT", path: (p) => `/conversations/${id(p)}`, kind: "conversation", required: ["id"], body: (p) => ({
    ...(typeof p["read"] === "boolean" ? { read: p["read"] } : {}),
    ...(p["title"] !== undefined ? { title: String(p["title"]) } : {}),
    ...(p["custom_attributes"] !== undefined ? { custom_attributes: attrs(p, "custom_attributes") } : {}),
  }) },
  reply_to_conversation: { verb: "POST", path: (p) => `/conversations/${id(p)}/reply`, kind: "conversation", required: ["id", "body"], body: (p) => {
    const kind = p["message_type"] ?? "comment";
    if (kind !== "comment" && kind !== "note") throw invalid("`message_type` must be comment or note");
    const att = urls(p);
    if (p["as"] === "contact") {
      if (kind === "note") throw invalid("Only admins can add notes");
      return { message_type: "comment", type: "user", intercom_user_id: id(p, "contact_id"), body: String(p["body"]), ...(att ? { attachment_urls: att } : {}) };
    }
    return { message_type: kind, ...adminAction(p), body: String(p["body"]), ...(att ? { attachment_urls: att } : {}) };
  } },
  add_conversation_note: { verb: "POST", path: (p) => `/conversations/${id(p)}/reply`, kind: "conversation", required: ["id", "body", "admin_id"], body: (p) => ({ message_type: "note", ...adminAction(p), body: String(p["body"]) }) },
  close_conversation: { verb: "POST", path: (p) => `/conversations/${id(p)}/parts`, kind: "conversation", required: ["id", "admin_id"], body: (p) => ({ message_type: "close", ...adminAction(p), ...(p["body"] ? { body: String(p["body"]) } : {}) }) },
  open_conversation: { verb: "POST", path: (p) => `/conversations/${id(p)}/parts`, kind: "conversation", required: ["id", "admin_id"], body: (p) => ({ message_type: "open", ...adminAction(p) }) },
  snooze_conversation: { verb: "POST", path: (p) => `/conversations/${id(p)}/parts`, kind: "conversation", required: ["id", "admin_id", "snoozed_until"], body: (p) => {
    const t = Number(p["snoozed_until"]);
    if (!Number.isInteger(t) || t <= 0) throw invalid("`snoozed_until` must be a unix timestamp");
    return { message_type: "snoozed", ...adminAction(p), snoozed_until: t };
  } },
  assign_conversation: { verb: "POST", path: (p) => `/conversations/${id(p)}/parts`, kind: "conversation", required: ["id", "admin_id", "assignee_id"], body: (p) => {
    const t = p["assignee_type"] ?? "admin";
    if (t !== "admin" && t !== "team") throw invalid("`assignee_type` must be admin or team");
    return { message_type: "assignment", ...adminAction(p), type: t, assignee_id: id(p, "assignee_id"), ...(p["body"] ? { body: String(p["body"]) } : {}) };
  } },

  // ---- Tags -------------------------------------------------------------------------
  list_tags: { verb: "GET", path: () => "/tags", kind: "list", key: "data" },
  get_tag: { verb: "GET", path: (p) => `/tags/${id(p)}`, kind: "entity", required: ["id"] },
  create_tag: { verb: "POST", path: () => "/tags", kind: "entity", required: ["name"], body: (p) => {
    const name = String(p["name"]).trim();
    if (!name || name.length > 255) throw invalid("`name` must be 1–255 characters");
    return { name };
  } },
  delete_tag: { verb: "DELETE", path: (p) => `/tags/${id(p)}`, kind: "deleted", required: ["id"] },
  tag_contact: { verb: "POST", path: (p) => `/contacts/${id(p, "contact_id")}/tags`, kind: "entity", required: ["contact_id", "tag_id"], body: (p) => ({ id: id(p, "tag_id") }) },
  untag_contact: { verb: "DELETE", path: (p) => `/contacts/${id(p, "contact_id")}/tags/${id(p, "tag_id")}`, kind: "entity", required: ["contact_id", "tag_id"] },
  tag_conversation: { verb: "POST", path: (p) => `/conversations/${id(p, "conversation_id")}/tags`, kind: "entity", required: ["conversation_id", "tag_id", "admin_id"], body: (p) => ({ id: id(p, "tag_id"), admin_id: id(p, "admin_id") }) },
  untag_conversation: { verb: "DELETE", path: (p) => `/conversations/${id(p, "conversation_id")}/tags/${id(p, "tag_id")}`, kind: "entity", required: ["conversation_id", "tag_id", "admin_id"], body: (p) => ({ admin_id: id(p, "admin_id") }) },
  list_contact_tags: { verb: "GET", path: (p) => `/contacts/${id(p, "contact_id")}/tags`, kind: "list", key: "data", required: ["contact_id"] },

  // ---- Notes ------------------------------------------------------------------------
  list_contact_notes: { verb: "GET", path: (p) => `/contacts/${id(p, "contact_id")}/notes`, kind: "list", key: "data", required: ["contact_id"], paging: "page" },
  create_contact_note: { verb: "POST", path: (p) => `/contacts/${id(p, "contact_id")}/notes`, kind: "entity", required: ["contact_id", "body"], body: (p) => ({ body: String(p["body"]), ...(p["admin_id"] !== undefined ? { admin_id: id(p, "admin_id") } : {}) }) },
  get_note: { verb: "GET", path: (p) => `/notes/${id(p)}`, kind: "entity", required: ["id"] },

  // ---- Data attribute definitions (read) -------------------------------------------
  list_data_attributes: { verb: "GET", path: () => "/data_attributes", kind: "list", key: "data", query: (p) => {
    const model = p["model"];
    if (model !== undefined && model !== "contact" && model !== "company" && model !== "conversation") throw invalid("`model` must be contact, company or conversation");
    return { ...(model ? { model: String(model) } : {}), ...(p["include_archived"] === true ? { include_archived: "true" } : {}) };
  } },
};

export const INTERCOM_OPERATIONS = Object.keys(OPERATIONS);

function perPage(p: Params): number {
  return Math.min(Math.max(Number(p["limit"] ?? 50) || 50, 1), MAX_PER_PAGE);
}

function nextCursor(spec: Spec, payload: unknown): string | null {
  const pages = asRecord(asRecord(payload)["pages"]);
  if (spec.paging === "cursor") {
    const after = asRecord(pages["next"])["starting_after"];
    return typeof after === "string" && after ? assertCursor("cursor", after) : null;
  }
  if (spec.paging === "page") {
    const page = Number(pages["page"]);
    const total = Number(pages["total_pages"]);
    return Number.isInteger(page) && Number.isInteger(total) && page < total ? assertCursor("page", String(page + 1)) : null;
  }
  return null;
}

function rows(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
}

function normalizePage(spec: Spec, payload: unknown): NormalizedPage {
  const p = asRecord(payload);
  const data = spec.key ? p[spec.key] : payload;
  const cursor = nextCursor(spec, payload);
  switch (spec.kind) {
    case "contact":
    case "contacts":
      return { items: rows(data).map(normalizeIntercomContact), cursor };
    case "company":
    case "companies":
      return { items: rows(data).map(normalizeIntercomCompany), cursor };
    case "conversation":
    case "conversations":
      return { items: rows(data).map(normalizeIntercomConversation), cursor };
    case "admin":
    case "admins":
      return { items: rows(data).map(normalizeIntercomAdmin), cursor };
    case "deleted":
      return { items: [{ id: p["id"] ?? null, deleted: p["deleted"] !== false }] };
    default:
      return { items: rows(data).map(normalizeIntercomEntity), cursor };
  }
}

/** Official headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (epoch seconds). */
export function readIntercomRateLimit(headers: Headers, nowMs = Date.now()): RateLimitInfo | undefined {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  const retryAfter = headers.get("retry-after");
  if (limit === null && remaining === null && retryAfter === null && reset === null) return undefined;
  const info: RateLimitInfo = {};
  if (limit !== null && Number.isFinite(Number(limit))) info.limit = Number(limit);
  if (remaining !== null && Number.isFinite(Number(remaining))) info.remaining = Number(remaining);
  if (reset !== null && Number.isFinite(Number(reset))) info.resetAt = new Date(Number(reset) * 1000).toISOString();
  if (retryAfter !== null && Number.isFinite(Number(retryAfter))) info.retryAfterMs = Number(retryAfter) * 1000;
  else if (info.remaining === 0 && reset !== null && Number.isFinite(Number(reset))) info.retryAfterMs = Math.max(0, Number(reset) * 1000 - nowMs);
  return info;
}

export const intercomConnector: ConnectorAdapter = {
  id: "intercom",
  label: "Intercom",
  capabilities: ["read", "write", "search", "pagination", "messaging", "webhook", "health_check"],
  credentials: { kind: "oauth2", required: ["access_token"], optional: ["region"] },
  operations: INTERCOM_OPERATIONS,
  healthOperation: "get_me",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    if (UNSUPPORTED_OPERATIONS[operation])
      throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS[operation]}`, { retryable: false });
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Intercom operation "${operation}"`, { retryable: false });
    if (params["idempotency_key"] !== undefined) throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS["idempotency_key"]}`, { retryable: false });
    assertRequiredParams(operation, params, spec.required);
    const url = new URL(`${INTERCOM_PLACEHOLDER_ORIGIN}${spec.path(params)}`);
    for (const [k, v] of Object.entries(spec.query?.(params) ?? {})) url.searchParams.set(k, v);
    let body = spec.body?.(params);
    if (spec.paging) {
      const size = perPage(params);
      const c = cursor ? assertCursor(spec.paging, cursor) : null;
      if (spec.bodyPaging) body = { ...(body ?? {}), pagination: { per_page: size, ...(c ? { starting_after: c } : {}) } };
      else if (spec.verb === "POST") body = { ...(body ?? {}), per_page: size, ...(c ? { page: Number(c) } : {}) };
      else {
        url.searchParams.set("per_page", String(size));
        if (c) url.searchParams.set(spec.paging === "cursor" ? "starting_after" : "page", c);
      }
    }
    const headers: Record<string, string> = { accept: "application/json", "intercom-version": INTERCOM_API_VERSION };
    const paginated = spec.paging ? { paginated: true } : {};
    if (body === undefined) return { method: spec.verb, url: url.toString(), headers, ...paginated };
    return { method: spec.verb, url: url.toString(), headers: { ...headers, "content-type": "application/json" }, body, ...paginated };
  },

  authorize: (call, credentials) => {
    const origin = intercomOrigin(credentials["region"]);
    if (!call.url.startsWith(`${INTERCOM_PLACEHOLDER_ORIGIN}/`))
      throw new ConnectorError("invalid_request", "Intercom calls must target the connected workspace", { retryable: false });
    const token = (credentials["access_token"] ?? "").trim();
    if (!token) throw new ConnectorError("auth", "The Intercom workspace is not connected yet", { retryable: false });
    return { ...call, url: `${origin}${call.url.slice(INTERCOM_PLACEHOLDER_ORIGIN.length)}`, headers: { ...call.headers, authorization: `Bearer ${token}` } };
  },

  normalize: (operation, payload, status) => {
    const spec = OPERATIONS[operation];
    if (!spec || status === 204 || payload === null || payload === undefined) return spec?.kind === "deleted" ? { items: [{ id: null, deleted: true }] } : { items: [] };
    return normalizePage(spec, payload);
  },

  /** `{ type: "error.list", request_id, errors: [{ code, message }] }`. */
  mapError: (status, payload) => {
    if (status < 400) return null;
    const p = asRecord(payload);
    const first = asRecord(Array.isArray(p["errors"]) ? p["errors"][0] : undefined);
    const code = typeof first["code"] === "string" ? first["code"] : "";
    const text = `${String(first["message"] ?? p["message"] ?? `Intercom request failed (${status})`)}${code ? ` [${code}]` : ""}${typeof p["request_id"] === "string" ? ` (request ${p["request_id"]})` : ""}`;
    if (status === 401) return { kind: "auth", message: `Intercom rejected the credentials: ${text}`, retryable: false };
    if (status === 403) return { kind: "forbidden", message: `Intercom denied access: ${text}`, retryable: false };
    if (status === 404) return { kind: "not_found", message: `Intercom resource not found: ${text}`, retryable: false };
    if (status === 409) return { kind: "invalid_request", message: `Intercom conflict: ${text}`, retryable: false };
    if (status === 422) return { kind: "invalid_request", message: `Intercom validation failed: ${text}`, retryable: false };
    if (status === 429) return { kind: "rate_limit", message: `Intercom rate limit: ${text}`, retryable: true };
    if (status >= 500) return { kind: "provider", message: `Intercom server error: ${text}`, retryable: true };
    return { kind: "invalid_request", message: `Intercom rejected the request: ${text}`, retryable: false };
  },

  readRateLimit: (headers) => readIntercomRateLimit(headers),
};
