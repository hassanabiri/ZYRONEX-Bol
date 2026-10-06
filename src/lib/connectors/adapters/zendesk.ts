import {
  normalizeZendeskAttachment,
  normalizeZendeskComment,
  normalizeZendeskEntity,
  normalizeZendeskField,
  normalizeZendeskSearchHit,
  normalizeZendeskTicket,
  normalizeZendeskUser,
  zendeskSubdomain,
} from "@/lib/connectors/adapters/zendesk-map";
import { asRecord, assertRequiredParams } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Zendesk Support connector — official Zendesk Support REST API (`/api/v2`) only.
 *
 * Every account lives on its own `{subdomain}.zendesk.com`. Calls are built
 * against a placeholder origin and re-homed onto the validated subdomain in
 * `authorize`, so credentials can never reach another host.
 *
 * Pagination: official cursor pagination (`page[size]` / `page[after]`,
 * `meta.has_more` / `meta.after_cursor`). Only the opaque `after_cursor` token
 * is carried — never a `links.next` URL — so a cursor cannot change host or
 * inject parameters. `/search.json` only supports offset pages, so its cursor
 * is the official page number.
 *
 * No AI, routing, SLA, triage or any support business logic.
 */

export const ZENDESK_PLACEHOLDER_ORIGIN = "https://account.zendesk.invalid";
const API = "/api/v2";
const MAX_PAGE = 100;

export function assertZendeskSubdomain(value: unknown): string {
  const sub = zendeskSubdomain(value);
  if (!sub) throw new ConnectorError("auth", "The Zendesk subdomain is missing or not an official *.zendesk.com host", { retryable: false });
  return sub;
}

export const zendeskOrigin = (value: unknown) => `https://${assertZendeskSubdomain(value)}.zendesk.com`;

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  upload_attachment: "POST /api/v2/uploads requires the raw binary file body (application/binary); the JSON runtime does not carry binary payloads.",
  download_attachment: "Attachment content_url returns binary content; the JSON runtime does not carry binary payloads. Attachment metadata is supported.",
  redact_attachment: "Attachment redaction permanently destroys customer content and is an administrative/compliance action outside the connector scope.",
  delete_user: "User deletion (and GDPR permanent deletion) is irreversible administration outside the connector scope.",
  permanently_delete_ticket: "Permanent deletion of deleted tickets is irreversible and outside the connector scope; soft delete is supported.",
  merge_tickets: "Ticket merges are irreversible and encode support-process decisions owned by ZYRONEX.",
  merge_users: "User merges are irreversible identity administration outside the connector scope.",
  bulk_import_tickets: "The ticket import API is an admin-only migration tool producing async job statuses; outside the connector scope.",
  get_webhook_signing_secret: "The signing secret must be stored in the webhook vault, never returned through connector results.",
  update_comment: "Zendesk comments are immutable; only redaction (administrative) is offered by the API.",
  view_execute_legacy: "GET /views/{id}/execute is a legacy offset endpoint; use list_view_tickets (cursor-paginated) instead.",
  apply_macro: "Applying macros encodes support workflow decisions; macro automation belongs to ZYRONEX, not the connector.",
  sla_and_routing: "SLA policies, routing and triggers configuration are business logic owned by ZYRONEX.",
  incremental_ticket_events: "The ticket-events incremental export supports only time-based pagination with a 1-minute replay; not mapped to the cursor contract.",
};

type Kind = "ticket" | "tickets" | "comments" | "user" | "users" | "entity" | "list" | "fields" | "search" | "attachment" | "deleted" | "count";
type Paging = "cursor" | "page";
type Params = Record<string, unknown>;
type Spec = {
  verb: HttpMethod;
  path: (p: Params) => string;
  kind: Kind;
  /** Response key holding the data (e.g. `ticket`, `tickets`). */
  key?: string;
  required?: string[];
  paging?: Paging;
  query?: (p: Params) => Record<string, string>;
  body?: (p: Params) => unknown;
  idempotent?: boolean;
};

const invalid = (m: string) => new ConnectorError("invalid_request", m, { retryable: false });

