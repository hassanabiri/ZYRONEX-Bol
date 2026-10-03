import {
  normalizePipedriveEntity,
  normalizePipedriveField,
  normalizePipedriveSearchHit,
  normalizePipedriveUser,
  pipedriveCompanyDomain,
  pipedriveData,
} from "@/lib/connectors/adapters/pipedrive-map";
import { asRecord, assertRequiredParams } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Pipedrive CRM connector — official Pipedrive REST API only.
 *
 * API v2 for persons, organizations, deals, activities, products, pipelines,
 * stages and search (cursor pagination); API v1 where v2 has no equivalent
 * (leads, notes, users, teams, field definitions, webhooks; offset paging).
 *
 * Each company has its own `api_domain` (OAuth token response). Calls are
 * built against a placeholder origin and re-homed onto the validated
 * `*.pipedrive.com` host in `authorize`, so credentials never reach another host.
 * No AI, sales logic, scoring or automation.
 */

export const PIPEDRIVE_PLACEHOLDER_ORIGIN = "https://company.pipedrive.invalid";
const V1 = "/api/v1";
const V2 = "/api/v2";
const MAX_LIMIT = 500;

export function assertPipedriveApiDomain(value: unknown): string {
  const sub = pipedriveCompanyDomain(value);
  const u = (() => {
    try {
      return new URL(String(value ?? ""));
    } catch {
      return null;
    }
  })();
  if (!sub || !u || u.port || u.username || u.password)
    throw new ConnectorError("auth", "The Pipedrive company domain is missing or not an official *.pipedrive.com host", { retryable: false });
  return u.origin;
}

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  idempotency_key: "Pipedrive publishes no idempotency header; duplicate writes stay guarded by ZYRONEX execution idempotency and Pipedrive record ids.",
  file_upload: "POST /files needs multipart/form-data, which the JSON runtime does not carry.",
  file_download: "GET /files/{id}/download returns binary content, which the JSON runtime does not carry.",
  merge_records: "Person/organization/deal merges are irreversible and are not exposed as connector operations.",
  webhooks_v1: "Webhooks v1 payloads carry no unique event id; only Webhooks v2 (meta.id) is accepted for deduplication.",
  webhook_signature:
    "Pipedrive webhooks are not signed; authenticity relies on the official HTTP Basic credentials configured on the webhook (http_auth_user / http_auth_password).",
  user_administration: "Adding, deactivating or changing permissions of users is an admin action outside the connector scope.",
  company_plan_limits: "Pipedrive exposes no official API for subscription plan details or per-plan limits; only rate-limit headers are read.",
  lead_conversion: "Lead → deal conversion applies sales process rules and is business logic owned by ZYRONEX.",
  sales_automation: "Lead scoring, assignment, sequences and workflows are business logic owned by ZYRONEX, not the connector.",
};

type Kind = "entity" | "list" | "search" | "fields" | "user" | "users" | "deleted";
type Paging = "cursor" | "offset";
type Params = Record<string, unknown>;
type Spec = {
  verb: HttpMethod;
  path: (p: Params) => string;
  kind: Kind;
  required?: string[];
  paging?: Paging;
  query?: (p: Params) => Record<string, string>;
  body?: (p: Params) => unknown;
};

const invalid = (m: string) => new ConnectorError("invalid_request", m, { retryable: false });

export function assertNumericId(value: unknown, field = "id"): string {
  const id = String(value ?? "");
  if (!/^[1-9]\d{0,17}$/.test(id)) throw invalid(`\`${field}\` must be a numeric Pipedrive id`);
  return id;
}

