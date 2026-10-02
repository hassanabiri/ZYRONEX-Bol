import {
  normalizeSalesforceDescribe,
  normalizeSalesforceError,
  normalizeSalesforceLimits,
  normalizeSalesforceRecord,
  normalizeSalesforceSaveResult,
  normalizeSalesforceSObjectSummary,
  normalizeSalesforceUserInfo,
} from "@/lib/connectors/adapters/salesforce-map";
import { asRecord, assertRequiredParams } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizeContext, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Salesforce CRM connector — official Salesforce REST API only.
 *
 * Owns authentication, REST calls, SOQL/SOSL pass-through, nextRecordsUrl
 * pagination, composite partial-result reporting and error mapping. No AI,
 * sales logic, lead scoring or case routing.
 *
 * Every org has its own `instance_url` (returned by the OAuth token response
 * and stored in the vault). Calls are built against a placeholder origin and
 * re-homed onto the validated instance host in `authorize`, so a call can
 * never reach a non-Salesforce host with the bearer token.
 */

export const SALESFORCE_API_VERSION = "v62.0";
/** Placeholder origin, replaced by the org's validated instance_url in `authorize`. */
export const SALESFORCE_PLACEHOLDER_ORIGIN = "https://instance.salesforce.invalid";
const DATA = `/services/data/${SALESFORCE_API_VERSION}`;

/** Official Salesforce hosts (My Domain, legacy pods, sandboxes, Government Cloud). */
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:salesforce\.com|force\.com|cloudforce\.com|salesforce\.mil|salesforce-setup\.com)$/i;

export function assertSalesforceInstanceUrl(value: unknown): string {
  let u: URL;
  try {
    u = new URL(String(value ?? ""));
  } catch {
    throw new ConnectorError("auth", "The Salesforce instance URL is missing or invalid", { retryable: false });
  }
  if (u.protocol !== "https:" || !HOST_RE.test(u.hostname) || u.username || u.password || u.port)
    throw new ConnectorError("auth", "The Salesforce instance URL is not an official Salesforce host", { retryable: false });
  return u.origin;
}

/** Standard objects with first-class operations. */
export const STANDARD_OBJECTS = {
  account: "Account",
  contact: "Contact",
  lead: "Lead",
  opportunity: "Opportunity",
  case: "Case",
  task: "Task",
  event: "Event",
} as const;

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  idempotency_key:
    "Salesforce REST publishes no idempotency header. Use upsert by an official External ID field, Salesforce record ids, and ZYRONEX execution idempotency.",
  file_upload:
    "ContentVersion / Attachment uploads need multipart/form-data or base64 binary bodies that the JSON runtime does not carry.",
  file_download: "ContentVersion.VersionData and Attachment.Body return binary content that the JSON runtime does not carry.",
  bulk_api: "Bulk API 2.0 jobs upload CSV bodies and poll long-running jobs; this needs binary transfer and job infrastructure.",
  platform_events_subscribe: "Platform Events subscription needs a persistent CometD / Pub/Sub API (gRPC) stream; no persistent streaming host exists.",
  change_data_capture: "Change Data Capture is delivered over the Streaming / Pub/Sub API only; it needs a persistent streaming host.",
  pub_sub_api: "The Pub/Sub API is gRPC over HTTP/2 with long-lived streams; it is not compatible with the request/response runtime.",
  outbound_messages:
    "Workflow Outbound Messages are SOAP deliveries that must be acknowledged with a SOAP <Ack> body; the shared ingress cannot return it (technical debt).",
  metadata_api: "Creating objects/fields is a Metadata API (SOAP, admin) change and is outside the connector scope.",
  merge_records: "Record merge is a SOAP API call and irreversible; it is not exposed.",
  convert_lead: "Lead conversion is a SOAP API / Apex action that applies sales process rules; it is business logic outside the connector.",
  undelete: "Undelete is a SOAP API call; REST exposes no record restore.",
  hard_delete: "Hard delete is only available through the Bulk API.",
  user_permission_bypass: "The connector runs with the connecting user's profile, permission sets and sharing; it cannot widen access.",
  sales_automation: "Lead scoring, assignment, case routing and workflows are business logic owned by ZYRONEX, not the connector.",
};

