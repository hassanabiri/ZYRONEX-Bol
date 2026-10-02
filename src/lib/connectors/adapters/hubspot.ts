import {
  normalizeHubSpotAccount,
  normalizeHubSpotAssociation,
  normalizeHubSpotAssociationBatch,
  normalizeHubSpotObject,
  normalizeHubSpotOwner,
  normalizeHubSpotPipeline,
  normalizeHubSpotProperty,
  normalizeHubSpotSchema,
} from "@/lib/connectors/adapters/hubspot-map";
import { asRecord, assertRequiredParams } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * HubSpot CRM connector — official HubSpot APIs only.
 *
 * Owns authentication, API calls, normalization, `after` cursor pagination,
 * batch partial-result reporting and error mapping. No AI, CRM rules, sales
 * logic or scoring. Every HubSpot path is built here from one version table,
 * so a version bump is a one-file change.
 */

export const HUBSPOT_API_BASE = "https://api.hubapi.com";
/** Official path versions in one place (objects/properties/schemas/pipelines/owners v3, associations v4). */
export const HUBSPOT_VERSIONS = { objects: "v3", associations: "v4", properties: "v3", schemas: "v3", pipelines: "v3", owners: "v3", accountInfo: "v3" } as const;

const LIST_MAX = 100;
const SEARCH_MAX = 200;
export const BATCH_MAX = 100;
export const ASSOCIATION_BATCH_MAX = 1000;

/** Standard objects with first-class operations. Custom objects use `object_type`. */
export const STANDARD_OBJECTS = {
  contact: "contacts",
  company: "companies",
  deal: "deals",
  ticket: "tickets",
} as const;
type ObjectKey = keyof typeof STANDARD_OBJECTS;

/** Official HubSpot OAuth scopes per object (tickets has one umbrella scope). */
export const HUBSPOT_SCOPES = {
  oauth: "oauth",
  contacts_read: "crm.objects.contacts.read",
  contacts_write: "crm.objects.contacts.write",
  companies_read: "crm.objects.companies.read",
  companies_write: "crm.objects.companies.write",
  deals_read: "crm.objects.deals.read",
  deals_write: "crm.objects.deals.write",
  tickets: "tickets",
  custom_read: "crm.objects.custom.read",
  custom_write: "crm.objects.custom.write",
  owners_read: "crm.objects.owners.read",
  schemas_custom_read: "crm.schemas.custom.read",
} as const;
type ScopeKey = keyof typeof HUBSPOT_SCOPES;

const OBJECT_SCOPES: Record<ObjectKey, { read: ScopeKey; write: ScopeKey }> = {
  contact: { read: "contacts_read", write: "contacts_write" },
  company: { read: "companies_read", write: "companies_write" },
  deal: { read: "deals_read", write: "deals_write" },
  ticket: { read: "tickets", write: "tickets" },
};

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  idempotency_key:
    "HubSpot CRM publishes no idempotency header; duplicate writes stay guarded by ZYRONEX execution idempotency, HubSpot record ids and unique properties (e.g. contact email, which HubSpot rejects with 409 when duplicated).",
  token_introspection:
    "GET /oauth/v1/access-tokens/{token} puts the access token in the URL path, which would expose it to proxies and logs; identity uses /account-info instead.",
  file_upload: "The Files API needs multipart/form-data uploads that the JSON runtime does not carry.",
  imports_api: "CRM Imports need multipart file uploads.",
  gdpr_delete:
    "POST /crm/v3/objects/contacts/gdpr-delete permanently erases a contact; it is a compliance action outside the connector scope (use archive_contact).",
  merge_records: "Record merge is irreversible and is not exposed as a connector operation.",
  webhook_subscription_management:
    "Webhook subscriptions are managed on the HubSpot developer app with the developer API key, not the portal OAuth token; they are configured in the app settings.",
  search_beyond_10000: "The CRM Search API returns at most 10,000 results per query; narrower filters are required beyond that.",
  user_permission_scoping:
    "A HubSpot token carries granted scopes, not the connecting user's record-level permissions; HubSpot exposes no per-user record visibility filter through the API.",
  workflow_automation: "Workflows, sequences and lead scoring are business logic owned by ZYRONEX, not the connector.",
};

type Kind = "object" | "objects" | "batch" | "association" | "associations" | "association_batch" | "labels" | "property" | "properties" | "schema" | "schemas" | "pipeline" | "pipelines" | "owner" | "owners" | "account" | "empty";

