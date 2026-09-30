import {
  normalizeGraphAttachment,
  normalizeGraphCalendar,
  normalizeGraphContact,
  normalizeGraphEvent,
  normalizeGraphFolder,
  normalizeGraphMessage,
  normalizeGraphOrganization,
  normalizeGraphSubscription,
  normalizeGraphUser,
} from "@/lib/connectors/adapters/microsoft-graph-map";
import { asRecord, assertRequiredParams } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Microsoft Graph connector (Outlook mail, calendar, contacts) — official
 * Microsoft Graph v1.0 only (https://learn.microsoft.com/graph/api/overview).
 *
 * One connector for Outlook + Microsoft 365 mail/calendar. Owns auth header
 * injection, API calls, normalization, `@odata.nextLink` / `@odata.deltaLink`
 * pagination and error mapping. No AI, business logic, CRM or storage.
 */

export const GRAPH_API_BASE = "https://graph.microsoft.com/v1.0";
const DEFAULT_TOP = 50;
const MAX_TOP = 1000;
/** Documented max subscription lifetime for Outlook messages/events/contacts (minutes). */
export const GRAPH_MAX_SUBSCRIPTION_MINUTES = 10080;
/** Documented inline attachment limit for the JSON `fileAttachment` POST. */
export const GRAPH_MAX_INLINE_ATTACHMENT_BYTES = 3 * 1024 * 1024;

/** Least-privilege delegated scope per capability (documented Graph permissions). */
export const GRAPH_SCOPES = {
  identity: "User.Read",
  mailRead: "Mail.Read",
  mailWrite: "Mail.ReadWrite",
  mailSend: "Mail.Send",
  calendarRead: "Calendars.Read",
  calendarWrite: "Calendars.ReadWrite",
  contactsRead: "Contacts.Read",
  contactsWrite: "Contacts.ReadWrite",
} as const;
type ScopeKey = keyof typeof GRAPH_SCOPES;

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  large_attachment_upload_session:
    "Attachments over 3 MB need createUploadSession + binary PUT byte ranges; the runtime sends JSON only.",
  attachment_raw_download:
    "GET /attachments/{id}/$value streams raw bytes; the runtime is JSON-only. Small fileAttachments return contentBytes (base64) via get_attachment.",
  message_mime_content:
    "GET /messages/{id}/$value returns MIME text, and MIME send needs a text/plain base64 body; the runtime is JSON-only.",
  restore_message:
    "Graph has no undelete for messages. delete moves an item to Deleted Items; bring it back with move_message (folder `deleteditems` → target).",
  idempotency_key:
    "Graph publishes no idempotency header, and sendMail/reply/forward have no request id. Only events accept the official `transactionId`, mapped from idempotency_key on create_event.",
  standalone_online_meetings:
    "/me/onlineMeetings needs OnlineMeetings.ReadWrite and belongs to a Teams connector. Teams meetings are created through events (isOnlineMeeting).",
  onedrive_sharepoint_files: "OneDrive/SharePoint file management is out of scope for this connector.",
  other_users_mailboxes:
    "/users/{id} mailboxes need shared/delegated access or application permissions with admin consent; this connector works on the signed-in user's own mailbox (/me).",
  admin_consent_application_permissions:
    "Application permissions (e.g. Mail.Read for all users) need tenant admin consent and a client-credentials flow; not requested.",
  validation_token_echo:
    "Subscription validation requires echoing `validationToken` as text/plain within 10s; the shared ingress cannot return a provider-specific body.",
  rich_notifications_decryption:
    "Rich notifications (includeResourceData) need a certificate and encrypted-content decryption; notifications stay basic and the resource is re-read.",
  search_across_mailboxes: "$search on messages only covers the signed-in user's own mailbox.",
};

type Kind =
  | "user" | "organization" | "message" | "folder" | "attachment" | "calendar" | "event" | "contact" | "subscription" | "raw" | "empty";

type Spec = {
  verb: HttpMethod;
  path: (p: Record<string, unknown>) => string;
  kind: Kind;
  required?: string[];
  /** Graph collection response (`value` + `@odata.nextLink`). */
  list?: boolean;
  /** Delta query: final page carries `@odata.deltaLink`. */
  delta?: boolean;
  /** snake_case input → Graph query param name. */
  query?: Record<string, string>;
  body?: (p: Record<string, unknown>) => unknown;
  scope: ScopeKey;
};

const enc = (v: unknown) => encodeURIComponent(String(v));
const bad = (message: string) => new ConnectorError("invalid_request", message, { retryable: false });

function recipients(value: unknown) {
  if (value === undefined || value === null) return undefined;
  const list = Array.isArray(value) ? value : String(value).split(",");
  return list
    .map((v) => (typeof v === "string" ? { emailAddress: { address: v.trim() } } : v))
    .filter((v) => (typeof v === "object" ? true : false));
}

