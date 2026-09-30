import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * Microsoft Graph — pure normalizers (no I/O, no business logic).
 * Field names follow the official Graph v1.0 resource types.
 */

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function address(value: unknown): { name: string | null; address: string | null } | null {
  const email = asRecord(asRecord(value)["emailAddress"]);
  if (!Object.keys(email).length) return null;
  return { name: str(email["name"]), address: str(email["address"]) };
}
const addresses = (v: unknown) => (Array.isArray(v) ? v.map(address).filter(Boolean) : []);

/** Graph `{ dateTime, timeZone }` pair, kept exactly as returned (no conversion). */
function dateTimeZone(value: unknown) {
  const r = asRecord(value);
  return Object.keys(r).length ? { date_time: str(r["dateTime"]), time_zone: str(r["timeZone"]) } : null;
}

export function normalizeGraphUser(value: unknown): Record<string, unknown> {
  const u = asRecord(value);
  return {
    id: u["id"] ?? null,
    display_name: u["displayName"] ?? null,
    mail: u["mail"] ?? null,
    user_principal_name: u["userPrincipalName"] ?? null,
    given_name: u["givenName"] ?? null,
    surname: u["surname"] ?? null,
    job_title: u["jobTitle"] ?? null,
    preferred_language: u["preferredLanguage"] ?? null,
  };
}

export function normalizeGraphOrganization(value: unknown): Record<string, unknown> {
  const o = asRecord(value);
  const domains = Array.isArray(o["verifiedDomains"]) ? (o["verifiedDomains"] as unknown[]).map((d) => asRecord(d)["name"]) : [];
  return { id: o["id"] ?? null, tenant_id: o["id"] ?? null, display_name: o["displayName"] ?? null, verified_domains: domains };
}

export function normalizeGraphMessage(value: unknown): Record<string, unknown> {
  const m = asRecord(value);
  const body = asRecord(m["body"]);
  const flag = asRecord(m["flag"]);
  return {
    id: m["id"] ?? null,
    conversation_id: m["conversationId"] ?? null,
    internet_message_id: m["internetMessageId"] ?? null,
    parent_folder_id: m["parentFolderId"] ?? null,
    subject: m["subject"] ?? null,
    body_preview: m["bodyPreview"] ?? null,
    body_content_type: body["contentType"] ?? null,
    body: body["content"] ?? null,
    from: address(m["from"]),
    sender: address(m["sender"]),
    to: addresses(m["toRecipients"]),
    cc: addresses(m["ccRecipients"]),
    bcc: addresses(m["bccRecipients"]),
    reply_to: addresses(m["replyTo"]),
    is_read: m["isRead"] ?? null,
    is_draft: m["isDraft"] ?? null,
    importance: m["importance"] ?? null,
    has_attachments: m["hasAttachments"] ?? null,
    categories: Array.isArray(m["categories"]) ? m["categories"] : [],
    flag_status: flag["flagStatus"] ?? null,
    received_at: m["receivedDateTime"] ?? null,
    sent_at: m["sentDateTime"] ?? null,
    web_link: m["webLink"] ?? null,
    ...(m["@removed"] ? { removed: true } : {}),
  };
}

export function normalizeGraphFolder(value: unknown): Record<string, unknown> {
  const f = asRecord(value);
  return {
    id: f["id"] ?? null,
    display_name: f["displayName"] ?? null,
    parent_folder_id: f["parentFolderId"] ?? null,
    child_folder_count: f["childFolderCount"] ?? null,
    unread_item_count: f["unreadItemCount"] ?? null,
    total_item_count: f["totalItemCount"] ?? null,
    is_hidden: f["isHidden"] ?? null,
  };
}

export function normalizeGraphAttachment(value: unknown): Record<string, unknown> {
  const a = asRecord(value);
  return {
    id: a["id"] ?? null,
    type: a["@odata.type"] ?? null,
    name: a["name"] ?? null,
    content_type: a["contentType"] ?? null,
    size: a["size"] ?? null,
    is_inline: a["isInline"] ?? null,
    last_modified_at: a["lastModifiedDateTime"] ?? null,
    // Present only for small fileAttachment reads; base64 in JSON, never streamed.
    ...(typeof a["contentBytes"] === "string" ? { content_bytes: a["contentBytes"] } : {}),
  };
}

export function normalizeGraphCalendar(value: unknown): Record<string, unknown> {
  const c = asRecord(value);
  return {
    id: c["id"] ?? null,
    name: c["name"] ?? null,
    color: c["color"] ?? null,
    is_default: c["isDefaultCalendar"] ?? null,
    can_edit: c["canEdit"] ?? null,
    owner: asRecord(c["owner"])["address"] ?? null,
    allowed_online_meeting_providers: Array.isArray(c["allowedOnlineMeetingProviders"]) ? c["allowedOnlineMeetingProviders"] : [],
  };
}