type Spec = {
  verb: HttpMethod;
  path: (p: Record<string, unknown>) => string;
  kind: Kind;
  scope: ScopeKey | ((p: Record<string, unknown>) => ScopeKey);
  required?: string[];
  /** GET list with `limit` + `after`. */
  paginated?: boolean;
  /** POST search: cursor goes in the body. */
  search?: boolean;
  maxLimit?: number;
  query?: (p: Record<string, unknown>) => Record<string, string | string[]>;
  body?: (p: Record<string, unknown>, cursor: string | null | undefined) => unknown;
  validate?: (p: Record<string, unknown>) => void;
};

const enc = (v: unknown) => encodeURIComponent(String(v));
const invalid = (m: string) => new ConnectorError("invalid_request", m, { retryable: false });
const V = HUBSPOT_VERSIONS;

/** Accepts official object type names/ids (`contacts`, `p_custom`, `2-12345`, `0-1`). */
export function assertObjectType(value: unknown): string {
  const type = String(value ?? "");
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(type)) throw invalid("`object_type` must be an official HubSpot object type name or id");
  return type;
}

function listQuery(p: Record<string, unknown>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  const list = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).map(String) : typeof p[k] === "string" ? [p[k] as string] : undefined);
  const properties = list("properties");
  const associations = list("associations");
  const history = list("properties_with_history");
  if (properties) out["properties"] = properties.join(",");
  if (associations) out["associations"] = associations.join(",");
  if (history) out["propertiesWithHistory"] = history.join(",");
  if (p["archived"] === true) out["archived"] = "true";
  if (typeof p["id_property"] === "string") out["idProperty"] = p["id_property"];
  return out;
}

function propertiesBody(p: Record<string, unknown>) {
  const props = p["properties"];
  if (!props || typeof props !== "object" || Array.isArray(props)) throw invalid("`properties` must be an object of HubSpot property values");
  return props as Record<string, unknown>;
}

function createBody(p: Record<string, unknown>) {
  return { properties: propertiesBody(p), ...(Array.isArray(p["associations"]) ? { associations: p["associations"] } : {}) };
}

function batchInputs(p: Record<string, unknown>, max = BATCH_MAX): unknown[] {
  const inputs = p["inputs"];
  if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > max) throw invalid(`\`inputs\` must be a list of 1–${max} items (HubSpot batch limit)`);
  return inputs;
}

const OPS = ["eq", "neq", "lt", "lte", "gt", "gte", "between", "in", "not_in", "has_property", "not_has_property", "contains_token", "not_contains_token"];

/** Builds the official CRM Search body; cursor → `after`. HubSpot allows 5 filterGroups × 6 filters, 18 filters total. */
export function buildSearchBody(p: Record<string, unknown>, cursor: string | null | undefined, max = SEARCH_MAX) {
  const groups = Array.isArray(p["filter_groups"]) ? (p["filter_groups"] as unknown[]) : Array.isArray(p["filters"]) ? [{ filters: p["filters"] }] : [];
  if (groups.length > 5) throw invalid("HubSpot search allows at most 5 filter groups");
  let total = 0;
  const filterGroups = groups.map((g) => {
    const filters = Array.isArray(asRecord(g)["filters"]) ? (asRecord(g)["filters"] as unknown[]) : [];
    if (filters.length > 6) throw invalid("HubSpot search allows at most 6 filters per group");
    total += filters.length;
    return {
      filters: filters.map((f) => {
        const r = asRecord(f);
        const operator = String(r["operator"] ?? "").toUpperCase();
        if (typeof r["propertyName"] !== "string" || !OPS.includes(operator.toLowerCase())) throw invalid("Each filter needs `propertyName` and an official HubSpot `operator`");
        return { ...r, operator };
      }),
    };
  });
  if (total > 18) throw invalid("HubSpot search allows at most 18 filters in total");
  const limit = Math.min(Math.max(Number(p["limit"] ?? 100) || 100, 1), max);
  const body: Record<string, unknown> = { filterGroups, limit };
  if (Array.isArray(p["sorts"])) body["sorts"] = p["sorts"];
  if (Array.isArray(p["properties"])) body["properties"] = p["properties"];
  if (typeof p["query"] === "string") body["query"] = p["query"];
  if (cursor) body["after"] = cursor;
  return body;
}

