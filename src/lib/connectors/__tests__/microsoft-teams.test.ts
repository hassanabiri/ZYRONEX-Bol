import { describe, expect, it, vi } from "vitest";

import { GRAPH_API_BASE, microsoftGraphConnector } from "@/lib/connectors/adapters/microsoft-graph";
import {
  TEAMS_ADMIN_CONSENT_SCOPES,
  TEAMS_DEFAULT_SCOPES,
  TEAMS_OPERATIONS,
  UNSUPPORTED_OPERATIONS,
  assertTeamsGraphUrl,
  microsoftTeamsConnector,
  teamsId,
  teamsScopeFor,
} from "@/lib/connectors/adapters/microsoft-teams";
import { normalizeSearchHits, normalizeTeamsMessage } from "@/lib/connectors/adapters/microsoft-teams-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { getOAuthProvider } from "@/lib/oauth/providers";
import { verifyWebhook } from "@/lib/webhooks/verify";

/** Simulation only — every response is mocked; no real Microsoft tenant is contacted. */

const trace = "trace-teams";
const TOKEN = "eyJ0eXAiOiJKV1QiLCJ0ZWFtcyI6InRva2VuIn0.payload.sig";
const creds = { access_token: TOKEN, tenant_id: "11111111-2222-3333-4444-555555555555" };
const TEAM = "f7c3a1e2-1234-4cde-9abc-0123456789ab";
const CHANNEL = "19:abc123@thread.tacv2";
const CHAT = "19:meeting_xyz@thread.v2";
const G = GRAPH_API_BASE;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status: init.status ?? 200, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
}
function capture(response: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit ?? {} });
    return jsonResponse(response, init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}
function sequence(...responses: (() => Response)[]) {
  let i = 0;
  const fetchImpl = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]!()) as unknown as typeof fetch;
  return { fetchImpl, count: () => i };
}
function run(input: Parameters<typeof runConnectorOperation>[0]["input"], fetchImpl: typeof fetch, credentials: Record<string, string> = creds) {
  return runConnectorOperation({ adapter: microsoftTeamsConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {} });
}
const build = (operation: string, params: Record<string, unknown> = {}, cursor?: string) => microsoftTeamsConnector.buildCall({ operation, params, ...(cursor ? { cursor } : {}) });
const url = (operation: string, params: Record<string, unknown> = {}) => new URL(build(operation, params).url);
const path = (operation: string, params: Record<string, unknown> = {}) => decodeURIComponent(url(operation, params).pathname.replace("/v1.0", ""));
const body = (operation: string, params: Record<string, unknown> = {}) => build(operation, params).body as any;
const TC = { team_id: TEAM, channel_id: CHANNEL };

// ---------------------------------------------------------------------------
describe("teams registration & reuse", () => {
  it("is registered", () => expect(getConnector("microsoft_teams")?.id).toBe("microsoft_teams"));
  for (const alias of ["teams", "ms_teams"]) it(`resolves alias ${alias}`, () => expect(getConnector(alias)?.id).toBe("microsoft_teams"));
  it("does not hijack the Graph connector", () => {
    expect(getConnector("microsoft_graph")?.id).toBe("microsoft_graph");
    expect(getConnector("outlook")?.id).toBe("microsoft_graph");
    expect(getConnector("microsoft_365")?.id).toBe("microsoft_graph");
  });
  it("describes oauth2 requiring an access token", () => {
    const d = describeConnectors().find((c) => c.id === "microsoft_teams");
    expect(d?.authKind).toBe("oauth2");
    expect(d?.requiredCredentials).toEqual(["access_token"]);
  });
  it("health operation is get_me", () => expect(microsoftTeamsConnector.healthOperation).toBe("get_me"));
  it("declares no calendar or webhook capability", () => {
    expect(microsoftTeamsConnector.capabilities).not.toContain("calendar");
    expect(microsoftTeamsConnector.capabilities).not.toContain("webhook");
  });
  it("leaves previous connectors untouched", () => {
    for (const id of ["intercom", "zendesk", "pipedrive", "salesforce", "hubspot", "slack"]) expect(getConnector(id)?.id).toBe(id);
  });
  it("exposes no unsupported operation", () => {
    for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) expect(TEAMS_OPERATIONS).not.toContain(op);
  });
  for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) it(`rejects ${op} as UNSUPPORTED_OPERATION`, () => expect(() => build(op)).toThrow(/UNSUPPORTED_OPERATION/));
  it("rejects unknown operations", () => expect(() => build("nope")).toThrow(/Unknown Microsoft Teams operation/));
  it("contains no calendar operations", () => expect(TEAMS_OPERATIONS.filter((o) => /calendar|event/.test(o))).toEqual([]));
  for (const op of TEAMS_OPERATIONS) it(`${op} declares a least-privilege scope`, () => expect(teamsScopeFor(op)).toMatch(/^[A-Za-z.]+$/));
  const P: Record<string, unknown> = { ...TC, chat_id: CHAT, message_id: "1700000000000", membership_id: "MCMjMSMj", user_id: "aaaa-bbbb", meeting_id: "MSo1N2Y5", content: "hi", display_name: "D", fields: { description: "x" }, chat_type: "group", member_user_ids: ["u1", "u2"], topic: "T", start: "2026-01-01T10:00:00Z", end: "2026-01-01T11:00:00Z", join_web_url: "https://teams.microsoft.com/l/meetup-join/x", query: "hello" };
  for (const op of TEAMS_OPERATIONS) it(`${op} targets Microsoft Graph v1.0 only`, () => expect(build(op, P).url.startsWith(`${G}/`)).toBe(true));
  it("reuses the Graph error mapping", () => {
    const payload = { error: { code: "Forbidden", message: "Missing role" } };
    expect(microsoftTeamsConnector.mapError!(403, payload)).toEqual(microsoftGraphConnector.mapError!(403, payload));
  });
  it("reuses the Graph Retry-After reader", () => {
    const h = new Headers({ "retry-after": "4" });
    expect(microsoftTeamsConnector.readRateLimit!(h, null)).toEqual(microsoftGraphConnector.readRateLimit!(h, null));
  });
});

