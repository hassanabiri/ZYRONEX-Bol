import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  UNSUPPORTED_OPERATIONS,
  ZENDESK_OPERATIONS,
  ZENDESK_PLACEHOLDER_ORIGIN,
  assertCursor,
  assertZendeskId,
  assertZendeskSubdomain,
  readZendeskRateLimit,
  zendeskConnector,
} from "@/lib/connectors/adapters/zendesk";
import { normalizeZendeskComment, parseZendeskWebhookEvent, zendeskSubdomain } from "@/lib/connectors/adapters/zendesk-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { beginAuthorization, completeAuthorization, hashState } from "@/lib/oauth/core";
import { getOAuthProvider, zendeskOAuthSpec } from "@/lib/oauth/providers";
import type { ConnectionAccount, OAuthStore, OAuthTokenSet, PendingAuthorization } from "@/lib/oauth/types";
import { verifyWebhook } from "@/lib/webhooks/verify";

/** Simulation only — every response below is mocked; no real Zendesk account is contacted. */

const trace = "trace-zendesk";
const TOKEN = "zd-oauth-access-token-AAAA1111";
const API_TOKEN = "zdApiTokenSecretValue0123456789";
const ORIGIN = "https://acme.zendesk.com";
const creds = { access_token: TOKEN, subdomain: "acme" };
const apiCreds = { subdomain: "acme", email: "agent@acme.test", api_token: API_TOKEN };
const NOW = 1_700_000_100_000;

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
  return runConnectorOperation({ adapter: zendeskConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {} });
}
const build = (operation: string, params: Record<string, unknown> = {}, cursor?: string) => zendeskConnector.buildCall({ operation, params, ...(cursor ? { cursor } : {}) });
const authed = (operation: string, params: Record<string, unknown> = {}, c: Record<string, string> = creds, cursor?: string) => zendeskConnector.authorize(build(operation, params, cursor), c);
const u = (c: { url: string }) => new URL(c.url);
const headerOf = (c: { init: RequestInit }, k: string) => (c.init.headers as Record<string, string>)[k];
const bodyOf = (c: { init: RequestInit } | undefined) => JSON.parse(String(c?.init.body ?? "{}")) as Record<string, any>;