type Kind = "record" | "save" | "query" | "search" | "describe" | "sobjects" | "userinfo" | "limits" | "versions" | "composite" | "composite_batch" | "composite_graph" | "collection" | "updated" | "deleted" | "empty";

type Params = Record<string, unknown>;
type Spec = {
  verb: HttpMethod;
  path: (p: Params) => string;
  kind: Kind;
  required?: string[];
  query?: (p: Params) => Record<string, string>;
  body?: (p: Params) => unknown;
  paginated?: boolean;
};

const enc = (v: unknown) => encodeURIComponent(String(v));
const invalid = (m: string) => new ConnectorError("invalid_request", m, { retryable: false });

/** Official SObject API names: `Account`, `Invoice__c`, `ns__Thing__c`, `Foo__mdt`… */
export function assertObjectName(value: unknown): string {
  const name = String(value ?? "");
  if (!/^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(name) || name.endsWith("_") || /___/.test(name))
    throw invalid("`object_type` must be an official Salesforce SObject API name");
  return name;
}

/** 15- or 18-character Salesforce record id. */
export function assertRecordId(value: unknown, field = "id"): string {
  const id = String(value ?? "");
  if (!/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(id)) throw invalid(`\`${field}\` must be a 15- or 18-character Salesforce id`);
  return id;
}

function assertFieldName(value: unknown, field: string): string {
  const name = String(value ?? "");
  if (!/^[A-Za-z][A-Za-z0-9_]{0,79}(?:\.[A-Za-z][A-Za-z0-9_]{0,79}){0,4}$/.test(name)) throw invalid(`\`${field}\` must be an official Salesforce field API name`);
  return name;
}

function fieldList(p: Params): string[] | undefined {
  const raw = p["fields"];
  const list = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  if (!list) return undefined;
  if (list.length === 0 || list.length > 200) throw invalid("`fields` must list 1–200 field API names");
  return list.map((f) => assertFieldName(f, "fields"));
}

/** SOQL is passed through unchanged; only shape and transport safety are checked. */
export function assertSoql(value: unknown): string {
  const q = typeof value === "string" ? value.trim() : "";
  if (!/^select\s/i.test(q)) throw invalid("`soql` must be a Salesforce SOQL SELECT statement");
  if (q.length > 100_000) throw invalid("SOQL statements are limited to 100,000 characters by Salesforce");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(q)) throw invalid("`soql` contains control characters");
  return q;
}

/** SOSL is passed through unchanged; it uses the separate /search endpoint. */
export function assertSosl(value: unknown): string {
  const q = typeof value === "string" ? value.trim() : "";
  if (!/^find\s/i.test(q)) throw invalid("`sosl` must be a Salesforce SOSL FIND statement");
  if (q.length > 100_000) throw invalid("SOSL statements are limited to 100,000 characters by Salesforce");
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(q)) throw invalid("`sosl` contains control characters");
  return q;
}

/** Official query cursor: Salesforce's relative `nextRecordsUrl`. Anything else is rejected. */
export function assertNextRecordsUrl(value: unknown): string {
  const v = String(value ?? "");
  if (!/^\/services\/data\/v\d{2,3}\.\d\/query(?:All)?\/[A-Za-z0-9]{15,18}-\d{1,9}$/.test(v))
    throw invalid("Pagination cursor is not an official Salesforce nextRecordsUrl");
  return v;
}

function fieldsBody(p: Params): Record<string, unknown> {
  const fields = p["fields"];
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw invalid("`fields` must be an object of Salesforce field values");
  for (const k of Object.keys(fields)) assertFieldName(k, "fields");
  return fields as Record<string, unknown>;
}