export function normalizeGraphEvent(value: unknown): Record<string, unknown> {
  const e = asRecord(value);
  const body = asRecord(e["body"]);
  const location = asRecord(e["location"]);
  const online = asRecord(e["onlineMeeting"]);
  const attendees = Array.isArray(e["attendees"])
    ? (e["attendees"] as unknown[]).map((a) => {
        const r = asRecord(a);
        return { ...address(r), type: r["type"] ?? null, response: asRecord(r["status"])["response"] ?? null };
      })
    : [];
  return {
    id: e["id"] ?? null,
    ical_uid: e["iCalUId"] ?? null,
    series_master_id: e["seriesMasterId"] ?? null,
    type: e["type"] ?? null,
    subject: e["subject"] ?? null,
    body_preview: e["bodyPreview"] ?? null,
    body_content_type: body["contentType"] ?? null,
    body: body["content"] ?? null,
    start: dateTimeZone(e["start"]),
    end: dateTimeZone(e["end"]),
    original_start_time_zone: e["originalStartTimeZone"] ?? null,
    is_all_day: e["isAllDay"] ?? null,
    is_cancelled: e["isCancelled"] ?? null,
    location: location["displayName"] ?? null,
    organizer: address(e["organizer"]),
    attendees,
    recurrence: e["recurrence"] ?? null,
    is_reminder_on: e["isReminderOn"] ?? null,
    reminder_minutes_before_start: e["reminderMinutesBeforeStart"] ?? null,
    show_as: e["showAs"] ?? null,
    sensitivity: e["sensitivity"] ?? null,
    is_online_meeting: e["isOnlineMeeting"] ?? null,
    online_meeting_provider: e["onlineMeetingProvider"] ?? null,
    online_meeting_url: online["joinUrl"] ?? null,
    transaction_id: e["transactionId"] ?? null,
    web_link: e["webLink"] ?? null,
    ...(e["@removed"] ? { removed: true } : {}),
  };
}

export function normalizeGraphContact(value: unknown): Record<string, unknown> {
  const c = asRecord(value);
  return {
    id: c["id"] ?? null,
    display_name: c["displayName"] ?? null,
    given_name: c["givenName"] ?? null,
    surname: c["surname"] ?? null,
    company_name: c["companyName"] ?? null,
    job_title: c["jobTitle"] ?? null,
    emails: Array.isArray(c["emailAddresses"]) ? (c["emailAddresses"] as unknown[]).map((e) => asRecord(e)["address"] ?? null) : [],
    mobile_phone: c["mobilePhone"] ?? null,
    business_phones: Array.isArray(c["businessPhones"]) ? c["businessPhones"] : [],
    parent_folder_id: c["parentFolderId"] ?? null,
  };
}

export function normalizeGraphSubscription(value: unknown): Record<string, unknown> {
  const s = asRecord(value);
  return {
    id: s["id"] ?? null,
    resource: s["resource"] ?? null,
    change_type: s["changeType"] ?? null,
    notification_url: s["notificationUrl"] ?? null,
    lifecycle_notification_url: s["lifecycleNotificationUrl"] ?? null,
    expires_at: s["expirationDateTime"] ?? null,
    application_id: s["applicationId"] ?? null,
    // clientState is the shared secret for notification validation — never echoed back.
  };
}

// ---- Change notifications ---------------------------------------------------

export type GraphNotification = {
  subscriptionId: string | null;
  subscriptionExpiration: string | null;
  changeType: string | null;
  lifecycleEvent: string | null;
  resource: string | null;
  resourceId: string | null;
  etag: string | null;
  tenantId: string | null;
  clientState: string | null;
};

/** Parses the official `{ value: [changeNotification] }` collection. */
export function parseGraphNotifications(payload: unknown): GraphNotification[] {
  const list = asRecord(payload)["value"];
  if (!Array.isArray(list)) return [];
  return list.map((n) => {
    const r = asRecord(n);
    const data = asRecord(r["resourceData"]);
    return {
      subscriptionId: str(r["subscriptionId"]),
      subscriptionExpiration: str(r["subscriptionExpirationDateTime"]),
      changeType: str(r["changeType"]),
      lifecycleEvent: str(r["lifecycleEvent"]),
      resource: str(r["resource"]),
      resourceId: str(data["id"]),
      etag: str(data["@odata.etag"]),
      tenantId: str(r["tenantId"]),
      clientState: str(r["clientState"]),
    };
  });
}

/**
 * Graph notifications carry no dedicated event id. The identity is composed only
 * from official fields: subscription, change/lifecycle type, resource id and etag
 * (the etag changes on every resource version, so redeliveries collapse).
 */
export function graphNotificationEventId(list: GraphNotification[]): string | undefined {
  if (!list.length || list.some((n) => !n.subscriptionId)) return undefined;
  return list
    .map((n) => `${n.subscriptionId}:${n.lifecycleEvent ?? n.changeType ?? "?"}:${n.resourceId ?? n.resource ?? "?"}:${n.etag ?? ""}`)
    .join("|");
}

export function graphNotificationEventType(list: GraphNotification[]): string | undefined {
  const first = list[0];
  if (!first) return undefined;
  if (first.lifecycleEvent) return `graph.lifecycle.${first.lifecycleEvent}`;
  return first.changeType ? `graph.${first.changeType}` : undefined;
}