/** Builds an official Graph `message` resource from snake_case input. */
function messageResource(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p["subject"] !== undefined) out["subject"] = p["subject"];
  if (p["html"] !== undefined) out["body"] = { contentType: "HTML", content: String(p["html"]) };
  else if (p["text"] !== undefined) out["body"] = { contentType: "Text", content: String(p["text"]) };
  for (const [from, to] of [["to", "toRecipients"], ["cc", "ccRecipients"], ["bcc", "bccRecipients"], ["reply_to", "replyTo"]] as const) {
    const r = recipients(p[from]);
    if (r) out[to] = r;
  }
  if (p["importance"] !== undefined) out["importance"] = p["importance"];
  if (p["categories"] !== undefined) out["categories"] = p["categories"];
  if (p["is_read"] !== undefined) out["isRead"] = Boolean(p["is_read"]);
  if (p["flag_status"] !== undefined) out["flag"] = { flagStatus: p["flag_status"] };
  if (Array.isArray(p["attachments"])) out["attachments"] = (p["attachments"] as unknown[]).map(fileAttachment);
  return out;
}

function fileAttachment(value: unknown): Record<string, unknown> {
  const a = asRecord(value);
  const name = a["name"] ?? a["filename"];
  const bytes = a["content_bytes"] ?? a["content_base64"];
  if (typeof name !== "string" || typeof bytes !== "string") throw bad("Each attachment needs `name` and base64 `content_bytes`");
  if (Math.floor((bytes.length * 3) / 4) > GRAPH_MAX_INLINE_ATTACHMENT_BYTES)
    throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS["large_attachment_upload_session"]}`, { retryable: false });
  return {
    "@odata.type": "#microsoft.graph.fileAttachment",
    name,
    contentBytes: bytes,
    ...(a["content_type"] ?? a["mime_type"] ? { contentType: a["content_type"] ?? a["mime_type"] } : {}),
    ...(a["is_inline"] !== undefined ? { isInline: Boolean(a["is_inline"]) } : {}),
  };
}

function sendMailBody(p: Record<string, unknown>) {
  return { message: messageResource(p), saveToSentItems: p["save_to_sent_items"] === undefined ? true : Boolean(p["save_to_sent_items"]) };
}

/** reply / replyAll / forward: official `comment` and optional `message` override. */
function respondBody(p: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  if (p["comment"] !== undefined) out["comment"] = String(p["comment"]);
  const msg = messageResource(p);
  if (Object.keys(msg).length) out["message"] = msg;
  return out;
}
function forwardBody(p: Record<string, unknown>) {
  const to = recipients(p["to"]);
  if (!to?.length) throw bad("`to` is required for forward_message");
  const { to: _to, ...rest } = p;
  return { ...respondBody(rest), toRecipients: to };
}

function updateMessageBody(p: Record<string, unknown>) {
  const out = messageResource(p);
  if (!Object.keys(out).length) throw bad("Provide at least one message field to update");
  return out;
}

function folderBody(p: Record<string, unknown>) {
  const name = p["display_name"] ?? p["name"];
  if (typeof name !== "string" || !name.trim()) throw bad("`display_name` is required");
  return { displayName: name, ...(p["is_hidden"] !== undefined ? { isHidden: Boolean(p["is_hidden"]) } : {}) };
}

function dateTz(value: unknown, tz: unknown) {
  const r = asRecord(value);
  if (typeof value === "string") return { dateTime: value, timeZone: typeof tz === "string" ? tz : "UTC" };
  if (r["dateTime"] ?? r["date_time"]) return { dateTime: r["dateTime"] ?? r["date_time"], timeZone: r["timeZone"] ?? r["time_zone"] ?? tz ?? "UTC" };
  return undefined;
}

function attendeeList(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value.map((a) => {
    if (typeof a === "string") return { emailAddress: { address: a }, type: "required" };
    const r = asRecord(a);
    return {
      emailAddress: { address: r["address"] ?? r["email"], ...(r["name"] ? { name: r["name"] } : {}) },
      type: r["type"] ?? "required",
    };
  });
}

/** Official Graph `event` resource. Recurrence is passed as the documented patternedRecurrence. */
function eventResource(p: Record<string, unknown>, create: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (p["subject"] !== undefined) out["subject"] = p["subject"];
  if (p["html"] !== undefined) out["body"] = { contentType: "HTML", content: String(p["html"]) };
  else if (p["text"] !== undefined) out["body"] = { contentType: "Text", content: String(p["text"]) };
  const start = dateTz(p["start"], p["time_zone"]);
  const end = dateTz(p["end"], p["time_zone"]);
  if (start) out["start"] = start;
  if (end) out["end"] = end;
  if (create && (!start || !end)) throw bad("`start` and `end` are required for create_event");
  if (p["location"] !== undefined) out["location"] = { displayName: String(p["location"]) };
  const attendees = attendeeList(p["attendees"]);
  if (attendees) out["attendees"] = attendees;
  if (p["recurrence"] !== undefined) {
    const r = asRecord(p["recurrence"]);
    if (p["recurrence"] !== null && (!r["pattern"] || !r["range"])) throw bad("`recurrence` needs the official `pattern` and `range` objects");
    out["recurrence"] = p["recurrence"];
  }
  if (p["is_all_day"] !== undefined) out["isAllDay"] = Boolean(p["is_all_day"]);
  if (p["is_reminder_on"] !== undefined) out["isReminderOn"] = Boolean(p["is_reminder_on"]);
  if (p["reminder_minutes_before_start"] !== undefined) {
    const m = Number(p["reminder_minutes_before_start"]);
    if (!Number.isInteger(m) || m < 0) throw bad("`reminder_minutes_before_start` must be a non-negative integer");
    out["reminderMinutesBeforeStart"] = m;
  }
  if (p["show_as"] !== undefined) out["showAs"] = p["show_as"];
  if (p["sensitivity"] !== undefined) out["sensitivity"] = p["sensitivity"];
  if (p["categories"] !== undefined) out["categories"] = p["categories"];
  if (p["is_online_meeting"] !== undefined) {
    out["isOnlineMeeting"] = Boolean(p["is_online_meeting"]);
    if (p["is_online_meeting"]) out["onlineMeetingProvider"] = p["online_meeting_provider"] ?? "teamsForBusiness";
  }
  if (p["allow_new_time_proposals"] !== undefined) out["allowNewTimeProposals"] = Boolean(p["allow_new_time_proposals"]);
  // Official Graph dedupe field for event creation retries.
  if (create && typeof p["idempotency_key"] === "string" && p["idempotency_key"]) out["transactionId"] = p["idempotency_key"];
  if (!create && !Object.keys(out).length) throw bad("Provide at least one event field to update");
  return out;
}

function eventResponseBody(p: Record<string, unknown>) {
  return {
    ...(p["comment"] !== undefined ? { comment: String(p["comment"]) } : {}),
    sendResponse: p["send_response"] === undefined ? true : Boolean(p["send_response"]),
  };
}

function calendarBody(p: Record<string, unknown>, create: boolean) {
  const out: Record<string, unknown> = {};
  if (p["name"] !== undefined) out["name"] = p["name"];
  if (p["color"] !== undefined) out["color"] = p["color"];
  if (create && typeof out["name"] !== "string") throw bad("`name` is required for create_calendar");
  if (!Object.keys(out).length) throw bad("Provide `name` or `color`");
  return out;
}

function contactBody(p: Record<string, unknown>, create: boolean) {
  const out: Record<string, unknown> = {};
  const map: Record<string, string> = {
    given_name: "givenName", surname: "surname", display_name: "displayName", company_name: "companyName",
    job_title: "jobTitle", mobile_phone: "mobilePhone", business_phones: "businessPhones",
  };
  for (const [from, to] of Object.entries(map)) if (p[from] !== undefined) out[to] = p[from];
  if (Array.isArray(p["emails"]))
    out["emailAddresses"] = (p["emails"] as unknown[]).map((e) => (typeof e === "string" ? { address: e } : e));
  if (!Object.keys(out).length) throw bad(create ? "A contact needs at least one field" : "Provide at least one contact field to update");
  return out;
}

function subscriptionExpiry(p: Record<string, unknown>) {
  const raw = p["expiration_date_time"];
  const at = typeof raw === "string" ? Date.parse(raw) : NaN;
  if (!Number.isFinite(at)) throw bad("`expiration_date_time` must be an ISO date");
  const now = typeof p["now_ms"] === "number" ? (p["now_ms"] as number) : Date.now();
  if (at <= now) throw bad("`expiration_date_time` must be in the future");
  if (at - now > GRAPH_MAX_SUBSCRIPTION_MINUTES * 60_000)
    throw bad(`Outlook subscriptions last at most ${GRAPH_MAX_SUBSCRIPTION_MINUTES} minutes (Graph limit)`);
  return new Date(at).toISOString();
}

function subscriptionBody(p: Record<string, unknown>) {
  const url = String(p["notification_url"] ?? "");
  if (!url.startsWith("https://")) throw bad("`notification_url` must be an https URL");
  if (typeof p["client_state"] !== "string" || !p["client_state"] || String(p["client_state"]).length > 128)
    throw bad("`client_state` (the endpoint secret, max 128 chars) is required");
  if (p["include_resource_data"])
    throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS["rich_notifications_decryption"]}`, { retryable: false });
  return {
    changeType: p["change_type"],
    notificationUrl: url,
    ...(p["lifecycle_notification_url"] ? { lifecycleNotificationUrl: p["lifecycle_notification_url"] } : {}),
    resource: p["resource"],
    expirationDateTime: subscriptionExpiry(p),
    clientState: p["client_state"],
  };
}