// ---------------------------------------------------------------------------
describe("zendesk registration", () => {
  it("is registered", () => expect(getConnector("zendesk")?.id).toBe("zendesk"));
  it("resolves the zendesk_support alias", () => expect(getConnector("zendesk_support")?.id).toBe("zendesk"));
  it("OAuth alias resolves", () => expect(getOAuthProvider("zendesk_support")?.connector).toBe("zendesk"));
  it("describes oauth2 requiring the subdomain", () => {
    const d = describeConnectors().find((c) => c.id === "zendesk");
    expect(d?.authKind).toBe("oauth2");
    expect(d?.requiredCredentials).toEqual(["subdomain"]);
  });
  it("descriptor never exposes credential values", () => expect(JSON.stringify(describeConnectors())).not.toContain(TOKEN));
  it("health operation is get_current_user", () => expect(zendeskConnector.healthOperation).toBe("get_current_user"));
  it("leaves previous connectors untouched", () => {
    for (const id of ["pipedrive", "salesforce", "hubspot", "shopify", "slack", "google_drive_api", "microsoft_graph"]) expect(getConnector(id)?.id).toBe(id);
    expect(getConnector("pipedrive_crm")?.id).toBe("pipedrive");
  });
  it("exposes no unsupported operation", () => {
    for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) expect(ZENDESK_OPERATIONS).not.toContain(op);
  });
  for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) it(`rejects ${op} as UNSUPPORTED_OPERATION`, () => expect(() => build(op)).toThrow(/UNSUPPORTED_OPERATION/));
  it("rejects unknown operations", () => expect(() => build("nope")).toThrow(/Unknown Zendesk operation/));
  it("declares capabilities", () => expect(zendeskConnector.capabilities).toEqual(expect.arrayContaining(["read", "write", "search", "pagination", "webhook", "health_check"])));
  for (const op of ZENDESK_OPERATIONS) it(`${op} targets the placeholder origin under /api/v2`, () => {
    const params: Record<string, unknown> = { id: "1", ticket_id: "1", user_id: "1", organization_id: "1", fields: { name: "x" }, body: "b", query: "status:open", name: "acme", filter_type: "ticket", token: "abc", endpoint: "https://h.test/x", subscriptions: ["conditional_ticket_events"] };
    const call = build(op, params);
    expect(call.url.startsWith(`${ZENDESK_PLACEHOLDER_ORIGIN}/api/v2/`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("zendesk host validation", () => {
  for (const ok of ["acme", "acme.zendesk.com", "https://acme.zendesk.com", "ACME", "a-b-c"]) it(`accepts ${ok}`, () => expect(zendeskSubdomain(ok)).toBe(ok.toLowerCase().replace(/^https:\/\//, "").replace(".zendesk.com", "")));
  for (const bad of ["", "evil.com", "https://evil.com", "acme.zendesk.com.evil.com", "http://acme.zendesk.com", "https://acme.zendesk.com:8443", "https://u:p@acme.zendesk.com", "https://acme.zendesk.com/path", "acme/../x", "-acme", "acme.zendesk.com?x=1", "a@b"])
    it(`rejects ${JSON.stringify(bad)}`, () => expect(zendeskSubdomain(bad)).toBeNull());
  it("assertZendeskSubdomain throws auth", () => expect(() => assertZendeskSubdomain("evil.com")).toThrow(/official \*\.zendesk\.com/));
  it("re-homes onto the subdomain", () => expect(authed("get_current_user").url).toBe(`${ORIGIN}/api/v2/users/me.json`));
  it("refuses credentials with a foreign subdomain", () => expect(() => authed("get_current_user", {}, { access_token: TOKEN, subdomain: "evil.com" })).toThrow());
  it("refuses calls not on the placeholder origin", () =>
    expect(() => zendeskConnector.authorize({ method: "GET", url: "https://evil.com/api/v2/x", headers: {} }, creds)).toThrow(/connected account/));
  it("never makes a request when the host is invalid", async () => {
    const { fetchImpl, calls } = capture({});
    const r = await run({ operation: "get_current_user" }, fetchImpl, { access_token: TOKEN, subdomain: "https://evil.com" });
    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("zendesk authentication", () => {
  it("uses OAuth bearer", () => expect(authed("get_current_user").headers["authorization"]).toBe(`Bearer ${TOKEN}`));
  it("uses official API token Basic scheme", () =>
    expect(authed("get_current_user", {}, apiCreds).headers["authorization"]).toBe(`Basic ${Buffer.from(`agent@acme.test/token:${API_TOKEN}`).toString("base64")}`));
  it("prefers OAuth when both exist", () => expect(authed("get_current_user", {}, { ...apiCreds, access_token: TOKEN }).headers["authorization"]).toBe(`Bearer ${TOKEN}`));
  it("api token requires email", () => expect(() => authed("get_current_user", {}, { subdomain: "acme", api_token: API_TOKEN })).toThrow(/not connected/));
  it("fails without credentials", () => expect(() => authed("get_current_user", {}, { subdomain: "acme" })).toThrow(/not connected/));
  it("never puts tokens in the URL", () => {
    expect(authed("list_tickets").url).not.toContain(TOKEN);
    expect(authed("list_tickets", {}, apiCreds).url).not.toContain(API_TOKEN);
  });
});

// ---------------------------------------------------------------------------
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
      const { tokens: t, ...rest } = input;
      const existing = [...accounts.values()].find((a) => a.workspaceId === rest.workspaceId && a.connector === rest.connector && a.accountIdentifier === rest.accountIdentifier);
      const account: ConnectionAccount = { ...rest, id: existing?.id ?? `acc${++seq}`, refreshFailures: 0 };
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
const spec = zendeskOAuthSpec("acme");
const pending = (ws = "ws1") => ({ workspaceId: ws, integrationId: "int1", provider: "zendesk", connector: "zendesk", redirectUri: "https://app.test/cb", createdBy: null });
async function connect(ws = "ws1", mem = memoryStore(), s = spec) {
  const { state, authorizationUrl } = await beginAuthorization({ store: mem.store, spec: s, clientId: "cid", pending: pending(ws), nowMs: NOW });
  const { fetchImpl, calls } = capture({ access_token: TOKEN, token_type: "bearer", scope: "read" });
  const { account } = await completeAuthorization({ store: mem.store, spec: s, client: { clientId: "cid", clientSecret: "shh" }, state, code: "c1", fetchImpl, nowMs: NOW });
  return { ...mem, account, state, calls, authorizationUrl };
}

describe("zendesk OAuth", () => {
  it("base spec only carries a placeholder host", () => expect(getOAuthProvider("zendesk")?.authorizationUrl).toContain("{subdomain}"));
  it("binds official endpoints to the subdomain", () => {
    expect(spec.authorizationUrl).toBe("https://acme.zendesk.com/oauth/authorizations/new");
    expect(spec.tokenUrl).toBe("https://acme.zendesk.com/oauth/tokens");
  });
  it("rejects a foreign subdomain spec", () => expect(() => zendeskOAuthSpec("evil.com")).toThrow());
  it("uses PKCE", async () => {
    const { authorizationUrl } = await connect();
    expect(new URL(authorizationUrl).searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("requests least-privilege read scope", async () => expect(new URL((await connect()).authorizationUrl).searchParams.get("scope")).toBe("read"));
  it("stores only the hashed state", async () => {
    const { store, states } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    expect(states.has(hashState(state))).toBe(true);
    expect(states.has(state)).toBe(false);
  });
  it("rejects a replayed state", async () => {
    const mem = memoryStore();
    const { state } = await connect("ws1", mem);
    await expect(completeAuthorization({ store: mem.store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "x", fetchImpl: capture({ access_token: TOKEN }).fetchImpl, nowMs: NOW })).rejects.toThrow();
  });
  it("rejects a forged state", async () => {
    const { store } = memoryStore();
    await expect(completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: "forged", code: "x", fetchImpl: capture({ access_token: TOKEN }).fetchImpl, nowMs: NOW })).rejects.toThrow();
  });
  it("rejects an expired state", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    await expect(completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "x", fetchImpl: capture({ access_token: TOKEN }).fetchImpl, nowMs: NOW + 86_400_000 })).rejects.toThrow();
  });
  it("exchanges the code on the account token endpoint", async () => expect((await connect()).calls[0]!.url).toBe("https://acme.zendesk.com/oauth/tokens"));
  it("binds the account to the subdomain", async () => {
    const { account } = await connect();
    expect(account.accountIdentifier).toBe("subdomain:acme");
    expect(account.accountLabel).toBe("acme.zendesk.com");
  });
  it("stores the subdomain with the vault token set", async () => {
    const { account, tokens } = await connect();
    expect(tokens.get(account.id)?.extra).toEqual({ subdomain: "acme" });
  });
  it("isolates workspaces", async () => {
    const mem = memoryStore();
    const a = await connect("ws1", mem);
    const b = await connect("ws2", mem);
    expect(a.account.id).not.toBe(b.account.id);
    expect(await mem.store.getAccount("ws2", a.account.id)).toBeNull();
  });
  it("different subdomains are different accounts", async () => {
    const mem = memoryStore();
    const a = await connect("ws1", mem);
    const b = await connect("ws1", mem, zendeskOAuthSpec("other"));
    expect(a.account.id).not.toBe(b.account.id);
  });
  it("auto-refresh is not claimed", () => expect(spec.refreshable).toBe(false));
});

// ---------------------------------------------------------------------------
describe("zendesk tickets", () => {
  it("create_ticket wraps fields", () => {
    const c = build("create_ticket", { fields: { subject: "Hi", comment: { body: "x" }, priority: "high", type: "question", status: "new" } });
    expect(c.method).toBe("POST");
    expect(new URL(c.url).pathname).toBe("/api/v2/tickets.json");
    expect((c.body as any).ticket.subject).toBe("Hi");
  });
  for (const s of ["new", "open", "pending", "hold", "solved", "closed"]) it(`accepts status ${s}`, () => expect(() => build("create_ticket", { fields: { status: s } })).not.toThrow());
  for (const p of ["low", "normal", "high", "urgent"]) it(`accepts priority ${p}`, () => expect(() => build("update_ticket", { id: 1, fields: { priority: p } })).not.toThrow());
  for (const t of ["problem", "incident", "question", "task"]) it(`accepts type ${t}`, () => expect(() => build("create_ticket", { fields: { type: t } })).not.toThrow());
  it("rejects unknown status", () => expect(() => build("create_ticket", { fields: { status: "escalated" } })).toThrow(/status/));
  it("rejects unknown priority", () => expect(() => build("create_ticket", { fields: { priority: "p1" } })).toThrow(/priority/));
  it("rejects unknown type", () => expect(() => build("create_ticket", { fields: { type: "bug" } })).toThrow(/type/));
  it("rejects invalid attribute names", () => expect(() => build("create_ticket", { fields: { "a b": 1 } })).toThrow(/attribute/));
  it("requires fields", () => expect(() => build("create_ticket", {})).toThrow(/fields/));
  it("custom_fields pass through without hardcoding", () => {
    const c = build("create_ticket", { fields: { custom_fields: [{ id: 360001, value: "gold" }] } });
    expect((c.body as any).ticket.custom_fields).toEqual([{ id: 360001, value: "gold" }]);
  });
  it("get_ticket path", () => expect(new URL(build("get_ticket", { id: 42 }).url).pathname).toBe("/api/v2/tickets/42.json"));
  it("update_ticket uses PUT", () => expect(build("update_ticket", { id: 42, fields: { status: "open" } }).method).toBe("PUT"));
  it("update_ticket supports official safe_update", () => {
    const b = build("update_ticket", { id: 42, fields: { status: "open" }, safe_update: true, updated_stamp: "2024-01-01T00:00:00Z" }).body as any;
    expect(b.ticket.safe_update).toBe(true);
    expect(b.ticket.updated_stamp).toBe("2024-01-01T00:00:00Z");
  });
  it("delete_ticket uses DELETE", () => expect(build("delete_ticket", { id: 42 }).method).toBe("DELETE"));
  for (const bad of ["abc", "0", "-1", "1/../2", "1.5", ""]) it(`rejects ticket id ${JSON.stringify(bad)}`, () => expect(() => build("get_ticket", { id: bad })).toThrow());
  it("list_tickets uses cursor pagination", () => {
    const url = new URL(build("list_tickets").url);
    expect(url.searchParams.get("page[size]")).toBe("100");
  });
  it("caps page size at 100", () => expect(new URL(build("list_tickets", { limit: 5000 }).url).searchParams.get("page[size]")).toBe("100"));
  it("honours smaller page size", () => expect(new URL(build("list_tickets", { limit: 10 }).url).searchParams.get("page[size]")).toBe("10"));
  it("normalizes a ticket", async () => {
    const { fetchImpl } = capture({ ticket: { id: 42, subject: "S", status: "open", priority: "high", tags: ["a"] } });
    const r = await run({ operation: "get_ticket", params: { id: 42 } }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: 42, subject: "S", status: "open", priority: "high", tags: ["a"] });
  });
  it("lists tickets and returns cursor", async () => {
    const { fetchImpl } = capture({ tickets: [{ id: 1 }, { id: 2 }], meta: { has_more: true, after_cursor: "xyz" } });
    const r = await run({ operation: "list_tickets" }, fetchImpl);
    expect(r.ok && r.items.map((i) => i["id"])).toEqual([1, 2]);
    expect(r.ok && r.cursor).toBe("xyz");
  });
  it("returns null cursor at the end", async () => {
    const { fetchImpl } = capture({ tickets: [{ id: 1 }], meta: { has_more: false, after_cursor: "zzz" } });
    const r = await run({ operation: "list_tickets" }, fetchImpl);
    expect(r.ok && r.cursor).toBeNull();
  });
  it("sends the cursor as page[after]", async () => {
    const { fetchImpl, calls } = capture({ tickets: [] });
    await run({ operation: "list_tickets", cursor: "abc" }, fetchImpl);
    expect(u(calls[0]!).searchParams.get("page[after]")).toBe("abc");
  });
  it("delete returns deleted marker on 204", async () => {
    const { fetchImpl } = capture(null, { status: 204 });
    const r = await run({ operation: "delete_ticket", params: { id: 42 } }, fetchImpl);
    expect(r.ok && r.items).toEqual([{ deleted: true }]);
  });
  it("organization tickets path", () => expect(new URL(build("list_organization_tickets", { organization_id: 7 }).url).pathname).toBe("/api/v2/organizations/7/tickets.json"));
  it("requested tickets path", () => expect(new URL(build("list_user_requested_tickets", { user_id: 7 }).url).pathname).toBe("/api/v2/users/7/tickets/requested.json"));
  it("assigned tickets path", () => expect(new URL(build("list_user_assigned_tickets", { user_id: 7 }).url).pathname).toBe("/api/v2/users/7/tickets/assigned.json"));
  it("count_tickets normalizes count", async () => {
    const { fetchImpl } = capture({ count: { value: 12, refreshed_at: "t" } });
    const r = await run({ operation: "count_tickets" }, fetchImpl);
    expect(r.ok && r.items[0]).toEqual({ count: 12, refreshed_at: "t" });
  });
  it("incremental export uses cursor endpoint", () => {
    const url = new URL(build("incremental_tickets", { start_time: 1700000000 }).url);
    expect(url.pathname).toBe("/api/v2/incremental/tickets/cursor.json");
    expect(url.searchParams.get("start_time")).toBe("1700000000");
  });
  it("incremental export stops at end_of_stream", async () => {
    const { fetchImpl } = capture({ tickets: [{ id: 1 }], after_cursor: "c1", end_of_stream: true });
    const r = await run({ operation: "incremental_tickets" }, fetchImpl);
    expect(r.ok && r.cursor).toBeNull();
  });
  it("incremental export continues with after_cursor", async () => {
    const { fetchImpl } = capture({ tickets: [{ id: 1 }], after_cursor: "c1", end_of_stream: false });
    const r = await run({ operation: "incremental_tickets" }, fetchImpl);
    expect(r.ok && r.cursor).toBe("c1");
  });
});

// ---------------------------------------------------------------------------
describe("zendesk idempotency", () => {
  it("forwards the official Idempotency-Key on create_ticket", () => expect(build("create_ticket", { fields: { subject: "a" }, idempotency_key: "exec-1:node-2" }).headers["idempotency-key"]).toBe("exec-1:node-2"));
  it("omits the header by default", () => expect(build("create_ticket", { fields: { subject: "a" } }).headers["idempotency-key"]).toBeUndefined());
  for (const op of ["update_ticket", "create_user", "create_organization", "add_ticket_comment"]) it(`does not claim idempotency for ${op}`, () =>
    expect(() => build(op, { id: 1, ticket_id: 1, fields: { name: "a" }, body: "b", idempotency_key: "k" })).toThrow(/ticket creation only/));
  it("rejects malformed keys", () => expect(() => build("create_ticket", { fields: { subject: "a" }, idempotency_key: "bad key\n" })).toThrow(/idempotency_key/));
});

// ---------------------------------------------------------------------------
describe("zendesk ticket comments", () => {
  it("lists comments with cursor", () => {
    const url = new URL(build("list_ticket_comments", { ticket_id: 5 }).url);
    expect(url.pathname).toBe("/api/v2/tickets/5/comments.json");
    expect(url.searchParams.get("page[size]")).toBe("100");
  });
  it("adds a public comment through the ticket API", () => {
    const c = build("add_ticket_comment", { ticket_id: 5, body: "hello" });
    expect(c.method).toBe("PUT");
    expect(new URL(c.url).pathname).toBe("/api/v2/tickets/5.json");
    expect((c.body as any).ticket.comment).toEqual({ body: "hello", public: true });
  });
  it("adds a private (internal) note", () => expect((build("add_ticket_comment", { ticket_id: 5, body: "x", public: false }).body as any).ticket.comment.public).toBe(false));
  it("supports html_body", () => expect((build("add_ticket_comment", { ticket_id: 5, html_body: "<p>x</p>" }).body as any).ticket.comment.html_body).toBe("<p>x</p>"));
  it("supports author_id", () => expect((build("add_ticket_comment", { ticket_id: 5, body: "x", author_id: 9 }).body as any).ticket.comment.author_id).toBe(9));
  it("attaches existing upload tokens", () => expect((build("add_ticket_comment", { ticket_id: 5, body: "x", uploads: ["tok123"] }).body as any).ticket.comment.uploads).toEqual(["tok123"]));
  it("rejects bad upload tokens", () => expect(() => build("add_ticket_comment", { ticket_id: 5, body: "x", uploads: ["../x"] })).toThrow(/upload tokens/));
  it("requires a body", () => expect(() => build("add_ticket_comment", { ticket_id: 5 })).toThrow(/body/));
  it("normalizes comments with public flag and attachment metadata", async () => {
    const { fetchImpl } = capture({ comments: [{ id: 1, body: "a", public: false, attachments: [{ id: 3, file_name: "f.png", content_url: "https://acme.zendesk.com/a" }] }] });
    const r = await run({ operation: "list_ticket_comments", params: { ticket_id: 5 } }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: 1, public: false, attachments: [{ id: 3, file_name: "f.png" }] });
  });
  it("normalizer defaults public to false when missing", () => expect(normalizeZendeskComment({ id: 1 })["public"]).toBe(false));
});

// ---------------------------------------------------------------------------
describe("zendesk audits", () => {
  it("ticket audits path", () => expect(new URL(build("list_ticket_audits", { ticket_id: 5 }).url).pathname).toBe("/api/v2/tickets/5/audits.json"));
  it("single audit path", () => expect(new URL(build("get_ticket_audit", { ticket_id: 5, id: 9 }).url).pathname).toBe("/api/v2/tickets/5/audits/9.json"));
  it("account audits are cursor paginated", () => expect(new URL(build("list_audits").url).searchParams.get("page[size]")).toBe("100"));
  it("normalizes audits", async () => {
    const { fetchImpl } = capture({ audits: [{ id: 9, events: [] }] });
    const r = await run({ operation: "list_audits" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: 9 });
  });
});

// ---------------------------------------------------------------------------
describe("zendesk users", () => {
  it("current user path", () => expect(new URL(build("get_current_user").url).pathname).toBe("/api/v2/users/me.json"));
  it("get user path", () => expect(new URL(build("get_user", { id: 3 }).url).pathname).toBe("/api/v2/users/3.json"));
  it("list users filters role", () => expect(new URL(build("list_users", { role: "agent" }).url).searchParams.get("role")).toBe("agent"));
  it("search users by query", () => expect(new URL(build("search_users", { query: "email:a@b.c" }).url).searchParams.get("query")).toBe("email:a@b.c"));
  it("search users by external_id", () => expect(new URL(build("search_users", { external_id: "e1" }).url).searchParams.get("external_id")).toBe("e1"));
  it("search users requires a filter", () => expect(() => build("search_users")).toThrow(/query/));
  it("create user", () => expect((build("create_user", { fields: { name: "A", email: "a@b.c" } }).body as any).user.name).toBe("A"));
  it("update user", () => expect(build("update_user", { id: 3, fields: { name: "B" } }).method).toBe("PUT"));
  it("identities path", () => expect(new URL(build("list_user_identities", { user_id: 3 }).url).pathname).toBe("/api/v2/users/3/identities.json"));
  it("normalizes users", async () => {
    const { fetchImpl } = capture({ users: [{ id: 3, name: "A", role: "agent", email: "a@b.c" }] });
    const r = await run({ operation: "list_users" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: 3, name: "A", role: "agent" });
  });
});

// ---------------------------------------------------------------------------
describe("zendesk organizations / groups / fields / views / brands", () => {
  it("create organization", () => expect((build("create_organization", { fields: { name: "Acme" } }).body as any).organization.name).toBe("Acme"));
  it("get organization", () => expect(new URL(build("get_organization", { id: 4 }).url).pathname).toBe("/api/v2/organizations/4.json"));
  it("update organization", () => expect(build("update_organization", { id: 4, fields: { notes: "n" } }).method).toBe("PUT"));
  it("delete organization", () => expect(build("delete_organization", { id: 4 }).method).toBe("DELETE"));
  it("list organizations", () => expect(new URL(build("list_organizations").url).pathname).toBe("/api/v2/organizations.json"));
  it("search organizations by external_id", () => expect(new URL(build("search_organizations", { external_id: "x" }).url).searchParams.get("external_id")).toBe("x"));
  it("search organizations requires a filter", () => expect(() => build("search_organizations")).toThrow());
  it("autocomplete needs 2 characters", () => expect(() => build("autocomplete_organizations", { name: "a" })).toThrow(/2 characters/));
  it("autocomplete path", () => expect(new URL(build("autocomplete_organizations", { name: "ac" }).url).pathname).toBe("/api/v2/organizations/autocomplete.json"));
  it("list groups", () => expect(new URL(build("list_groups").url).pathname).toBe("/api/v2/groups.json"));
  it("get group", () => expect(new URL(build("get_group", { id: 2 }).url).pathname).toBe("/api/v2/groups/2.json"));
  it("group memberships", () => expect(new URL(build("list_group_memberships").url).pathname).toBe("/api/v2/group_memberships.json"));
  it("list ticket fields", () => expect(new URL(build("list_ticket_fields").url).pathname).toBe("/api/v2/ticket_fields.json"));
  it("get ticket field", () => expect(new URL(build("get_ticket_field", { id: 8 }).url).pathname).toBe("/api/v2/ticket_fields/8.json"));
  it("normalizes ticket fields with options", async () => {
    const { fetchImpl } = capture({ ticket_fields: [{ id: 8, type: "tagger", title: "Tier", custom_field_options: [{ name: "Gold", value: "gold" }] }] });
    const r = await run({ operation: "list_ticket_fields" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: 8, type: "tagger", custom_field_options: [{ value: "gold" }] });
  });
  it("ticket forms", () => expect(new URL(build("list_ticket_forms").url).pathname).toBe("/api/v2/ticket_forms.json"));
  it("user fields", () => expect(new URL(build("list_user_fields").url).pathname).toBe("/api/v2/user_fields.json"));
  it("organization fields", () => expect(new URL(build("list_organization_fields").url).pathname).toBe("/api/v2/organization_fields.json"));
  it("list views", () => expect(new URL(build("list_views").url).pathname).toBe("/api/v2/views.json"));
  it("active views", () => expect(new URL(build("list_active_views").url).pathname).toBe("/api/v2/views/active.json"));
  it("get view", () => expect(new URL(build("get_view", { id: 6 }).url).pathname).toBe("/api/v2/views/6.json"));
  it("view tickets (cursor)", () => {
    const url = new URL(build("list_view_tickets", { id: 6 }).url);
    expect(url.pathname).toBe("/api/v2/views/6/tickets.json");
    expect(url.searchParams.get("page[size]")).toBe("100");
  });
  it("view count", () => expect(new URL(build("count_view_tickets", { id: 6 }).url).pathname).toBe("/api/v2/views/6/count.json"));
  it("brands", () => expect(new URL(build("list_brands").url).pathname).toBe("/api/v2/brands.json"));
  it("brand", () => expect(new URL(build("get_brand", { id: 1 }).url).pathname).toBe("/api/v2/brands/1.json"));
  it("account settings", () => expect(new URL(build("get_account_settings").url).pathname).toBe("/api/v2/account/settings.json"));
});

// ---------------------------------------------------------------------------
describe("zendesk search", () => {
  it("passes the official query verbatim", () => expect(new URL(build("search", { query: "type:ticket status<solved" }).url).searchParams.get("query")).toBe("type:ticket status<solved"));
  it("requires query", () => expect(() => build("search", { query: " " })).toThrow(/query/));
  it("rejects overly long queries", () => expect(() => build("search", { query: "x".repeat(3000) })).toThrow(/too long/));
  it("uses offset paging per_page", () => expect(new URL(build("search", { query: "a" }).url).searchParams.get("per_page")).toBe("100"));
  it("sends page number cursor", () => expect(new URL(build("search", { query: "a" }, "3").url).searchParams.get("page")).toBe("3"));
  it("advances page from next_page", async () => {
    const { fetchImpl } = capture({ results: [{ id: 1, result_type: "ticket" }], next_page: "https://acme.zendesk.com/api/v2/search.json?page=2" });
    const r = await run({ operation: "search", params: { query: "a" } }, fetchImpl);
    expect(r.ok && r.cursor).toBe("2");
    expect(r.ok && r.items[0]).toMatchObject({ result_type: "ticket" });
  });
  it("never adopts the next_page URL", async () => {
    const { fetchImpl } = capture({ results: [], next_page: "https://evil.com/steal" });
    const r = await run({ operation: "search", params: { query: "a" } }, fetchImpl);
    expect(r.ok && r.cursor).toBe("2");
  });
  it("ends when next_page is null", async () => {
    const { fetchImpl } = capture({ results: [], next_page: null });
    const r = await run({ operation: "search", params: { query: "a" } }, fetchImpl);
    expect(r.ok && r.cursor).toBeNull();
  });
  it("search count", () => expect(new URL(build("search_count", { query: "a" }).url).pathname).toBe("/api/v2/search/count.json"));
  for (const t of ["ticket", "user", "organization", "group"]) it(`export search filter ${t}`, () => expect(new URL(build("search_export", { query: "a", filter_type: t }).url).searchParams.get("filter[type]")).toBe(t));
  it("export search rejects unknown types", () => expect(() => build("search_export", { query: "a", filter_type: "article" })).toThrow());
});

// ---------------------------------------------------------------------------
describe("zendesk pagination safety", () => {
  for (const bad of ["https://evil.com", "a&b=c", "x?y", "a b", "../..", "x".repeat(3000)]) it(`rejects cursor ${JSON.stringify(bad).slice(0, 30)}`, () => expect(() => build("list_tickets", {}, bad)).toThrow(/official Zendesk cursor/));
  for (const bad of ["0", "abc", "-1", "999999"]) it(`rejects page cursor ${bad}`, () => expect(() => assertCursor("page", bad)).toThrow());
  it("rejects a hostile after_cursor in responses", async () => {
    const { fetchImpl } = capture({ tickets: [], meta: { has_more: true, after_cursor: "x&page[size]=1000" } });
    const r = await run({ operation: "list_tickets" }, fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("cursor cannot change the host", () => expect(authed("list_tickets", {}, creds, "abc").url.startsWith(`${ORIGIN}/`)).toBe(true));
  it("follows multiple pages within maxPages on the same host", async () => {
    const urls: string[] = [];
    const responses = [{ tickets: [{ id: 1 }], meta: { has_more: true, after_cursor: "c2" } }, { tickets: [{ id: 2 }], meta: { has_more: false } }];
    let i = 0;
    const fetchImpl = vi.fn(async (url: string) => (urls.push(String(url)), jsonResponse(responses[i++]))) as unknown as typeof fetch;
    const r = await run({ operation: "list_tickets", maxPages: 3 }, fetchImpl);
    expect(r.ok && r.items.map((x) => x["id"])).toEqual([1, 2]);
    expect(urls.every((x) => x.startsWith(ORIGIN))).toBe(true);
  });
  it("assertZendeskId rejects injection", () => expect(() => assertZendeskId("1?x=1")).toThrow());
});

// ---------------------------------------------------------------------------
describe("zendesk attachments", () => {
  it("get attachment metadata", async () => {
    const { fetchImpl } = capture({ attachment: { id: 3, file_name: "a.pdf", content_type: "application/pdf", size: 10, content_url: "https://acme.zendesk.com/x" } });
    const r = await run({ operation: "get_attachment", params: { id: 3 } }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: 3, file_name: "a.pdf", size: 10 });
  });
  it("delete upload token path", () => expect(new URL(build("delete_upload", { token: "abc123" }).url).pathname).toBe("/api/v2/uploads/abc123.json"));
  it("delete upload rejects bad token", () => expect(() => build("delete_upload", { token: "../x" })).toThrow());
  it("binary upload unsupported", () => expect(() => build("upload_attachment")).toThrow(/binary/));
  it("binary download unsupported", () => expect(() => build("download_attachment")).toThrow(/binary/));
});

// ---------------------------------------------------------------------------
describe("zendesk webhook management", () => {
  it("create webhook", () => {
    const b = build("create_webhook", { name: "zx", endpoint: "https://h.test/x", subscriptions: ["zen:event-type:user.created"] }).body as any;
    expect(b.webhook).toMatchObject({ endpoint: "https://h.test/x", http_method: "POST", request_format: "json", subscriptions: ["zen:event-type:user.created"] });
  });
  it("rejects http endpoints", () => expect(() => build("create_webhook", { name: "a", endpoint: "http://h", subscriptions: ["conditional_ticket_events"] })).toThrow(/https/));
  it("rejects invented subscriptions", () => expect(() => build("create_webhook", { name: "a", endpoint: "https://h", subscriptions: ["anything"] })).toThrow(/official/));
  it("get webhook path", () => expect(new URL(build("get_webhook", { id: "01ABC" }).url).pathname).toBe("/api/v2/webhooks/01ABC"));
  it("delete webhook", () => expect(build("delete_webhook", { id: "01ABC" }).method).toBe("DELETE"));
  it("rejects bad webhook id", () => expect(() => build("get_webhook", { id: "../x" })).toThrow());
  it("signing secret is never returned", () => expect(() => build("get_webhook_signing_secret")).toThrow(/UNSUPPORTED_OPERATION/));
});

// ---------------------------------------------------------------------------
describe("zendesk webhook verification", () => {
  const SECRET = "dGhpc2lzYXNpZ25pbmdzZWNyZXQ=";
  const STAMP = new Date(NOW).toISOString();
  const EVENT = { id: "01HEVENT", type: "zen:event-type:ticket.status_changed", time: STAMP, account_id: 123, detail: { id: "5" } };
  const sign = (raw: string, stamp = STAMP, secret = SECRET) => createHmac("sha256", secret).update(`${stamp}${raw}`).digest("base64");
  const deliver = (payload: unknown, opts: { sig?: string | null; stamp?: string; secret?: string | null; nowMs?: number; headers?: Record<string, string> } = {}) => {
    const raw = JSON.stringify(payload);
    const stamp = opts.stamp ?? STAMP;
    const headers: Record<string, string> = { "x-zendesk-webhook-signature-timestamp": stamp, ...(opts.headers ?? {}) };
    if (opts.sig !== null) headers["x-zendesk-webhook-signature"] = opts.sig ?? sign(raw, stamp);
    return verifyWebhook("zendesk", { raw, headers, payload, secret: opts.secret === undefined ? SECRET : opts.secret, nowMs: opts.nowMs ?? NOW, replayWindowMs: 300_000 });
  };
  it("accepts a valid signed event", () => expect(deliver(EVENT)).toMatchObject({ ok: true, eventId: "01HEVENT", eventType: "zen:event-type:ticket.status_changed" }));
  it("works through the alias", () => {
    const raw = JSON.stringify(EVENT);
    expect(verifyWebhook("zendesk_support", { raw, headers: { "x-zendesk-webhook-signature": sign(raw), "x-zendesk-webhook-signature-timestamp": STAMP }, payload: EVENT, secret: SECRET, nowMs: NOW, replayWindowMs: 300_000 }).ok).toBe(true);
  });
  it("rejects a wrong signature", () => expect(deliver(EVENT, { sig: "AAAA" })).toMatchObject({ ok: false, reason: "invalid_signature" }));
  it("rejects a signature from another secret", () => expect(deliver(EVENT, { sig: sign(JSON.stringify(EVENT), STAMP, "other") })).toMatchObject({ ok: false, reason: "invalid_signature" }));
  it("rejects a missing signature", () => expect(deliver(EVENT, { sig: null })).toMatchObject({ ok: false, reason: "invalid_signature" }));
  it("rejects a tampered body", () => {
    const raw = JSON.stringify(EVENT);
    const r = verifyWebhook("zendesk", { raw: raw + " ", headers: { "x-zendesk-webhook-signature": sign(raw), "x-zendesk-webhook-signature-timestamp": STAMP }, payload: EVENT, secret: SECRET, nowMs: NOW, replayWindowMs: 300_000 });
    expect(r).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("rejects a swapped timestamp", () => {
    const raw = JSON.stringify(EVENT);
    const r = verifyWebhook("zendesk", { raw, headers: { "x-zendesk-webhook-signature": sign(raw), "x-zendesk-webhook-signature-timestamp": new Date(NOW + 1000).toISOString() }, payload: EVENT, secret: SECRET, nowMs: NOW, replayWindowMs: 300_000 });
    expect(r.ok).toBe(false);
  });
  it("requires a configured secret", () => expect(deliver(EVENT, { secret: null })).toMatchObject({ ok: false, reason: "missing_secret" }));
  it("rejects replays outside the window", () => expect(deliver(EVENT, { nowMs: NOW + 3_600_000 })).toMatchObject({ ok: false, reason: "replay" }));
  it("rejects future-dated deliveries", () => expect(deliver(EVENT, { nowMs: NOW - 3_600_000 })).toMatchObject({ ok: false, reason: "replay" }));
  it("rejects invalid timestamps", () => expect(deliver(EVENT, { stamp: "not-a-date" })).toMatchObject({ ok: false }));
  it("uses invocation id for trigger webhooks", () => expect(deliver({ ticket_id: 5 }, { headers: { "x-zendesk-webhook-invocation-id": "inv-77" } })).toMatchObject({ ok: true, eventId: "invocation:inv-77", eventType: "zendesk.trigger" }));
  it("rejects deliveries without any event id", () => expect(deliver({ ticket_id: 5 })).toMatchObject({ ok: false, reason: "malformed_payload" }));
  it("same event id dedupes across redeliveries", () => {
    const a = deliver(EVENT);
    const b = deliver(EVENT, { headers: { "x-zendesk-webhook-invocation-id": "retry-2" } });
    expect(a.eventId).toBe(b.eventId);
  });
  it("different events have different ids", () => expect(deliver({ ...EVENT, id: "01HOTHER" }).eventId).not.toBe("01HEVENT"));
  it("never returns the secret", () => expect(JSON.stringify(deliver(EVENT, { sig: "x" }))).not.toContain(SECRET));
  it("parses the event envelope", () => expect(parseZendeskWebhookEvent(EVENT)).toEqual({ id: "01HEVENT", type: EVENT.type, timeMs: NOW, accountId: "123" }));
});

// ---------------------------------------------------------------------------
describe("zendesk rate limits & retries", () => {
  it("reads ratelimit-* headers", () => expect(readZendeskRateLimit(new Headers({ "ratelimit-limit": "700", "ratelimit-remaining": "5" }))).toEqual({ limit: 700, remaining: 5 }));
  it("reads x-rate-limit headers", () => expect(readZendeskRateLimit(new Headers({ "x-rate-limit": "400", "x-rate-limit-remaining": "0" }))).toMatchObject({ limit: 400, remaining: 0 }));
  it("reads retry-after", () => expect(readZendeskRateLimit(new Headers({ "retry-after": "7" }))?.retryAfterMs).toBe(7000));
  it("uses reset when exhausted", () => expect(readZendeskRateLimit(new Headers({ "ratelimit-remaining": "0", "ratelimit-reset": "3" }))?.retryAfterMs).toBe(3000));
  it("returns undefined without headers", () => expect(readZendeskRateLimit(new Headers())).toBeUndefined());
  it("retries 429 then succeeds", async () => {
    const s = sequence(() => jsonResponse({ error: "TooManyRequests" }, { status: 429, headers: { "retry-after": "1" } }), () => jsonResponse({ user: { id: 1 } }));
    const r = await run({ operation: "get_current_user" }, s.fetchImpl);
    expect(r.ok).toBe(true);
    expect(s.count()).toBe(2);
  });
  for (const status of [500, 502, 503]) it(`retries ${status}`, async () => {
    const s = sequence(() => jsonResponse({ error: "x" }, { status }), () => jsonResponse({ user: { id: 1 } }));
    expect((await run({ operation: "get_current_user" }, s.fetchImpl)).ok).toBe(true);
    expect(s.count()).toBe(2);
  });
  for (const status of [400, 401, 403, 404, 409, 422]) it(`does not retry ${status}`, async () => {
    const s = sequence(() => jsonResponse({ error: "x" }, { status }));
    const r = await run({ operation: "get_current_user" }, s.fetchImpl);
    expect(r.ok).toBe(false);
    expect(s.count()).toBe(1);
  });
  it("retries network errors", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return jsonResponse({ user: { id: 1 } });
    }) as unknown as typeof fetch;
    expect((await run({ operation: "get_current_user" }, fetchImpl)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("zendesk error mapping", () => {
  const map = (status: number, payload: unknown = {}) => zendeskConnector.mapError!(status, payload);
  it("no error below 400", () => expect(map(200)).toBeNull());
  it("401 → auth", () => expect(map(401, { error: "Couldn't authenticate you" })).toMatchObject({ kind: "auth", retryable: false }));
  it("403 → forbidden", () => expect(map(403, { error: { title: "Forbidden", message: "no" } })).toMatchObject({ kind: "forbidden" }));
  it("404 → not_found", () => expect(map(404, { error: "RecordNotFound", description: "Not found" })).toMatchObject({ kind: "not_found" }));
  it("409 → conflict", () => expect(map(409)?.message).toMatch(/conflict/));
  it("422 → validation with field names", () => {
    const e = map(422, { error: "RecordInvalid", description: "Record validation errors", details: { requester: [{ description: "x" }] } });
    expect(e).toMatchObject({ kind: "invalid_request", retryable: false });
    expect(e?.message).toMatch(/requester/);
  });
  it("429 → rate_limit retryable", () => expect(map(429)).toMatchObject({ kind: "rate_limit", retryable: true }));
  it("5xx → provider retryable", () => expect(map(503)).toMatchObject({ kind: "provider", retryable: true }));
  it("other 4xx → invalid_request", () => expect(map(400)).toMatchObject({ kind: "invalid_request" }));
  it("surfaces normalized errors through the runtime", async () => {
    const { fetchImpl } = capture({ error: "RecordNotFound" }, { status: 404 });
    const r = await run({ operation: "get_ticket", params: { id: 1 } }, fetchImpl);
    expect(!r.ok && r.error.kind).toBe("not_found");
    expect(r.traceId).toBe(trace);
  });
  it("error results never contain the token", async () => {
    const { fetchImpl } = capture({ error: `bad ${TOKEN}` }, { status: 401 });
    const r = await run({ operation: "get_current_user" }, fetchImpl);
    expect(JSON.stringify(r)).not.toContain(API_TOKEN);
  });
  it("redact masks bearer tokens", () => expect(JSON.stringify(redact({ authorization: `Bearer ${TOKEN}` }))).not.toContain(TOKEN));
  it("redact masks basic credentials", () => expect(JSON.stringify(redact({ authorization: `Basic ${btoa(`a/token:${API_TOKEN}`)}` }))).not.toContain(API_TOKEN));
});

// ---------------------------------------------------------------------------
describe("zendesk health", () => {
  it("healthy on users/me", async () => {
    const { fetchImpl, calls } = capture({ user: { id: 1 } });
    const h = await checkConnectorHealth({ adapter: zendeskConnector, credentials: creds, traceId: trace, fetchImpl, sleep: async () => {} } as Parameters<typeof checkConnectorHealth>[0]);
    expect(h.healthy).toBe(true);
    expect(u(calls[0]!).pathname).toBe("/api/v2/users/me.json");
    expect(headerOf(calls[0]!, "authorization")).toBe(`Bearer ${TOKEN}`);
  });
  it("unhealthy on 401", async () => {
    const { fetchImpl } = capture({ error: "x" }, { status: 401 });
    const h = await checkConnectorHealth({ adapter: zendeskConnector, credentials: creds, traceId: trace, fetchImpl, sleep: async () => {} } as Parameters<typeof checkConnectorHealth>[0]);
    expect(h.healthy).toBe(false);
  });
  it("health with API token", async () => {
    const { fetchImpl, calls } = capture({ user: { id: 1 } });
    await checkConnectorHealth({ adapter: zendeskConnector, credentials: apiCreds, traceId: trace, fetchImpl, sleep: async () => {} } as Parameters<typeof checkConnectorHealth>[0]);
    expect(headerOf(calls[0]!, "authorization")).toMatch(/^Basic /);
  });
});

// ---------------------------------------------------------------------------
describe("zendesk isolation", () => {
  it("each credential set targets only its own subdomain", async () => {
    const a = capture({ user: { id: 1 } });
    const b = capture({ user: { id: 2 } });
    await run({ operation: "get_current_user" }, a.fetchImpl, creds);
    await run({ operation: "get_current_user" }, b.fetchImpl, { access_token: "other", subdomain: "globex" });
    expect(a.calls[0]!.url.startsWith(ORIGIN)).toBe(true);
    expect(b.calls[0]!.url.startsWith("https://globex.zendesk.com")).toBe(true);
    expect(headerOf(b.calls[0]!, "authorization")).not.toContain(TOKEN);
  });
  it("request body never contains credentials", async () => {
    const { fetchImpl, calls } = capture({ ticket: { id: 1 } });
    await run({ operation: "create_ticket", params: { fields: { subject: "a" } } }, fetchImpl);
    expect(JSON.stringify(bodyOf(calls[0]))).not.toContain(TOKEN);
  });
});
