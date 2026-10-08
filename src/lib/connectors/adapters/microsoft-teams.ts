import { GRAPH_API_BASE, microsoftGraphConnector } from "@/lib/connectors/adapters/microsoft-graph";
import { normalizeGraphOrganization, normalizeGraphUser } from "@/lib/connectors/adapters/microsoft-graph-map";
import {
  normalizeChannel,
  normalizeChat,
  normalizeHostedContent,
  normalizeMember,
  normalizeOnlineMeeting,
  normalizeSearchHits,
  normalizeTeam,
  normalizeTeamsMessage,
} from "@/lib/connectors/adapters/microsoft-teams-map";
import { asRecord, assertRequiredParams } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizeContext, NormalizedPage } from "@/lib/connectors/types";

/**
 * Microsoft Teams connector — official Microsoft Graph v1.0 Teams APIs only.
 *
 * Reuses the Microsoft Graph connector's infrastructure instead of duplicating
 * it: the same Graph host (`GRAPH_API_BASE`), the same Graph error mapping and
 * Retry-After reading (delegated to `microsoftGraphConnector`), the same
 * Microsoft identity platform OAuth spec (extended with Teams scopes) and the
 * same change-notification verifier. Calendar/Outlook stays in the Graph
 * connector. Delegated (signed-in user) permissions only.
 *
 * No AI, routing, moderation or collaboration business logic.
 */

/** Least-privilege delegated Graph permissions per capability. */
export const TEAMS_SCOPES = {
  identity: "User.Read",
  organization: "User.Read",
  teams_read: "Team.ReadBasic.All",
  team_create: "Team.Create",
  team_settings: "TeamSettings.ReadWrite.All",
  team_members_read: "TeamMember.Read.All",
  team_members_write: "TeamMember.ReadWrite.All",
  channels_read: "Channel.ReadBasic.All",
  channel_create: "Channel.Create",
  channel_settings: "ChannelSettings.ReadWrite.All",
  channel_delete: "Channel.Delete.All",
  channel_members_read: "ChannelMember.Read.All",
  channel_members_write: "ChannelMember.ReadWrite.All",
  channel_messages_read: "ChannelMessage.Read.All",
  channel_messages_send: "ChannelMessage.Send",
  channel_messages_write: "ChannelMessage.ReadWrite",
  chats: "Chat.ReadWrite",
  chat_create: "Chat.Create",
  chat_members_write: "ChatMember.ReadWrite",
  chat_messages_send: "ChatMessage.Send",
  meetings: "OnlineMeetings.ReadWrite",
  search: "ChannelMessage.Read.All",
} as const;
type ScopeKey = keyof typeof TEAMS_SCOPES;

/** Default consent set: no admin-consent permission is requested up front. */
export const TEAMS_DEFAULT_SCOPES = [
  "openid", "profile", "email", "offline_access",
  "User.Read", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Send",
  "Chat.ReadWrite", "ChatMessage.Send", "OnlineMeetings.ReadWrite",
];

/** Delegated permissions that require tenant admin consent (requested per connection only). */
export const TEAMS_ADMIN_CONSENT_SCOPES = [
  "TeamSettings.ReadWrite.All", "TeamMember.Read.All", "TeamMember.ReadWrite.All", "ChannelSettings.ReadWrite.All",
  "Channel.Delete.All", "ChannelMember.Read.All", "ChannelMember.ReadWrite.All", "ChannelMessage.Read.All",
];

export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  delete_team: "Deleting a team deletes its Microsoft 365 group (DELETE /groups/{id}, Group.ReadWrite.All) — tenant group administration outside the connector scope.",
  delete_chat: "DELETE /chats/{id} requires the application-only Chat.ManageDeletion.All permission, unavailable to the delegated connection.",
  reply_to_chat_message: "Chats have no reply/thread endpoint in Graph v1.0; replies exist only for channel messages.",
  hard_delete_message: "Graph v1.0 offers softDelete/undoSoftDelete only; permanent deletion is not exposed.",
  upload_file: "Teams files live in SharePoint drives; binary upload needs a binary transfer the JSON runtime does not carry.",
  download_file: "File and hosted-content bytes (/$value) are binary, which the JSON runtime does not carry.",
  get_hosted_content_bytes: "GET .../hostedContents/{id}/$value returns binary image bytes.",
  create_subscription: "Teams change notifications need the validationToken echo the shared ingress cannot send (existing Graph debt), and resource-data notifications need certificate decryption.",
  meeting_media: "Live audio/video, recordings and calling bots require Cloud Communications media infrastructure, not the JSON runtime.",
  list_online_meetings: "Graph v1.0 has no list endpoint for online meetings; use get_online_meeting or find_online_meeting_by_join_url.",
  tenant_message_export: "getAllMessages / export APIs are application-only, metered and tenant-wide.",
  calendar_events: "Calendar and Outlook events belong to the existing Microsoft Graph connector and are not duplicated here.",
  idempotency_key: "Graph documents no idempotency header for Teams writes; client-request-id is a diagnostics id, not idempotency.",
  teams_apps_and_tabs: "Installing apps/tabs and bot provisioning are administrative app-lifecycle actions outside the connector scope.",
};