function listSoql(object: string, p: Params): string {
  const fields = fieldList(p) ?? ["Id"];
  const limit = Math.min(Math.max(Number(p["limit"] ?? 200) || 200, 1), 2000);
  const order = p["order_by"] === undefined ? "" : ` ORDER BY ${assertFieldName(p["order_by"], "order_by")} ${p["order_direction"] === "DESC" ? "DESC" : "ASC"}`;
  return `SELECT ${fields.join(", ")} FROM ${object}${order} LIMIT ${limit}`;
}

function objectOps(prefix: string, objectOf: (p: Params) => string, extra: string[] = []): Record<string, Spec> {
  const base = (p: Params) => `${DATA}/sobjects/${enc(objectOf(p))}`;
  const req = (...k: string[]) => [...extra, ...k];
  const plural = prefix.endsWith("y") ? `${prefix.slice(0, -1)}ies` : prefix === "record" ? "records" : `${prefix}s`;
  return {
    [`create_${prefix}`]: { verb: "POST", path: base, kind: "save", required: req("fields"), body: fieldsBody },
    [`get_${prefix}`]: {
      verb: "GET", path: (p) => `${base(p)}/${assertRecordId(p["id"])}`, kind: "record", required: req("id"),
      query: (p) => { const f = fieldList(p); return f ? { fields: f.join(",") } : {}; },
    },
    [`update_${prefix}`]: { verb: "PATCH", path: (p) => `${base(p)}/${assertRecordId(p["id"])}`, kind: "empty", required: req("id", "fields"), body: fieldsBody },
    [`delete_${prefix}`]: { verb: "DELETE", path: (p) => `${base(p)}/${assertRecordId(p["id"])}`, kind: "empty", required: req("id") },
    // Official idempotent write: upsert by an External ID field.
    [`upsert_${prefix}`]: {
      verb: "PATCH", path: (p) => `${base(p)}/${enc(assertFieldName(p["external_id_field"], "external_id_field"))}/${enc(p["external_id"])}`,
      kind: "save", required: req("external_id_field", "external_id", "fields"), body: fieldsBody,
    },
    [`list_${plural}`]: { verb: "GET", path: () => `${DATA}/query`, kind: "query", required: req(), paginated: true, query: (p) => ({ q: listSoql(objectOf(p), p) }) },
    [`describe_${prefix}`]: { verb: "GET", path: (p) => `${base(p)}/describe`, kind: "describe", required: req() },
    [`search_${plural}`]: {
      verb: "GET", path: () => `${DATA}/parameterizedSearch`, kind: "search", required: req("search_text"),
      query: (p) => {
        const object = objectOf(p);
        const text = String(p["search_text"]);
        if (text.trim().length < 2) throw invalid("`search_text` needs at least 2 characters (Salesforce SOSL minimum)");
        const f = fieldList(p);
        return { q: text, sobject: object, ...(f ? { [`${object}.fields`]: f.join(",") } : {}), overallLimit: String(Math.min(Math.max(Number(p["limit"] ?? 50) || 50, 1), 2000)) };
      },
    },
  };
}

const genericObject = (p: Params) => assertObjectName(p["object_type"]);

function collection(p: Params, max = 200): unknown[] {
  const records = p["records"];
  if (!Array.isArray(records) || records.length === 0 || records.length > max) throw invalid(`\`records\` must be a list of 1–${max} items (Salesforce collection limit)`);
  return records;
}

function compositeRequests(p: Params, key: string, max: number): Record<string, unknown>[] {
  const list = p[key];
  if (!Array.isArray(list) || list.length === 0 || list.length > max) throw invalid(`\`${key}\` must be a list of 1–${max} subrequests (Salesforce limit)`);
  return list.map((r) => {
    const s = asRecord(r);
    const url = String(s["url"] ?? "");
    // Subrequests may only target this org's REST API (no absolute URLs).
    if (!/^\/services\/data\/v\d{2,3}\.\d\//.test(url) || /[\s\\]|\.\.|\/\//.test(url.slice(1))) throw invalid("Composite subrequest `url` must be a relative /services/data/ path");
    if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(String(s["method"] ?? ""))) throw invalid("Composite subrequest `method` must be an official HTTP method");
    return s;
  });
}