export function assertZendeskId(value: unknown, field = "id"): string {
  const id = String(value ?? "");
  if (!/^[1-9]\d{0,18}$/.test(id)) throw invalid(`\`${field}\` must be a numeric Zendesk id`);
  return id;
}

export function assertCursor(paging: Paging, value: string): string {
  if (paging === "page" ? !/^[1-9]\d{0,4}$/.test(value) : !/^[A-Za-z0-9+/=_.-]{1,2048}$/.test(value) || value.includes(".."))
    throw invalid("Pagination cursor is not an official Zendesk cursor");
  return value;
}

const TICKET_STATUS = ["new", "open", "pending", "hold", "solved", "closed"];
const TICKET_PRIORITY = ["low", "normal", "high", "urgent"];
const TICKET_TYPE = ["problem", "incident", "question", "task"];

function objectField(p: Params, key = "fields"): Record<string, unknown> {
  const v = p[key];
  if (!v || typeof v !== "object" || Array.isArray(v)) throw invalid(`\`${key}\` must be an object of Zendesk attribute values`);
  for (const k of Object.keys(v)) if (!/^[a-z_][a-z0-9_]{0,63}$/.test(k)) throw invalid(`\`${k}\` is not an official Zendesk attribute name`);
  return v as Record<string, unknown>;
}

function ticketFields(p: Params): Record<string, unknown> {
  const f = objectField(p);
  if (f["status"] !== undefined && !TICKET_STATUS.includes(String(f["status"]))) throw invalid("`status` is not an official Zendesk ticket status");
  if (f["priority"] !== undefined && f["priority"] !== null && !TICKET_PRIORITY.includes(String(f["priority"]))) throw invalid("`priority` is not an official Zendesk ticket priority");
  if (f["type"] !== undefined && f["type"] !== null && !TICKET_TYPE.includes(String(f["type"]))) throw invalid("`type` is not an official Zendesk ticket type");
  return f;
}

function filters(keys: string[]) {
  return (p: Params): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const k of keys) {
      const v = p[k];
      if (v === undefined || v === null || v === "") continue;
      out[k] = Array.isArray(v) ? v.map(String).join(",") : String(v);
    }
    return out;
  };
}

function searchQuery(p: Params): string {
  const q = String(p["query"] ?? "");
  if (!q.trim()) throw invalid("`query` is required (official Zendesk search syntax)");
  if (q.length > 2048) throw invalid("`query` is too long");
  return q;
}

const id = (p: Params, field = "id") => assertZendeskId(p[field], field);

