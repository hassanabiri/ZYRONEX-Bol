import { describe, expect, it, vi } from "vitest";

import {
  GRAPH_API_BASE,
  GRAPH_MAX_SUBSCRIPTION_MINUTES,
  GRAPH_OPERATIONS,
  GRAPH_SCOPES,
  UNSUPPORTED_OPERATIONS,
  graphScopeFor,
  microsoftGraphConnector,
} from "@/lib/connectors/adapters/microsoft-graph";
import { graphNotificationEventId, normalizeGraphEvent, normalizeGraphMessage, parseGraphNotifications } from "@/lib/connectors/adapters/microsoft-graph-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { assertCanExecute } from "@/lib/execution/guard.server";
import { beginAuthorization, completeAuthorization, ensureAccessToken, hashState } from "@/lib/oauth/core";
import { getOAuthProvider } from "@/lib/oauth/providers";
import type { ConnectionAccount, OAuthStore, OAuthTokenSet, PendingAuthorization } from "@/lib/oauth/types";
import { verifyWebhook } from "@/lib/webhooks/verify";

const trace = "trace-graph";
const TOKEN = "EwBwA8l6BAAUGraphAccessTokenAAAA1111";
const TOKEN_B = "EwBwA8l6BAAUGraphAccessTokenBBBB2222";
const REFRESH = "M.C507_BAY.0.U.GraphRefreshTokenXYZ";
const CLIENT_STATE = "zyronex-graph-client-state-5b1d";
const TENANT_A = "11111111-1111-1111-1111-111111111111";
const TENANT_B = "22222222-2222-2222-2222-222222222222";
const creds = { access_token: TOKEN };
const NOW = 1_700_000_100_000;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const status = init.status ?? 200;
  return new Response(body === null || status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
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
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    return responses[Math.min(i++, responses.length - 1)]!();
  }) as unknown as typeof fetch;
  return { fetchImpl, count: () => i, calls };
}
function run(
  input: Parameters<typeof runConnectorOperation>[0]["input"],
  fetchImpl: typeof fetch,
  credentials: Record<string, string> = creds,
  extra: Partial<Parameters<typeof runConnectorOperation>[0]> = {},
) {
  return runConnectorOperation({ adapter: microsoftGraphConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {}, ...extra });
}
const body = (call: { init: RequestInit } | undefined) => JSON.parse(String(call?.init.body ?? "{}")) as Record<string, unknown>;
const headerOf = (call: { init: RequestInit } | undefined, name: string) => (call?.init.headers as Record<string, string> | undefined)?.[name];
const gErr = (code: string, message: string) => ({ error: { code, message, innerError: { "request-id": "r1" } } });
const url = (call: { url: string } | undefined) => new URL(call!.url);

const MESSAGE = {
  id: "AAMk1",
  conversationId: "AAQk1",
  internetMessageId: "<abc@contoso.com>",
  parentFolderId: "inbox-id",
  subject: "Quote",
  bodyPreview: "hello",
  body: { contentType: "html", content: "<p>hello</p>" },
  from: { emailAddress: { name: "Ali", address: "ali@contoso.com" } },
  toRecipients: [{ emailAddress: { name: "Me", address: "me@contoso.com" } }],
  ccRecipients: [],
  isRead: false,
  isDraft: false,
  hasAttachments: true,
  importance: "normal",
  receivedDateTime: "2026-09-01T10:00:00Z",
  flag: { flagStatus: "notFlagged" },
};
const EVENT = {
  id: "AAMkE1",
  iCalUId: "ical-1",
  subject: "Sync",
  type: "seriesMaster",
  start: { dateTime: "2026-10-01T09:00:00.0000000", timeZone: "Arab Standard Time" },
  end: { dateTime: "2026-10-01T09:30:00.0000000", timeZone: "Arab Standard Time" },
  attendees: [{ emailAddress: { address: "a@contoso.com", name: "A" }, type: "required", status: { response: "accepted" } }],
  recurrence: { pattern: { type: "weekly", interval: 1, daysOfWeek: ["monday"] }, range: { type: "noEnd", startDate: "2026-10-01" } },
  isReminderOn: true,
  reminderMinutesBeforeStart: 15,
  isOnlineMeeting: true,
  onlineMeetingProvider: "teamsForBusiness",
  onlineMeeting: { joinUrl: "https://teams.microsoft.com/l/meetup-join/x" },
  organizer: { emailAddress: { address: "me@contoso.com" } },
  transactionId: "idem-1",
};

function requiredParams(): Record<string, unknown> {
  return {
    message_id: "m1", draft_id: "d1", folder_id: "f1", attachment_id: "a1", destination_id: "archive", calendar_id: "c1",
    event_id: "e1", contact_id: "k1", subscription_id: "s1", to: "x@contoso.com", search: "invoice", conversation_id: "conv1",
    display_name: "N", name: "N", content_bytes: Buffer.from("hi").toString("base64"), subject: "S", text: "t",
    start: "2026-10-01T09:00:00", end: "2026-10-01T10:00:00", start_date_time: "2026-10-01T00:00:00Z", end_date_time: "2026-10-08T00:00:00Z",
    new_reminder_time: "2026-10-01T08:55:00", given_name: "G", change_type: "created", notification_url: "https://app.test/api/public/webhooks/x",
    resource: "me/mailFolders('inbox')/messages", expiration_date_time: new Date(Date.now() + 3600_000).toISOString(), client_state: CLIENT_STATE,
  };
}