// ---------------------------------------------------------------------------
describe("teams OAuth reuse", () => {
  const spec = getOAuthProvider("microsoft_teams")!;
  const graph = getOAuthProvider("microsoft_graph")!;
  it("uses the same Microsoft identity platform endpoints", () => {
    expect(spec.authorizationUrl).toBe(graph.authorizationUrl);
    expect(spec.tokenUrl).toBe(graph.tokenUrl);
  });
  it("keeps PKCE and refresh", () => {
    expect(spec.usePkce).toBe(true);
    expect(spec.refreshable).toBe(true);
  });
  it("reuses the tenant/oid identity functions", () => {
    expect(spec.identify).toBe(graph.identify);
    expect(spec.credentialFields).toBe(graph.credentialFields);
  });
  it("is bound to the teams connector", () => expect(spec.connector).toBe("microsoft_teams"));
  it("aliases resolve the same spec", () => expect(getOAuthProvider("teams")?.connector).toBe("microsoft_teams"));
  it("Graph spec is unchanged", () => {
    expect(graph.connector).toBe("microsoft_graph");
    expect(graph.scopes).not.toContain("Chat.ReadWrite");
  });
  it("requests offline_access for refresh", () => expect(spec.scopes).toContain("offline_access"));
  it("default consent contains no admin-consent permission", () => {
    for (const s of TEAMS_ADMIN_CONSENT_SCOPES) expect(TEAMS_DEFAULT_SCOPES).not.toContain(s);
  });
  it("default consent contains no Mail or Calendar scopes", () => expect(spec.scopes.filter((s) => /Mail|Calendars/.test(s))).toEqual([]));
  it("default consent contains only documented delegated scopes", () =>
    expect(spec.scopes).toEqual(["openid", "profile", "email", "offline_access", "User.Read", "Team.ReadBasic.All", "Channel.ReadBasic.All", "ChannelMessage.Send", "Chat.ReadWrite", "ChatMessage.Send", "OnlineMeetings.ReadWrite"]));
});