const OPERATIONS: Record<string, Spec> = {
  // ---- Account / identity ----------------------------------------------------
  get_current_user: { verb: "GET", path: () => `${API}/users/me.json`, kind: "user", key: "user" },
  get_account_settings: { verb: "GET", path: () => `${API}/account/settings.json`, kind: "entity", key: "settings" },
  list_brands: { verb: "GET", path: () => `${API}/brands.json`, kind: "list", key: "brands", paging: "cursor" },
  get_brand: { verb: "GET", path: (p) => `${API}/brands/${id(p)}.json`, kind: "entity", key: "brand", required: ["id"] },

  // ---- Tickets -----------------------------------------------------------------
  create_ticket: {
    verb: "POST", path: () => `${API}/tickets.json`, kind: "ticket", key: "ticket", required: ["fields"], idempotent: true,
    body: (p) => ({ ticket: ticketFields(p) }),
  },
  get_ticket: { verb: "GET", path: (p) => `${API}/tickets/${id(p)}.json`, kind: "ticket", key: "ticket", required: ["id"], query: filters(["include"]) },
  update_ticket: {
    verb: "PUT", path: (p) => `${API}/tickets/${id(p)}.json`, kind: "ticket", key: "ticket", required: ["id", "fields"],
    body: (p) => {
      const f = ticketFields(p);
      // Official optimistic-concurrency guard (409 on mismatch).
      return { ticket: { ...f, ...(p["safe_update"] === true ? { safe_update: true, updated_stamp: String(p["updated_stamp"] ?? "") } : {}) } };
    },
  },
  delete_ticket: { verb: "DELETE", path: (p) => `${API}/tickets/${id(p)}.json`, kind: "deleted", required: ["id"] },
  list_tickets: { verb: "GET", path: () => `${API}/tickets.json`, kind: "tickets", key: "tickets", paging: "cursor", query: filters(["sort", "external_id"]) },
  list_organization_tickets: { verb: "GET", path: (p) => `${API}/organizations/${id(p, "organization_id")}/tickets.json`, kind: "tickets", key: "tickets", required: ["organization_id"], paging: "cursor" },
  list_user_requested_tickets: { verb: "GET", path: (p) => `${API}/users/${id(p, "user_id")}/tickets/requested.json`, kind: "tickets", key: "tickets", required: ["user_id"], paging: "cursor" },
  list_user_assigned_tickets: { verb: "GET", path: (p) => `${API}/users/${id(p, "user_id")}/tickets/assigned.json`, kind: "tickets", key: "tickets", required: ["user_id"], paging: "cursor" },
  count_tickets: { verb: "GET", path: () => `${API}/tickets/count.json`, kind: "count" },
  incremental_tickets: {
    verb: "GET", path: () => `${API}/incremental/tickets/cursor.json`, kind: "tickets", key: "tickets", paging: "cursor",
    query: (p) => (p["start_time"] === undefined ? {} : { start_time: String(Number(p["start_time"]) | 0) }),
  },

  // ---- Ticket comments (added through the ticket API, as documented) ---------
  list_ticket_comments: { verb: "GET", path: (p) => `${API}/tickets/${id(p, "ticket_id")}/comments.json`, kind: "comments", key: "comments", required: ["ticket_id"], paging: "cursor", query: filters(["sort", "include_inline_images"]) },
  add_ticket_comment: {
    verb: "PUT", path: (p) => `${API}/tickets/${id(p, "ticket_id")}.json`, kind: "ticket", key: "ticket", required: ["ticket_id"],
    body: (p) => {
      const body = p["body"];
      const html = p["html_body"];
      if ((typeof body !== "string" || !body) && (typeof html !== "string" || !html)) throw invalid("`body` or `html_body` is required");
      const uploads = p["uploads"];
      if (uploads !== undefined && (!Array.isArray(uploads) || uploads.some((u) => typeof u !== "string" || !/^[A-Za-z0-9]{1,128}$/.test(u)))) throw invalid("`uploads` must be Zendesk upload tokens");
      return {
        ticket: {
          comment: {
            ...(typeof body === "string" && body ? { body } : {}),
            ...(typeof html === "string" && html ? { html_body: html } : {}),
            public: p["public"] !== false,
            ...(p["author_id"] === undefined ? {} : { author_id: Number(id(p, "author_id")) }),
            ...(uploads ? { uploads } : {}),
          },
        },
      };
    },
  },

  // ---- Audits (official ticket audit log, read-only) -------------------------
  list_ticket_audits: { verb: "GET", path: (p) => `${API}/tickets/${id(p, "ticket_id")}/audits.json`, kind: "list", key: "audits", required: ["ticket_id"], paging: "cursor" },
  get_ticket_audit: { verb: "GET", path: (p) => `${API}/tickets/${id(p, "ticket_id")}/audits/${id(p)}.json`, kind: "entity", key: "audit", required: ["ticket_id", "id"] },
  list_audits: { verb: "GET", path: () => `${API}/ticket_audits.json`, kind: "list", key: "audits", paging: "cursor" },

  // ---- Users -----------------------------------------------------------------
  get_user: { verb: "GET", path: (p) => `${API}/users/${id(p)}.json`, kind: "user", key: "user", required: ["id"] },
  list_users: { verb: "GET", path: () => `${API}/users.json`, kind: "users", key: "users", paging: "cursor", query: filters(["role", "permission_set", "external_id"]) },
  search_users: { verb: "GET", path: () => `${API}/users/search.json`, kind: "users", key: "users", query: (p) => {
    const out = filters(["query", "external_id"])(p);
    if (!out["query"] && !out["external_id"]) throw invalid("`query` or `external_id` is required");
    return out;
  } },
  create_user: { verb: "POST", path: () => `${API}/users.json`, kind: "user", key: "user", required: ["fields"], body: (p) => ({ user: objectField(p) }) },
  update_user: { verb: "PUT", path: (p) => `${API}/users/${id(p)}.json`, kind: "user", key: "user", required: ["id", "fields"], body: (p) => ({ user: objectField(p) }) },
  list_user_identities: { verb: "GET", path: (p) => `${API}/users/${id(p, "user_id")}/identities.json`, kind: "list", key: "identities", required: ["user_id"], paging: "cursor" },

  // ---- Organizations ---------------------------------------------------------
  create_organization: { verb: "POST", path: () => `${API}/organizations.json`, kind: "entity", key: "organization", required: ["fields"], body: (p) => ({ organization: objectField(p) }) },
  get_organization: { verb: "GET", path: (p) => `${API}/organizations/${id(p)}.json`, kind: "entity", key: "organization", required: ["id"] },
  update_organization: { verb: "PUT", path: (p) => `${API}/organizations/${id(p)}.json`, kind: "entity", key: "organization", required: ["id", "fields"], body: (p) => ({ organization: objectField(p) }) },
  delete_organization: { verb: "DELETE", path: (p) => `${API}/organizations/${id(p)}.json`, kind: "deleted", required: ["id"] },
  list_organizations: { verb: "GET", path: () => `${API}/organizations.json`, kind: "list", key: "organizations", paging: "cursor" },
  search_organizations: { verb: "GET", path: () => `${API}/organizations/search.json`, kind: "list", key: "organizations", query: (p) => {
    const out = filters(["name", "external_id"])(p);
    if (!out["name"] && !out["external_id"]) throw invalid("`name` or `external_id` is required");
    return out;
  } },
  autocomplete_organizations: { verb: "GET", path: () => `${API}/organizations/autocomplete.json`, kind: "list", key: "organizations", required: ["name"], query: (p) => {
    const name = String(p["name"]);
    if (name.trim().length < 2) throw invalid("`name` needs at least 2 characters (Zendesk autocomplete minimum)");
    return { name };
  } },

  // ---- Groups (read) ---------------------------------------------------------
  list_groups: { verb: "GET", path: () => `${API}/groups.json`, kind: "list", key: "groups", paging: "cursor" },
  get_group: { verb: "GET", path: (p) => `${API}/groups/${id(p)}.json`, kind: "entity", key: "group", required: ["id"] },
  list_group_memberships: { verb: "GET", path: () => `${API}/group_memberships.json`, kind: "list", key: "group_memberships", paging: "cursor" },

  // ---- Ticket fields (definitions, read) --------------------------------------
  list_ticket_fields: { verb: "GET", path: () => `${API}/ticket_fields.json`, kind: "fields", key: "ticket_fields", paging: "cursor", query: filters(["locale", "creator"]) },
  get_ticket_field: { verb: "GET", path: (p) => `${API}/ticket_fields/${id(p)}.json`, kind: "fields", key: "ticket_field", required: ["id"] },
  list_ticket_forms: { verb: "GET", path: () => `${API}/ticket_forms.json`, kind: "list", key: "ticket_forms", query: filters(["active", "end_user_visible"]) },
  list_user_fields: { verb: "GET", path: () => `${API}/user_fields.json`, kind: "fields", key: "user_fields", paging: "cursor" },
  list_organization_fields: { verb: "GET", path: () => `${API}/organization_fields.json`, kind: "fields", key: "organization_fields", paging: "cursor" },

  // ---- Views -----------------------------------------------------------------
  list_views: { verb: "GET", path: () => `${API}/views.json`, kind: "list", key: "views", paging: "cursor", query: filters(["access", "active", "group_id"]) },
  list_active_views: { verb: "GET", path: () => `${API}/views/active.json`, kind: "list", key: "views", paging: "cursor" },
  get_view: { verb: "GET", path: (p) => `${API}/views/${id(p)}.json`, kind: "entity", key: "view", required: ["id"] },
  list_view_tickets: { verb: "GET", path: (p) => `${API}/views/${id(p)}/tickets.json`, kind: "tickets", key: "tickets", required: ["id"], paging: "cursor", query: filters(["sort_by", "sort_order"]) },
  count_view_tickets: { verb: "GET", path: (p) => `${API}/views/${id(p)}/count.json`, kind: "entity", key: "view_count", required: ["id"] },

  // ---- Search (official query syntax, passed verbatim) -----------------------
  search: { verb: "GET", path: () => `${API}/search.json`, kind: "search", paging: "page", query: (p) => ({ query: searchQuery(p), ...filters(["sort_by", "sort_order"])(p) }) },
  search_count: { verb: "GET", path: () => `${API}/search/count.json`, kind: "count", query: (p) => ({ query: searchQuery(p) }) },
  search_export: {
    verb: "GET", path: () => `${API}/search/export.json`, kind: "search", paging: "cursor", required: ["filter_type"],
    query: (p) => {
      const type = String(p["filter_type"]);
      if (!["ticket", "user", "organization", "group"].includes(type)) throw invalid("`filter_type` must be ticket, user, organization or group");
      return { query: searchQuery(p), "filter[type]": type };
    },
  },

  // ---- Attachments (metadata only) -------------------------------------------
  get_attachment: { verb: "GET", path: (p) => `${API}/attachments/${id(p)}.json`, kind: "attachment", key: "attachment", required: ["id"] },
  delete_upload: {
    verb: "DELETE", path: (p) => {
      const token = String(p["token"] ?? "");
      if (!/^[A-Za-z0-9]{1,128}$/.test(token)) throw invalid("`token` must be a Zendesk upload token");
      return `${API}/uploads/${token}.json`;
    }, kind: "deleted", required: ["token"],
  },

  // ---- Webhooks (official management API) ------------------------------------
  list_webhooks: { verb: "GET", path: () => `${API}/webhooks`, kind: "list", key: "webhooks", paging: "cursor" },
  get_webhook: { verb: "GET", path: (p) => `${API}/webhooks/${webhookId(p)}`, kind: "entity", key: "webhook", required: ["id"] },
  create_webhook: {
    verb: "POST", path: () => `${API}/webhooks`, kind: "entity", key: "webhook", required: ["name", "endpoint", "subscriptions"],
    body: (p) => {
      const endpoint = String(p["endpoint"]);
      if (!/^https:\/\/[^\s]+$/.test(endpoint)) throw invalid("`endpoint` must be an https URL");
      const subs = p["subscriptions"];
      if (!Array.isArray(subs) || !subs.length || subs.some((s) => typeof s !== "string" || !/^(conditional_ticket_events|zen:event-type:[a-z_]+\.[a-z_]+)$/.test(s)))
        throw invalid("`subscriptions` must be official Zendesk event types");
      return { webhook: { name: String(p["name"]), endpoint, http_method: "POST", request_format: "json", status: "active", subscriptions: subs } };
    },
  },
  delete_webhook: { verb: "DELETE", path: (p) => `${API}/webhooks/${webhookId(p)}`, kind: "deleted", required: ["id"] },
};

