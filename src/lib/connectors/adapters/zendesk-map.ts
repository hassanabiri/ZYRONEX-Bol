import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * Zendesk Support response normalizers — pure, transport-neutral.
 * Values are passed through as Zendesk returns them; no support logic.
 */

const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Accepts `acme`, `acme.zendesk.com` or `https://acme.zendesk.com`; returns `acme` or null. */
export function zendeskSubdomain(value: unknown): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (SUBDOMAIN.test(raw)) return raw;
  let host = raw;
  if (/^https:\/\//.test(raw)) {
    try {
      const u = new URL(raw);
      if (u.port || u.username || u.password || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return null;
      host = u.hostname;
    } catch {
      return null;
    }
  } else if (raw.includes("/") || raw.includes(":") || raw.includes("@")) return null;
  const m = /^([a-z0-9-]+)\.zendesk\.com$/.exec(host);
  return m && SUBDOMAIN.test(m[1]!) ? m[1]! : null;
}

const strOrNull = (v: unknown) => (v === undefined || v === null ? null : String(v));

export function normalizeZendeskTicket(value: unknown): Record<string, unknown> {
  const t = asRecord(value);
  return {
    ...t,
    id: t["id"] ?? null,
    subject: t["subject"] ?? null,
    status: t["status"] ?? null,
    priority: t["priority"] ?? null,
    type: t["type"] ?? null,
    requester_id: t["requester_id"] ?? null,
    assignee_id: t["assignee_id"] ?? null,
    group_id: t["group_id"] ?? null,
    organization_id: t["organization_id"] ?? null,
    tags: Array.isArray(t["tags"]) ? t["tags"] : [],
    custom_fields: Array.isArray(t["custom_fields"]) ? t["custom_fields"] : [],
    created_at: strOrNull(t["created_at"]),
    updated_at: strOrNull(t["updated_at"]),
  };
}

export function normalizeZendeskComment(value: unknown): Record<string, unknown> {
  const c = asRecord(value);
  return {
    id: c["id"] ?? null,
    author_id: c["author_id"] ?? null,
    body: c["body"] ?? null,
    html_body: c["html_body"] ?? null,
    public: c["public"] === true,
    via: c["via"] ?? null,
    // Attachment metadata only — content_url is a reference, never fetched.
    attachments: Array.isArray(c["attachments"]) ? (c["attachments"] as unknown[]).map(normalizeZendeskAttachment) : [],
    created_at: strOrNull(c["created_at"]),
  };
}

export function normalizeZendeskAttachment(value: unknown): Record<string, unknown> {
  const a = asRecord(value);
  return {
    id: a["id"] ?? null,
    file_name: a["file_name"] ?? null,
    content_type: a["content_type"] ?? null,
    size: a["size"] ?? null,
    content_url: a["content_url"] ?? null,
    inline: a["inline"] === true,
    malware_scan_result: a["malware_scan_result"] ?? null,
  };
}

export function normalizeZendeskUser(value: unknown): Record<string, unknown> {
  const u = asRecord(value);
  return {
    id: u["id"] ?? null,
    name: u["name"] ?? null,
    email: u["email"] ?? null,
    role: u["role"] ?? null,
    active: u["active"] ?? null,
    suspended: u["suspended"] ?? null,
    organization_id: u["organization_id"] ?? null,
    time_zone: u["time_zone"] ?? null,
    locale: u["locale"] ?? null,
    external_id: u["external_id"] ?? null,
    tags: Array.isArray(u["tags"]) ? u["tags"] : [],
    user_fields: asRecord(u["user_fields"]),
    created_at: strOrNull(u["created_at"]),
    updated_at: strOrNull(u["updated_at"]),
  };
}

export function normalizeZendeskEntity(value: unknown): Record<string, unknown> {
  return { ...asRecord(value) };
}

export function normalizeZendeskField(value: unknown): Record<string, unknown> {
  const f = asRecord(value);
  return {
    id: f["id"] ?? null,
    type: f["type"] ?? null,
    title: f["title"] ?? null,
    key: f["key"] ?? null,
    active: f["active"] ?? null,
    required: f["required"] ?? null,
    custom_field_options: Array.isArray(f["custom_field_options"]) ? f["custom_field_options"] : [],
    system_field_options: Array.isArray(f["system_field_options"]) ? f["system_field_options"] : [],
  };
}

/** Search hits carry a `result_type`; shape otherwise passes through. */
export function normalizeZendeskSearchHit(value: unknown): Record<string, unknown> {
  const h = asRecord(value);
  return { ...h, result_type: h["result_type"] ?? null };
}

/** Zendesk event-subscription webhook envelope (`zen:event-type:*`). */
export function parseZendeskWebhookEvent(payload: unknown): { id?: string; type?: string; timeMs?: number; accountId?: string } {
  const p = asRecord(payload);
  const out: { id?: string; type?: string; timeMs?: number; accountId?: string } = {};
  if (typeof p["id"] === "string" && p["id"]) out.id = p["id"];
  if (typeof p["type"] === "string" && p["type"]) out.type = p["type"];
  if (typeof p["time"] === "string") {
    const t = Date.parse(p["time"]);
    if (Number.isFinite(t)) out.timeMs = t;
  }
  if (p["account_id"] !== undefined && p["account_id"] !== null) out.accountId = String(p["account_id"]);
  return out;
}