// ---------------------------------------------------------------------------
describe("teams identity & health", () => {
  it("get_me", () => expect(path("get_me")).toBe("/me"));
  it("organization", () => expect(path("get_organization")).toBe("/organization"));
  it("normalizes the user via the Graph normalizer", async () => {
    const { fetchImpl } = capture({ id: "u1", displayName: "A", userPrincipalName: "a@contoso.com" });
    const r = await run({ operation: "get_me" }, fetchImpl);
    expect(r.ok && r.items[0]?.["id"]).toBe("u1");
  });
  it("healthy via /me", async () => {
    const { fetchImpl, calls } = capture({ id: "u1" });
    const h = await checkConnectorHealth({ adapter: microsoftTeamsConnector, credentials: creds, traceId: trace, fetchImpl, sleep: async () => {} } as Parameters<typeof checkConnectorHealth>[0]);
    expect(h.healthy).toBe(true);
    expect(calls[0]!.url).toBe(`${G}/me`);
  });
  it("unhealthy on 401", async () => {
    const h = await checkConnectorHealth({ adapter: microsoftTeamsConnector, credentials: creds, traceId: trace, fetchImpl: capture({ error: { code: "InvalidAuthenticationToken" } }, { status: 401 }).fetchImpl, sleep: async () => {} } as Parameters<typeof checkConnectorHealth>[0]);
    expect(h.healthy).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("teams: teams & members", () => {
  it("joined teams", () => expect(path("list_joined_teams")).toBe("/me/joinedTeams"));
  it("joined teams sends no $top (unsupported by Graph)", () => expect(url("list_joined_teams").searchParams.get("$top")).toBeNull());
  it("get team", () => expect(path("get_team", { team_id: TEAM })).toBe(`/teams/${TEAM}`));
  it("create team uses the standard template", () => {
    const b = body("create_team", { display_name: "Ops", description: "d" });
    expect(b["template@odata.bind"]).toBe(`${G}/teamsTemplates('standard')`);
    expect(b).toMatchObject({ displayName: "Ops", description: "d", visibility: "private" });
  });
  it("create team rejects invalid visibility", () => expect(() => build("create_team", { display_name: "x", visibility: "hidden" })).toThrow());
  it("create team returns accepted on 202", async () => {
    const { fetchImpl } = capture(null, { status: 202 });
    const r = await run({ operation: "create_team", params: { display_name: "Ops" } }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ ok: true, accepted: true });
  });
  it("update team PATCH with allowed properties", () => expect(build("update_team", { team_id: TEAM, fields: { memberSettings: { allowCreateUpdateChannels: false } } }).method).toBe("PATCH"));
  it("update team rejects unknown properties", () => expect(() => build("update_team", { team_id: TEAM, fields: { owner: "x" } })).toThrow(/updatable/));
  it("update team rejects empty fields", () => expect(() => build("update_team", { team_id: TEAM, fields: {} })).toThrow());
  it("archive", () => expect(path("archive_team", { team_id: TEAM })).toBe(`/teams/${TEAM}/archive`));
  it("archive with read-only SharePoint", () => expect(body("archive_team", { team_id: TEAM, read_only_sharepoint: true })).toEqual({ shouldSetSpoSiteReadOnlyForMembers: true }));
  it("unarchive", () => expect(path("unarchive_team", { team_id: TEAM })).toBe(`/teams/${TEAM}/unarchive`));
  it("list team members", () => expect(path("list_team_members", { team_id: TEAM })).toBe(`/teams/${TEAM}/members`));
  it("get team member", () => expect(path("get_team_member", { team_id: TEAM, membership_id: "m1" })).toBe(`/teams/${TEAM}/members/m1`));
  it("add team member binds the user", () => {
    const b = body("add_team_member", { team_id: TEAM, user_id: "u-1", roles: ["owner"] });
    expect(b).toEqual({ "@odata.type": "#microsoft.graph.aadUserConversationMember", roles: ["owner"], "user@odata.bind": `${G}/users('u-1')` });
  });
  it("rejects invalid roles", () => expect(() => build("add_team_member", { team_id: TEAM, user_id: "u", roles: ["admin"] })).toThrow());
  it("remove team member", () => expect(build("remove_team_member", { team_id: TEAM, membership_id: "m1" }).method).toBe("DELETE"));
  it("normalizes members", async () => {
    const { fetchImpl } = capture({ value: [{ id: "m1", userId: "u1", displayName: "A", roles: ["owner"] }] });
    const r = await run({ operation: "list_team_members", params: { team_id: TEAM } }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "m1", user_id: "u1", roles: ["owner"] });
  });
  it("normalizes teams", async () => {
    const { fetchImpl } = capture({ value: [{ id: TEAM, displayName: "Ops", isArchived: false }] });
    const r = await run({ operation: "list_joined_teams" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: TEAM, display_name: "Ops", is_archived: false });
  });
});

// ---------------------------------------------------------------------------
describe("teams: channels", () => {
  it("list channels", () => expect(path("list_channels", { team_id: TEAM })).toBe(`/teams/${TEAM}/channels`));
  it("filters by membership type", () => expect(url("list_channels", { team_id: TEAM, membership_type: "private" }).searchParams.get("$filter")).toBe("membershipType eq 'private'"));
  it("rejects unknown channel type", () => expect(() => build("list_channels", { team_id: TEAM, membership_type: "secret" })).toThrow());
  it("encodes thread ids in paths", () => expect(url("get_channel", TC).pathname).toContain(encodeURIComponent(CHANNEL)));
  it("get channel", () => expect(path("get_channel", TC)).toBe(`/teams/${TEAM}/channels/${CHANNEL}`));
  it("create standard channel", () => expect(body("create_channel", { team_id: TEAM, display_name: "General 2" })).toEqual({ displayName: "General 2", membershipType: "standard" }));
  it("private channel requires an owner", () => expect(() => build("create_channel", { team_id: TEAM, display_name: "P", membership_type: "private" })).toThrow(/owner/));
  it("shared channel requires an owner", () => expect(() => build("create_channel", { team_id: TEAM, display_name: "S", membership_type: "shared" })).toThrow(/owner/));
  it("private channel includes owner members", () => {
    const b = body("create_channel", { team_id: TEAM, display_name: "P", membership_type: "private", owner_user_ids: ["u1"] });
    expect(b.membershipType).toBe("private");
    expect(b.members[0]).toMatchObject({ roles: ["owner"], "user@odata.bind": `${G}/users('u1')` });
  });
  it("update channel", () => expect(body("update_channel", { ...TC, description: "new" })).toEqual({ description: "new" }));
  it("update channel requires a change", () => expect(() => build("update_channel", TC)).toThrow());
  it("delete channel", () => expect(build("delete_channel", TC).method).toBe("DELETE"));
  it("channel members", () => expect(path("list_channel_members", TC)).toBe(`/teams/${TEAM}/channels/${CHANNEL}/members`));
  it("get channel member", () => expect(path("get_channel_member", { ...TC, membership_id: "m" })).toBe(`/teams/${TEAM}/channels/${CHANNEL}/members/m`));
  it("add channel member", () => expect(body("add_channel_member", { ...TC, user_id: "u2" })["user@odata.bind"]).toBe(`${G}/users('u2')`));
  it("remove channel member", () => expect(build("remove_channel_member", { ...TC, membership_id: "m" }).method).toBe("DELETE"));
  it("normalizes channel type", async () => {
    const { fetchImpl } = capture({ id: CHANNEL, displayName: "P", membershipType: "private" });
    const r = await run({ operation: "get_channel", params: TC }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: CHANNEL, membership_type: "private" });
  });
});

// ---------------------------------------------------------------------------
describe("teams: channel messages", () => {
  const M = { ...TC, message_id: "1700000000000" };
  it("list with $top capped at 50", () => {
    expect(url("list_channel_messages", { ...TC, limit: 500 }).searchParams.get("$top")).toBe("50");
    expect(url("list_channel_messages", { ...TC, limit: 10 }).searchParams.get("$top")).toBe("10");
  });
  it("get", () => expect(path("get_channel_message", M)).toBe(`/teams/${TEAM}/channels/${CHANNEL}/messages/1700000000000`));
  it("send text", () => expect(body("send_channel_message", { ...TC, content: "hi" })).toEqual({ body: { contentType: "text", content: "hi" } }));
  it("send html with mentions", () => {
    const mentions = [{ id: 0, mentionText: "A", mentioned: { user: { id: "u1" } } }];
    expect(body("send_channel_message", { ...TC, content: "<at id=\"0\">A</at>", content_type: "html", mentions })).toMatchObject({ body: { contentType: "html" }, mentions });
  });
  it("mentions require html", () => expect(() => build("send_channel_message", { ...TC, content: "x", mentions: [] })).toThrow(/html/));
  it("rejects unknown content types", () => expect(() => build("send_channel_message", { ...TC, content: "x", content_type: "markdown" })).toThrow());
  it("supports subject and importance", () => expect(body("send_channel_message", { ...TC, content: "x", subject: "S", importance: "urgent" })).toMatchObject({ subject: "S", importance: "urgent" }));
  it("rejects invalid importance", () => expect(() => build("send_channel_message", { ...TC, content: "x", importance: "max" })).toThrow());
  it("passes attachment references", () => expect(body("send_channel_message", { ...TC, content: "x", attachments: [{ id: "a", contentType: "reference", contentUrl: "https://contoso.sharepoint.com/f" }] }).attachments).toHaveLength(1));
  it("requires content", () => expect(() => build("send_channel_message", TC)).toThrow(/content/));
  it("reply", () => expect(path("reply_to_channel_message", { ...M, content: "r" })).toBe(`/teams/${TEAM}/channels/${CHANNEL}/messages/1700000000000/replies`));
  it("list replies", () => expect(path("list_channel_message_replies", M)).toBe(`/teams/${TEAM}/channels/${CHANNEL}/messages/1700000000000/replies`));
  it("update message", () => expect(build("update_channel_message", { ...M, content: "e" }).method).toBe("PATCH"));
  it("update a reply", () => expect(path("update_channel_message", { ...M, reply_id: "17", content: "e" })).toMatch(/\/replies\/17$/));
  it("soft delete", () => expect(path("soft_delete_channel_message", M)).toMatch(/\/softDelete$/));
  it("undo soft delete", () => expect(path("undo_soft_delete_channel_message", M)).toMatch(/\/undoSoftDelete$/));
  it("hosted contents metadata", () => expect(path("list_channel_message_hosted_contents", M)).toMatch(/\/hostedContents$/));
  it("normalizes channel messages", async () => {
    const { fetchImpl } = capture({ value: [{ id: "1", body: { contentType: "html", content: "<p>x</p>" }, channelIdentity: { teamId: TEAM, channelId: CHANNEL }, from: { user: { id: "u1", displayName: "A" } } }] });
    const r = await run({ operation: "list_channel_messages", params: TC }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "1", scope: "channel", team_id: TEAM, content_type: "html", from_user_id: "u1" });
  });
});