const LIST_QUERY = { filter: "$filter", select: "$select", orderby: "$orderby" };
const MSG_LIST_QUERY = { ...LIST_QUERY, search: "$search" };
const folderPath = (p: Record<string, unknown>) => `/me/mailFolders/${enc(p["folder_id"])}`;
const calendarBase = (p: Record<string, unknown>) => (p["calendar_id"] ? `/me/calendars/${enc(p["calendar_id"])}` : "/me");

const OPERATIONS: Record<string, Spec> = {
  // ---- Identity / health -----------------------------------------------------
  get_me: { verb: "GET", path: () => "/me", kind: "user", query: { select: "$select" }, scope: "identity" },
  get_organization: { verb: "GET", path: () => "/organization", kind: "organization", list: true, scope: "identity" },

  // ---- Messages --------------------------------------------------------------
  list_messages: { verb: "GET", path: () => "/me/messages", kind: "message", list: true, query: MSG_LIST_QUERY, scope: "mailRead" },
  search_messages: { verb: "GET", path: () => "/me/messages", kind: "message", list: true, required: ["search"], query: MSG_LIST_QUERY, scope: "mailRead" },
  list_conversation_messages: {
    verb: "GET", path: () => "/me/messages", kind: "message", list: true, required: ["conversation_id"],
    query: { select: "$select" }, scope: "mailRead",
  },
  get_message: { verb: "GET", path: (p) => `/me/messages/${enc(p["message_id"])}`, kind: "message", required: ["message_id"], query: { select: "$select" }, scope: "mailRead" },
  send_mail: { verb: "POST", path: () => "/me/sendMail", kind: "empty", required: ["to"], body: sendMailBody, scope: "mailSend" },
  reply_message: { verb: "POST", path: (p) => `/me/messages/${enc(p["message_id"])}/reply`, kind: "empty", required: ["message_id"], body: respondBody, scope: "mailSend" },
  reply_all_message: { verb: "POST", path: (p) => `/me/messages/${enc(p["message_id"])}/replyAll`, kind: "empty", required: ["message_id"], body: respondBody, scope: "mailSend" },
  forward_message: { verb: "POST", path: (p) => `/me/messages/${enc(p["message_id"])}/forward`, kind: "empty", required: ["message_id", "to"], body: forwardBody, scope: "mailSend" },
  update_message: { verb: "PATCH", path: (p) => `/me/messages/${enc(p["message_id"])}`, kind: "message", required: ["message_id"], body: updateMessageBody, scope: "mailWrite" },
  mark_read: { verb: "PATCH", path: (p) => `/me/messages/${enc(p["message_id"])}`, kind: "message", required: ["message_id"], body: () => ({ isRead: true }), scope: "mailWrite" },
  mark_unread: { verb: "PATCH", path: (p) => `/me/messages/${enc(p["message_id"])}`, kind: "message", required: ["message_id"], body: () => ({ isRead: false }), scope: "mailWrite" },
  move_message: {
    verb: "POST", path: (p) => `/me/messages/${enc(p["message_id"])}/move`, kind: "message", required: ["message_id", "destination_id"],
    body: (p) => ({ destinationId: p["destination_id"] }), scope: "mailWrite",
  },
  copy_message: {
    verb: "POST", path: (p) => `/me/messages/${enc(p["message_id"])}/copy`, kind: "message", required: ["message_id", "destination_id"],
    body: (p) => ({ destinationId: p["destination_id"] }), scope: "mailWrite",
  },
  delete_message: { verb: "DELETE", path: (p) => `/me/messages/${enc(p["message_id"])}`, kind: "empty", required: ["message_id"], scope: "mailWrite" },
  permanent_delete_message: {
    verb: "POST", path: (p) => `/me/messages/${enc(p["message_id"])}/permanentDelete`, kind: "empty", required: ["message_id"], scope: "mailWrite",
  },
  list_attachments: {
    verb: "GET", path: (p) => `/me/messages/${enc(p["message_id"])}/attachments`, kind: "attachment", list: true, required: ["message_id"],
    // Metadata only by default; contentBytes is fetched per attachment.
    query: { select: "$select" }, scope: "mailRead",
  },
  get_attachment: {
    verb: "GET", path: (p) => `/me/messages/${enc(p["message_id"])}/attachments/${enc(p["attachment_id"])}`, kind: "attachment",
    required: ["message_id", "attachment_id"], query: { select: "$select" }, scope: "mailRead",
  },
  add_attachment: {
    verb: "POST", path: (p) => `/me/messages/${enc(p["message_id"])}/attachments`, kind: "attachment", required: ["message_id", "name", "content_bytes"],
    body: (p) => fileAttachment(p), scope: "mailWrite",
  },
  delete_attachment: {
    verb: "DELETE", path: (p) => `/me/messages/${enc(p["message_id"])}/attachments/${enc(p["attachment_id"])}`, kind: "empty",
    required: ["message_id", "attachment_id"], scope: "mailWrite",
  },
  messages_delta: {
    verb: "GET", path: (p) => `${folderPath(p)}/messages/delta`, kind: "message", list: true, delta: true, required: ["folder_id"],
    query: { select: "$select", filter: "$filter" }, scope: "mailRead",
  },

  // ---- Mail folders ----------------------------------------------------------
  list_mail_folders: {
    verb: "GET", path: (p) => (p["parent_folder_id"] ? `/me/mailFolders/${enc(p["parent_folder_id"])}/childFolders` : "/me/mailFolders"),
    kind: "folder", list: true, query: { ...LIST_QUERY, include_hidden: "includeHiddenFolders" }, scope: "mailRead",
  },
  get_mail_folder: { verb: "GET", path: folderPath, kind: "folder", required: ["folder_id"], scope: "mailRead" },
  create_mail_folder: {
    verb: "POST", path: (p) => (p["parent_folder_id"] ? `/me/mailFolders/${enc(p["parent_folder_id"])}/childFolders` : "/me/mailFolders"),
    kind: "folder", required: ["display_name"], body: folderBody, scope: "mailWrite",
  },
  update_mail_folder: { verb: "PATCH", path: folderPath, kind: "folder", required: ["folder_id", "display_name"], body: (p) => ({ displayName: p["display_name"] }), scope: "mailWrite" },
  delete_mail_folder: { verb: "DELETE", path: folderPath, kind: "empty", required: ["folder_id"], scope: "mailWrite" },
  list_folder_messages: {
    verb: "GET", path: (p) => `${folderPath(p)}/messages`, kind: "message", list: true, required: ["folder_id"], query: MSG_LIST_QUERY, scope: "mailRead",
  },

  // ---- Drafts ----------------------------------------------------------------
  list_drafts: { verb: "GET", path: () => "/me/mailFolders/drafts/messages", kind: "message", list: true, query: LIST_QUERY, scope: "mailRead" },
  get_draft: { verb: "GET", path: (p) => `/me/messages/${enc(p["draft_id"])}`, kind: "message", required: ["draft_id"], scope: "mailRead" },
  create_draft: { verb: "POST", path: () => "/me/messages", kind: "message", body: messageResource, scope: "mailWrite" },
  create_reply_draft: { verb: "POST", path: (p) => `/me/messages/${enc(p["message_id"])}/createReply`, kind: "message", required: ["message_id"], body: respondBody, scope: "mailWrite" },
  create_reply_all_draft: { verb: "POST", path: (p) => `/me/messages/${enc(p["message_id"])}/createReplyAll`, kind: "message", required: ["message_id"], body: respondBody, scope: "mailWrite" },
  create_forward_draft: { verb: "POST", path: (p) => `/me/messages/${enc(p["message_id"])}/createForward`, kind: "message", required: ["message_id"], body: respondBody, scope: "mailWrite" },
  update_draft: { verb: "PATCH", path: (p) => `/me/messages/${enc(p["draft_id"])}`, kind: "message", required: ["draft_id"], body: updateMessageBody, scope: "mailWrite" },
  send_draft: { verb: "POST", path: (p) => `/me/messages/${enc(p["draft_id"])}/send`, kind: "empty", required: ["draft_id"], scope: "mailSend" },
  delete_draft: { verb: "DELETE", path: (p) => `/me/messages/${enc(p["draft_id"])}`, kind: "empty", required: ["draft_id"], scope: "mailWrite" },

  // ---- Calendars -------------------------------------------------------------
  list_calendars: { verb: "GET", path: () => "/me/calendars", kind: "calendar", list: true, query: LIST_QUERY, scope: "calendarRead" },
  get_calendar: { verb: "GET", path: (p) => `/me/calendars/${enc(p["calendar_id"])}`, kind: "calendar", required: ["calendar_id"], scope: "calendarRead" },
  create_calendar: { verb: "POST", path: () => "/me/calendars", kind: "calendar", required: ["name"], body: (p) => calendarBody(p, true), scope: "calendarWrite" },
  update_calendar: { verb: "PATCH", path: (p) => `/me/calendars/${enc(p["calendar_id"])}`, kind: "calendar", required: ["calendar_id"], body: (p) => calendarBody(p, false), scope: "calendarWrite" },
  delete_calendar: { verb: "DELETE", path: (p) => `/me/calendars/${enc(p["calendar_id"])}`, kind: "empty", required: ["calendar_id"], scope: "calendarWrite" },

  // ---- Events ----------------------------------------------------------------
  list_events: { verb: "GET", path: (p) => `${calendarBase(p)}/events`, kind: "event", list: true, query: LIST_QUERY, scope: "calendarRead" },
  calendar_view: {
    verb: "GET", path: (p) => `${calendarBase(p)}/calendarView`, kind: "event", list: true, required: ["start_date_time", "end_date_time"],
    query: { start_date_time: "startDateTime", end_date_time: "endDateTime", ...LIST_QUERY }, scope: "calendarRead",
  },
  events_delta: {
    verb: "GET", path: () => "/me/calendarView/delta", kind: "event", list: true, delta: true, required: ["start_date_time", "end_date_time"],
    query: { start_date_time: "startDateTime", end_date_time: "endDateTime" }, scope: "calendarRead",
  },
  get_event: { verb: "GET", path: (p) => `/me/events/${enc(p["event_id"])}`, kind: "event", required: ["event_id"], query: { select: "$select" }, scope: "calendarRead" },
  list_event_instances: {
    verb: "GET", path: (p) => `/me/events/${enc(p["event_id"])}/instances`, kind: "event", list: true, required: ["event_id", "start_date_time", "end_date_time"],
    query: { start_date_time: "startDateTime", end_date_time: "endDateTime" }, scope: "calendarRead",
  },
  create_event: { verb: "POST", path: (p) => `${calendarBase(p)}/events`, kind: "event", required: ["subject"], body: (p) => eventResource(p, true), scope: "calendarWrite" },
  update_event: { verb: "PATCH", path: (p) => `/me/events/${enc(p["event_id"])}`, kind: "event", required: ["event_id"], body: (p) => eventResource(p, false), scope: "calendarWrite" },
  delete_event: { verb: "DELETE", path: (p) => `/me/events/${enc(p["event_id"])}`, kind: "empty", required: ["event_id"], scope: "calendarWrite" },
  accept_event: { verb: "POST", path: (p) => `/me/events/${enc(p["event_id"])}/accept`, kind: "empty", required: ["event_id"], body: eventResponseBody, scope: "calendarWrite" },
  decline_event: { verb: "POST", path: (p) => `/me/events/${enc(p["event_id"])}/decline`, kind: "empty", required: ["event_id"], body: eventResponseBody, scope: "calendarWrite" },
  tentatively_accept_event: {
    verb: "POST", path: (p) => `/me/events/${enc(p["event_id"])}/tentativelyAccept`, kind: "empty", required: ["event_id"], body: eventResponseBody, scope: "calendarWrite",
  },
  cancel_event: {
    verb: "POST", path: (p) => `/me/events/${enc(p["event_id"])}/cancel`, kind: "empty", required: ["event_id"],
    body: (p) => (p["comment"] !== undefined ? { comment: String(p["comment"]) } : {}), scope: "calendarWrite",
  },
  dismiss_reminder: { verb: "POST", path: (p) => `/me/events/${enc(p["event_id"])}/dismissReminder`, kind: "empty", required: ["event_id"], scope: "calendarWrite" },
  snooze_reminder: {
    verb: "POST", path: (p) => `/me/events/${enc(p["event_id"])}/snoozeReminder`, kind: "empty", required: ["event_id", "new_reminder_time"],
    body: (p) => ({ newReminderTime: dateTz(p["new_reminder_time"], p["time_zone"]) }), scope: "calendarWrite",
  },

  // ---- Contacts --------------------------------------------------------------
  list_contacts: { verb: "GET", path: () => "/me/contacts", kind: "contact", list: true, query: LIST_QUERY, scope: "contactsRead" },
  get_contact: { verb: "GET", path: (p) => `/me/contacts/${enc(p["contact_id"])}`, kind: "contact", required: ["contact_id"], scope: "contactsRead" },
  create_contact: { verb: "POST", path: () => "/me/contacts", kind: "contact", body: (p) => contactBody(p, true), scope: "contactsWrite" },
  update_contact: { verb: "PATCH", path: (p) => `/me/contacts/${enc(p["contact_id"])}`, kind: "contact", required: ["contact_id"], body: (p) => contactBody(p, false), scope: "contactsWrite" },
  delete_contact: { verb: "DELETE", path: (p) => `/me/contacts/${enc(p["contact_id"])}`, kind: "empty", required: ["contact_id"], scope: "contactsWrite" },

  // ---- Change notification subscriptions -------------------------------------
  list_subscriptions: { verb: "GET", path: () => "/subscriptions", kind: "subscription", list: true, scope: "identity" },
  get_subscription: { verb: "GET", path: (p) => `/subscriptions/${enc(p["subscription_id"])}`, kind: "subscription", required: ["subscription_id"], scope: "identity" },
  create_subscription: {
    verb: "POST", path: () => "/subscriptions", kind: "subscription",
    required: ["change_type", "notification_url", "resource", "expiration_date_time", "client_state"], body: subscriptionBody, scope: "mailRead",
  },
  renew_subscription: {
    verb: "PATCH", path: (p) => `/subscriptions/${enc(p["subscription_id"])}`, kind: "subscription", required: ["subscription_id", "expiration_date_time"],
    body: (p) => ({ expirationDateTime: subscriptionExpiry(p) }), scope: "identity",
  },
  delete_subscription: { verb: "DELETE", path: (p) => `/subscriptions/${enc(p["subscription_id"])}`, kind: "empty", required: ["subscription_id"], scope: "identity" },
};