function webhookId(p: Params): string {
  const v = String(p["id"] ?? "");
  if (!/^[A-Za-z0-9]{1,64}$/.test(v)) throw invalid("`id` must be a Zendesk webhook id");
  return v;
}

export const ZENDESK_OPERATIONS = Object.keys(OPERATIONS);

function buildUrl(spec: Spec, p: Params, cursor: string | null | undefined): string {
  const url = new URL(`${ZENDESK_PLACEHOLDER_ORIGIN}${spec.path(p)}`);
  for (const [k, v] of Object.entries(spec.query?.(p) ?? {})) url.searchParams.set(k, v);
  const size = String(Math.min(Math.max(Number(p["limit"] ?? MAX_PAGE) || MAX_PAGE, 1), MAX_PAGE));
  if (spec.paging === "cursor") {
    url.searchParams.set("page[size]", size);
    if (cursor) url.searchParams.set("page[after]", assertCursor("cursor", cursor));
  } else if (spec.paging === "page") {
    url.searchParams.set("per_page", size);
    if (cursor) url.searchParams.set("page", assertCursor("page", cursor));
  }
  return url.toString();
}

function nextCursor(spec: Spec, payload: unknown, call: ConnectorCall | undefined): string | null {
  const p = asRecord(payload);
  if (spec.paging === "cursor") {
    // Incremental export uses `end_of_stream` + `after_cursor`.
    if (p["end_of_stream"] === true) return null;
    const meta = asRecord(p["meta"]);
    const c = meta["has_more"] === true ? meta["after_cursor"] : p["end_of_stream"] === false ? p["after_cursor"] : null;
    return typeof c === "string" && c ? assertCursor("cursor", c) : null;
  }
  if (spec.paging === "page") {
    if (p["next_page"] === null || p["next_page"] === undefined) return null;
    const current = call ? Number(new URL(call.url).searchParams.get("page") ?? "1") : 1;
    return assertCursor("page", String(current + 1));
  }
  return null;
}