function objectOps(prefix: string, typeOf: (p: Record<string, unknown>) => string, read: Spec["scope"], write: Spec["scope"], extraRequired: string[] = []): Record<string, Spec> {
  const base = (p: Record<string, unknown>) => `/crm/${V.objects}/objects/${enc(typeOf(p))}`;
  const req = (...k: string[]) => [...extraRequired, ...k];
  return {
    [`list_${prefix}s`]: { verb: "GET", path: base, kind: "objects", paginated: true, maxLimit: LIST_MAX, query: listQuery, scope: read, required: req() },
    [`get_${prefix}`]: { verb: "GET", path: (p) => `${base(p)}/${enc(p["id"])}`, kind: "object", required: req("id"), query: listQuery, scope: read },
    [`create_${prefix}`]: { verb: "POST", path: base, kind: "object", required: req("properties"), body: createBody, scope: write },
    [`update_${prefix}`]: {
      verb: "PATCH", path: (p) => `${base(p)}/${enc(p["id"])}`, kind: "object", required: req("id", "properties"), scope: write,
      query: (p) => (typeof p["id_property"] === "string" ? { idProperty: p["id_property"] } : {}), body: (p) => ({ properties: propertiesBody(p) }),
    },
    [`archive_${prefix}`]: { verb: "DELETE", path: (p) => `${base(p)}/${enc(p["id"])}`, kind: "empty", required: req("id"), scope: write },
    [`search_${prefix}s`]: { verb: "POST", path: (p) => `${base(p)}/search`, kind: "objects", search: true, body: (p, c) => buildSearchBody(p, c), scope: read, required: req() },
    [`batch_read_${prefix}s`]: {
      verb: "POST", path: (p) => `${base(p)}/batch/read`, kind: "batch", required: req("ids"), scope: read,
      body: (p) => {
        const ids = p["ids"];
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > BATCH_MAX) throw invalid(`\`ids\` must be a list of 1–${BATCH_MAX} record ids`);
        return {
          inputs: ids.map((id) => ({ id: String(id) })),
          properties: Array.isArray(p["properties"]) ? p["properties"] : [],
          ...(typeof p["id_property"] === "string" ? { idProperty: p["id_property"] } : {}),
          ...(Array.isArray(p["properties_with_history"]) ? { propertiesWithHistory: p["properties_with_history"] } : {}),
        };
      },
      query: (p) => (p["archived"] === true ? { archived: "true" } : {}),
    },
    [`batch_create_${prefix}s`]: {
      verb: "POST", path: (p) => `${base(p)}/batch/create`, kind: "batch", required: req("inputs"), scope: write,
      body: (p) => ({ inputs: batchInputs(p).map((i) => ({ ...asRecord(i), properties: propertiesBody(asRecord(i)) })) }),
    },
    [`batch_update_${prefix}s`]: {
      verb: "POST", path: (p) => `${base(p)}/batch/update`, kind: "batch", required: req("inputs"), scope: write,
      body: (p) => ({
        inputs: batchInputs(p).map((i) => {
          const r = asRecord(i);
          if (r["id"] === undefined) throw invalid("Each batch update input needs an `id`");
          return { ...r, id: String(r["id"]), properties: propertiesBody(r) };
        }),
      }),
    },
    [`batch_archive_${prefix}s`]: {
      verb: "POST", path: (p) => `${base(p)}/batch/archive`, kind: "empty", required: req("ids"), scope: write,
      body: (p) => {
        const ids = p["ids"];
        if (!Array.isArray(ids) || ids.length === 0 || ids.length > BATCH_MAX) throw invalid(`\`ids\` must be a list of 1–${BATCH_MAX} record ids`);
        return { inputs: ids.map((id) => ({ id: String(id) })) };
      },
    },
  };
}

const customScope = (w: boolean) => (p: Record<string, unknown>): ScopeKey => {
  const type = String(p["object_type"] ?? "");
  const std = (Object.entries(STANDARD_OBJECTS).find(([, v]) => v === type)?.[0] ?? null) as ObjectKey | null;
  if (std) return w ? OBJECT_SCOPES[std].write : OBJECT_SCOPES[std].read;
  return w ? "custom_write" : "custom_read";
};

function assocPath(p: Record<string, unknown>) {
  return `/crm/${V.associations}/objects/${enc(assertObjectType(p["from_object_type"]))}/${enc(p["from_object_id"])}/associations`;
}