const OPERATIONS: Record<string, Spec> = {
  // ---- Identity / org -------------------------------------------------------
  get_user_info: { verb: "GET", path: () => "/services/oauth2/userinfo", kind: "userinfo" },
  get_organization: {
    verb: "GET", path: () => `${DATA}/query`, kind: "query",
    query: () => ({ q: "SELECT Id, Name, OrganizationType, InstanceName, IsSandbox, LanguageLocaleKey, TimeZoneSidKey, DefaultLocaleSidKey FROM Organization LIMIT 1" }),
  },
  get_limits: { verb: "GET", path: () => `${DATA}/limits`, kind: "limits" },
  list_api_versions: { verb: "GET", path: () => "/services/data/", kind: "versions" },
  list_sobjects: { verb: "GET", path: () => `${DATA}/sobjects`, kind: "sobjects" },

  // ---- Standard + custom objects -------------------------------------------
  ...Object.entries(STANDARD_OBJECTS).reduce<Record<string, Spec>>((acc, [key, name]) => ({ ...acc, ...objectOps(key, () => name) }), {}),
  ...objectOps("record", genericObject, ["object_type"]),
  describe_object: { verb: "GET", path: (p) => `${DATA}/sobjects/${enc(genericObject(p))}/describe`, kind: "describe", required: ["object_type"] },
  get_related_records: {
    verb: "GET",
    path: (p) => `${DATA}/sobjects/${enc(genericObject(p))}/${assertRecordId(p["id"])}/${enc(assertObjectName(p["relationship_name"]))}`,
    kind: "query", required: ["object_type", "id", "relationship_name"],
    query: (p) => { const f = fieldList(p); return f ? { fields: f.join(",") } : {}; },
  },
  get_updated_records: {
    verb: "GET", path: (p) => `${DATA}/sobjects/${enc(genericObject(p))}/updated/`, kind: "updated", required: ["object_type", "start", "end"],
    query: (p) => ({ start: String(p["start"]), end: String(p["end"]) }),
  },
  get_deleted_records: {
    verb: "GET", path: (p) => `${DATA}/sobjects/${enc(genericObject(p))}/deleted/`, kind: "deleted", required: ["object_type", "start", "end"],
    query: (p) => ({ start: String(p["start"]), end: String(p["end"]) }),
  },

  // ---- SOQL / SOSL ---------------------------------------------------------
  query: { verb: "GET", path: () => `${DATA}/query`, kind: "query", required: ["soql"], paginated: true, query: (p) => ({ q: assertSoql(p["soql"]) }) },
  query_all: { verb: "GET", path: () => `${DATA}/queryAll`, kind: "query", required: ["soql"], paginated: true, query: (p) => ({ q: assertSoql(p["soql"]) }) },
  search: { verb: "GET", path: () => `${DATA}/search`, kind: "search", required: ["sosl"], query: (p) => ({ q: assertSosl(p["sosl"]) }) },

  // ---- Composite -----------------------------------------------------------
  composite: {
    verb: "POST", path: () => `${DATA}/composite`, kind: "composite", required: ["requests"],
    body: (p) => ({ allOrNone: p["all_or_none"] === true, compositeRequest: compositeRequests(p, "requests", 25) }),
  },
  composite_batch: {
    verb: "POST", path: () => `${DATA}/composite/batch`, kind: "composite_batch", required: ["requests"],
    body: (p) => ({ haltOnError: p["halt_on_error"] === true, batchRequests: compositeRequests(p, "requests", 25) }),
  },
  composite_graph: {
    verb: "POST", path: () => `${DATA}/composite/graph`, kind: "composite_graph", required: ["graphs"],
    body: (p) => {
      const graphs = p["graphs"];
      if (!Array.isArray(graphs) || graphs.length === 0 || graphs.length > 75) throw invalid("`graphs` must be a list of 1–75 graphs");
      return { graphs: graphs.map((g) => ({ graphId: String(asRecord(g)["graphId"] ?? ""), compositeRequest: compositeRequests(asRecord(g), "compositeRequest", 500) })) };
    },
  },
  create_records: {
    verb: "POST", path: () => `${DATA}/composite/sobjects`, kind: "collection", required: ["records"],
    body: (p) => ({ allOrNone: p["all_or_none"] === true, records: collection(p).map((r) => { const x = asRecord(r); assertObjectName(asRecord(x["attributes"])["type"]); return x; }) }),
  },
  update_records: {
    verb: "PATCH", path: () => `${DATA}/composite/sobjects`, kind: "collection", required: ["records"],
    body: (p) => ({ allOrNone: p["all_or_none"] === true, records: collection(p).map((r) => { const x = asRecord(r); assertObjectName(asRecord(x["attributes"])["type"]); assertRecordId(x["id"]); return x; }) }),
  },
  delete_records: {
    verb: "DELETE", path: () => `${DATA}/composite/sobjects`, kind: "collection", required: ["ids"],
    query: (p) => {
      const ids = p["ids"];
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) throw invalid("`ids` must be a list of 1–200 Salesforce ids");
      return { ids: ids.map((id) => assertRecordId(id, "ids")).join(","), allOrNone: String(p["all_or_none"] === true) };
    },
  },
};

