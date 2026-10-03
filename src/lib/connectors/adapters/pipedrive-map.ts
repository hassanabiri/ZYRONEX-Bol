import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * Pipedrive response normalizers — pure functions, no business logic.
 * Official field names (including 40-char custom-field hash keys) are kept
 * exactly as Pipedrive returns them.
 */

/** Pipedrive envelope: `{ success, data, additional_data }`. */
export function pipedriveData(payload: unknown): unknown {
  return asRecord(payload)["data"];
}

export function normalizePipedriveEntity(value: unknown): Record<string, unknown> {
  const r = asRecord(value);
  return { id: r["id"] ?? null, ...r };
}

/** Search hit `{ result_score, item }`. */
export function normalizePipedriveSearchHit(value: unknown): Record<string, unknown> {
  const r = asRecord(value);
  const item = asRecord(r["item"]);
  return { id: item["id"] ?? null, type: item["type"] ?? null, result_score: r["result_score"] ?? null, item };
}

export function normalizePipedriveField(value: unknown): Record<string, unknown> {
  const f = asRecord(value);
  return {
    id: f["id"] ?? null,
    key: f["key"] ?? null,
    name: f["name"] ?? null,
    field_type: f["field_type"] ?? null,
    // Custom fields have a 40-char hash key; core fields have readable keys.
    custom: f["edit_flag"] === true || /^[a-f0-9]{40}$/.test(String(f["key"] ?? "")),
    mandatory: f["mandatory_flag"] === true || asRecord(f["mandatory_flag"])["value"] === true,
    options: Array.isArray(f["options"]) ? (f["options"] as unknown[]).map((o) => ({ id: asRecord(o)["id"] ?? null, label: asRecord(o)["label"] ?? null })) : [],
  };
}

export function normalizePipedriveUser(value: unknown): Record<string, unknown> {
  const u = asRecord(value);
  return {
    id: u["id"] ?? null,
    name: u["name"] ?? null,
    email: u["email"] ?? null,
    active: u["active_flag"] !== false,
    is_admin: u["is_admin"] === 1 || u["is_admin"] === true,
    company_id: u["company_id"] ?? null,
    company_name: u["company_name"] ?? null,
    company_domain: u["company_domain"] ?? null,
    timezone: u["timezone_name"] ?? null,
    locale: u["locale"] ?? null,
  };
}

/** `https://acme.pipedrive.com` → `acme` (official company domain). */
export function pipedriveCompanyDomain(apiDomain: unknown): string | null {
  try {
    const u = new URL(String(apiDomain ?? ""));
    const m = /^([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.pipedrive\.com$/i.exec(u.hostname);
    return u.protocol === "https:" && m ? m[1]!.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Webhooks v2 `meta`. */
export type PipedriveWebhookMeta = {
  id: string | null;
  action: string | null;
  entity: string | null;
  entityId: string | null;
  companyId: string | null;
  version: string | null;
  timestampMs: number | undefined;
};

export function parsePipedriveWebhookMeta(payload: unknown): PipedriveWebhookMeta {
  const m = asRecord(asRecord(payload)["meta"]);
  const str = (v: unknown) => (typeof v === "string" && v ? v : typeof v === "number" ? String(v) : null);
  const ts = typeof m["timestamp"] === "string" ? Date.parse(m["timestamp"]) : undefined;
  return {
    id: str(m["id"]),
    action: str(m["action"]),
    entity: str(m["entity"]),
    entityId: str(m["entity_id"]),
    companyId: str(m["company_id"]),
    version: str(m["version"]),
    timestampMs: ts !== undefined && Number.isFinite(ts) ? ts : undefined,
  };
}