type Kind = "user" | "organization" | "team" | "channel" | "chat" | "message" | "member" | "meeting" | "hosted" | "accepted" | "deleted" | "search";
type Params = Record<string, unknown>;
type Spec = {
  verb: HttpMethod;
  path: (p: Params) => string;
  kind: Kind;
  scope: ScopeKey;
  required?: string[];
  list?: boolean;
  /** Max `$top` Graph accepts for this collection; omitted when `$top` is unsupported. */
  top?: number;
  query?: (p: Params) => Record<string, string>;
  body?: (p: Params) => Record<string, unknown>;
};

const invalid = (m: string) => new ConnectorError("invalid_request", m, { retryable: false });

/** Graph Teams ids: GUIDs, `19:...@thread.tacv2`, numeric message ids, membership ids. */
export function teamsId(p: Params, field: string): string {
  const raw = String(p[field] ?? "");
  if (!/^[A-Za-z0-9:@._=+\-]{1,512}$/.test(raw) || raw.includes("..")) throw invalid(`\`${field}\` is not a valid Microsoft Teams id`);
  return encodeURIComponent(raw);
}

/** Only Graph's own origin may receive the bearer token (same rule as the Graph connector). */
export function assertTeamsGraphUrl(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw invalid("Pagination links must point at https://graph.microsoft.com/v1.0");
  }
  if (!url.startsWith(`${GRAPH_API_BASE}/`) || u.username || u.password || u.port) throw invalid("Pagination links must point at https://graph.microsoft.com/v1.0");
  return url;
}

/** Official message body: `{ contentType: text|html, content }`, mentions passed through. */
function messageBody(p: Params): Record<string, unknown> {
  const content = p["content"];
  if (typeof content !== "string" || !content) throw invalid("`content` is required");
  const type = p["content_type"] ?? "text";
  if (type !== "text" && type !== "html") throw invalid("`content_type` must be text or html");
  const mentions = p["mentions"];
  if (mentions !== undefined) {
    if (!Array.isArray(mentions)) throw invalid("`mentions` must be a list of Graph chatMessageMention objects");
    if (type !== "html") throw invalid("Mentions require html content with <at id=\"n\"> tags (Graph requirement)");
  }
  const attachments = p["attachments"];
  if (attachments !== undefined && !Array.isArray(attachments)) throw invalid("`attachments` must be a list of Graph chatMessageAttachment references");
  const importance = p["importance"];
  if (importance !== undefined && !["normal", "high", "urgent"].includes(String(importance))) throw invalid("`importance` must be normal, high or urgent");
  return {
    body: { contentType: type, content },
    ...(typeof p["subject"] === "string" ? { subject: p["subject"] } : {}),
    ...(importance ? { importance } : {}),
    ...(mentions ? { mentions } : {}),
    ...(attachments ? { attachments } : {}),
  };
}

function memberBody(p: Params): Record<string, unknown> {
  const user = teamsId(p, "user_id");
  const roles = p["roles"] ?? [];
  if (!Array.isArray(roles) || roles.some((r) => r !== "owner" && r !== "guest")) throw invalid("`roles` may only contain owner or guest");
  return {
    "@odata.type": "#microsoft.graph.aadUserConversationMember",
    roles,
    "user@odata.bind": `${GRAPH_API_BASE}/users('${decodeURIComponent(user)}')`,
  };
}

function isoDate(p: Params, field: string): string {
  const v = String(p[field] ?? "");
  if (!Number.isFinite(Date.parse(v))) throw invalid(`\`${field}\` must be an ISO 8601 date-time`);
  return v;
}