// ---------------------------------------------------------------------------
describe("teams: chats & chat messages", () => {
  const CM = { chat_id: CHAT, message_id: "171" };
  it("list chats", () => expect(path("list_chats")).toBe("/me/chats"));
  it("filter chats by type", () => expect(url("list_chats", { chat_type: "group" }).searchParams.get("$filter")).toBe("chatType eq 'group'"));
  it("get chat", () => expect(path("get_chat", { chat_id: CHAT })).toBe(`/chats/${CHAT}`));
  it("create group chat", () => {
    const b = body("create_chat", { chat_type: "group", member_user_ids: ["u1", "u2", "u3"], topic: "T" });
    expect(b.chatType).toBe("group");
    expect(b.topic).toBe("T");
    expect(b.members).toHaveLength(3);
  });
  it("oneOnOne needs exactly two members", () => expect(() => build("create_chat", { chat_type: "oneOnOne", member_user_ids: ["u1", "u2", "u3"] })).toThrow());
  it("oneOnOne cannot have a topic", () => expect(() => build("create_chat", { chat_type: "oneOnOne", member_user_ids: ["u1", "u2"], topic: "x" })).toThrow());
  it("requires two members", () => expect(() => build("create_chat", { chat_type: "group", member_user_ids: ["u1"] })).toThrow());
  it("rejects unknown chat type", () => expect(() => build("create_chat", { chat_type: "meeting", member_user_ids: ["a", "b"] })).toThrow());
  it("update topic", () => expect(body("update_chat", { chat_id: CHAT, topic: "New" })).toEqual({ topic: "New" }));
  it("chat members", () => expect(path("list_chat_members", { chat_id: CHAT })).toBe(`/chats/${CHAT}/members`));
  it("get chat member", () => expect(path("get_chat_member", { chat_id: CHAT, membership_id: "m" })).toBe(`/chats/${CHAT}/members/m`));
  it("add chat member with history", () => expect(body("add_chat_member", { chat_id: CHAT, user_id: "u", share_history_since: "2026-01-01T00:00:00Z" }).visibleHistoryStartDateTime).toBe("2026-01-01T00:00:00Z"));
  it("rejects invalid history date", () => expect(() => build("add_chat_member", { chat_id: CHAT, user_id: "u", share_history_since: "yesterday" })).toThrow());
  it("remove chat member", () => expect(build("remove_chat_member", { chat_id: CHAT, membership_id: "m" }).method).toBe("DELETE"));
  it("list chat messages", () => expect(url("list_chat_messages", { chat_id: CHAT }).searchParams.get("$top")).toBe("50"));
  it("get chat message", () => expect(path("get_chat_message", CM)).toBe(`/chats/${CHAT}/messages/171`));
  it("send chat message", () => expect(body("send_chat_message", { chat_id: CHAT, content: "hey" })).toEqual({ body: { contentType: "text", content: "hey" } }));
  it("update chat message", () => expect(build("update_chat_message", { ...CM, content: "e" }).method).toBe("PATCH"));
  it("soft delete uses the official /me/chats path", () => expect(path("soft_delete_chat_message", CM)).toBe(`/me/chats/${CHAT}/messages/171/softDelete`));
  it("undo soft delete", () => expect(path("undo_soft_delete_chat_message", CM)).toBe(`/me/chats/${CHAT}/messages/171/undoSoftDelete`));
  it("chat replies are unsupported", () => expect(() => build("reply_to_chat_message", CM)).toThrow(/UNSUPPORTED_OPERATION/));
  it("chat messages are distinguished from channel messages", () => {
    expect(normalizeTeamsMessage({ id: "1", chatId: CHAT })["scope"]).toBe("chat");
    expect(normalizeTeamsMessage({ id: "1", channelIdentity: { teamId: TEAM } })["scope"]).toBe("channel");
  });
  it("attachments are references only", () => expect(normalizeTeamsMessage({ attachments: [{ id: "a", contentType: "reference", contentUrl: "u", content: "big" }] })["attachments"]).toEqual([{ id: "a", content_type: "reference", content_url: "u", name: null }]));
});

