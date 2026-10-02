import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * Salesforce response normalizers — pure functions, no business logic.
 * Official field names are kept as Salesforce returns them; only the
 * `attributes` envelope is lifted into `object_type` / `url`.
 */

export function normalizeSalesforceRecord(value: unknown): Record<string, unknown> {
  const r = asRecord(value);
  const attributes = asRecord(r["attributes"]);
  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (k !== "attributes") fields[k] = v;
  return {
    id: r["Id"] ?? r["id"] ?? null,
    object_type: attributes["type"] ?? null,
    url: attributes["url"] ?? null,
    fields,
  };
}

/** `{ id, success, errors }` save result (create / upsert / collections). */
export function normalizeSalesforceSaveResult(value: unknown): Record<string, unknown> {
  const r = asRecord(value);
  const errors = Array.isArray(r["errors"]) ? (r["errors"] as unknown[]).map(normalizeSalesforceError) : [];
  return {
    id: r["id"] ?? null,
    success: r["success"] !== false && errors.length === 0,
    ...(r["created"] === undefined ? {} : { created: r["created"] }),
    errors,
  };
}

export function normalizeSalesforceError(value: unknown): Record<string, unknown> {
  const r = asRecord(value);
  return {
    error_code: r["errorCode"] ?? r["statusCode"] ?? null,
    message: r["message"] ?? null,
    fields: Array.isArray(r["fields"]) ? r["fields"] : [],
  };
}

export function normalizeSalesforceField(value: unknown): Record<string, unknown> {
  const f = asRecord(value);
  return {
    name: f["name"] ?? null,
    label: f["label"] ?? null,
    type: f["type"] ?? null,
    length: f["length"] ?? null,
    createable: f["createable"] === true,
    updateable: f["updateable"] === true,
    filterable: f["filterable"] === true,
    nillable: f["nillable"] === true,
    // Salesforce marks a field required when it is createable, not nillable and has no default.
    required: f["createable"] === true && f["nillable"] === false && f["defaultedOnCreate"] !== true,
    external_id: f["externalId"] === true,
    unique: f["unique"] === true,
    reference_to: Array.isArray(f["referenceTo"]) ? f["referenceTo"] : [],
    relationship_name: f["relationshipName"] ?? null,
    picklist_values: Array.isArray(f["picklistValues"])
      ? (f["picklistValues"] as unknown[]).map((p) => ({ value: asRecord(p)["value"] ?? null, active: asRecord(p)["active"] === true }))
      : [],
  };
}

export function normalizeSalesforceDescribe(value: unknown): Record<string, unknown> {
  const d = asRecord(value);
  return {
    name: d["name"] ?? null,
    label: d["label"] ?? null,
    custom: d["custom"] === true,
    key_prefix: d["keyPrefix"] ?? null,
    capabilities: {
      createable: d["createable"] === true,
      updateable: d["updateable"] === true,
      deletable: d["deletable"] === true,
      queryable: d["queryable"] === true,
      searchable: d["searchable"] === true,
      retrieveable: d["retrieveable"] === true,
    },
    fields: Array.isArray(d["fields"]) ? (d["fields"] as unknown[]).map(normalizeSalesforceField) : [],
    child_relationships: Array.isArray(d["childRelationships"])
      ? (d["childRelationships"] as unknown[]).map((c) => {
          const r = asRecord(c);
          return { child_object: r["childSObject"] ?? null, field: r["field"] ?? null, relationship_name: r["relationshipName"] ?? null };
        })
      : [],
  };
}

export function normalizeSalesforceSObjectSummary(value: unknown): Record<string, unknown> {
  const d = asRecord(value);
  return {
    name: d["name"] ?? null,
    label: d["label"] ?? null,
    custom: d["custom"] === true,
    key_prefix: d["keyPrefix"] ?? null,
    createable: d["createable"] === true,
    updateable: d["updateable"] === true,
    deletable: d["deletable"] === true,
    queryable: d["queryable"] === true,
    searchable: d["searchable"] === true,
  };
}

export function normalizeSalesforceUserInfo(value: unknown): Record<string, unknown> {
  const u = asRecord(value);
  return {
    user_id: u["user_id"] ?? null,
    organization_id: u["organization_id"] ?? null,
    username: u["preferred_username"] ?? null,
    name: u["name"] ?? null,
    email: u["email"] ?? null,
    email_verified: u["email_verified"] === true,
    user_type: u["user_type"] ?? null,
    locale: u["locale"] ?? null,
    zoneinfo: u["zoneinfo"] ?? null,
    active: u["active"] !== false,
  };
}

/** `/limits` → one row per limit. */
export function normalizeSalesforceLimits(value: unknown): Record<string, unknown>[] {
  return Object.entries(asRecord(value)).map(([name, v]) => ({ name, max: asRecord(v)["Max"] ?? null, remaining: asRecord(v)["Remaining"] ?? null }));
}

/** Official org id (00D…) / user id (005…) from the OAuth identity URL `…/id/{orgId}/{userId}`. */
export function parseSalesforceIdentityUrl(value: unknown): { orgId: string; userId: string; host: string } | null {
  if (typeof value !== "string") return null;
  try {
    const u = new URL(value);
    const m = /^\/id\/(00D[A-Za-z0-9]{12,15})\/(005[A-Za-z0-9]{12,15})$/.exec(u.pathname);
    return m && u.protocol === "https:" ? { orgId: m[1]!, userId: m[2]!, host: u.hostname } : null;
  } catch {
    return null;
  }
}