const T = (p: Params) => `/teams/${teamsId(p, "team_id")}`;
const C = (p: Params) => `${T(p)}/channels/${teamsId(p, "channel_id")}`;
const CH = (p: Params) => `/chats/${teamsId(p, "chat_id")}`;

const OPERATIONS: Record<string, Spec> = {
  // ---- Identity (same model as the Graph connector) ---------------------------
  get_me: { verb: "GET", path: () => "/me", kind: "user", scope: "identity" },
  get_organization: { verb: "GET", path: () => "/organization", kind: "organization", scope: "organization", list: true },

  // ---- Teams --------------------------------------------------------------------
  list_joined_teams: { verb: "GET", path: () => "/me/joinedTeams", kind: "team", scope: "teams_read", list: true },
  get_team: { verb: "GET", path: (p) => T(p), kind: "team", scope: "teams_read", required: ["team_id"] },
  create_team: {
    verb: "POST", path: () => "/teams", kind: "accepted", scope: "team_create", required: ["display_name"],
    body: (p) => {
      const visibility = p["visibility"] ?? "private";
      if (visibility !== "private" && visibility !== "public") throw invalid("`visibility` must be private or public");
      return {
        "template@odata.bind": `${GRAPH_API_BASE}/teamsTemplates('standard')`,
        displayName: String(p["display_name"]),
        ...(typeof p["description"] === "string" ? { description: p["description"] } : {}),
        visibility,
      };
    },
  },
  update_team: {
    verb: "PATCH", path: (p) => T(p), kind: "accepted", scope: "team_settings", required: ["team_id", "fields"],
    body: (p) => {
      const f = asRecord(p["fields"]);
      const allowed = ["displayName", "description", "visibility", "memberSettings", "guestSettings", "messagingSettings", "funSettings", "discoverySettings"];
      for (const k of Object.keys(f)) if (!allowed.includes(k)) throw invalid(`\`${k}\` is not an updatable team property`);
      if (!Object.keys(f).length) throw invalid("`fields` must not be empty");
      return f;
    },
  },
  archive_team: { verb: "POST", path: (p) => `${T(p)}/archive`, kind: "accepted", scope: "team_settings", required: ["team_id"], body: (p) => (p["read_only_sharepoint"] === true ? { shouldSetSpoSiteReadOnlyForMembers: true } : {}) },
  unarchive_team: { verb: "POST", path: (p) => `${T(p)}/unarchive`, kind: "accepted", scope: "team_settings", required: ["team_id"] },

  // ---- Team members -------------------------------------------------------------
  list_team_members: { verb: "GET", path: (p) => `${T(p)}/members`, kind: "member", scope: "team_members_read", required: ["team_id"], list: true },
  get_team_member: { verb: "GET", path: (p) => `${T(p)}/members/${teamsId(p, "membership_id")}`, kind: "member", scope: "team_members_read", required: ["team_id", "membership_id"] },
  add_team_member: { verb: "POST", path: (p) => `${T(p)}/members`, kind: "member", scope: "team_members_write", required: ["team_id", "user_id"], body: memberBody },
  remove_team_member: { verb: "DELETE", path: (p) => `${T(p)}/members/${teamsId(p, "membership_id")}`, kind: "deleted", scope: "team_members_write", required: ["team_id", "membership_id"] },

  // ---- Channels -----------------------------------------------------------------
  list_channels: {
    verb: "GET", path: (p) => `${T(p)}/channels`, kind: "channel", scope: "channels_read", required: ["team_id"], list: true,
    query: (p) => (p["membership_type"] ? { $filter: `membershipType eq '${channelType(p["membership_type"])}'` } : {}),
  },
  get_channel: { verb: "GET", path: (p) => C(p), kind: "channel", scope: "channels_read", required: ["team_id", "channel_id"] },
  create_channel: {
    verb: "POST", path: (p) => `${T(p)}/channels`, kind: "channel", scope: "channel_create", required: ["team_id", "display_name"],
    body: (p) => {
      const type = channelType(p["membership_type"] ?? "standard");
      const owners = p["owner_user_ids"];
      // Private and shared channels require at least one owner at creation (Graph rule).
      if (type !== "standard" && (!Array.isArray(owners) || !owners.length)) throw invalid("Private and shared channels need `owner_user_ids` (at least one owner)");
      return {
        displayName: String(p["display_name"]),
        ...(typeof p["description"] === "string" ? { description: p["description"] } : {}),
        membershipType: type,
        ...(type !== "standard"
          ? { members: (owners as unknown[]).map((id, i) => memberBody({ user_id: id, roles: ["owner"], _i: i })) }
          : {}),
      };
    },
  },
  update_channel: {
    verb: "PATCH", path: (p) => C(p), kind: "accepted", scope: "channel_settings", required: ["team_id", "channel_id"],
    body: (p) => {
      const out: Record<string, unknown> = {};
      if (typeof p["display_name"] === "string") out["displayName"] = p["display_name"];
      if (typeof p["description"] === "string") out["description"] = p["description"];
      if (!Object.keys(out).length) throw invalid("Provide `display_name` or `description`");
      return out;
    },
  },
  delete_channel: { verb: "DELETE", path: (p) => C(p), kind: "deleted", scope: "channel_delete", required: ["team_id", "channel_id"] },

  // ---- Channel members (private/shared channels) -------------------------------
  list_channel_members: { verb: "GET", path: (p) => `${C(p)}/members`, kind: "member", scope: "channel_members_read", required: ["team_id", "channel_id"], list: true },
  get_channel_member: { verb: "GET", path: (p) => `${C(p)}/members/${teamsId(p, "membership_id")}`, kind: "member", scope: "channel_members_read", required: ["team_id", "channel_id", "membership_id"] },
  add_channel_member: { verb: "POST", path: (p) => `${C(p)}/members`, kind: "member", scope: "channel_members_write", required: ["team_id", "channel_id", "user_id"], body: memberBody },
  remove_channel_member: { verb: "DELETE", path: (p) => `${C(p)}/members/${teamsId(p, "membership_id")}`, kind: "deleted", scope: "channel_members_write", required: ["team_id", "channel_id", "membership_id"] },

  // ---- Channel messages -----------------------------------------------------------
  list_channel_messages: { verb: "GET", path: (p) => `${C(p)}/messages`, kind: "message", scope: "channel_messages_read", required: ["team_id", "channel_id"], list: true, top: 50 },
  get_channel_message: { verb: "GET", path: (p) => `${C(p)}/messages/${teamsId(p, "message_id")}`, kind: "message", scope: "channel_messages_read", required: ["team_id", "channel_id", "message_id"] },
  send_channel_message: { verb: "POST", path: (p) => `${C(p)}/messages`, kind: "message", scope: "channel_messages_send", required: ["team_id", "channel_id", "content"], body: messageBody },
  reply_to_channel_message: { verb: "POST", path: (p) => `${C(p)}/messages/${teamsId(p, "message_id")}/replies`, kind: "message", scope: "channel_messages_send", required: ["team_id", "channel_id", "message_id", "content"], body: messageBody },
  list_channel_message_replies: { verb: "GET", path: (p) => `${C(p)}/messages/${teamsId(p, "message_id")}/replies`, kind: "message", scope: "channel_messages_read", required: ["team_id", "channel_id", "message_id"], list: true, top: 50 },
  update_channel_message: { verb: "PATCH", path: (p) => `${C(p)}/messages/${teamsId(p, "message_id")}${p["reply_id"] ? `/replies/${teamsId(p, "reply_id")}` : ""}`, kind: "accepted", scope: "channel_messages_write", required: ["team_id", "channel_id", "message_id", "content"], body: messageBody },
  soft_delete_channel_message: { verb: "POST", path: (p) => `${C(p)}/messages/${teamsId(p, "message_id")}${p["reply_id"] ? `/replies/${teamsId(p, "reply_id")}` : ""}/softDelete`, kind: "accepted", scope: "channel_messages_write", required: ["team_id", "channel_id", "message_id"] },
  undo_soft_delete_channel_message: { verb: "POST", path: (p) => `${C(p)}/messages/${teamsId(p, "message_id")}${p["reply_id"] ? `/replies/${teamsId(p, "reply_id")}` : ""}/undoSoftDelete`, kind: "accepted", scope: "channel_messages_write", required: ["team_id", "channel_id", "message_id"] },
  list_channel_message_hosted_contents: { verb: "GET", path: (p) => `${C(p)}/messages/${teamsId(p, "message_id")}/hostedContents`, kind: "hosted", scope: "channel_messages_read", required: ["team_id", "channel_id", "message_id"], list: true },

  // ---- Chats ----------------------------------------------------------------------
  list_chats: { verb: "GET", path: () => "/me/chats", kind: "chat", scope: "chats", list: true, top: 50, query: (p) => (p["chat_type"] ? { $filter: `chatType eq '${chatType(p["chat_type"])}'` } : {}) },
  get_chat: { verb: "GET", path: (p) => CH(p), kind: "chat", scope: "chats", required: ["chat_id"] },
  create_chat: {
    verb: "POST", path: () => "/chats", kind: "chat", scope: "chat_create", required: ["chat_type", "member_user_ids"],
    body: (p) => {
      const type = chatType(p["chat_type"]);
      const ids = p["member_user_ids"];
      if (!Array.isArray(ids) || ids.length < 2) throw invalid("`member_user_ids` must include the signed-in user and at least one other member");
      if (type === "oneOnOne" && ids.length !== 2) throw invalid("oneOnOne chats have exactly two members");
      if (type === "oneOnOne" && p["topic"] !== undefined) throw invalid("oneOnOne chats cannot have a topic");
      return {
        chatType: type,
        ...(typeof p["topic"] === "string" ? { topic: p["topic"] } : {}),
        members: ids.map((id) => memberBody({ user_id: id, roles: ["owner"] })),
      };
    },
  },
  update_chat: { verb: "PATCH", path: (p) => CH(p), kind: "chat", scope: "chats", required: ["chat_id", "topic"], body: (p) => ({ topic: String(p["topic"]) }) },

  // ---- Chat members ---------------------------------------------------------------
  list_chat_members: { verb: "GET", path: (p) => `${CH(p)}/members`, kind: "member", scope: "chats", required: ["chat_id"], list: true },
  get_chat_member: { verb: "GET", path: (p) => `${CH(p)}/members/${teamsId(p, "membership_id")}`, kind: "member", scope: "chats", required: ["chat_id", "membership_id"] },
  add_chat_member: {
    verb: "POST", path: (p) => `${CH(p)}/members`, kind: "member", scope: "chat_members_write", required: ["chat_id", "user_id"],
    body: (p) => ({
      ...memberBody(p),
      ...(p["share_history_since"] ? { visibleHistoryStartDateTime: isoDate(p, "share_history_since") } : {}),
    }),
  },
  remove_chat_member: { verb: "DELETE", path: (p) => `${CH(p)}/members/${teamsId(p, "membership_id")}`, kind: "deleted", scope: "chat_members_write", required: ["chat_id", "membership_id"] },

  // ---- Chat messages ---------------------------------------------------------------
  list_chat_messages: { verb: "GET", path: (p) => `${CH(p)}/messages`, kind: "message", scope: "chats", required: ["chat_id"], list: true, top: 50 },
  get_chat_message: { verb: "GET", path: (p) => `${CH(p)}/messages/${teamsId(p, "message_id")}`, kind: "message", scope: "chats", required: ["chat_id", "message_id"] },
  send_chat_message: { verb: "POST", path: (p) => `${CH(p)}/messages`, kind: "message", scope: "chat_messages_send", required: ["chat_id", "content"], body: messageBody },
  update_chat_message: { verb: "PATCH", path: (p) => `${CH(p)}/messages/${teamsId(p, "message_id")}`, kind: "accepted", scope: "chats", required: ["chat_id", "message_id", "content"], body: messageBody },
  soft_delete_chat_message: { verb: "POST", path: (p) => `/me/chats/${teamsId(p, "chat_id")}/messages/${teamsId(p, "message_id")}/softDelete`, kind: "accepted", scope: "chats", required: ["chat_id", "message_id"] },
  undo_soft_delete_chat_message: { verb: "POST", path: (p) => `/me/chats/${teamsId(p, "chat_id")}/messages/${teamsId(p, "message_id")}/undoSoftDelete`, kind: "accepted", scope: "chats", required: ["chat_id", "message_id"] },
  list_chat_message_hosted_contents: { verb: "GET", path: (p) => `${CH(p)}/messages/${teamsId(p, "message_id")}/hostedContents`, kind: "hosted", scope: "chats", required: ["chat_id", "message_id"], list: true },

  // ---- Online meetings (metadata only; calendar stays in the Graph connector) ----
  create_online_meeting: {
    verb: "POST", path: () => "/me/onlineMeetings", kind: "meeting", scope: "meetings", required: ["start", "end"],
    body: (p) => {
      const start = isoDate(p, "start");
      const end = isoDate(p, "end");
      if (Date.parse(end) <= Date.parse(start)) throw invalid("`end` must be after `start`");
      return { startDateTime: start, endDateTime: end, ...(typeof p["subject"] === "string" ? { subject: p["subject"] } : {}) };
    },
  },
  get_online_meeting: { verb: "GET", path: (p) => `/me/onlineMeetings/${teamsId(p, "meeting_id")}`, kind: "meeting", scope: "meetings", required: ["meeting_id"] },
  find_online_meeting_by_join_url: {
    verb: "GET", path: () => "/me/onlineMeetings", kind: "meeting", scope: "meetings", required: ["join_web_url"], list: true,
    query: (p) => {
      const url = String(p["join_web_url"]);
      if (!/^https:\/\/teams\.microsoft\.com\/[^\s']+$/.test(url)) throw invalid("`join_web_url` must be an official https://teams.microsoft.com join link");
      return { $filter: `JoinWebUrl eq '${url}'` };
    },
  },
  update_online_meeting: {
    verb: "PATCH", path: (p) => `/me/onlineMeetings/${teamsId(p, "meeting_id")}`, kind: "meeting", scope: "meetings", required: ["meeting_id"],
    body: (p) => {
      const out: Record<string, unknown> = {};
      if (p["start"] !== undefined) out["startDateTime"] = isoDate(p, "start");
      if (p["end"] !== undefined) out["endDateTime"] = isoDate(p, "end");
      if (typeof p["subject"] === "string") out["subject"] = p["subject"];
      if (!Object.keys(out).length) throw invalid("Provide `start`, `end` or `subject`");
      return out;
    },
  },
  delete_online_meeting: { verb: "DELETE", path: (p) => `/me/onlineMeetings/${teamsId(p, "meeting_id")}`, kind: "deleted", scope: "meetings", required: ["meeting_id"] },

  // ---- Search (Microsoft Search API, chatMessage entity, user-scoped) -----------
  search_messages: {
    verb: "POST", path: () => "/search/query", kind: "search", scope: "search", required: ["query"],
    body: (p) => {
      const q = String(p["query"]).trim();
      if (!q || q.length > 1000) throw invalid("`query` must be 1–1000 characters (KQL as documented by Microsoft Search)");
      return { requests: [{ entityTypes: ["chatMessage"], query: { queryString: q }, from: 0, size: Math.min(Math.max(Number(p["limit"] ?? 25) || 25, 1), 25) }] };
    },
  },
};

function channelType(value: unknown): string {
  const t = String(value);
  if (t !== "standard" && t !== "private" && t !== "shared") throw invalid("`membership_type` must be standard, private or shared");
  return t;
}
function chatType(value: unknown): string {
  const t = String(value);
  if (t !== "oneOnOne" && t !== "group") throw invalid("`chat_type` must be oneOnOne or group");
  return t;
}

export const TEAMS_OPERATIONS = Object.keys(OPERATIONS);

export function teamsScopeFor(operation: string): string | undefined {
  const spec = OPERATIONS[operation];
  return spec ? TEAMS_SCOPES[spec.scope] : undefined;
}

function normalizeByKind(kind: Kind, value: unknown): Record<string, unknown> {
  switch (kind) {
    case "user": return normalizeGraphUser(value);
    case "organization": return normalizeGraphOrganization(value);
    case "team": return normalizeTeam(value);
    case "channel": return normalizeChannel(value);
    case "chat": return normalizeChat(value);
    case "message": return normalizeTeamsMessage(value);
    case "member": return normalizeMember(value);
    case "meeting": return normalizeOnlineMeeting(value);
    case "hosted": return normalizeHostedContent(value);
    default: return asRecord(value);
  }
}

export const microsoftTeamsConnector: ConnectorAdapter = {
  id: "microsoft_teams",
  label: "Microsoft Teams",
  capabilities: ["read", "write", "messaging", "search", "pagination", "health_check"],
  credentials: { kind: "oauth2", required: ["access_token"], optional: ["refresh_token", "tenant_id"] },
  operations: TEAMS_OPERATIONS,
  healthOperation: "get_me",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    if (UNSUPPORTED_OPERATIONS[operation])
      throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS[operation]}`, { retryable: false });
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Microsoft Teams operation "${operation}"`, { retryable: false });
    if (params["idempotency_key"] !== undefined)
      throw new ConnectorError("unsupported", `UNSUPPORTED_OPERATION: ${UNSUPPORTED_OPERATIONS["idempotency_key"]}`, { retryable: false });
    const headers: Record<string, string> = { accept: "application/json" };

    if (spec.kind === "search") {
      assertRequiredParams(operation, params, spec.required);
      const body = spec.body!(params);
      // Search pages by offset (`from`); the cursor is that numeric offset.
      if (cursor) {
        if (!/^\d{1,5}$/.test(cursor)) throw invalid("Pagination cursor is not a Microsoft Search offset");
        (body["requests"] as Record<string, unknown>[])[0]!["from"] = Number(cursor);
      }
      return { method: "POST", url: `${GRAPH_API_BASE}${spec.path(params)}`, headers: { ...headers, "content-type": "application/json" }, body, paginated: true };
    }

    // Follow Graph's own opaque nextLink verbatim, guarded to the Graph origin.
    if (cursor) return { method: "GET", url: assertTeamsGraphUrl(cursor), headers, paginated: true };

    assertRequiredParams(operation, params, spec.required);
    const url = new URL(`${GRAPH_API_BASE}${spec.path(params)}`);
    for (const [k, val] of Object.entries(spec.query?.(params) ?? {})) url.searchParams.set(k, val);
    if (spec.top) url.searchParams.set("$top", String(Math.min(Math.max(Number(params["limit"] ?? spec.top) || spec.top, 1), spec.top)));
    const body = spec.body?.(params);
    const paginated = spec.list ? { paginated: true } : {};
    if (body === undefined) return { method: spec.verb, url: url.toString(), headers, ...paginated };
    return { method: spec.verb, url: url.toString(), headers: { ...headers, "content-type": "application/json" }, body, ...paginated };
  },

  authorize: (call, credentials) => {
    const token = (credentials["access_token"] ?? "").trim();
    if (!token) throw new ConnectorError("auth", "The Microsoft account is not connected yet", { retryable: false });
    assertTeamsGraphUrl(call.url);
    return { ...call, headers: { ...call.headers, authorization: `Bearer ${token}` } };
  },

  normalize: (operation, payload, status, context?: NormalizeContext): NormalizedPage => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Microsoft Teams operation "${operation}"`, { retryable: false });
    if (spec.kind === "deleted") return { items: [{ deleted: true, operation }], cursor: null };
    if (spec.kind === "accepted" || status === 202 || status === 204 || payload === null || payload === undefined)
      return { items: [{ ok: true, accepted: status === 202, operation }], cursor: null };
    if (typeof payload !== "object") throw new ConnectorError("malformed_response", "Microsoft Graph returned a non-JSON body", { retryable: false });
    if (spec.kind === "search") {
      const r = normalizeSearchHits(payload);
      const req = asRecord((asRecord(context?.call.body)["requests"] as unknown[] | undefined)?.[0]);
      const from = Number(req["from"] ?? 0);
      const next = r.moreResults && r.items.length ? from + r.items.length : null;
      return { items: r.items, cursor: next !== null && next < 100000 ? String(next) : null, raw: payload };
    }
    const body = asRecord(payload);
    if (!spec.list) return { items: [normalizeByKind(spec.kind, body)], cursor: null, raw: payload };
    const list = body["value"];
    if (list !== undefined && !Array.isArray(list))
      throw new ConnectorError("malformed_response", "Microsoft Graph response field \"value\" is not a list", { retryable: false });
    const next = body["@odata.nextLink"];
    return {
      items: Array.isArray(list) ? list.map((x) => normalizeByKind(spec.kind, x)) : [],
      cursor: typeof next === "string" && next ? assertTeamsGraphUrl(next) : null,
      raw: payload,
    };
  },

  // Reused verbatim from the Microsoft Graph connector — one Graph error/throttle model.
  mapError: (status, payload) => microsoftGraphConnector.mapError!(status, payload),
  readRateLimit: (headers, payload) => microsoftGraphConnector.readRateLimit!(headers, payload),
};