export function assertLeadId(value: unknown): string {
  const id = String(value ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw invalid("`id` must be a Pipedrive lead UUID");
  return id;
}

/** v2 cursor is an opaque token; v1 cursor is the official `next_start` offset. */
export function assertCursor(paging: Paging, value: string): string {
  if (paging === "offset" ? !/^\d{1,9}$/.test(value) : !/^[A-Za-z0-9+/=_.-]{1,1024}$/.test(value))
    throw invalid("Pagination cursor is not an official Pipedrive cursor");
  return value;
}

function objectBody(p: Params): Record<string, unknown> {
  const fields = p["fields"];
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw invalid("`fields` must be an object of Pipedrive field values");
  for (const k of Object.keys(fields)) if (!/^[A-Za-z0-9_]{1,64}$/.test(k)) throw invalid(`\`${k}\` is not an official Pipedrive field key`);
  return fields as Record<string, unknown>;
}

/** Copies documented filter params verbatim (Pipedrive semantics are not altered). */
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

function v2Entity(singular: string, plural: string, listFilters: string[]): Record<string, Spec> {
  const base = `${V2}/${plural}`;
  return {
    [`create_${singular}`]: { verb: "POST", path: () => base, kind: "entity", required: ["fields"], body: objectBody },
    [`get_${singular}`]: { verb: "GET", path: (p) => `${base}/${assertNumericId(p["id"])}`, kind: "entity", required: ["id"], query: filters(["include_fields", "custom_fields"]) },
    [`update_${singular}`]: { verb: "PATCH", path: (p) => `${base}/${assertNumericId(p["id"])}`, kind: "entity", required: ["id", "fields"], body: objectBody },
    [`delete_${singular}`]: { verb: "DELETE", path: (p) => `${base}/${assertNumericId(p["id"])}`, kind: "deleted", required: ["id"] },
    [`list_${plural}`]: {
      verb: "GET", path: () => base, kind: "list", paging: "cursor",
      query: filters(["filter_id", "ids", "owner_id", "updated_since", "updated_until", "sort_by", "sort_direction", "include_fields", "custom_fields", ...listFilters]),
    },
  };
}

function searchSpec(path: string, extra: string[] = []): Spec {
  return {
    verb: "GET", path: () => path, kind: "search", required: ["term"], paging: path.startsWith(V2) ? "cursor" : "offset",
    query: (p) => {
      const term = String(p["term"] ?? "");
      if (term.trim().length < 2 && p["exact_match"] !== true) throw invalid("`term` needs at least 2 characters (Pipedrive search minimum, or 1 with exact_match)");
      return { term, ...filters(["fields", "exact_match", "include_fields", ...extra])(p) };
    },
  };
}

const offsetList = (path: string, keys: string[] = []): Spec => ({ verb: "GET", path: () => path, kind: "list", paging: "offset", query: filters(keys) });

const FIELD_ENTITIES = { person: "personFields", organization: "organizationFields", deal: "dealFields", product: "productFields", activity: "activityFields", note: "noteFields" } as const;

const OPERATIONS: Record<string, Spec> = {
  // ---- Account / users / teams (v1) ----------------------------------------
  get_current_user: { verb: "GET", path: () => `${V1}/users/me`, kind: "user" },
  list_users: { verb: "GET", path: () => `${V1}/users`, kind: "users" },
  get_user: { verb: "GET", path: (p) => `${V1}/users/${assertNumericId(p["id"])}`, kind: "user", required: ["id"] },
  list_teams: { verb: "GET", path: () => `${V1}/legacyTeams`, kind: "list" },
  get_team: { verb: "GET", path: (p) => `${V1}/legacyTeams/${assertNumericId(p["id"])}`, kind: "entity", required: ["id"] },

  // ---- v2 entities -----------------------------------------------------------
  ...v2Entity("person", "persons", ["org_id", "deal_id"]),
  ...v2Entity("organization", "organizations", []),
  ...v2Entity("deal", "deals", ["person_id", "org_id", "pipeline_id", "stage_id", "status"]),
  ...v2Entity("activity", "activities", ["deal_id", "lead_id", "person_id", "org_id", "done", "updated_since"]),
  ...v2Entity("product", "products", []),
  search_persons: searchSpec(`${V2}/persons/search`, ["organization_id"]),
  search_organizations: searchSpec(`${V2}/organizations/search`),
  search_deals: searchSpec(`${V2}/deals/search`, ["person_id", "organization_id", "status"]),
  search_products: searchSpec(`${V2}/products/search`),
  search_items: searchSpec(`${V2}/itemSearch`, ["item_types", "search_for_related_items"]),

  // ---- Leads (v1; ids are UUIDs) ----------------------------------------------
  create_lead: { verb: "POST", path: () => `${V1}/leads`, kind: "entity", required: ["fields"], body: objectBody },
  get_lead: { verb: "GET", path: (p) => `${V1}/leads/${assertLeadId(p["id"])}`, kind: "entity", required: ["id"] },
  update_lead: { verb: "PATCH", path: (p) => `${V1}/leads/${assertLeadId(p["id"])}`, kind: "entity", required: ["id", "fields"], body: objectBody },
  delete_lead: { verb: "DELETE", path: (p) => `${V1}/leads/${assertLeadId(p["id"])}`, kind: "deleted", required: ["id"] },
  list_leads: offsetList(`${V1}/leads`, ["archived_status", "owner_id", "person_id", "organization_id", "filter_id", "sort"]),
  search_leads: searchSpec(`${V1}/leads/search`, ["person_id", "organization_id"]),

  // ---- Notes (v1) -------------------------------------------------------------
  create_note: { verb: "POST", path: () => `${V1}/notes`, kind: "entity", required: ["fields"], body: objectBody },
  get_note: { verb: "GET", path: (p) => `${V1}/notes/${assertNumericId(p["id"])}`, kind: "entity", required: ["id"] },
  update_note: { verb: "PUT", path: (p) => `${V1}/notes/${assertNumericId(p["id"])}`, kind: "entity", required: ["id", "fields"], body: objectBody },
  delete_note: { verb: "DELETE", path: (p) => `${V1}/notes/${assertNumericId(p["id"])}`, kind: "deleted", required: ["id"] },
  list_notes: offsetList(`${V1}/notes`, ["user_id", "lead_id", "deal_id", "person_id", "org_id", "sort", "start_date", "end_date", "updated_since"]),

  // ---- Pipelines / stages (v2, read) -----------------------------------------
  list_pipelines: { verb: "GET", path: () => `${V2}/pipelines`, kind: "list", paging: "cursor", query: filters(["sort_by", "sort_direction"]) },
  get_pipeline: { verb: "GET", path: (p) => `${V2}/pipelines/${assertNumericId(p["id"])}`, kind: "entity", required: ["id"] },
  list_stages: { verb: "GET", path: () => `${V2}/stages`, kind: "list", paging: "cursor", query: filters(["pipeline_id", "sort_by", "sort_direction"]) },
  get_stage: { verb: "GET", path: (p) => `${V2}/stages/${assertNumericId(p["id"])}`, kind: "entity", required: ["id"] },

  // ---- Field definitions (v1; leads share dealFields officially) ------------
  ...Object.fromEntries(
    Object.entries(FIELD_ENTITIES).map(([entity, path]) => [`list_${entity}_fields`, { verb: "GET", path: () => `${V1}/${path}`, kind: "fields", paging: "offset" } satisfies Spec]),
  ),

  // ---- Webhooks v2 subscription lifecycle (v1 management endpoints) ----------
  list_webhooks: { verb: "GET", path: () => `${V1}/webhooks`, kind: "list" },
  create_webhook: {
    verb: "POST", path: () => `${V1}/webhooks`, kind: "entity", required: ["subscription_url", "event_action", "event_object"],
    body: (p) => {
      const url = String(p["subscription_url"]);
      if (!/^https:\/\/[^\s]+$/.test(url)) throw invalid("`subscription_url` must be an https URL");
      const action = String(p["event_action"]);
      const object = String(p["event_object"]);
      if (!["create", "change", "delete", "*"].includes(action)) throw invalid("`event_action` must be an official Pipedrive webhook action");
      if (!/^(\*|activity|deal|lead|note|organization|person|pipeline|product|stage|user)$/.test(object)) throw invalid("`event_object` must be an official Pipedrive webhook object");
      return {
        subscription_url: url,
        event_action: action,
        event_object: object,
        version: "2.0",
        ...(typeof p["http_auth_user"] === "string" ? { http_auth_user: p["http_auth_user"] } : {}),
        ...(typeof p["http_auth_password"] === "string" ? { http_auth_password: p["http_auth_password"] } : {}),
        ...(p["user_id"] === undefined ? {} : { user_id: Number(assertNumericId(p["user_id"], "user_id")) }),
        ...(typeof p["name"] === "string" ? { name: p["name"] } : {}),
      };
    },
  },
  delete_webhook: { verb: "DELETE", path: (p) => `${V1}/webhooks/${assertNumericId(p["id"])}`, kind: "deleted", required: ["id"] },
};

export const PIPEDRIVE_OPERATIONS = Object.keys(OPERATIONS);

function buildUrl(spec: Spec, p: Params, cursor: string | null | undefined): string {
  const url = new URL(`${PIPEDRIVE_PLACEHOLDER_ORIGIN}${spec.path(p)}`);
  for (const [k, v] of Object.entries(spec.query?.(p) ?? {})) url.searchParams.set(k, v);
  if (spec.paging) {
    url.searchParams.set("limit", String(Math.min(Math.max(Number(p["limit"] ?? 100) || 100, 1), MAX_LIMIT)));
    if (cursor) url.searchParams.set(spec.paging === "cursor" ? "cursor" : "start", assertCursor(spec.paging, cursor));
  }
  return url.toString();
}

function nextCursor(paging: Paging | undefined, payload: unknown): string | null {
  const extra = asRecord(asRecord(payload)["additional_data"]);
  if (paging === "cursor") {
    const c = extra["next_cursor"];
    return typeof c === "string" && c ? assertCursor("cursor", c) : null;
  }
  if (paging === "offset") {
    const pg = asRecord(extra["pagination"]);
    return pg["more_items_in_collection"] === true && pg["next_start"] !== undefined ? assertCursor("offset", String(pg["next_start"])) : null;
  }
  return null;
}

function normalizePage(spec: Spec, payload: unknown): NormalizedPage {
  const data = pipedriveData(payload);
  const rows = (v: unknown) => (Array.isArray(v) ? v : v === null || v === undefined ? [] : [v]);
  const cursor = nextCursor(spec.paging, payload);
  switch (spec.kind) {
    case "entity":
    case "list":
      return { items: rows(data).map(normalizePipedriveEntity), cursor };
    case "deleted":
      return { items: [{ id: asRecord(data)["id"] ?? null, deleted: true }] };
    case "search":
      return { items: rows(asRecord(data)["items"]).map(normalizePipedriveSearchHit), cursor };
    case "fields":
      return { items: rows(data).map(normalizePipedriveField), cursor };
    case "user":
    case "users":
      return { items: rows(data).map(normalizePipedriveUser) };
    default:
      return { items: [] };
  }
}

/** Official `x-ratelimit-*` headers (token-based / burst limits). */
export function readPipedriveRateLimit(headers: Headers): RateLimitInfo | undefined {
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  const retryAfter = headers.get("retry-after");
  if (limit === null && remaining === null && retryAfter === null) return undefined;
  const info: RateLimitInfo = {};
  if (limit !== null && Number.isFinite(Number(limit))) info.limit = Number(limit);
  if (remaining !== null && Number.isFinite(Number(remaining))) info.remaining = Number(remaining);
  const wait = retryAfter !== null ? Number(retryAfter) : reset !== null && info.remaining === 0 ? Number(reset) : NaN;
  if (Number.isFinite(wait) && wait >= 0) info.retryAfterMs = wait * 1000;
  return info;
}

export const pipedriveConnector: ConnectorAdapter = {
  id: "pipedrive",
  label: "Pipedrive CRM",
  capabilities: ["read", "write", "search", "pagination", "webhook", "health_check"],
  // OAuth access token, or an API token for single-company setups; api_domain is always required.
  credentials: { kind: "oauth2", required: ["api_domain"], optional: ["access_token", "refresh_token", "api_token"] },
  operations: PIPEDRIVE_OPERATIONS,
  healthOperation: "get_current_user",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    if (UNSUPPORTED_OPERATIONS[operation])
      throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS[operation]}`, { retryable: false });
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Pipedrive operation "${operation}"`, { retryable: false });
    assertRequiredParams(operation, params, spec.required);
    const url = buildUrl(spec, params, cursor);
    const headers: Record<string, string> = { accept: "application/json" };
    const paginated = spec.paging ? { paginated: true } : {};
    if (!spec.body) return { method: spec.verb, url, headers, ...paginated };
    return { method: spec.verb, url, headers: { ...headers, "content-type": "application/json" }, body: spec.body(params), ...paginated };
  },

  authorize: (call, credentials) => {
    const origin = assertPipedriveApiDomain(credentials["api_domain"]);
    if (!call.url.startsWith(`${PIPEDRIVE_PLACEHOLDER_ORIGIN}/`))
      throw new ConnectorError("invalid_request", "Pipedrive calls must target the connected company", { retryable: false });
    const access = (credentials["access_token"] ?? "").trim();
    const apiToken = (credentials["api_token"] ?? "").trim();
    // Official header auth only; the token is never placed in the URL.
    const auth = access ? { authorization: `Bearer ${access}` } : apiToken ? { "x-api-token": apiToken } : null;
    if (!auth) throw new ConnectorError("auth", "The Pipedrive account is not connected yet", { retryable: false });
    return { ...call, url: `${origin}${call.url.slice(PIPEDRIVE_PLACEHOLDER_ORIGIN.length)}`, headers: { ...call.headers, ...auth } };
  },

  normalize: (operation, payload, status) => {
    const spec = OPERATIONS[operation];
    if (!spec || status === 204 || payload === null) return { items: [] };
    return normalizePage(spec, payload);
  },

  /** `{ success:false, error, error_info, errorCode }` envelope. */
  mapError: (status, payload) => {
    const p = asRecord(payload);
    if (status < 400 && p["success"] !== false) return null;
    const text = `${String(p["error"] ?? p["message"] ?? `Pipedrive request failed (${status})`)}${p["errorCode"] !== undefined ? ` [${String(p["errorCode"])}]` : ""}`;
    if (status < 400) return { kind: "invalid_request", message: `Pipedrive reported a failure: ${text}`, retryable: false };
    if (status === 401) return { kind: "auth", message: `Pipedrive rejected the credentials: ${text}`, retryable: false };
    if (status === 402) return { kind: "forbidden", message: `Pipedrive plan does not allow this request: ${text}`, retryable: false };
    if (status === 403) return { kind: "forbidden", message: `Pipedrive denied access: ${text}`, retryable: false };
    if (status === 404 || status === 410) return { kind: "not_found", message: `Pipedrive resource not found: ${text}`, retryable: false };
    if (status === 409) return { kind: "invalid_request", message: `Pipedrive conflict: ${text}`, retryable: false };
    if (status === 429) return { kind: "rate_limit", message: `Pipedrive rate limit: ${text}`, retryable: true };
    if (status >= 500) return { kind: "provider", message: `Pipedrive server error: ${text}`, retryable: true };
    return { kind: "invalid_request", message: `Pipedrive rejected the request: ${text}`, retryable: false };
  },

  readRateLimit: (headers) => readPipedriveRateLimit(headers),
};