export const SALESFORCE_OPERATIONS = Object.keys(OPERATIONS);

function buildUrl(spec: Spec, params: Params, cursor: string | null | undefined): string {
  if (cursor && spec.paginated) return `${SALESFORCE_PLACEHOLDER_ORIGIN}${assertNextRecordsUrl(cursor)}`;
  const url = new URL(`${SALESFORCE_PLACEHOLDER_ORIGIN}${spec.path(params)}`);
  for (const [k, v] of Object.entries(spec.query?.(params) ?? {})) url.searchParams.set(k, v);
  return url.toString();
}

function summary(http_status: number, succeeded: number, failed: number, extra: Record<string, unknown> = {}) {
  return { type: "composite_summary", http_status, succeeded, failed, partial: failed > 0 && succeeded > 0, all_failed: failed > 0 && succeeded === 0, ...extra };
}

function subResult(r: Record<string, unknown>, statusKey: string, bodyKey: string) {
  const code = Number(r[statusKey] ?? 0);
  const body = r[bodyKey];
  const ok = code >= 200 && code < 300;
  return {
    reference_id: r["referenceId"] ?? null,
    http_status: code,
    status: ok ? "ok" : "error",
    ...(ok ? { body: body ?? null } : { errors: Array.isArray(body) ? (body as unknown[]).map(normalizeSalesforceError) : [normalizeSalesforceError(body)] }),
  };
}