export const GRAPH_OPERATIONS = Object.keys(OPERATIONS);

/** Least-privilege delegated scope for an operation (subscriptions need the resource's read scope). */
export function graphScopeFor(operation: string): string | undefined {
  const spec = OPERATIONS[operation];
  return spec ? GRAPH_SCOPES[spec.scope] : undefined;
}

/** Only Graph's own origin may receive the bearer token (nextLink / deltaLink guard). */
function assertGraphUrl(url: string): string {
  if (!url.startsWith(`${GRAPH_API_BASE}/`)) throw bad("Pagination links must point at https://graph.microsoft.com/v1.0");
  return url;
}

function buildUrl(spec: Spec, operation: string, params: Record<string, unknown>): string {
  const url = new URL(`${GRAPH_API_BASE}${spec.path(params)}`);
  for (const [from, to] of Object.entries(spec.query ?? {})) {
    const value = params[from];
    if (value === undefined || value === null || value === "") continue;
    const v = Array.isArray(value) ? value.join(",") : String(value);
    // $search values are quoted per the Graph documentation.
    url.searchParams.set(to, to === "$search" && !/^".*"$/.test(v) ? `"${v}"` : v);
  }
  if (operation === "list_conversation_messages") url.searchParams.set("$filter", `conversationId eq '${String(params["conversation_id"]).replace(/'/g, "''")}'`);
  if (spec.list && !spec.delta && operation !== "get_organization") {
    const top = Math.min(Math.max(Number(params["limit"] ?? DEFAULT_TOP) || DEFAULT_TOP, 1), MAX_TOP);
    url.searchParams.set("$top", String(top));
  }
  return url.toString();
}