function rows(v: unknown): unknown[] {
  return Array.isArray(v) ? v : v === null || v === undefined ? [] : [v];
}

function normalizePage(spec: Spec, payload: unknown, call?: ConnectorCall): NormalizedPage {
  const p = asRecord(payload);
  const data = spec.key ? p[spec.key] : payload;
  const cursor = nextCursor(spec, payload, call);
  switch (spec.kind) {
    case "ticket":
    case "tickets":
      return { items: rows(data).map(normalizeZendeskTicket), cursor };
    case "comments":
      return { items: rows(data).map(normalizeZendeskComment), cursor };
    case "user":
    case "users":
      return { items: rows(data).map(normalizeZendeskUser), cursor };
    case "fields":
      return { items: rows(data).map(normalizeZendeskField), cursor };
    case "search":
      return { items: rows(p["results"]).map(normalizeZendeskSearchHit), cursor };
    case "attachment":
      return { items: rows(data).map(normalizeZendeskAttachment) };
    case "count": {
      const c = asRecord(p["count"]);
      return { items: [{ count: typeof p["count"] === "number" ? p["count"] : (c["value"] ?? null), refreshed_at: c["refreshed_at"] ?? null }] };
    }
    case "deleted":
      return { items: [{ deleted: true }] };
    default:
      return { items: rows(data).map(normalizeZendeskEntity), cursor };
  }
}