// ---------------------------------------------------------------------------
describe("teams: online meetings", () => {
  const W = { start: "2026-01-01T10:00:00Z", end: "2026-01-01T11:00:00Z" };
  it("create", () => expect(body("create_online_meeting", { ...W, subject: "Sync" })).toEqual({ startDateTime: W.start, endDateTime: W.end, subject: "Sync" }));
  it("end must follow start", () => expect(() => build("create_online_meeting", { start: W.end, end: W.start })).toThrow());
  it("rejects invalid dates", () => expect(() => build("create_online_meeting", { start: "soon", end: W.end })).toThrow());
  it("get", () => expect(path("get_online_meeting", { meeting_id: "MSo1" })).toBe("/me/onlineMeetings/MSo1"));
  it("find by join url", () => expect(url("find_online_meeting_by_join_url", { join_web_url: "https://teams.microsoft.com/l/meetup-join/abc" }).searchParams.get("$filter")).toBe("JoinWebUrl eq 'https://teams.microsoft.com/l/meetup-join/abc'"));
  it("find rejects foreign join urls", () => expect(() => build("find_online_meeting_by_join_url", { join_web_url: "https://evil.com/x" })).toThrow());
  it("find rejects quote injection", () => expect(() => build("find_online_meeting_by_join_url", { join_web_url: "https://teams.microsoft.com/x' or 1 eq 1" })).toThrow());
  it("update", () => expect(body("update_online_meeting", { meeting_id: "MSo1", subject: "S2" })).toEqual({ subject: "S2" }));
  it("update requires a change", () => expect(() => build("update_online_meeting", { meeting_id: "MSo1" })).toThrow());
  it("delete", () => expect(build("delete_online_meeting", { meeting_id: "MSo1" }).method).toBe("DELETE"));
  it("normalizes meetings", async () => {
    const { fetchImpl } = capture({ id: "MSo1", subject: "S", joinWebUrl: "https://teams.microsoft.com/l/x", chatInfo: { threadId: CHAT } });
    const r = await run({ operation: "get_online_meeting", params: { meeting_id: "MSo1" } }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "MSo1", chat_thread_id: CHAT });
  });
  it("listing meetings is unsupported", () => expect(() => build("list_online_meetings")).toThrow(/UNSUPPORTED_OPERATION/));
  it("media is unsupported", () => expect(() => build("meeting_media")).toThrow(/UNSUPPORTED_OPERATION/));
});