function assocTypes(p: Record<string, unknown>) {
  const types = p["association_types"];
  if (!Array.isArray(types) || types.length === 0) throw invalid("`association_types` must list official { associationCategory, associationTypeId } entries");
  return types.map((t) => {
    const r = asRecord(t);
    const category = String(r["associationCategory"] ?? "");
    if (!["HUBSPOT_DEFINED", "USER_DEFINED", "INTEGRATOR_DEFINED"].includes(category) || typeof r["associationTypeId"] !== "number")
      throw invalid("Each association type needs an official `associationCategory` and numeric `associationTypeId`");
    return { associationCategory: category, associationTypeId: r["associationTypeId"] };
  });
}

function assocBatchPath(p: Record<string, unknown>, action: string) {
  return `/crm/${V.associations}/associations/${enc(assertObjectType(p["from_object_type"]))}/${enc(assertObjectType(p["to_object_type"]))}/batch/${action}`;
}

const OPERATIONS: Record<string, Spec> = {
  // ---- Identity / health -----------------------------------------------------
  get_account_details: { verb: "GET", path: () => `/account-info/${V.accountInfo}/details`, kind: "account", scope: "oauth" },

  // ---- Standard objects ------------------------------------------------------
  ...objectOps("contact", () => STANDARD_OBJECTS.contact, OBJECT_SCOPES.contact.read, OBJECT_SCOPES.contact.write),
  ...objectOps("company", () => STANDARD_OBJECTS.company, OBJECT_SCOPES.company.read, OBJECT_SCOPES.company.write),
  ...objectOps("deal", () => STANDARD_OBJECTS.deal, OBJECT_SCOPES.deal.read, OBJECT_SCOPES.deal.write),
  ...objectOps("ticket", () => STANDARD_OBJECTS.ticket, OBJECT_SCOPES.ticket.read, OBJECT_SCOPES.ticket.write),

  // ---- Generic / custom objects (object type is an official parameter) --------
  ...objectOps("object", (p) => assertObjectType(p["object_type"]), customScope(false), customScope(true), ["object_type"]),

  // ---- Associations (v4) -----------------------------------------------------
  list_associations: {
    verb: "GET", path: (p) => `${assocPath(p)}/${enc(assertObjectType(p["to_object_type"]))}`, kind: "associations", paginated: true, maxLimit: 500,
    required: ["from_object_type", "from_object_id", "to_object_type"], scope: (p) => customScope(false)({ object_type: p["from_object_type"] }),
  },
  create_association: {
    verb: "PUT", path: (p) => `${assocPath(p)}/${enc(assertObjectType(p["to_object_type"]))}/${enc(p["to_object_id"])}`, kind: "association",
    required: ["from_object_type", "from_object_id", "to_object_type", "to_object_id", "association_types"], body: assocTypes,
    scope: (p) => customScope(true)({ object_type: p["from_object_type"] }),
  },
  create_default_association: {
    verb: "PUT", path: (p) => `${assocPath(p)}/default/${enc(assertObjectType(p["to_object_type"]))}/${enc(p["to_object_id"])}`, kind: "association",
    required: ["from_object_type", "from_object_id", "to_object_type", "to_object_id"], scope: (p) => customScope(true)({ object_type: p["from_object_type"] }), body: () => ({}),
  },
  remove_association: {
    verb: "DELETE", path: (p) => `${assocPath(p)}/${enc(assertObjectType(p["to_object_type"]))}/${enc(p["to_object_id"])}`, kind: "empty",
    required: ["from_object_type", "from_object_id", "to_object_type", "to_object_id"], scope: (p) => customScope(true)({ object_type: p["from_object_type"] }),
  },
  batch_read_associations: {
    verb: "POST", path: (p) => assocBatchPath(p, "read"), kind: "association_batch", required: ["from_object_type", "to_object_type", "ids"],
    scope: (p) => customScope(false)({ object_type: p["from_object_type"] }),
    body: (p) => {
      const ids = p["ids"];
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > ASSOCIATION_BATCH_MAX) throw invalid(`\`ids\` must be a list of 1–${ASSOCIATION_BATCH_MAX} record ids`);
      return { inputs: ids.map((id) => ({ id: String(id) })) };
    },
  },
  batch_create_associations: {
    verb: "POST", path: (p) => assocBatchPath(p, "create"), kind: "association_batch", required: ["from_object_type", "to_object_type", "inputs"],
    scope: (p) => customScope(true)({ object_type: p["from_object_type"] }),
    body: (p) => ({
      inputs: batchInputs(p, ASSOCIATION_BATCH_MAX).map((i) => {
        const r = asRecord(i);
        if (r["from_id"] === undefined || r["to_id"] === undefined) throw invalid("Each association input needs `from_id` and `to_id`");
        return { from: { id: String(r["from_id"]) }, to: { id: String(r["to_id"]) }, types: assocTypes({ association_types: r["association_types"] }) };
      }),
    }),
  },
  batch_archive_associations: {
    verb: "POST", path: (p) => assocBatchPath(p, "archive"), kind: "empty", required: ["from_object_type", "to_object_type", "inputs"],
    scope: (p) => customScope(true)({ object_type: p["from_object_type"] }),
    body: (p) => ({
      inputs: batchInputs(p, ASSOCIATION_BATCH_MAX).map((i) => {
        const r = asRecord(i);
        if (r["from_id"] === undefined || !Array.isArray(r["to_ids"])) throw invalid("Each association archive input needs `from_id` and `to_ids`");
        return { from: { id: String(r["from_id"]) }, to: (r["to_ids"] as unknown[]).map((id) => ({ id: String(id) })) };
      }),
    }),
  },
  list_association_labels: {
    verb: "GET", path: (p) => `/crm/${V.associations}/associations/${enc(assertObjectType(p["from_object_type"]))}/${enc(assertObjectType(p["to_object_type"]))}/labels`,
    kind: "labels", required: ["from_object_type", "to_object_type"], scope: (p) => customScope(false)({ object_type: p["from_object_type"] }),
  },

  // ---- Properties / schemas / pipelines / owners -----------------------------
  list_properties: {
    verb: "GET", path: (p) => `/crm/${V.properties}/properties/${enc(assertObjectType(p["object_type"]))}`, kind: "properties", required: ["object_type"],
    scope: customScope(false), query: (p) => (p["archived"] === true ? { archived: "true" } : {}),
  },
  get_property: {
    verb: "GET", path: (p) => `/crm/${V.properties}/properties/${enc(assertObjectType(p["object_type"]))}/${enc(p["property_name"])}`, kind: "property",
    required: ["object_type", "property_name"], scope: customScope(false),
  },
  list_schemas: { verb: "GET", path: () => `/crm/${V.schemas}/schemas`, kind: "schemas", scope: "schemas_custom_read" },
  get_schema: { verb: "GET", path: (p) => `/crm/${V.schemas}/schemas/${enc(assertObjectType(p["object_type"]))}`, kind: "schema", required: ["object_type"], scope: "schemas_custom_read" },
  list_pipelines: {
    verb: "GET", path: (p) => `/crm/${V.pipelines}/pipelines/${enc(assertObjectType(p["object_type"]))}`, kind: "pipelines", required: ["object_type"], scope: customScope(false),
  },
  get_pipeline: {
    verb: "GET", path: (p) => `/crm/${V.pipelines}/pipelines/${enc(assertObjectType(p["object_type"]))}/${enc(p["pipeline_id"])}`, kind: "pipeline",
    required: ["object_type", "pipeline_id"], scope: customScope(false),
  },
  list_owners: {
    verb: "GET", path: () => `/crm/${V.owners}/owners`, kind: "owners", paginated: true, maxLimit: 500, scope: "owners_read",
    query: (p) => ({ ...(typeof p["email"] === "string" ? { email: p["email"] } : {}), ...(p["archived"] === true ? { archived: "true" } : {}) }),
  },
  get_owner: { verb: "GET", path: (p) => `/crm/${V.owners}/owners/${enc(p["owner_id"])}`, kind: "owner", required: ["owner_id"], scope: "owners_read" },
};