function normalizePage(kind: Kind, payload: unknown, status: number): NormalizedPage {
  const p = asRecord(payload);
  switch (kind) {
    case "record":
      return { items: [normalizeSalesforceRecord(payload)] };
    case "save":
      return { items: [normalizeSalesforceSaveResult(payload)] };
    case "query": {
      const next = p["done"] === false && typeof p["nextRecordsUrl"] === "string" ? p["nextRecordsUrl"] : null;
      if (next !== null) {
        try {
          assertNextRecordsUrl(next);
        } catch {
          throw new Error("nextRecordsUrl is not an official Salesforce query locator");
        }
      }
      const records = Array.isArray(p["records"]) ? (p["records"] as unknown[]) : [];
      return { items: records.map(normalizeSalesforceRecord), cursor: next };
    }
    case "search": {
      const rows = Array.isArray(payload) ? payload : Array.isArray(p["searchRecords"]) ? (p["searchRecords"] as unknown[]) : [];
      return { items: rows.map(normalizeSalesforceRecord) };
    }
    case "describe":
      return { items: [normalizeSalesforceDescribe(payload)] };
    case "sobjects":
      return { items: (Array.isArray(p["sobjects"]) ? (p["sobjects"] as unknown[]) : []).map(normalizeSalesforceSObjectSummary) };
    case "userinfo":
      return { items: [normalizeSalesforceUserInfo(payload)] };
    case "limits":
      return { items: normalizeSalesforceLimits(payload) };
    case "versions":
      return { items: (Array.isArray(payload) ? payload : []).map((v) => ({ version: asRecord(v)["version"] ?? null, label: asRecord(v)["label"] ?? null, url: asRecord(v)["url"] ?? null })) };
    case "updated":
      return { items: (Array.isArray(p["ids"]) ? (p["ids"] as unknown[]) : []).map((id) => ({ id })), raw: { latest_date_covered: p["latestDateCovered"] ?? null } };
    case "deleted":
      return {
        items: (Array.isArray(p["deletedRecords"]) ? (p["deletedRecords"] as unknown[]) : []).map((r) => ({ id: asRecord(r)["id"] ?? null, deleted_date: asRecord(r)["deletedDate"] ?? null })),
      };
    case "composite": {
      const rows = (Array.isArray(p["compositeResponse"]) ? (p["compositeResponse"] as unknown[]) : []).map((r) => subResult(asRecord(r), "httpStatusCode", "body"));
      const failed = rows.filter((r) => r.status === "error").length;
      return { items: [...rows, summary(status, rows.length - failed, failed)] };
    }
    case "composite_batch": {
      const rows = (Array.isArray(p["results"]) ? (p["results"] as unknown[]) : []).map((r, i) => ({ ...subResult(asRecord(r), "statusCode", "result"), reference_id: i }));
      const failed = rows.filter((r) => r.status === "error").length;
      return { items: [...rows, summary(status, rows.length - failed, failed, { has_errors: p["hasErrors"] === true })] };
    }
    case "composite_graph": {
      const graphs = Array.isArray(p["graphs"]) ? (p["graphs"] as unknown[]) : [];
      const rows = graphs.map((g) => {
        const r = asRecord(g);
        const subs = (Array.isArray(asRecord(r["graphResponse"])["compositeResponse"]) ? (asRecord(r["graphResponse"])["compositeResponse"] as unknown[]) : []).map((s) =>
          subResult(asRecord(s), "httpStatusCode", "body"),
        );
        return { graph_id: r["graphId"] ?? null, status: r["isSuccessful"] === true ? "ok" : "error", results: subs };
      });
      const failed = rows.filter((r) => r.status === "error").length;
      return { items: [...rows, summary(status, rows.length - failed, failed)] };
    }
    case "collection": {
      const rows = (Array.isArray(payload) ? payload : []).map((r) => ({ ...normalizeSalesforceSaveResult(r), status: normalizeSalesforceSaveResult(r)["success"] ? "ok" : "error" }));
      const failed = rows.filter((r) => r.status === "error").length;
      return { items: [...rows, summary(status, rows.length - failed, failed)] };
    }
    default:
      return { items: [] };
  }
}

/** Salesforce error body: `[{ message, errorCode, fields }]`. */
function firstError(payload: unknown): { code: string; message: string } {
  const first = Array.isArray(payload) ? asRecord(payload[0]) : asRecord(payload);
  return {
    code: String(first["errorCode"] ?? first["error"] ?? ""),
    message: String(first["message"] ?? first["error_description"] ?? ""),
  };
}