/** Official headers: `ratelimit-*` (draft standard), `x-rate-limit*`, `retry-after`. */
export function readZendeskRateLimit(headers: Headers): RateLimitInfo | undefined {
  const limit = headers.get("ratelimit-limit") ?? headers.get("x-rate-limit");
  const remaining = headers.get("ratelimit-remaining") ?? headers.get("x-rate-limit-remaining");
  const reset = headers.get("ratelimit-reset");
  const retryAfter = headers.get("retry-after");
  if (limit === null && remaining === null && retryAfter === null) return undefined;
  const info: RateLimitInfo = {};
  if (limit !== null && Number.isFinite(Number(limit))) info.limit = Number(limit);
  if (remaining !== null && Number.isFinite(Number(remaining))) info.remaining = Number(remaining);
  const wait = retryAfter !== null ? Number(retryAfter) : reset !== null && info.remaining === 0 ? Number(reset) : NaN;
  if (Number.isFinite(wait) && wait >= 0) info.retryAfterMs = wait * 1000;
  return info;
}

function errorText(status: number, payload: unknown): string {
  const p = asRecord(payload);
  const err = p["error"];
  const e = asRecord(err);
  const title = typeof err === "string" ? err : String(e["title"] ?? p["title"] ?? "");
  const message = String(p["description"] ?? e["message"] ?? p["message"] ?? "");
  const details = p["details"] && typeof p["details"] === "object" ? ` ${Object.keys(p["details"] as object).join(",")}` : "";
  const text = [title, message].filter(Boolean).join(": ");
  return `${text || `Zendesk request failed (${status})`}${details}`;
}