export const HUBSPOT_OPERATIONS = Object.keys(OPERATIONS);

/** Least-privilege scope for an operation (custom-object/association scope depends on `object_type`). */
export function hubspotScopeFor(operation: string, params: Record<string, unknown> = {}): string | undefined {
  const spec = OPERATIONS[operation];
  if (!spec) return undefined;
  return HUBSPOT_SCOPES[typeof spec.scope === "function" ? spec.scope(params) : spec.scope];
}

function buildUrl(spec: Spec, params: Record<string, unknown>, cursor: string | null | undefined): string {
  const url = new URL(`${HUBSPOT_API_BASE}${spec.path(params)}`);
  for (const [k, v] of Object.entries(spec.query?.(params) ?? {})) url.searchParams.set(k, Array.isArray(v) ? v.join(",") : v);
  if (spec.paginated) {
    const max = spec.maxLimit ?? LIST_MAX;
    url.searchParams.set("limit", String(Math.min(Math.max(Number(params["limit"] ?? max) || max, 1), max)));
    if (cursor) url.searchParams.set("after", cursor);
  }
  return url.toString();
}

function normalizeByKind(kind: Kind, value: unknown): Record<string, unknown> {
  switch (kind) {
    case "object":
    case "objects":
    case "batch":
      return normalizeHubSpotObject(value);
    case "association":
    case "associations":
      return normalizeHubSpotAssociation(value);
    case "association_batch":
      return normalizeHubSpotAssociationBatch(value);
    case "labels": {
      const l = asRecord(value);
      return { category: l["category"] ?? null, type_id: l["typeId"] ?? null, label: l["label"] ?? null };
    }
    case "property":
    case "properties":
      return normalizeHubSpotProperty(value);
    case "schema":
    case "schemas":
      return normalizeHubSpotSchema(value);
    case "pipeline":
    case "pipelines":
      return normalizeHubSpotPipeline(value);
    case "owner":
    case "owners":
      return normalizeHubSpotOwner(value);
    case "account":
      return normalizeHubSpotAccount(value);
    default:
      return asRecord(value);
  }
}