function idToken(claims: Record<string, unknown>) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "RS256", typ: "JWT" })}.${b(claims)}.sig`;
}
function notification(overrides: Record<string, unknown> = {}) {
  return {
    subscriptionId: "sub-1",
    subscriptionExpirationDateTime: new Date(NOW + 3600_000).toISOString(),
    changeType: "created",
    resource: "Users/uid/Messages/AAMk1",
    resourceData: { "@odata.type": "#Microsoft.Graph.Message", "@odata.id": "Users/uid/Messages/AAMk1", "@odata.etag": 'W/"CQAAABYAAA"', id: "AAMk1" },
    clientState: CLIENT_STATE,
    tenantId: TENANT_A,
    ...overrides,
  };
}
function verifyNotify(payload: unknown, opts: { secret?: string | null; nowMs?: number } = {}) {
  return verifyWebhook("microsoft_graph", {
    raw: JSON.stringify(payload ?? ""),
    headers: { "content-type": "application/json" },
    payload,
    secret: opts.secret === undefined ? CLIENT_STATE : opts.secret,
    nowMs: opts.nowMs ?? NOW,
    replayWindowMs: 300_000,
  });
}

function memoryStore() {
  const states = new Map<string, PendingAuthorization & { stateHash: string; expiresAt: string; used?: boolean }>();
  const accounts = new Map<string, ConnectionAccount>();
  const tokens = new Map<string, OAuthTokenSet>();
  let seq = 0;
  const store = {
    saveState: async (s: PendingAuthorization & { stateHash: string; expiresAt: string }) => void states.set(s.stateHash, { ...s }),
    consumeState: async (hash: string, nowMs: number) => {
      const row = states.get(hash);
      if (!row || row.used || new Date(row.expiresAt).getTime() <= nowMs) return null;
      row.used = true;
      return row;
    },
    upsertAccount: async (input: Omit<ConnectionAccount, "id" | "refreshFailures"> & { tokens: OAuthTokenSet }) => {
      const existing = [...accounts.values()].find(
        (a) => a.workspaceId === input.workspaceId && a.provider === input.provider && a.accountIdentifier === input.accountIdentifier,
      );
      const { tokens: t, ...rest } = input;
      const account: ConnectionAccount = { ...rest, id: existing?.id ?? `acc-${++seq}`, refreshFailures: 0 } as ConnectionAccount;
      accounts.set(account.id, account);
      tokens.set(account.id, t);
      return account;
    },
    getAccount: async (ws: string, id: string) => {
      const a = accounts.get(id);
      return a && a.workspaceId === ws ? a : null;
    },
    readTokens: async (id: string) => tokens.get(id) ?? null,
    writeTokens: async (id: string, t: OAuthTokenSet) => void tokens.set(id, t),
    updateAccount: async (id: string, patch: Partial<ConnectionAccount>) => void accounts.set(id, { ...accounts.get(id)!, ...patch }),
    acquireRefreshLock: async () => true,
    releaseRefreshLock: async () => {},
  } as unknown as OAuthStore;
  return { store, accounts, tokens, states };
}
const pending = (ws = "ws1") => ({
  workspaceId: ws, integrationId: null, provider: "microsoft_graph", connector: "microsoft_graph", redirectUri: "https://app.test/cb", createdBy: null,
});
async function connect(ws = "ws1", opts: { tid?: string; oid?: string; mem?: ReturnType<typeof memoryStore> } = {}) {
  const spec = getOAuthProvider("microsoft_graph")!;
  const mem = opts.mem ?? memoryStore();
  const { state, authorizationUrl } = await beginAuthorization({ store: mem.store, spec, clientId: "cid", pending: pending(ws), nowMs: NOW });
  const { calls, fetchImpl } = capture({
    access_token: TOKEN, refresh_token: REFRESH, expires_in: 3599, token_type: "Bearer", scope: spec.scopes.join(" "),
    id_token: idToken({ tid: opts.tid ?? TENANT_A, oid: opts.oid ?? "oid-1", preferred_username: "me@contoso.com", name: "Me" }),
  });
  const { account } = await completeAuthorization({ store: mem.store, spec, client: { clientId: "cid", clientSecret: "shh" }, state, code: "c1", fetchImpl, nowMs: NOW });
  return { ...mem, spec, account, state, authorizationUrl, tokenCalls: calls };
}
function rbacClient(role: string | null) {
  const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: role ? { role } : null, error: null }) };
  return { from: () => chain } as unknown as Parameters<typeof assertCanExecute>[0];
}

// ---------------------------------------------------------------------------
describe("microsoft graph registration", () => {
  it("is registered under microsoft_graph as oauth2", () => {
    expect(getConnector("microsoft_graph")?.id).toBe("microsoft_graph");
    const d = describeConnectors().find((c) => c.id === "microsoft_graph");
    expect(d?.authKind).toBe("oauth2");
    expect(d?.requiredCredentials).toEqual(["access_token"]);
  });
  for (const alias of ["outlook", "microsoft_outlook", "microsoft_365", "microsoft_calendar"])
    it(`resolves catalog id ${alias} to the single Graph connector`, () => {
      expect(getConnector(alias)?.id).toBe("microsoft_graph");
      expect(getOAuthProvider(alias)?.connector).toBe("microsoft_graph");
    });
  it("leaves gmail/google/slack untouched", () => {
    expect(getConnector("google_mail")?.id).toBe("google_mail");
    expect(getConnector("gmail")?.id).toBe("google");
    expect(getConnector("slack")?.id).toBe("slack");
    expect(getOAuthProvider("google_mail")?.tokenUrl).toBe("https://oauth2.googleapis.com/token");
  });
  it("declares calendar + webhook capabilities and a health op", () => {
    expect(microsoftGraphConnector.capabilities).toEqual(expect.arrayContaining(["calendar", "webhook", "messaging", "health_check"]));
    expect(microsoftGraphConnector.healthOperation).toBe("get_me");
  });
  it("never overlaps supported and unsupported operations", () => {
    for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) expect(GRAPH_OPERATIONS).not.toContain(op);
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph oauth", () => {
  it("uses the multi-tenant common authority with PKCE and state", async () => {
    const { authorizationUrl, states } = await connect();
    const u = new URL(authorizationUrl);
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBeTruthy();
    expect(u.searchParams.get("state")).toBeTruthy();
    expect(states.size).toBe(1);
  });
  it("stores only a hash of the state", async () => {
    const spec = getOAuthProvider("microsoft_graph")!;
    const mem = memoryStore();
    const { state } = await beginAuthorization({ store: mem.store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    expect(mem.states.has(hashState(state))).toBe(true);
    expect(mem.states.has(state)).toBe(false);
  });
  it("requests offline_access and least-privilege scopes, no admin scopes", () => {
    const scopes = getOAuthProvider("microsoft_graph")!.scopes;
    expect(scopes).toContain("offline_access");
    expect(scopes).toEqual(expect.arrayContaining(["User.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Contacts.ReadWrite"]));
    expect(scopes.some((s) => /\.All$|Directory|Sites|Files|OnlineMeetings|Mail\.ReadWrite\.Shared/.test(s))).toBe(false);
  });
  it("space-separates scopes in the authorization url", async () => {
    const { authorizationUrl } = await connect();
    expect(new URL(authorizationUrl).searchParams.get("scope")).toContain("offline_access User.Read");
  });
  it("sends the PKCE verifier on token exchange to the common token endpoint", async () => {
    const { tokenCalls } = await connect();
    expect(tokenCalls[0]!.url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(String(tokenCalls[0]!.init.body)).toContain("code_verifier=");
    expect(String(tokenCalls[0]!.init.body)).toContain("grant_type=authorization_code");
  });
  it("identifies the account as tenant:object id", async () => {
    const { account } = await connect();
    expect(account.accountIdentifier).toBe(`${TENANT_A}:oid-1`);
    expect(account.accountLabel).toBe("me@contoso.com");
  });
  it("keeps the tenant id with the encrypted token set", async () => {
    const { tokens, account } = await connect();
    expect(JSON.stringify(tokens.get(account.id))).toContain(TENANT_A);
  });
  it("records the refresh token and expiry", async () => {
    const { tokens, account } = await connect();
    const t = tokens.get(account.id)!;
    expect(t.refreshToken).toBe(REFRESH);
    expect(t.expiresAt).toBeTruthy();
  });
  it("rejects a replayed state", async () => {
    const { store, spec, state } = await connect();
    await expect(
      completeAuthorization({ store, spec, client: { clientId: "cid", clientSecret: "s" }, state, code: "c2", fetchImpl: capture({}).fetchImpl, nowMs: NOW }),
    ).rejects.toThrow();
  });
  it("rejects an unknown state", async () => {
    const spec = getOAuthProvider("microsoft_graph")!;
    const { store } = memoryStore();
    await expect(
      completeAuthorization({ store, spec, client: { clientId: "cid", clientSecret: "s" }, state: "forged", code: "c", fetchImpl: capture({}).fetchImpl, nowMs: NOW }),
    ).rejects.toThrow();
  });
  it("uses a fresh token without calling Microsoft", async () => {
    const { store, spec, account } = await connect();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW });
    expect(r.token).toBe(TOKEN);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refreshes an expired token and stores the rotated refresh token", async () => {
    const { store, spec, account, tokens } = await connect();
    const { calls, fetchImpl } = capture({ access_token: TOKEN_B, refresh_token: "rotated-refresh-token-xyz", expires_in: 3599, token_type: "Bearer" });
    const r = await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW + 2 * 3600_000 });
    expect(r.refreshed).toBe(true);
    expect(r.token).toBe(TOKEN_B);
    expect(calls[0]!.url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(String(calls[0]!.init.body)).toContain("grant_type=refresh_token");
    expect(tokens.get(account.id)?.refreshToken).toBe("rotated-refresh-token-xyz");
  });
  it("fails the refresh on invalid_grant (AADSTS70008)", async () => {
    const { store, spec, account } = await connect();
    const { fetchImpl } = capture({ error: "invalid_grant", error_description: "AADSTS70008: The refresh token has expired" }, { status: 400 });
    await expect(ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW + 2 * 3600_000 })).rejects.toThrow();
  });
  it("has no revoke endpoint (Graph offers none for delegated tokens)", () => {
    expect(getOAuthProvider("microsoft_graph")!.revokeUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph tenant / workspace isolation", () => {
  it("keeps the same user in two tenants as two accounts", async () => {
    const mem = memoryStore();
    const a = await connect("ws1", { tid: TENANT_A, mem });
    const b = await connect("ws1", { tid: TENANT_B, mem });
    expect(a.account.id).not.toBe(b.account.id);
  });
  it("reconnecting the same tenant+user updates one account", async () => {
    const mem = memoryStore();
    const a = await connect("ws1", { mem });
    const b = await connect("ws1", { mem });
    expect(a.account.id).toBe(b.account.id);
  });
  it("scopes accounts to their workspace", async () => {
    const mem = memoryStore();
    const a = await connect("ws1", { mem });
    const b = await connect("ws2", { mem });
    expect(a.account.id).not.toBe(b.account.id);
    expect(await mem.store.getAccount("ws2", a.account.id)).toBeNull();
    expect(await mem.store.getAccount("ws1", a.account.id)).not.toBeNull();
  });
  it("uses only the credentials passed for this run", async () => {
    const { calls, fetchImpl } = capture({ id: "u" });
    await run({ operation: "get_me" }, fetchImpl, { access_token: TOKEN_B });
    expect(headerOf(calls[0], "authorization")).toBe(`Bearer ${TOKEN_B}`);
  });
  it("fails before any request when the account has no token", async () => {
    const { fetchImpl } = capture({});
    const r = await run({ operation: "get_me" }, fetchImpl, {});
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  for (const role of ["owner", "admin", "member"])
    it(`RBAC allows ${role}`, async () => {
      await expect(assertCanExecute(rbacClient(role), "ws1", "u1")).resolves.toBe(role);
    });
  for (const role of ["viewer", null])
    it(`RBAC blocks ${role ?? "non-members"}`, async () => {
      await expect(assertCanExecute(rbacClient(role), "ws1", "u1")).rejects.toThrow(/permission/);
    });
});

// ---------------------------------------------------------------------------
describe("microsoft graph identity / health", () => {
  it("reads /me and normalizes the user", async () => {
    const { calls, fetchImpl } = capture({ id: "oid-1", displayName: "Me", mail: "me@contoso.com", userPrincipalName: "me@contoso.com" });
    const r = await run({ operation: "get_me" }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me`);
    expect(r.ok && r.items[0]).toMatchObject({ id: "oid-1", mail: "me@contoso.com", user_principal_name: "me@contoso.com" });
  });
  it("reads tenant information from /organization", async () => {
    const { calls, fetchImpl } = capture({ value: [{ id: TENANT_A, displayName: "Contoso", verifiedDomains: [{ name: "contoso.com" }] }] });
    const r = await run({ operation: "get_organization" }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/organization`);
    expect(r.ok && r.items[0]).toMatchObject({ tenant_id: TENANT_A, verified_domains: ["contoso.com"] });
  });
  it("reports healthy on /me", async () => {
    const h = await checkConnectorHealth({ adapter: microsoftGraphConnector, credentials: creds, traceId: trace, fetchImpl: capture({ id: "x" }).fetchImpl });
    expect(h.healthy).toBe(true);
  });
  it("reports unhealthy on 401 without leaking the token", async () => {
    const h = await checkConnectorHealth({
      adapter: microsoftGraphConnector, credentials: creds, traceId: trace,
      fetchImpl: capture(gErr("InvalidAuthenticationToken", `bad ${TOKEN}`), { status: 401 }).fetchImpl,
    });
    expect(h.healthy).toBe(false);
    expect(JSON.stringify(h)).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph messages", () => {
  it("lists messages with $top and $filter", async () => {
    const { calls, fetchImpl } = capture({ value: [MESSAGE] });
    const r = await run({ operation: "list_messages", params: { filter: "isRead eq false", limit: 10 } }, fetchImpl);
    const u = url(calls[0]);
    expect(u.pathname).toBe("/v1.0/me/messages");
    expect(u.searchParams.get("$top")).toBe("10");
    expect(u.searchParams.get("$filter")).toBe("isRead eq false");
    expect(r.ok && r.items[0]).toMatchObject({ id: "AAMk1", conversation_id: "AAQk1", is_read: false, from: { address: "ali@contoso.com" } });
  });
  it("caps $top at 1000", async () => {
    const { calls, fetchImpl } = capture({ value: [] });
    await run({ operation: "list_messages", params: { limit: 99999 } }, fetchImpl);
    expect(url(calls[0]).searchParams.get("$top")).toBe("1000");
  });
  it("gets one message", async () => {
    const { calls, fetchImpl } = capture(MESSAGE);
    const r = await run({ operation: "get_message", params: { message_id: "AAMk1", select: ["subject", "from"] } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/messages/AAMk1");
    expect(url(calls[0]).searchParams.get("$select")).toBe("subject,from");
    expect(r.ok && r.items[0]?.["subject"]).toBe("Quote");
  });
  it("url-encodes message ids", async () => {
    const { calls, fetchImpl } = capture(MESSAGE);
    await run({ operation: "get_message", params: { message_id: "AA/Mk+1=" } }, fetchImpl);
    expect(calls[0]!.url).toContain("/me/messages/AA%2FMk%2B1%3D");
  });
  it("sends mail with the official JSON message resource (202, no body)", async () => {
    const { calls, fetchImpl } = capture(null, { status: 202 });
    const r = await run({ operation: "send_mail", params: { to: ["a@contoso.com", "b@contoso.com"], cc: "c@contoso.com", subject: "Hi", html: "<b>x</b>" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/sendMail`);
    const b = body(calls[0]);
    expect(b["saveToSentItems"]).toBe(true);
    expect(b["message"]).toMatchObject({
      subject: "Hi",
      body: { contentType: "HTML", content: "<b>x</b>" },
      toRecipients: [{ emailAddress: { address: "a@contoso.com" } }, { emailAddress: { address: "b@contoso.com" } }],
      ccRecipients: [{ emailAddress: { address: "c@contoso.com" } }],
    });
    expect(r.ok && r.items[0]).toEqual({ ok: true, operation: "send_mail" });
  });
  it("sends a plain text body", async () => {
    const { calls, fetchImpl } = capture(null, { status: 202 });
    await run({ operation: "send_mail", params: { to: "a@contoso.com", text: "plain" } }, fetchImpl);
    expect((body(calls[0])["message"] as Record<string, unknown>)["body"]).toEqual({ contentType: "Text", content: "plain" });
  });
  it("sends small inline attachments as fileAttachment", async () => {
    const { calls, fetchImpl } = capture(null, { status: 202 });
    await run({ operation: "send_mail", params: { to: "a@contoso.com", text: "x", attachments: [{ name: "a.txt", content_bytes: "aGk=", content_type: "text/plain" }] } }, fetchImpl);
    const att = ((body(calls[0])["message"] as Record<string, unknown>)["attachments"] as Record<string, unknown>[])[0];
    expect(att).toEqual({ "@odata.type": "#microsoft.graph.fileAttachment", name: "a.txt", contentBytes: "aGk=", contentType: "text/plain" });
  });
  it("rejects attachments above 3 MB as UNSUPPORTED_OPERATION", async () => {
    const big = "A".repeat(4.2 * 1024 * 1024);
    const { fetchImpl } = capture(null, { status: 202 });
    const r = await run({ operation: "send_mail", params: { to: "a@contoso.com", attachments: [{ name: "big.bin", content_bytes: big }] } }, fetchImpl);
    expect(!r.ok && r.error.kind).toBe("unsupported");
    expect(!r.ok && r.error.message).toContain("UNSUPPORTED_OPERATION");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("can skip saving to Sent Items", async () => {
    const { calls, fetchImpl } = capture(null, { status: 202 });
    await run({ operation: "send_mail", params: { to: "a@contoso.com", save_to_sent_items: false } }, fetchImpl);
    expect(body(calls[0])["saveToSentItems"]).toBe(false);
  });
  it("replies with the official comment", async () => {
    const { calls, fetchImpl } = capture(null, { status: 202 });
    await run({ operation: "reply_message", params: { message_id: "m1", comment: "Thanks" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/messages/m1/reply`);
    expect(body(calls[0])).toEqual({ comment: "Thanks" });
  });
  it("replies to all", async () => {
    const { calls, fetchImpl } = capture(null, { status: 202 });
    await run({ operation: "reply_all_message", params: { message_id: "m1", comment: "All" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/messages/m1/replyAll`);
  });
  it("forwards with toRecipients", async () => {
    const { calls, fetchImpl } = capture(null, { status: 202 });
    await run({ operation: "forward_message", params: { message_id: "m1", to: "z@contoso.com", comment: "FYI" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/messages/m1/forward`);
    expect(body(calls[0])).toEqual({ comment: "FYI", toRecipients: [{ emailAddress: { address: "z@contoso.com" } }] });
  });
  it("requires recipients to forward", async () => {
    const r = await run({ operation: "forward_message", params: { message_id: "m1" } }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("updates message fields with PATCH", async () => {
    const { calls, fetchImpl } = capture({ ...MESSAGE, importance: "high", categories: ["Red"] });
    const r = await run({ operation: "update_message", params: { message_id: "m1", importance: "high", categories: ["Red"], flag_status: "flagged" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(body(calls[0])).toEqual({ importance: "high", categories: ["Red"], flag: { flagStatus: "flagged" } });
    expect(r.ok && r.items[0]?.["importance"]).toBe("high");
  });
  it("refuses an empty update", async () => {
    const r = await run({ operation: "update_message", params: { message_id: "m1" } }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("marks read", async () => {
    const { calls, fetchImpl } = capture({ ...MESSAGE, isRead: true });
    await run({ operation: "mark_read", params: { message_id: "m1" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ isRead: true });
  });
  it("marks unread", async () => {
    const { calls, fetchImpl } = capture(MESSAGE);
    await run({ operation: "mark_unread", params: { message_id: "m1" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ isRead: false });
  });
  it("moves a message by destinationId (well-known names allowed)", async () => {
    const { calls, fetchImpl } = capture({ ...MESSAGE, id: "new-id" });
    const r = await run({ operation: "move_message", params: { message_id: "m1", destination_id: "archive" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/messages/m1/move`);
    expect(body(calls[0])).toEqual({ destinationId: "archive" });
    expect(r.ok && r.items[0]?.["id"]).toBe("new-id");
  });
  it("copies a message", async () => {
    const { calls, fetchImpl } = capture(MESSAGE);
    await run({ operation: "copy_message", params: { message_id: "m1", destination_id: "f2" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/messages/m1/copy`);
  });
  it("deletes (moves to Deleted Items) with DELETE", async () => {
    const { calls, fetchImpl } = capture(null, { status: 204 });
    const r = await run({ operation: "delete_message", params: { message_id: "m1" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("DELETE");
    expect(r.ok).toBe(true);
  });
  it("permanently deletes via the official permanentDelete action", async () => {
    const { calls, fetchImpl } = capture(null, { status: 204 });
    await run({ operation: "permanent_delete_message", params: { message_id: "m1" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/messages/m1/permanentDelete`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBeUndefined();
  });
  it("classifies restore/undelete as UNSUPPORTED_OPERATION", () => {
    expect(() => microsoftGraphConnector.buildCall({ operation: "restore_message" })).toThrow(/UNSUPPORTED_OPERATION/);
  });
  it("restores in practice by moving out of deleteditems", async () => {
    const { calls, fetchImpl } = capture(MESSAGE);
    await run({ operation: "move_message", params: { message_id: "m1", destination_id: "inbox" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ destinationId: "inbox" });
  });
  it("reads a conversation with the official conversationId filter", async () => {
    const { calls, fetchImpl } = capture({ value: [MESSAGE] });
    await run({ operation: "list_conversation_messages", params: { conversation_id: "AAQk'1" } }, fetchImpl);
    expect(url(calls[0]).searchParams.get("$filter")).toBe("conversationId eq 'AAQk''1'");
  });
  it("requires a message id", async () => {
    const r = await run({ operation: "get_message", params: {} }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph search", () => {
  it("uses the official quoted $search parameter", async () => {
    const { calls, fetchImpl } = capture({ value: [MESSAGE] });
    await run({ operation: "search_messages", params: { search: "subject:invoice" } }, fetchImpl);
    expect(url(calls[0]).searchParams.get("$search")).toBe('"subject:invoice"');
  });
  it("keeps an already-quoted search unchanged", async () => {
    const { calls, fetchImpl } = capture({ value: [] });
    await run({ operation: "search_messages", params: { search: '"a b"' } }, fetchImpl);
    expect(url(calls[0]).searchParams.get("$search")).toBe('"a b"');
  });
  it("requires a query", async () => {
    const r = await run({ operation: "search_messages" }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("searches only the signed-in mailbox (/me)", async () => {
    const { calls, fetchImpl } = capture({ value: [] });
    await run({ operation: "search_messages", params: { search: "x" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/messages");
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph folders", () => {
  it("lists mail folders", async () => {
    const { calls, fetchImpl } = capture({ value: [{ id: "f1", displayName: "Inbox", unreadItemCount: 3, totalItemCount: 9 }] });
    const r = await run({ operation: "list_mail_folders" }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/mailFolders");
    expect(r.ok && r.items[0]).toMatchObject({ id: "f1", display_name: "Inbox", unread_item_count: 3 });
  });
  it("lists child folders", async () => {
    const { calls, fetchImpl } = capture({ value: [] });
    await run({ operation: "list_mail_folders", params: { parent_folder_id: "p1" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/mailFolders/p1/childFolders");
  });
  it("includes hidden folders when asked", async () => {
    const { calls, fetchImpl } = capture({ value: [] });
    await run({ operation: "list_mail_folders", params: { include_hidden: true } }, fetchImpl);
    expect(url(calls[0]).searchParams.get("includeHiddenFolders")).toBe("true");
  });
  it("gets a folder", async () => {
    const { calls, fetchImpl } = capture({ id: "inbox" });
    await run({ operation: "get_mail_folder", params: { folder_id: "inbox" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/mailFolders/inbox");
  });
  it("creates a folder", async () => {
    const { calls, fetchImpl } = capture({ id: "f9", displayName: "Clients" });
    await run({ operation: "create_mail_folder", params: { display_name: "Clients" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ displayName: "Clients" });
  });
  it("creates a child folder", async () => {
    const { calls, fetchImpl } = capture({ id: "f9" });
    await run({ operation: "create_mail_folder", params: { display_name: "Sub", parent_folder_id: "f1" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/mailFolders/f1/childFolders");
  });
  it("renames a folder", async () => {
    const { calls, fetchImpl } = capture({ id: "f1", displayName: "Renamed" });
    await run({ operation: "update_mail_folder", params: { folder_id: "f1", display_name: "Renamed" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(body(calls[0])).toEqual({ displayName: "Renamed" });
  });
  it("deletes a folder", async () => {
    const { calls, fetchImpl } = capture(null, { status: 204 });
    await run({ operation: "delete_mail_folder", params: { folder_id: "f1" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("DELETE");
  });
  it("lists messages inside a folder", async () => {
    const { calls, fetchImpl } = capture({ value: [MESSAGE] });
    await run({ operation: "list_folder_messages", params: { folder_id: "inbox" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/mailFolders/inbox/messages");
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph drafts", () => {
  it("lists drafts from the well-known drafts folder", async () => {
    const { calls, fetchImpl } = capture({ value: [{ ...MESSAGE, isDraft: true }] });
    const r = await run({ operation: "list_drafts" }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/mailFolders/drafts/messages");
    expect(r.ok && r.items[0]?.["is_draft"]).toBe(true);
  });
  it("creates a draft", async () => {
    const { calls, fetchImpl } = capture({ ...MESSAGE, isDraft: true });
    await run({ operation: "create_draft", params: { to: "a@contoso.com", subject: "Draft" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/messages`);
    expect(body(calls[0])).toMatchObject({ subject: "Draft", toRecipients: [{ emailAddress: { address: "a@contoso.com" } }] });
  });
  it("gets a draft", async () => {
    const { calls, fetchImpl } = capture(MESSAGE);
    await run({ operation: "get_draft", params: { draft_id: "d1" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/messages/d1");
  });
  it("updates a draft", async () => {
    const { calls, fetchImpl } = capture(MESSAGE);
    await run({ operation: "update_draft", params: { draft_id: "d1", subject: "v2" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(body(calls[0])).toEqual({ subject: "v2" });
  });
  it("sends a draft without a body", async () => {
    const { calls, fetchImpl } = capture(null, { status: 202 });
    await run({ operation: "send_draft", params: { draft_id: "d1" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/messages/d1/send`);
    expect(calls[0]!.init.body).toBeUndefined();
  });
  it("deletes a draft", async () => {
    const { calls, fetchImpl } = capture(null, { status: 204 });
    await run({ operation: "delete_draft", params: { draft_id: "d1" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("DELETE");
  });
  for (const [op, action] of [["create_reply_draft", "createReply"], ["create_reply_all_draft", "createReplyAll"], ["create_forward_draft", "createForward"]] as const)
    it(`${op} uses ${action}`, async () => {
      const { calls, fetchImpl } = capture({ ...MESSAGE, isDraft: true });
      await run({ operation: op, params: { message_id: "m1" } }, fetchImpl);
      expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/messages/m1/${action}`);
    });
});

// ---------------------------------------------------------------------------
describe("microsoft graph attachments", () => {
  it("lists attachment metadata", async () => {
    const { calls, fetchImpl } = capture({ value: [{ "@odata.type": "#microsoft.graph.fileAttachment", id: "a1", name: "q.pdf", contentType: "application/pdf", size: 2048, isInline: false }] });
    const r = await run({ operation: "list_attachments", params: { message_id: "m1", select: "id,name,size,contentType" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/messages/m1/attachments");
    expect(r.ok && r.items[0]).toMatchObject({ id: "a1", name: "q.pdf", size: 2048, content_type: "application/pdf" });
    expect(r.ok && r.items[0]).not.toHaveProperty("content_bytes");
  });
  it("gets an attachment with base64 contentBytes in JSON", async () => {
    const { fetchImpl } = capture({ id: "a1", name: "a.txt", contentBytes: "aGk=", size: 2 });
    const r = await run({ operation: "get_attachment", params: { message_id: "m1", attachment_id: "a1" } }, fetchImpl);
    expect(r.ok && r.items[0]?.["content_bytes"]).toBe("aGk=");
  });
  it("adds a small attachment to a draft", async () => {
    const { calls, fetchImpl } = capture({ id: "a2", name: "n.txt" });
    await run({ operation: "add_attachment", params: { message_id: "d1", name: "n.txt", content_bytes: "aGk=" } }, fetchImpl);
    expect(body(calls[0])).toMatchObject({ "@odata.type": "#microsoft.graph.fileAttachment", name: "n.txt", contentBytes: "aGk=" });
  });
  it("deletes an attachment", async () => {
    const { calls, fetchImpl } = capture(null, { status: 204 });
    await run({ operation: "delete_attachment", params: { message_id: "d1", attachment_id: "a1" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("DELETE");
  });
  for (const op of ["large_attachment_upload_session", "attachment_raw_download", "message_mime_content"])
    it(`${op} is UNSUPPORTED_OPERATION`, () => {
      expect(() => microsoftGraphConnector.buildCall({ operation: op })).toThrow(/UNSUPPORTED_OPERATION/);
    });
});

// ---------------------------------------------------------------------------
describe("microsoft graph calendars", () => {
  it("lists calendars", async () => {
    const { fetchImpl } = capture({ value: [{ id: "c1", name: "Calendar", isDefaultCalendar: true, canEdit: true, owner: { address: "me@contoso.com" } }] });
    const r = await run({ operation: "list_calendars" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "c1", is_default: true, owner: "me@contoso.com" });
  });
  it("gets a calendar", async () => {
    const { calls, fetchImpl } = capture({ id: "c1" });
    await run({ operation: "get_calendar", params: { calendar_id: "c1" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/calendars/c1");
  });
  it("creates a calendar", async () => {
    const { calls, fetchImpl } = capture({ id: "c2", name: "Team" });
    await run({ operation: "create_calendar", params: { name: "Team", color: "lightBlue" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ name: "Team", color: "lightBlue" });
  });
  it("updates a calendar", async () => {
    const { calls, fetchImpl } = capture({ id: "c2" });
    await run({ operation: "update_calendar", params: { calendar_id: "c2", name: "New" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("PATCH");
  });
  it("refuses an empty calendar update", async () => {
    const r = await run({ operation: "update_calendar", params: { calendar_id: "c2" } }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("deletes a calendar", async () => {
    const { calls, fetchImpl } = capture(null, { status: 204 });
    await run({ operation: "delete_calendar", params: { calendar_id: "c2" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph events", () => {
  it("lists events on the default calendar", async () => {
    const { calls, fetchImpl } = capture({ value: [EVENT] });
    const r = await run({ operation: "list_events" }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/events");
    expect(r.ok && r.items[0]).toMatchObject({ id: "AAMkE1", online_meeting_url: "https://teams.microsoft.com/l/meetup-join/x", reminder_minutes_before_start: 15 });
  });
  it("lists events on a specific calendar", async () => {
    const { calls, fetchImpl } = capture({ value: [] });
    await run({ operation: "list_events", params: { calendar_id: "c1" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/calendars/c1/events");
  });
  it("reads a calendar view for a time range", async () => {
    const { calls, fetchImpl } = capture({ value: [EVENT] });
    await run({ operation: "calendar_view", params: { start_date_time: "2026-10-01T00:00:00Z", end_date_time: "2026-10-08T00:00:00Z" } }, fetchImpl);
    const u = url(calls[0]);
    expect(u.pathname).toBe("/v1.0/me/calendarView");
    expect(u.searchParams.get("startDateTime")).toBe("2026-10-01T00:00:00Z");
  });
  it("sets the official Prefer outlook.timezone header", async () => {
    const { calls, fetchImpl } = capture({ value: [] });
    await run({ operation: "list_events", params: { time_zone: "Arab Standard Time" } }, fetchImpl);
    expect(headerOf(calls[0], "prefer")).toBe('outlook.timezone="Arab Standard Time"');
  });
  it("gets an event", async () => {
    const { fetchImpl } = capture(EVENT);
    const r = await run({ operation: "get_event", params: { event_id: "AAMkE1" } }, fetchImpl);
    expect(r.ok && r.items[0]?.["start"]).toEqual({ date_time: "2026-10-01T09:00:00.0000000", time_zone: "Arab Standard Time" });
  });
  it("creates an event with attendees, reminders and timezone", async () => {
    const { calls, fetchImpl } = capture(EVENT, { status: 201 });
    await run({
      operation: "create_event",
      params: {
        subject: "Sync", start: "2026-10-01T09:00:00", end: "2026-10-01T09:30:00", time_zone: "Arab Standard Time",
        attendees: ["a@contoso.com", { address: "b@contoso.com", name: "B", type: "optional" }], location: "Room 1",
        is_reminder_on: true, reminder_minutes_before_start: 15, text: "Agenda",
      },
    }, fetchImpl);
    expect(body(calls[0])).toMatchObject({
      subject: "Sync",
      start: { dateTime: "2026-10-01T09:00:00", timeZone: "Arab Standard Time" },
      end: { dateTime: "2026-10-01T09:30:00", timeZone: "Arab Standard Time" },
      attendees: [
        { emailAddress: { address: "a@contoso.com" }, type: "required" },
        { emailAddress: { address: "b@contoso.com", name: "B" }, type: "optional" },
      ],
      location: { displayName: "Room 1" },
      isReminderOn: true,
      reminderMinutesBeforeStart: 15,
      body: { contentType: "Text", content: "Agenda" },
    });
  });
  it("defaults the timezone to UTC when none is given", async () => {
    const { calls, fetchImpl } = capture(EVENT);
    await run({ operation: "create_event", params: { subject: "S", start: "2026-10-01T09:00:00", end: "2026-10-01T10:00:00" } }, fetchImpl);
    expect((body(calls[0])["start"] as Record<string, unknown>)["timeZone"]).toBe("UTC");
  });
  it("passes the official recurrence pattern + range", async () => {
    const { calls, fetchImpl } = capture(EVENT);
    await run({ operation: "create_event", params: { subject: "S", start: "2026-10-01T09:00:00", end: "2026-10-01T10:00:00", recurrence: EVENT.recurrence } }, fetchImpl);
    expect(body(calls[0])["recurrence"]).toEqual(EVENT.recurrence);
  });
  it("rejects a recurrence without pattern/range", async () => {
    const r = await run({ operation: "create_event", params: { subject: "S", start: "2026-10-01T09:00:00", end: "2026-10-01T10:00:00", recurrence: { type: "weekly" } } }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("rejects negative reminder minutes", async () => {
    const r = await run({ operation: "create_event", params: { subject: "S", start: "a", end: "b", reminder_minutes_before_start: -5 } }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("requires start and end to create", async () => {
    const r = await run({ operation: "create_event", params: { subject: "S" } }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("creates a Teams online meeting through the event (no extra scope)", async () => {
    const { calls, fetchImpl } = capture(EVENT);
    await run({ operation: "create_event", params: { subject: "S", start: "a", end: "b", is_online_meeting: true } }, fetchImpl);
    expect(body(calls[0])).toMatchObject({ isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" });
    expect(graphScopeFor("create_event")).toBe("Calendars.ReadWrite");
  });
  it("maps idempotency_key to the official event transactionId", async () => {
    const { calls, fetchImpl } = capture(EVENT);
    await run({ operation: "create_event", params: { subject: "S", start: "a", end: "b", idempotency_key: "exec-42" } }, fetchImpl);
    expect(body(calls[0])["transactionId"]).toBe("exec-42");
  });
  it("does not send transactionId on update", async () => {
    const { calls, fetchImpl } = capture(EVENT);
    await run({ operation: "update_event", params: { event_id: "e1", subject: "S2", idempotency_key: "x" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ subject: "S2" });
  });
  it("updates attendees with PATCH", async () => {
    const { calls, fetchImpl } = capture(EVENT);
    await run({ operation: "update_event", params: { event_id: "e1", attendees: ["n@contoso.com"] } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(body(calls[0])["attendees"]).toEqual([{ emailAddress: { address: "n@contoso.com" }, type: "required" }]);
  });
  it("refuses an empty event update", async () => {
    const r = await run({ operation: "update_event", params: { event_id: "e1" } }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("deletes an event", async () => {
    const { calls, fetchImpl } = capture(null, { status: 204 });
    await run({ operation: "delete_event", params: { event_id: "e1" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("DELETE");
  });
  for (const [op, action] of [["accept_event", "accept"], ["decline_event", "decline"], ["tentatively_accept_event", "tentativelyAccept"]] as const)
    it(`${op} posts the official ${action} response`, async () => {
      const { calls, fetchImpl } = capture(null, { status: 202 });
      await run({ operation: op, params: { event_id: "e1", comment: "ok" } }, fetchImpl);
      expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/events/e1/${action}`);
      expect(body(calls[0])).toEqual({ comment: "ok", sendResponse: true });
    });
  it("cancels a meeting as organizer", async () => {
    const { calls, fetchImpl } = capture(null, { status: 202 });
    await run({ operation: "cancel_event", params: { event_id: "e1", comment: "moved" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/events/e1/cancel`);
  });
  it("lists recurring instances", async () => {
    const { calls, fetchImpl } = capture({ value: [EVENT] });
    await run({ operation: "list_event_instances", params: { event_id: "e1", start_date_time: "a", end_date_time: "b" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/events/e1/instances");
  });
  it("dismisses a reminder", async () => {
    const { calls, fetchImpl } = capture(null, { status: 200 });
    await run({ operation: "dismiss_reminder", params: { event_id: "e1" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/me/events/e1/dismissReminder`);
  });
  it("snoozes a reminder with a dateTimeTimeZone", async () => {
    const { calls, fetchImpl } = capture(null, { status: 200 });
    await run({ operation: "snooze_reminder", params: { event_id: "e1", new_reminder_time: "2026-10-01T08:55:00", time_zone: "UTC" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ newReminderTime: { dateTime: "2026-10-01T08:55:00", timeZone: "UTC" } });
  });
  it("normalizes attendee responses and recurrence", () => {
    const e = normalizeGraphEvent(EVENT);
    expect(e["attendees"]).toEqual([{ name: "A", address: "a@contoso.com", type: "required", response: "accepted" }]);
    expect(e["recurrence"]).toEqual(EVENT.recurrence);
    expect(e["transaction_id"]).toBe("idem-1");
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph contacts", () => {
  it("lists contacts", async () => {
    const { fetchImpl } = capture({ value: [{ id: "k1", displayName: "Sara", emailAddresses: [{ address: "s@contoso.com" }] }] });
    const r = await run({ operation: "list_contacts" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "k1", display_name: "Sara", emails: ["s@contoso.com"] });
  });
  it("gets a contact", async () => {
    const { calls, fetchImpl } = capture({ id: "k1" });
    await run({ operation: "get_contact", params: { contact_id: "k1" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/contacts/k1");
  });
  it("creates a contact", async () => {
    const { calls, fetchImpl } = capture({ id: "k2" });
    await run({ operation: "create_contact", params: { given_name: "Sara", emails: ["s@contoso.com"], business_phones: ["+966"] } }, fetchImpl);
    expect(body(calls[0])).toEqual({ givenName: "Sara", businessPhones: ["+966"], emailAddresses: [{ address: "s@contoso.com" }] });
  });
  it("updates a contact", async () => {
    const { calls, fetchImpl } = capture({ id: "k2" });
    await run({ operation: "update_contact", params: { contact_id: "k2", job_title: "CTO" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ jobTitle: "CTO" });
  });
  it("refuses an empty contact", async () => {
    const r = await run({ operation: "create_contact", params: {} }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("deletes a contact", async () => {
    const { calls, fetchImpl } = capture(null, { status: 204 });
    await run({ operation: "delete_contact", params: { contact_id: "k2" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph pagination / delta", () => {
  it("follows @odata.nextLink verbatim across pages", async () => {
    const next = `${GRAPH_API_BASE}/me/messages?$top=1&$skip=1`;
    const { fetchImpl, calls } = sequence(
      () => jsonResponse({ value: [MESSAGE], "@odata.nextLink": next }),
      () => jsonResponse({ value: [{ ...MESSAGE, id: "AAMk2" }] }),
    );
    const r = await run({ operation: "list_messages", params: { limit: 1 }, maxPages: 5 }, fetchImpl);
    expect(calls[1]).toBe(next);
    expect(r.ok && r.items.map((i) => i["id"])).toEqual(["AAMk1", "AAMk2"]);
    expect(r.ok && r.cursor).toBeNull();
  });
  it("returns the nextLink as the cursor when the page budget ends", async () => {
    const next = `${GRAPH_API_BASE}/me/messages?$skiptoken=abc`;
    const r = await run({ operation: "list_messages" }, capture({ value: [MESSAGE], "@odata.nextLink": next }).fetchImpl);
    expect(r.ok && r.cursor).toBe(next);
  });
  it("resumes from a supplied cursor", async () => {
    const next = `${GRAPH_API_BASE}/me/messages?$skiptoken=abc`;
    const { calls, fetchImpl } = capture({ value: [] });
    await run({ operation: "list_messages", cursor: next }, fetchImpl);
    expect(calls[0]!.url).toBe(next);
  });
  it("refuses a cursor outside Graph (token exfiltration guard)", async () => {
    const { fetchImpl } = capture({ value: [] });
    const r = await run({ operation: "list_messages", cursor: "https://evil.example/steal" }, fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("runs a messages delta and surfaces the official deltaLink", async () => {
    const delta = `${GRAPH_API_BASE}/me/mailFolders/inbox/messages/delta?$deltatoken=xyz`;
    const { calls, fetchImpl } = capture({ value: [MESSAGE, { id: "gone", "@removed": { reason: "deleted" } }], "@odata.deltaLink": delta });
    const r = await run({ operation: "messages_delta", params: { folder_id: "inbox" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/mailFolders/inbox/messages/delta");
    expect(url(calls[0]).searchParams.has("$top")).toBe(false);
    expect(r.ok && r.items.at(-1)).toEqual({ kind: "delta_state", delta_link: delta });
    expect(r.ok && r.items[1]?.["removed"]).toBe(true);
  });
  it("resumes a delta from delta_link", async () => {
    const delta = `${GRAPH_API_BASE}/me/mailFolders/inbox/messages/delta?$deltatoken=xyz`;
    const { calls, fetchImpl } = capture({ value: [], "@odata.deltaLink": delta });
    await run({ operation: "messages_delta", params: { delta_link: delta } }, fetchImpl);
    expect(calls[0]!.url).toBe(delta);
  });
  it("refuses a foreign delta_link", async () => {
    const r = await run({ operation: "messages_delta", params: { delta_link: "https://evil.example/d" } }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("sets odata.maxpagesize for delta via Prefer", async () => {
    const { calls, fetchImpl } = capture({ value: [] });
    await run({ operation: "messages_delta", params: { folder_id: "inbox", max_page_size: 20 } }, fetchImpl);
    expect(headerOf(calls[0], "prefer")).toBe("odata.maxpagesize=20");
  });
  it("runs an events delta over calendarView", async () => {
    const { calls, fetchImpl } = capture({ value: [EVENT], "@odata.deltaLink": `${GRAPH_API_BASE}/me/calendarView/delta?$deltatoken=1` });
    await run({ operation: "events_delta", params: { start_date_time: "a", end_date_time: "b" } }, fetchImpl);
    expect(url(calls[0]).pathname).toBe("/v1.0/me/calendarView/delta");
  });
  it("maps an expired delta token (410 syncStateNotFound) to invalid_request", async () => {
    const r = await run({ operation: "messages_delta", params: { folder_id: "inbox" } }, capture(gErr("syncStateNotFound", "Sync state expired"), { status: 410 }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("rejects a non-list value", async () => {
    const r = await run({ operation: "list_messages" }, capture({ value: "nope" }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("malformed_response");
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph errors / rate limits / retry", () => {
  it("maps 401 to auth, not retryable", async () => {
    const r = await run({ operation: "get_me" }, capture(gErr("InvalidAuthenticationToken", "expired"), { status: 401 }).fetchImpl);
    expect(!r.ok && r.error).toMatchObject({ kind: "auth", retryable: false });
  });
  it("maps 403 missing consent to forbidden with a consent hint", async () => {
    const r = await run({ operation: "get_me" }, capture(gErr("Authorization_RequestDenied", "Insufficient privileges; admin consent required"), { status: 403 }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("forbidden");
    expect(!r.ok && r.error.message).toMatch(/consent/);
  });
  it("maps ErrorAccessDenied to forbidden", async () => {
    const r = await run({ operation: "get_me" }, capture(gErr("ErrorAccessDenied", "Access is denied."), { status: 403 }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("forbidden");
  });
  it("maps 404 ErrorItemNotFound", async () => {
    const r = await run({ operation: "get_message", params: { message_id: "x" } }, capture(gErr("ErrorItemNotFound", "not found"), { status: 404 }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("not_found");
  });
  it("maps 400 to invalid_request", async () => {
    const r = await run({ operation: "get_me" }, capture(gErr("BadRequest", "bad"), { status: 400 }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("retries 429 then succeeds", async () => {
    const { fetchImpl, count } = sequence(
      () => jsonResponse(gErr("TooManyRequests", "slow down"), { status: 429, headers: { "retry-after": "2" } }),
      () => jsonResponse({ id: "u" }),
    );
    const r = await run({ operation: "get_me" }, fetchImpl);
    expect(r.ok).toBe(true);
    expect(count()).toBe(2);
    expect(r.attempts).toBe(2);
  });
  it("classifies ApplicationThrottled and MailboxConcurrency as rate limits", () => {
    for (const code of ["ApplicationThrottled", "MailboxConcurrency", "ErrorServerBusy"])
      expect(microsoftGraphConnector.mapError!(400, gErr(code, "x"))?.kind).toBe("rate_limit");
  });
  it("classifies a 503 throttling message as a rate limit", () => {
    expect(microsoftGraphConnector.mapError!(503, gErr("ServiceUnavailable", "Request throttled"))?.kind).toBe("rate_limit");
  });
  it("reads Retry-After seconds", () => {
    expect(microsoftGraphConnector.readRateLimit!(new Headers({ "retry-after": "7" }), null)).toEqual({ retryAfterMs: 7000, remaining: 0 });
  });
  it("reads Retry-After http-date", () => {
    const at = new Date(Date.now() + 5000).toUTCString();
    expect(microsoftGraphConnector.readRateLimit!(new Headers({ "retry-after": at }), null)?.resetAt).toBeTruthy();
  });
  it("returns no rate-limit info without Retry-After", () => {
    expect(microsoftGraphConnector.readRateLimit!(new Headers(), null)).toBeUndefined();
  });
  it("retries 5xx then succeeds", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr("generalException", "boom"), { status: 502 }), () => jsonResponse({ id: "u" }));
    expect((await run({ operation: "get_me" }, fetchImpl)).ok).toBe(true);
    expect(count()).toBe(2);
  });
  it("gives up after maxAttempts on persistent 503", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr("serviceNotAvailable", "down"), { status: 503 }));
    const r = await run({ operation: "get_me" }, fetchImpl, creds, { maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect(count()).toBe(3);
  });
  it("does not retry 4xx", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr("BadRequest", "x"), { status: 400 }));
    await run({ operation: "get_me" }, fetchImpl);
    expect(count()).toBe(1);
  });
  it("retries network errors", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      if (n++ === 0) throw new Error("ECONNRESET");
      return jsonResponse({ id: "u" });
    }) as unknown as typeof fetch;
    expect((await run({ operation: "get_me" }, fetchImpl)).ok).toBe(true);
  });
  it("rejects a non-JSON body on a resource read", () => {
    expect(() => microsoftGraphConnector.normalize("get_me", "text", 200)).toThrow(/non-JSON/);
  });
  it("rejects unknown operations", async () => {
    const r = await run({ operation: "nope" }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("unsupported");
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph idempotency", () => {
  it("declares no idempotency header for mail (UNSUPPORTED_OPERATION)", () => {
    expect(() => microsoftGraphConnector.buildCall({ operation: "idempotency_key" })).toThrow(/UNSUPPORTED_OPERATION/);
    expect(UNSUPPORTED_OPERATIONS["idempotency_key"]).toMatch(/sendMail/);
  });
  it("never adds an idempotency header to sendMail", async () => {
    const { calls, fetchImpl } = capture(null, { status: 202 });
    await run({ operation: "send_mail", params: { to: "a@contoso.com", idempotency_key: "exec-1" } }, fetchImpl);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(Object.keys(headers).some((h) => /idempot|request-id|transaction/i.test(h))).toBe(false);
    expect(JSON.stringify(body(calls[0]))).not.toContain("exec-1");
  });
  it("uses resource ids returned by Graph for follow-up steps", async () => {
    const r = await run({ operation: "create_draft", params: { subject: "x" } }, capture({ ...MESSAGE, id: "draft-77" }).fetchImpl);
    expect(r.ok && r.items[0]?.["id"]).toBe("draft-77");
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph subscriptions", () => {
  const future = (min: number) => new Date(Date.now() + min * 60_000).toISOString();
  it("creates a subscription with clientState and a bounded expiry", async () => {
    const { calls, fetchImpl } = capture({ id: "sub-1", resource: "me/messages", changeType: "created", expirationDateTime: future(60), clientState: CLIENT_STATE });
    const r = await run({
      operation: "create_subscription",
      params: { change_type: "created,updated", notification_url: "https://app.test/api/public/webhooks/abc", resource: "me/mailFolders('inbox')/messages", expiration_date_time: future(60), client_state: CLIENT_STATE },
    }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GRAPH_API_BASE}/subscriptions`);
    expect(body(calls[0])).toMatchObject({ changeType: "created,updated", clientState: CLIENT_STATE, resource: "me/mailFolders('inbox')/messages" });
    expect(r.ok && r.items[0]).toMatchObject({ id: "sub-1" });
  });
  it("never echoes clientState back in results", async () => {
    const r = await run({
      operation: "create_subscription",
      params: { change_type: "created", notification_url: "https://a.test/x", resource: "me/events", expiration_date_time: future(60), client_state: CLIENT_STATE },
    }, capture({ id: "s", clientState: CLIENT_STATE }).fetchImpl);
    expect(JSON.stringify(r.ok && r.items)).not.toContain(CLIENT_STATE);
  });
  it("rejects an expiry beyond the Outlook limit", async () => {
    const r = await run({
      operation: "create_subscription",
      params: { change_type: "created", notification_url: "https://a.test/x", resource: "me/messages", expiration_date_time: future(GRAPH_MAX_SUBSCRIPTION_MINUTES + 10), client_state: CLIENT_STATE },
    }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("rejects a past expiry", async () => {
    const r = await run({
      operation: "create_subscription",
      params: { change_type: "created", notification_url: "https://a.test/x", resource: "me/messages", expiration_date_time: new Date(Date.now() - 1000).toISOString(), client_state: CLIENT_STATE },
    }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("requires an https notification url", async () => {
    const r = await run({
      operation: "create_subscription",
      params: { change_type: "created", notification_url: "http://a.test/x", resource: "me/messages", expiration_date_time: future(60), client_state: CLIENT_STATE },
    }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("requires clientState", async () => {
    const r = await run({
      operation: "create_subscription",
      params: { change_type: "created", notification_url: "https://a.test/x", resource: "me/messages", expiration_date_time: future(60) },
    }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
  it("refuses rich notifications (includeResourceData) as unsupported", async () => {
    const r = await run({
      operation: "create_subscription",
      params: { change_type: "created", notification_url: "https://a.test/x", resource: "me/messages", expiration_date_time: future(60), client_state: CLIENT_STATE, include_resource_data: true },
    }, capture({}).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("unsupported");
  });
  it("renews with PATCH expirationDateTime", async () => {
    const exp = future(120);
    const { calls, fetchImpl } = capture({ id: "sub-1", expirationDateTime: exp });
    await run({ operation: "renew_subscription", params: { subscription_id: "sub-1", expiration_date_time: exp } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(body(calls[0])).toEqual({ expirationDateTime: new Date(exp).toISOString() });
  });
  it("lists, gets and deletes subscriptions", async () => {
    const a = capture({ value: [{ id: "s1" }] });
    await run({ operation: "list_subscriptions" }, a.fetchImpl);
    expect(url(a.calls[0]).pathname).toBe("/v1.0/subscriptions");
    const b = capture({ id: "s1" });
    await run({ operation: "get_subscription", params: { subscription_id: "s1" } }, b.fetchImpl);
    expect(url(b.calls[0]).pathname).toBe("/v1.0/subscriptions/s1");
    const c = capture(null, { status: 204 });
    await run({ operation: "delete_subscription", params: { subscription_id: "s1" } }, c.fetchImpl);
    expect(c.calls[0]!.init.method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph change notifications", () => {
  it("accepts a notification whose clientState matches", () => {
    const v = verifyNotify({ value: [notification()] });
    expect(v.ok).toBe(true);
    expect(v.eventType).toBe("graph.created");
    expect(v.eventId).toBe(`sub-1:created:AAMk1:W/"CQAAABYAAA"`);
  });
  it("rejects a mismatched clientState", () => {
    const v = verifyNotify({ value: [notification({ clientState: "wrong" })] });
    expect(v).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("rejects a batch when any item has the wrong clientState", () => {
    const v = verifyNotify({ value: [notification(), notification({ clientState: "other" })] });
    expect(v.ok).toBe(false);
  });
  it("rejects a missing clientState", () => {
    const n = notification();
    delete (n as Record<string, unknown>)["clientState"];
    expect(verifyNotify({ value: [n] }).reason).toBe("invalid_signature");
  });
  it("requires a configured secret", () => {
    expect(verifyNotify({ value: [notification()] }, { secret: null }).reason).toBe("missing_secret");
  });
  it("reports validationToken requests as needing an in-body echo (tech debt)", () => {
    const v = verifyNotify(null);
    expect(v).toMatchObject({ ok: false, reason: "unsupported_event" });
    expect(v.message).toMatch(/validationToken/);
    expect(() => microsoftGraphConnector.buildCall({ operation: "validation_token_echo" })).toThrow(/UNSUPPORTED_OPERATION/);
  });
  it("rejects notifications for an expired subscription (replay)", () => {
    const v = verifyNotify({ value: [notification({ subscriptionExpirationDateTime: new Date(NOW - 3600_000).toISOString() })] });
    expect(v.reason).toBe("replay");
  });
  it("gives the same event id to a redelivery (dedupe)", () => {
    const a = verifyNotify({ value: [notification()] });
    const b = verifyNotify({ value: [notification()] });
    expect(a.eventId).toBe(b.eventId);
  });
  it("gives a new event id when the resource etag changes", () => {
    const a = verifyNotify({ value: [notification()] });
    const b = verifyNotify({ value: [notification({ resourceData: { id: "AAMk1", "@odata.etag": 'W/"NEW"' } })] });
    expect(a.eventId).not.toBe(b.eventId);
  });
  it("distinguishes change types on the same resource", () => {
    const a = verifyNotify({ value: [notification()] });
    const b = verifyNotify({ value: [notification({ changeType: "deleted" })] });
    expect(a.eventId).not.toBe(b.eventId);
  });
  it("accepts lifecycle notifications", () => {
    const v = verifyNotify({ value: [{ subscriptionId: "sub-1", lifecycleEvent: "reauthorizationRequired", clientState: CLIENT_STATE, tenantId: TENANT_A, subscriptionExpirationDateTime: new Date(NOW + 60_000).toISOString() }] });
    expect(v.ok).toBe(true);
    expect(v.eventType).toBe("graph.lifecycle.reauthorizationRequired");
  });
  it("rejects notifications without a subscription id", () => {
    expect(verifyNotify({ value: [notification({ subscriptionId: undefined })] }).reason).toBe("malformed_payload");
  });
  it("exposes resource identifiers through the parser", () => {
    const [n] = parseGraphNotifications({ value: [notification()] });
    expect(n).toMatchObject({ resource: "Users/uid/Messages/AAMk1", resourceId: "AAMk1", tenantId: TENANT_A, changeType: "created" });
  });
  it("composes batch ids from every item", () => {
    const id = graphNotificationEventId(parseGraphNotifications({ value: [notification(), notification({ changeType: "updated" })] }));
    expect(id?.split("|")).toHaveLength(2);
  });
  it("never includes the clientState in the verification result", () => {
    expect(JSON.stringify(verifyNotify({ value: [notification()] }))).not.toContain(CLIENT_STATE);
    expect(JSON.stringify(verifyNotify({ value: [notification({ clientState: "bad" })] }))).not.toContain(CLIENT_STATE);
  });
  it("isolates endpoints: another workspace's clientState is rejected", () => {
    expect(verifyNotify({ value: [notification()] }, { secret: "workspace-2-client-state" }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph scopes / unsupported catalogue", () => {
  it("maps every operation to a documented least-privilege scope", () => {
    const allowed = new Set(Object.values(GRAPH_SCOPES));
    for (const op of GRAPH_OPERATIONS) expect(allowed.has(graphScopeFor(op) as (typeof GRAPH_SCOPES)[keyof typeof GRAPH_SCOPES])).toBe(true);
  });
  it("reads with read scopes and writes with write scopes", () => {
    expect(graphScopeFor("list_messages")).toBe("Mail.Read");
    expect(graphScopeFor("move_message")).toBe("Mail.ReadWrite");
    expect(graphScopeFor("send_mail")).toBe("Mail.Send");
    expect(graphScopeFor("list_events")).toBe("Calendars.Read");
    expect(graphScopeFor("create_contact")).toBe("Contacts.ReadWrite");
    expect(graphScopeFor("get_me")).toBe("User.Read");
  });
  for (const op of Object.keys(UNSUPPORTED_OPERATIONS))
    it(`${op} throws UNSUPPORTED_OPERATION with a reason`, () => {
      expect(() => microsoftGraphConnector.buildCall({ operation: op })).toThrow(/UNSUPPORTED_OPERATION/);
    });
  it("every supported operation builds a Graph call with its required params", () => {
    for (const op of GRAPH_OPERATIONS) {
      const call = microsoftGraphConnector.buildCall({ operation: op, params: requiredParams() });
      expect(call.url.startsWith(`${GRAPH_API_BASE}/`)).toBe(true);
    }
  });
  it("authorize refuses to attach the token to a non-Graph url", () => {
    expect(() => microsoftGraphConnector.authorize({ method: "GET", url: "https://evil.example/", headers: {} }, creds)).toThrow();
  });
});

// ---------------------------------------------------------------------------
describe("microsoft graph secret redaction / trace ids", () => {
  it("never returns the token in results", async () => {
    const r = await run({ operation: "get_me" }, capture({ id: "x" }).fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("scrubs the token from provider error text", async () => {
    const r = await run({ operation: "get_me" }, capture(gErr("BadRequest", `bad token ${TOKEN}`), { status: 400 }).fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("scrubs the token from non-JSON error bodies", async () => {
    const fetchImpl = vi.fn(async () => new Response(`denied ${TOKEN}`, { status: 418 })) as unknown as typeof fetch;
    expect(JSON.stringify(await run({ operation: "get_me" }, fetchImpl))).not.toContain(TOKEN);
  });
  it("scrubs the token from network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`socket closed for ${TOKEN}`);
    }) as unknown as typeof fetch;
    expect(JSON.stringify(await run({ operation: "get_me" }, fetchImpl, creds, { maxAttempts: 1 }))).not.toContain(TOKEN);
  });
  it("redacts token-like keys", () => {
    const out = JSON.stringify(redact({ access_token: TOKEN, refresh_token: REFRESH, nested: { client_secret: "x" } }));
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(REFRESH);
  });
  it("does not emit the token in runtime events and keeps the trace id", async () => {
    const events: unknown[] = [];
    const { fetchImpl } = sequence(() => jsonResponse(gErr("TooManyRequests", "slow"), { status: 429 }), () => jsonResponse({ id: "x" }));
    await run({ operation: "get_me" }, fetchImpl, creds, { onEvent: (e) => events.push(e) });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    expect(events.every((e) => (e as { traceId: string }).traceId === trace)).toBe(true);
  });
  it("carries the trace id on success and failure", async () => {
    const ok = await run({ operation: "get_me" }, capture({ id: "x" }).fetchImpl);
    const bad = await run({ operation: "get_me" }, capture(gErr("ErrorItemNotFound", "nf"), { status: 404 }).fetchImpl);
    expect(ok.traceId).toBe(trace);
    expect(bad.traceId).toBe(trace);
  });
  it("normalizes messages without leaking unknown fields", () => {
    const m = normalizeGraphMessage({ ...MESSAGE, secretField: "zzz" });
    expect(JSON.stringify(m)).not.toContain("zzz");
  });
});