export const zendeskConnector: ConnectorAdapter = {
  id: "zendesk",
  label: "Zendesk Support",
  capabilities: ["read", "write", "search", "pagination", "webhook", "health_check"],
  // OAuth access token, or official API token (email + api_token); subdomain always required.
  credentials: { kind: "oauth2", required: ["subdomain"], optional: ["access_token", "refresh_token", "email", "api_token"] },
  operations: ZENDESK_OPERATIONS,
  healthOperation: "get_current_user",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    if (UNSUPPORTED_OPERATIONS[operation])
      throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS[operation]}`, { retryable: false });
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Zendesk operation "${operation}"`, { retryable: false });
    assertRequiredParams(operation, params, spec.required);
    const url = buildUrl(spec, params, cursor);
    const headers: Record<string, string> = { accept: "application/json" };
    // Zendesk's official Idempotency-Key is documented for ticket creation only.
    const key = params["idempotency_key"];
    if (key !== undefined) {
      if (!spec.idempotent) throw invalid("Zendesk documents `Idempotency-Key` for ticket creation only");
      if (typeof key !== "string" || !/^[A-Za-z0-9_.:-]{1,255}$/.test(key)) throw invalid("`idempotency_key` is not a valid key");
      headers["idempotency-key"] = key;
    }
    const paginated = spec.paging ? { paginated: true } : {};
    if (!spec.body) return { method: spec.verb, url, headers, ...paginated };
    return { method: spec.verb, url, headers: { ...headers, "content-type": "application/json" }, body: spec.body(params), ...paginated };
  },

  authorize: (call, credentials) => {
    const origin = zendeskOrigin(credentials["subdomain"]);
    if (!call.url.startsWith(`${ZENDESK_PLACEHOLDER_ORIGIN}/`))
      throw new ConnectorError("invalid_request", "Zendesk calls must target the connected account", { retryable: false });
    const access = (credentials["access_token"] ?? "").trim();
    const apiToken = (credentials["api_token"] ?? "").trim();
    const email = (credentials["email"] ?? "").trim();
    // Official schemes: OAuth bearer, or Basic `{email}/token:{api_token}`. Never in the URL.
    const auth = access
      ? `Bearer ${access}`
      : apiToken && email
        ? `Basic ${btoa(`${email}/token:${apiToken}`)}`
        : null;
    if (!auth) throw new ConnectorError("auth", "The Zendesk account is not connected yet", { retryable: false });
    return { ...call, url: `${origin}${call.url.slice(ZENDESK_PLACEHOLDER_ORIGIN.length)}`, headers: { ...call.headers, authorization: auth } };
  },

  normalize: (operation, payload, status, context) => {
    const spec = OPERATIONS[operation];
    if (!spec || status === 204 || payload === null || payload === undefined) return spec?.kind === "deleted" ? { items: [{ deleted: true }] } : { items: [] };
    return normalizePage(spec, payload, context?.call);
  },

  mapError: (status, payload) => {
    if (status < 400) return null;
    const text = errorText(status, payload);
    if (status === 401) return { kind: "auth", message: `Zendesk rejected the credentials: ${text}`, retryable: false };
    if (status === 403) return { kind: "forbidden", message: `Zendesk denied access: ${text}`, retryable: false };
    if (status === 404) return { kind: "not_found", message: `Zendesk resource not found: ${text}`, retryable: false };
    if (status === 409) return { kind: "invalid_request", message: `Zendesk conflict: ${text}`, retryable: false };
    if (status === 422) return { kind: "invalid_request", message: `Zendesk validation failed: ${text}`, retryable: false };
    if (status === 429) return { kind: "rate_limit", message: `Zendesk rate limit: ${text}`, retryable: true };
    if (status >= 500) return { kind: "provider", message: `Zendesk server error: ${text}`, retryable: true };
    return { kind: "invalid_request", message: `Zendesk rejected the request: ${text}`, retryable: false };
  },

  readRateLimit: (headers) => readZendeskRateLimit(headers),
};