/** HubSpot batch responses: `results` + optional `errors` (HTTP 207 on partial success). */
function batchItems(kind: Kind, body: Record<string, unknown>, status: number): Record<string, unknown>[] {
  const results = Array.isArray(body["results"]) ? (body["results"] as unknown[]) : [];
  const errors = Array.isArray(body["errors"]) ? (body["errors"] as unknown[]) : [];
  const items: Record<string, unknown>[] = results.map((r) => ({ ...normalizeByKind(kind, r), batch_status: "ok" }));
  for (const e of errors) {
    const r = asRecord(e);
    items.push({
      batch_status: "error",
      category: r["category"] ?? null,
      message: r["message"] ?? null,
      context: asRecord(r["context"]),
      sub_category: r["subCategory"] ?? null,
    });
  }
  const numErrors = typeof body["numErrors"] === "number" ? body["numErrors"] : errors.length;
  items.push({ type: "batch_summary", status: body["status"] ?? null, http_status: status, succeeded: results.length, failed: numErrors, partial: numErrors > 0 || status === 207 });
  return items;
}

function categoryOf(payload: unknown): string {
  return String(asRecord(payload)["category"] ?? "");
}

export const hubspotConnector: ConnectorAdapter = {
  id: "hubspot",
  label: "HubSpot CRM",
  capabilities: ["read", "write", "search", "pagination", "webhook", "health_check"],
  // OAuth access token or a private-app access token: both are bearer tokens stored in the same vault field.
  credentials: { kind: "oauth2", required: ["access_token"], optional: ["refresh_token"] },
  operations: HUBSPOT_OPERATIONS,
  healthOperation: "get_account_details",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    if (UNSUPPORTED_OPERATIONS[operation])
      throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS[operation]}`, { retryable: false });
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown HubSpot operation "${operation}"`, { retryable: false });
    assertRequiredParams(operation, params, spec.required);
    spec.validate?.(params);
    const url = buildUrl(spec, params, cursor);
    const headers: Record<string, string> = { accept: "application/json" };
    if (spec.verb === "GET" || spec.verb === "DELETE" || !spec.body)
      return { method: spec.verb, url, headers, ...(spec.paginated ? { paginated: true } : {}) };
    return {
      method: spec.verb,
      url,
      headers: { ...headers, "content-type": "application/json" },
      body: spec.body(params, cursor),
      ...(spec.search ? { paginated: true } : {}),
    };
  },

  authorize: (call, credentials) => {
    const token = (credentials["access_token"] ?? "").trim();
    if (!token) throw new ConnectorError("auth", "The HubSpot account is not connected yet", { retryable: false });
    return { ...call, headers: { ...call.headers, authorization: `Bearer ${token}` } };
  },

  /** HubSpot's `{ status:"error", message, correlationId, category }` envelope. */
  mapError: (status, payload) => {
    if (status < 400) return null;
    const p = asRecord(payload);
    const category = categoryOf(payload);
    const correlation = typeof p["correlationId"] === "string" ? ` (correlationId ${p["correlationId"]})` : "";
    const message = `${String(p["message"] ?? `HubSpot request failed (${status})`)}${correlation}`;
    if (status === 401 || category === "INVALID_AUTHENTICATION" || category === "EXPIRED_AUTHENTICATION")
      return { kind: "auth", message: `HubSpot rejected the token: ${message}`, retryable: false };
    if (status === 429 || category === "RATE_LIMITS") return { kind: "rate_limit", message: `HubSpot rate limit reached: ${message}`, retryable: true };
    if (status === 403 || category === "MISSING_SCOPES")
      return { kind: "forbidden", message: `HubSpot denied the request (scope or permission): ${message}`, retryable: false };
    if (status === 404 || category === "OBJECT_NOT_FOUND") return { kind: "not_found", message: `HubSpot record not found: ${message}`, retryable: false };
    if (status === 409 || category === "CONFLICT") return { kind: "invalid_request", message: `HubSpot conflict (duplicate or concurrent change): ${message}`, retryable: false };
    if (status >= 500) return { kind: "provider", message: `HubSpot is temporarily unavailable: ${message}`, retryable: true };
    return { kind: "invalid_request", message: `HubSpot rejected the request: ${message}`, retryable: false };
  },

  /** `Retry-After` plus HubSpot's documented `X-HubSpot-RateLimit-*` headers. */
  readRateLimit: (headers): RateLimitInfo | undefined => {
    const info: RateLimitInfo = {};
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds)) info.retryAfterMs = Math.max(0, seconds) * 1000;
      else {
        const at = Date.parse(retryAfter);
        if (Number.isFinite(at)) {
          info.retryAfterMs = Math.max(0, at - Date.now());
          info.resetAt = new Date(at).toISOString();
        }
      }
    }
    const max = Number(headers.get("x-hubspot-ratelimit-max"));
    const remaining = Number(headers.get("x-hubspot-ratelimit-remaining"));
    const interval = Number(headers.get("x-hubspot-ratelimit-interval-milliseconds"));
    if (headers.get("x-hubspot-ratelimit-max") !== null && Number.isFinite(max)) info.limit = max;
    if (headers.get("x-hubspot-ratelimit-remaining") !== null && Number.isFinite(remaining)) {
      info.remaining = remaining;
      if (remaining === 0 && info.retryAfterMs === undefined && Number.isFinite(interval) && interval > 0) info.retryAfterMs = interval;
    }
    if (info.retryAfterMs !== undefined && info.remaining === undefined) info.remaining = 0;
    return Object.keys(info).length ? info : undefined;
  },

  normalize: (operation, payload, status): NormalizedPage => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown HubSpot operation "${operation}"`, { retryable: false });
    if (spec.kind === "empty") return { items: [{ ok: true, operation }], cursor: null, raw: payload };
    if (payload === null && spec.kind === "association") return { items: [{ ok: true, operation }], cursor: null, raw: payload };
    if (payload === null || typeof payload !== "object")
      throw new ConnectorError("malformed_response", "HubSpot returned a non-JSON body", { retryable: false });
    const body = asRecord(payload);

    if (spec.kind === "batch" || spec.kind === "association_batch") return { items: batchItems(spec.kind, body, status), cursor: null, raw: payload };

    const list = Array.isArray(payload) ? payload : body["results"];
    const isCollection = ["objects", "associations", "labels", "properties", "schemas", "pipelines", "owners"].includes(spec.kind);
    if (!isCollection) return { items: [normalizeByKind(spec.kind, body)], cursor: null, raw: payload };
    if (list !== undefined && !Array.isArray(list))
      throw new ConnectorError("malformed_response", "HubSpot response field \"results\" is not a list", { retryable: false });
    const after = asRecord(asRecord(body["paging"])["next"])["after"];
    return {
      items: Array.isArray(list) ? list.map((v) => normalizeByKind(spec.kind, v)) : [],
      cursor: typeof after === "string" && after.length > 0 ? after : typeof after === "number" ? String(after) : null,
      raw: payload,
    };
  },
};
