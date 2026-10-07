import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * Intercom response normalizers — pure, transport-neutral. No support logic.
 */

/** Official regional REST hosts. */
export const INTERCOM_HOSTS = { us: "https://api.intercom.io", eu: "https://api.eu.intercom.io", au: "https://api.au.intercom.io" } as const;
export type IntercomRegion = keyof typeof INTERCOM_HOSTS;

export function intercomRegion(value: unknown): IntercomRegion | null {
  const v = String(value ?? "us").trim().toLowerCase() || "us";
  return v === "us" || v === "eu" || v === "au" ? v : null;
}

const s = (v: unknown) => (v === undefined || v === null ? null : v);

export function normalizeIntercomContact(value: unknown): Record<string, unknown> {
  const c = asRecord(value);
  return {
    id: s(c["id"]),
    type: s(c["type"]),
    role: s(c["role"]),
    external_id: s(c["external_id"]),
    email: s(c["email"]),
    phone: s(c["phone"]),
    name: s(c["name"]),
    owner_id: s(c["owner_id"]),
    custom_attributes: asRecord(c["custom_attributes"]),
    created_at: s(c["created_at"]),
    updated_at: s(c["updated_at"]),
    workspace_id: s(c["workspace_id"]),
  };
}

export function normalizeIntercomCompany(value: unknown): Record<string, unknown> {
  const c = asRecord(value);
  return {
    id: s(c["id"]),
    company_id: s(c["company_id"]),
    name: s(c["name"]),
    plan: s(c["plan"]),
    size: s(c["size"]),
    website: s(c["website"]),
    industry: s(c["industry"]),
    user_count: s(c["user_count"]),
    custom_attributes: asRecord(c["custom_attributes"]),
    created_at: s(c["created_at"]),
    updated_at: s(c["updated_at"]),
  };
}

export function normalizeIntercomConversation(value: unknown): Record<string, unknown> {
  const c = asRecord(value);
  const parts = asRecord(c["conversation_parts"]);
  return {
    id: s(c["id"]),
    type: s(c["type"]),
    title: s(c["title"]),
    state: s(c["state"]),
    open: s(c["open"]),
    read: s(c["read"]),
    priority: s(c["priority"]),
    admin_assignee_id: s(c["admin_assignee_id"]),
    team_assignee_id: s(c["team_assignee_id"]),
    snoozed_until: s(c["snoozed_until"]),
    source: c["source"] === undefined ? null : asRecord(c["source"]),
    contacts: asRecord(c["contacts"])["contacts"] ?? [],
    tags: asRecord(c["tags"])["tags"] ?? [],
    custom_attributes: asRecord(c["custom_attributes"]),
    parts: Array.isArray(parts["conversation_parts"]) ? parts["conversation_parts"] : [],
    created_at: s(c["created_at"]),
    updated_at: s(c["updated_at"]),
  };
}

export function normalizeIntercomAdmin(value: unknown): Record<string, unknown> {
  const a = asRecord(value);
  const app = asRecord(a["app"]);
  return {
    id: s(a["id"]),
    type: s(a["type"]),
    name: s(a["name"]),
    email: s(a["email"]),
    away_mode_enabled: s(a["away_mode_enabled"]),
    has_inbox_seat: s(a["has_inbox_seat"]),
    team_ids: Array.isArray(a["team_ids"]) ? a["team_ids"] : [],
    ...(a["app"] ? { app: { id_code: s(app["id_code"]), name: s(app["name"]), region: s(app["region"]), timezone: s(app["timezone"]) } } : {}),
  };
}

export function normalizeIntercomEntity(value: unknown): Record<string, unknown> {
  return { ...asRecord(value) };
}

/** Intercom webhook notification envelope. */
export function parseIntercomNotification(payload: unknown): { id?: string; topic?: string; createdAtMs?: number; appId?: string } {
  const p = asRecord(payload);
  const out: { id?: string; topic?: string; createdAtMs?: number; appId?: string } = {};
  if (p["type"] !== "notification_event") return out;
  if (typeof p["id"] === "string" && p["id"]) out.id = p["id"];
  if (typeof p["topic"] === "string" && p["topic"]) out.topic = p["topic"];
  const created = Number(p["created_at"]);
  if (Number.isFinite(created) && created > 0) out.createdAtMs = created * 1000;
  if (typeof p["app_id"] === "string") out.appId = p["app_id"];
  return out;
}