function normalizeByKind(kind: Kind, value: unknown): Record<string, unknown> {
  switch (kind) {
    case "user": return normalizeGraphUser(value);
    case "organization": return normalizeGraphOrganization(value);
    case "message": return normalizeGraphMessage(value);
    case "folder": return normalizeGraphFolder(value);
    case "attachment": return normalizeGraphAttachment(value);
    case "calendar": return normalizeGraphCalendar(value);
    case "event": return normalizeGraphEvent(value);
    case "contact": return normalizeGraphContact(value);
    case "subscription": return normalizeGraphSubscription(value);
    default: return asRecord(value);
  }
}

const THROTTLE_CODES = ["TooManyRequests", "ApplicationThrottled", "ErrorServerBusy", "activityLimitReached", "MailboxConcurrency"];

export const microsoftGraphConnector: ConnectorAdapter = {
  id: "microsoft_graph",
  label: "Microsoft Graph (Outlook)",
  capabilities: ["read", "write", "messaging", "search", "pagination", "files", "calendar", "webhook", "health_check"],
  credentials: { kind: "oauth2", required: ["access_token"], optional: ["refresh_token", "tenant_id"] },
  operations: GRAPH_OPERATIONS,
  healthOperation: "get_me",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    if (UNSUPPORTED_OPERATIONS[operation])
      throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS[operation]}`, { retryable: false });
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Microsoft Graph operation "${operation}"`, { retryable: false });
    const headers: Record<string, string> = { accept: "application/json" };
    const prefer: string[] = [];
    if (typeof params["time_zone"] === "string" && (spec.kind === "event")) prefer.push(`outlook.timezone="${params["time_zone"]}"`);
    if (params["body_content_type"] === "text" || params["body_content_type"] === "html") prefer.push(`outlook.body-content-type="${params["body_content_type"]}"`);
    if (spec.delta && params["max_page_size"]) prefer.push(`odata.maxpagesize=${Number(params["max_page_size"])}`);
    if (prefer.length) headers["prefer"] = prefer.join(", ");

    // Follow the provider's own opaque links verbatim — no internal cursor.
    if (cursor) return { method: "GET", url: assertGraphUrl(cursor), headers, paginated: true };
    if (spec.delta && typeof params["delta_link"] === "string" && params["delta_link"])
      return { method: "GET", url: assertGraphUrl(params["delta_link"]), headers, paginated: true };

    assertRequiredParams(operation, params, spec.required);
    const url = buildUrl(spec, operation, params);
    if (spec.verb === "GET" || spec.verb === "DELETE" || (!spec.body && spec.verb !== "POST"))
      return { method: spec.verb, url, headers, ...(spec.list ? { paginated: true } : {}) };
    const body = spec.body ? spec.body(params) : undefined;
    if (body === undefined) return { method: spec.verb, url, headers };
    return { method: spec.verb, url, headers: { ...headers, "content-type": "application/json" }, body };
  },

  authorize: (call, credentials) => {
    const token = (credentials["access_token"] ?? "").trim();
    if (!token) throw new ConnectorError("auth", "The Microsoft account is not connected yet", { retryable: false });
    if (!call.url.startsWith(`${GRAPH_API_BASE}/`)) throw bad("Refusing to send the Microsoft token outside Microsoft Graph");
    return { ...call, headers: { ...call.headers, authorization: `Bearer ${token}` } };
  },

  /** Graph's `{ error: { code, message, innerError } }` envelope. */
  mapError: (status, payload) => {
    if (status < 400) return null;
    const error = asRecord(asRecord(payload)["error"]);
    const code = String(error["code"] ?? "");
    const message = String(error["message"] ?? `Microsoft Graph request failed (${status})`);
    if (status === 401) return { kind: "auth", message: `Microsoft rejected the token: ${message}`, retryable: false };
    if (status === 429 || THROTTLE_CODES.includes(code) || (status === 503 && /throttl|busy/i.test(message)))
      return { kind: "rate_limit", message: `Microsoft Graph throttled the request: ${message}`, retryable: true };
    if (status === 403) {
      if (/consent|AADSTS65001/i.test(message) || code === "Authorization_RequestDenied")
        return { kind: "forbidden", message: `Microsoft permission or admin consent missing: ${message}`, retryable: false };
      return { kind: "forbidden", message: `Microsoft denied the request: ${message}`, retryable: false };
    }
    if (status === 404) return { kind: "not_found", message: `Microsoft Graph resource not found: ${message}`, retryable: false };
    if (status === 410 && /sync|delta/i.test(`${code} ${message}`))
      return { kind: "invalid_request", message: `Delta token expired; restart the sync without delta_link: ${message}`, retryable: false };
    if (status >= 500) return { kind: "provider", message: `Microsoft Graph is temporarily unavailable: ${message}`, retryable: true };
    return { kind: "invalid_request", message: `Microsoft Graph rejected the request: ${message}`, retryable: false };
  },

  readRateLimit: (headers): RateLimitInfo | undefined => {
    const retryAfter = headers.get("retry-after");
    if (!retryAfter) return undefined;
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return { retryAfterMs: Math.max(0, seconds) * 1000, remaining: 0 };
    const at = Date.parse(retryAfter);
    return Number.isFinite(at) ? { retryAfterMs: Math.max(0, at - Date.now()), remaining: 0, resetAt: new Date(at).toISOString() } : undefined;
  },

  normalize: (operation, payload): NormalizedPage => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Microsoft Graph operation "${operation}"`, { retryable: false });
    if (spec.kind === "empty") return { items: [{ ok: true, operation }], cursor: null, raw: payload };
    if (payload === null || typeof payload !== "object")
      throw new ConnectorError("malformed_response", "Microsoft Graph returned a non-JSON body", { retryable: false });
    const body = asRecord(payload);
    if (!spec.list) return { items: [normalizeByKind(spec.kind, body)], cursor: null, raw: payload };

    const list = body["value"];
    if (list !== undefined && !Array.isArray(list))
      throw new ConnectorError("malformed_response", "Microsoft Graph response field \"value\" is not a list", { retryable: false });
    const next = body["@odata.nextLink"];
    const items = Array.isArray(list) ? list.map((v) => normalizeByKind(spec.kind, v)) : [];
    const deltaLink = body["@odata.deltaLink"];
    // The final delta page returns the official deltaLink for the next sync round.
    if (spec.delta && typeof deltaLink === "string") items.push({ kind: "delta_state", delta_link: deltaLink });
    return { items, cursor: typeof next === "string" && next.length > 0 ? next : null, raw: payload };
  },
};
