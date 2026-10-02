import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * HubSpot CRM normalizers (https://developers.hubspot.com/docs/api-reference/overview).
 * Pure functions: no I/O, no credentials, no CRM business rules. Property
 * values are passed through untouched — interpretation stays in ZYRONEX.
 */

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null);

export function normalizeHubSpotObject(value: unknown): Record<string, unknown> {
  const o = asRecord(value);
  const associations = asRecord(o["associations"]);
  return {
    id: str(o["id"]),
    properties: asRecord(o["properties"]),
    created_at: str(o["createdAt"]),
    updated_at: str(o["updatedAt"]),
    archived: o["archived"] === true,
    archived_at: str(o["archivedAt"]),
    ...(Object.keys(associations).length ? { associations } : {}),
    ...(o["propertiesWithHistory"] ? { properties_with_history: o["propertiesWithHistory"] } : {}),
  };
}

export function normalizeHubSpotAssociation(value: unknown): Record<string, unknown> {
  const a = asRecord(value);
  const types = Array.isArray(a["associationTypes"]) ? (a["associationTypes"] as unknown[]).map(asRecord) : [];
  return {
    to_object_id: str(a["toObjectId"]) ?? str(asRecord(a["to"])["id"]),
    association_types: types.map((t) => ({ category: str(t["category"]), type_id: typeof t["typeId"] === "number" ? t["typeId"] : null, label: str(t["label"]) })),
  };
}

export function normalizeHubSpotAssociationBatch(value: unknown): Record<string, unknown> {
  const r = asRecord(value);
  const to = Array.isArray(r["to"]) ? (r["to"] as unknown[]).map(normalizeHubSpotAssociation) : [];
  return { from_object_id: str(asRecord(r["from"])["id"]), to };
}

export function normalizeHubSpotProperty(value: unknown): Record<string, unknown> {
  const p = asRecord(value);
  return {
    name: str(p["name"]),
    label: str(p["label"]),
    type: str(p["type"]),
    field_type: str(p["fieldType"]),
    group_name: str(p["groupName"]),
    options: Array.isArray(p["options"]) ? p["options"] : [],
    hubspot_defined: p["hubspotDefined"] === true,
    archived: p["archived"] === true,
  };
}

export function normalizeHubSpotSchema(value: unknown): Record<string, unknown> {
  const s = asRecord(value);
  return {
    id: str(s["id"]),
    object_type_id: str(s["objectTypeId"]),
    fully_qualified_name: str(s["fullyQualifiedName"]),
    name: str(s["name"]),
    labels: asRecord(s["labels"]),
    primary_display_property: str(s["primaryDisplayProperty"]),
    required_properties: Array.isArray(s["requiredProperties"]) ? s["requiredProperties"] : [],
    properties: Array.isArray(s["properties"]) ? (s["properties"] as unknown[]).map(normalizeHubSpotProperty) : [],
  };
}

export function normalizeHubSpotPipeline(value: unknown): Record<string, unknown> {
  const p = asRecord(value);
  return {
    id: str(p["id"]),
    label: str(p["label"]),
    display_order: p["displayOrder"] ?? null,
    archived: p["archived"] === true,
    stages: Array.isArray(p["stages"])
      ? (p["stages"] as unknown[]).map((s) => {
          const st = asRecord(s);
          return { id: str(st["id"]), label: str(st["label"]), display_order: st["displayOrder"] ?? null, metadata: asRecord(st["metadata"]) };
        })
      : [],
  };
}

export function normalizeHubSpotOwner(value: unknown): Record<string, unknown> {
  const o = asRecord(value);
  return { id: str(o["id"]), email: str(o["email"]), first_name: str(o["firstName"]), last_name: str(o["lastName"]), user_id: str(o["userId"]), archived: o["archived"] === true };
}

export function normalizeHubSpotAccount(value: unknown): Record<string, unknown> {
  const a = asRecord(value);
  return {
    portal_id: str(a["portalId"]),
    account_type: str(a["accountType"]),
    time_zone: str(a["timeZone"]),
    company_currency: str(a["companyCurrency"]),
    ui_domain: str(a["uiDomain"]),
    data_hosting_location: str(a["dataHostingLocation"]),
  };
}

/** One official Webhooks API event (HubSpot delivers a JSON array, up to 100 per request). */
export type HubSpotWebhookEvent = {
  eventId?: string;
  subscriptionId?: string;
  portalId?: string;
  appId?: string;
  occurredAt?: number;
  subscriptionType?: string;
  objectId?: string;
  attemptNumber?: number;
};

export function parseHubSpotEvents(payload: unknown): HubSpotWebhookEvent[] {
  if (!Array.isArray(payload)) return [];
  return payload.map((raw) => {
    const e = asRecord(raw);
    const out: HubSpotWebhookEvent = {};
    const s = (k: string) => str(e[k]) ?? undefined;
    if (s("eventId")) out.eventId = s("eventId")!;
    if (s("subscriptionId")) out.subscriptionId = s("subscriptionId")!;
    if (s("portalId")) out.portalId = s("portalId")!;
    if (s("appId")) out.appId = s("appId")!;
    if (s("subscriptionType")) out.subscriptionType = s("subscriptionType")!;
    if (s("objectId")) out.objectId = s("objectId")!;
    if (typeof e["occurredAt"] === "number") out.occurredAt = e["occurredAt"];
    if (typeof e["attemptNumber"] === "number") out.attemptNumber = e["attemptNumber"];
    return out;
  });
}

/** Dedupe key from official ids: portal + every (subscriptionId, eventId) pair in the batch. */
export function hubSpotBatchEventId(events: HubSpotWebhookEvent[]): string | undefined {
  if (!events.length || events.some((e) => !e.eventId || !e.portalId)) return undefined;
  const portals = new Set(events.map((e) => e.portalId));
  if (portals.size !== 1) return undefined;
  const pairs = events.map((e) => `${e.subscriptionId ?? "-"}:${e.eventId}`).sort();
  return `hubspot:${events[0]!.portalId}:${pairs.join(",")}`;
}

export function hubSpotBatchEventType(events: HubSpotWebhookEvent[]): string | undefined {
  const types = new Set(events.map((e) => e.subscriptionType).filter(Boolean));
  if (types.size === 0) return undefined;
  return types.size === 1 ? [...types][0] : "batch";
}