// ---------------------------------------------------------------------------
describe("teams: search", () => {
  it("uses Microsoft Search with chatMessage only", () => {
    const b = body("search_messages", { query: "budget" });
    expect(path("search_messages", { query: "budget" })).toBe("/search/query");
    expect(b.requests[0]).toEqual({ entityTypes: ["chatMessage"], query: { queryString: "budget" }, from: 0, size: 25 });
  });
  it("caps size at 25", () => expect(body("search_messages", { query: "x", limit: 500 }).requests[0].size).toBe(25));
  it("requires a query", () => expect(() => build("search_messages", { query: " " })).toThrow());
  it("cursor is the offset", () => expect((build("search_messages", { query: "x" }, "25").body as any).requests[0].from).toBe(25));
  it("rejects non-numeric search cursors", () => expect(() => build("search_messages", { query: "x" }, "https://evil.com")).toThrow());
  it("advances offset when more results exist", async () => {
    const { fetchImpl } = capture({ value: [{ hitsContainers: [{ hits: [{ hitId: "h1", resource: { id: "1", chatId: CHAT } }], moreResultsAvailable: true, total: 40 }] }] });
    const r = await run({ operation: "search_messages", params: { query: "x" } }, fetchImpl);
    expect(r.ok && r.cursor).toBe("1");
    expect(r.ok && r.items[0]).toMatchObject({ hit_id: "h1", resource: { id: "1", scope: "chat" } });
  });
  it("stops when no more results", async () => {
    const { fetchImpl } = capture({ value: [{ hitsContainers: [{ hits: [], moreResultsAvailable: false }] }] });
    expect((await run({ operation: "search_messages", params: { query: "x" } }, fetchImpl)).ok && true).toBe(true);
  });
  it("normalizer tolerates empty payloads", () => expect(normalizeSearchHits({})).toEqual({ items: [], moreResults: false, total: null }));
});