/** `Sforce-Limit-Info: api-usage=18/15000` (rolling 24h org API allocation). */
export function readSalesforceLimitInfo(headers: Headers): RateLimitInfo | undefined {
  const m = /api-usage=(\d+)\/(\d+)/.exec(headers.get("sforce-limit-info") ?? "");
  if (!m) return undefined;
  const used = Number(m[1]);
  const limit = Number(m[2]);
  return { limit, remaining: Math.max(limit - used, 0) };
}

export const salesforceConnector: ConnectorAdapter = {
  id: "salesforce",
  label: "Salesforce CRM",
  capabilities: ["read", "write", "search", "pagination", "health_check"],
  credentials: { kind: "oauth2", required: ["access_token", "instance_url"], optional: ["refresh_token", "identity_url", "org_id", "user_id"] },
  operations: SALESFORCE_OPERATIONS,
  healthOperation: "get_user_info",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    if (UNSUPPORTED_OPERATIONS[operation])
      throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS[operation]}`, { retryable: false });
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Salesforce operation "${operation}"`, { retryable: false });
    assertRequiredParams(operation, params, spec.required);
    const url = buildUrl(spec, params, cursor);
    const headers: Record<string, string> = { accept: "application/json" };
    const paginated = spec.paginated ? { paginated: true } : {};
    if (!spec.body) return { method: spec.verb, url, headers, ...paginated };
    return { method: spec.verb, url, headers: { ...headers, "content-type": "application/json" }, body: spec.body(params), ...paginated };
  },

  authorize: (call, credentials) => {
    const token = (credentials["access_token"] ?? "").trim();
    if (!token) throw new ConnectorError("auth", "The Salesforce org is not connected yet", { retryable: false });
    const origin = assertSalesforceInstanceUrl(credentials["instance_url"]);
    if (!call.url.startsWith(`${SALESFORCE_PLACEHOLDER_ORIGIN}/`))
      throw new ConnectorError("invalid_request", "Salesforce calls must target the connected org", { retryable: false });
    return { ...call, url: `${origin}${call.url.slice(SALESFORCE_PLACEHOLDER_ORIGIN.length)}`, headers: { ...call.headers, authorization: `Bearer ${token}` } };
  },

  normalize: (operation, payload, status, _context?: NormalizeContext) => {
    const spec = OPERATIONS[operation];
    if (!spec) return { items: [] };
    if (status === 204 || payload === null) return { items: [] };
    return normalizePage(spec.kind, payload, status);
  },

  mapError: (status, payload) => {
    if (status < 300) return null;
    const { code, message } = firstError(payload);
    const text = `${message || `Salesforce request failed (${status})`}${code ? ` [${code}]` : ""}`;
    if (status === 300) return { kind: "invalid_request", message: `More than one record matches the external id: ${text}`, retryable: false };
    if (status === 401 || code === "INVALID_SESSION_ID") return { kind: "auth", message: `Salesforce rejected the session: ${text}`, retryable: false };
    // Org-wide 24h API allocation exhausted: retrying within the run cannot help.
    if (code === "REQUEST_LIMIT_EXCEEDED") return { kind: "rate_limit", message: `Salesforce API limit reached: ${text}`, retryable: false };
    if (status === 429) return { kind: "rate_limit", message: `Salesforce rate limit: ${text}`, retryable: true };
    if (status === 403) return { kind: "forbidden", message: `Salesforce denied access: ${text}`, retryable: false };
    if (status === 404) return { kind: "not_found", message: `Salesforce resource not found: ${text}`, retryable: false };
    if (status === 409) return { kind: "invalid_request", message: `Salesforce conflict: ${text}`, retryable: false };
    if (status === 400 || status === 405 || status === 415) return { kind: "invalid_request", message: `Salesforce rejected the request: ${text}`, retryable: false };
    if (status >= 500) return { kind: "provider", message: `Salesforce server error: ${text}`, retryable: true };
    return { kind: "provider", message: text, retryable: false };
  },

  readRateLimit: (headers) => readSalesforceLimitInfo(headers),
};