// ---------------------------------------------------------------------------
describe("teams: pagination & host safety", () => {
  it("follows Graph nextLink", async () => {
    const urls: string[] = [];
    const responses = [{ value: [{ id: "1" }], "@odata.nextLink": `${G}/me/chats?$skiptoken=abc` }, { value: [{ id: "2" }] }];
    let i = 0;
    const fetchImpl = vi.fn(async (u: string) => (urls.push(String(u)), jsonResponse(responses[i++]))) as unknown as typeof fetch;
    const r = await run({ operation: "list_chats", maxPages: 3 }, fetchImpl);
    expect(r.ok && r.items.map((x) => x["id"])).toEqual(["1", "2"]);
    expect(urls[1]).toBe(`${G}/me/chats?$skiptoken=abc`);
  });
  for (const bad of ["https://evil.com/v1.0/me", "https://graph.microsoft.com/beta/me", "http://graph.microsoft.com/v1.0/me", "https://graph.microsoft.com.evil.com/v1.0/me", "https://user:pw@graph.microsoft.com/v1.0/me", "https://graph.microsoft.com:8443/v1.0/me", "not a url"])
    it(`rejects continuation ${bad}`, () => expect(() => build("list_chats", {}, bad)).toThrow(/graph\.microsoft\.com/));
  it("rejects a hostile nextLink in responses", async () => {
    const { fetchImpl } = capture({ value: [], "@odata.nextLink": "https://evil.com/steal" });
    expect((await run({ operation: "list_chats" }, fetchImpl)).ok).toBe(false);
  });
  it("authorize refuses non-Graph hosts", () => expect(() => microsoftTeamsConnector.authorize({ method: "GET", url: "https://evil.com/x", headers: {} }, creds)).toThrow());
  it("authorize sends the bearer token", () => expect(microsoftTeamsConnector.authorize(build("get_me"), creds).headers["authorization"]).toBe(`Bearer ${TOKEN}`));
  it("fails without a token", () => expect(() => microsoftTeamsConnector.authorize(build("get_me"), {})).toThrow(/not connected/));
  for (const bad of ["../me", "a/b", "a b", "x?y=1", "a#b", ""]) it(`rejects id ${JSON.stringify(bad)}`, () => expect(() => teamsId({ v: bad }, "v")).toThrow());
  it("assertTeamsGraphUrl accepts Graph links", () => expect(assertTeamsGraphUrl(`${G}/me`)).toBe(`${G}/me`));
  it("rejects malformed list payloads", async () => {
    const { fetchImpl } = capture({ value: "nope" });
    expect((await run({ operation: "list_chats" }, fetchImpl)).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("teams: rate limits, retries & errors", () => {
  it("retries 429 with Retry-After", async () => {
    const s = sequence(() => jsonResponse({ error: { code: "TooManyRequests", message: "slow" } }, { status: 429, headers: { "retry-after": "1" } }), () => jsonResponse({ id: "u1" }));
    expect((await run({ operation: "get_me" }, s.fetchImpl)).ok).toBe(true);
    expect(s.count()).toBe(2);
  });
  for (const status of [500, 502, 503, 504]) it(`retries ${status}`, async () => {
    const s = sequence(() => jsonResponse({ error: { code: "x", message: "m" } }, { status }), () => jsonResponse({ id: "u1" }));
    expect((await run({ operation: "get_me" }, s.fetchImpl)).ok).toBe(true);
  });
  for (const status of [400, 401, 403, 404, 409]) it(`does not retry ${status}`, async () => {
    const s = sequence(() => jsonResponse({ error: { code: "x", message: "m" } }, { status }));
    expect((await run({ operation: "get_me" }, s.fetchImpl)).ok).toBe(false);
    expect(s.count()).toBe(1);
  });
  it("retries network errors", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return jsonResponse({ id: "u1" });
    }) as unknown as typeof fetch;
    expect((await run({ operation: "get_me" }, fetchImpl)).ok).toBe(true);
  });
  const map = (s: number, code: string, message = "m") => microsoftTeamsConnector.mapError!(s, { error: { code, message } });
  it("401 → auth", () => expect(map(401, "InvalidAuthenticationToken")).toMatchObject({ kind: "auth", retryable: false }));
  it("403 consent → forbidden with consent hint", () => expect(map(403, "Authorization_RequestDenied", "Insufficient privileges")?.message).toMatch(/consent/));
  it("403 → forbidden", () => expect(map(403, "Forbidden")).toMatchObject({ kind: "forbidden", retryable: false }));
  it("404 → not_found", () => expect(map(404, "NotFound")).toMatchObject({ kind: "not_found" }));
  it("409 → invalid_request", () => expect(map(409, "Conflict")).toMatchObject({ kind: "invalid_request", retryable: false }));
  it("throttle codes → rate_limit", () => expect(map(400, "ApplicationThrottled")).toMatchObject({ kind: "rate_limit", retryable: true }));
  it("5xx → provider", () => expect(map(503, "ServiceUnavailable", "down")).toMatchObject({ kind: "provider", retryable: true }));
  it("permission failures surface through the runtime", async () => {
    const { fetchImpl } = capture({ error: { code: "Forbidden", message: "Missing scope permissions on the request. API requires one of 'ChannelMessage.Read.All'" } }, { status: 403 });
    const r = await run({ operation: "list_channel_messages", params: TC }, fetchImpl);
    expect(!r.ok && r.error.kind).toBe("forbidden");
    expect(!r.ok && r.error.message).toMatch(/ChannelMessage\.Read\.All/);
    expect(r.traceId).toBe(trace);
  });
  it("errors never echo the token", async () => {
    const { fetchImpl } = capture({ error: { code: "x", message: `bad ${TOKEN}` } }, { status: 401 });
    expect(JSON.stringify(await run({ operation: "get_me" }, fetchImpl))).not.toContain(TOKEN);
  });
  it("redact masks bearer tokens", () => expect(JSON.stringify(redact({ authorization: `Bearer ${TOKEN}` }))).not.toContain(TOKEN));
  it("rejects invented idempotency keys", () => expect(() => build("send_chat_message", { chat_id: CHAT, content: "x", idempotency_key: "k" })).toThrow(/UNSUPPORTED_OPERATION/));
});

// ---------------------------------------------------------------------------
describe("teams: change notifications (Graph verifier reuse)", () => {
  const SECRET = "teams-client-state";
  const NOW = Date.parse("2026-01-01T10:00:00Z");
  const note = (over: Record<string, unknown> = {}) => ({
    value: [{ subscriptionId: "sub-1", clientState: SECRET, changeType: "created", resource: `chats('${CHAT}')/messages('171')`, subscriptionExpirationDateTime: "2026-01-01T11:00:00Z", tenantId: creds.tenant_id, ...over }],
  });
  const deliver = (payload: unknown, connector = "microsoft_teams", secret: string | null = SECRET) =>
    verifyWebhook(connector, { raw: JSON.stringify(payload), headers: {}, payload, secret, nowMs: NOW, replayWindowMs: 300_000 });
  it("uses the same verifier as Microsoft Graph", () => {
    const p = note();
    expect(deliver(p)).toEqual(deliver(p, "microsoft_graph"));
  });
  it("accepts a matching clientState", () => expect(deliver(note()).ok).toBe(true));
  it("rejects a wrong clientState", () => expect(deliver(note({ clientState: "other" })).ok).toBe(false));
  it("rejects without a configured secret", () => expect(deliver(note(), "microsoft_teams", null).ok).toBe(false));
  it("works through the alias", () => expect(deliver(note(), "teams").ok).toBe(true));
  it("subscription creation is unsupported (validationToken)", () => expect(() => build("create_subscription")).toThrow(/validationToken/));
});

// ---------------------------------------------------------------------------
describe("teams: isolation", () => {
  it("each connection uses only its own token", async () => {
    const a = capture({ id: "u1" });
    const b = capture({ id: "u2" });
    await run({ operation: "get_me" }, a.fetchImpl, creds);
    await run({ operation: "get_me" }, b.fetchImpl, { access_token: "other-tenant-token", tenant_id: "99999999-0000-0000-0000-000000000000" });
    expect((b.calls[0]!.init.headers as Record<string, string>)["authorization"]).not.toContain(TOKEN);
  });
  it("request bodies never contain credentials", async () => {
    const { fetchImpl, calls } = capture({ id: "1" });
    await run({ operation: "send_chat_message", params: { chat_id: CHAT, content: "x" } }, fetchImpl);
    expect(String(calls[0]!.init.body)).not.toContain(TOKEN);
  });
  it("URLs never contain credentials", () => expect(microsoftTeamsConnector.authorize(build("list_chats"), creds).url).not.toContain(TOKEN));
});
