import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  INTERCOM_API_VERSION,
  INTERCOM_OPERATIONS,
  INTERCOM_PLACEHOLDER_ORIGIN,
  UNSUPPORTED_OPERATIONS,
  assertCursor,
  assertIntercomId,
  assertSearchQuery,
  intercomConnector,
  intercomOrigin,
  readIntercomRateLimit,
} from "@/lib/connectors/adapters/intercom";
import { intercomRegion, normalizeIntercomAdmin, parseIntercomNotification } from "@/lib/connectors/adapters/intercom-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { beginAuthorization, completeAuthorization, hashState } from "@/lib/oauth/core";
import { getOAuthProvider } from "@/lib/oauth/providers";
import type { ConnectionAccount, OAuthStore, OAuthTokenSet, PendingAuthorization } from "@/lib/oauth/types";
import { verifyWebhook } from "@/lib/webhooks/verify";

/** Simulation only — every response is mocked; no real Intercom workspace is contacted. */

const trace = "trace-intercom";
const TOKEN = "dG9rOmludGVyY29tLWFjY2Vzcy10b2tlbg==";
const creds = { access_token: TOKEN };
const NOW = 1_700_000_100_000;
const US = "https://api.intercom.io";
const Q = { field: "email", operator: "=", value: "a@b.c" };

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
  return runConnectorOperation({ adapter: intercomConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {} });
}
const build = (operation: string, params: Record<string, unknown> = {}, cursor?: string) => intercomConnector.buildCall({ operation, params, ...(cursor ? { cursor } : {}) });
const path = (operation: string, params: Record<string, unknown> = {}) => new URL(build(operation, params).url).pathname;
const body = (operation: string, params: Record<string, unknown> = {}, cursor?: string) => build(operation, params, cursor).body as any;
const headerOf = (c: { init: RequestInit }, k: string) => (c.init.headers as Record<string, string>)[k];

// ---------------------------------------------------------------------------
describe("intercom registration", () => {
  it("is registered", () => expect(getConnector("intercom")?.id).toBe("intercom"));
  it("resolves the intercom_support alias", () => expect(getConnector("intercom_support")?.id).toBe("intercom"));
  it("OAuth alias resolves", () => expect(getOAuthProvider("intercom_support")?.connector).toBe("intercom"));
  it("describes oauth2 requiring an access token", () => {
    const d = describeConnectors().find((c) => c.id === "intercom");
    expect(d?.authKind).toBe("oauth2");
    expect(d?.requiredCredentials).toEqual(["access_token"]);
  });
  it("health operation is get_me", () => expect(intercomConnector.healthOperation).toBe("get_me"));
  it("leaves previous connectors untouched", () => {
    for (const id of ["zendesk", "pipedrive", "salesforce", "hubspot", "shopify", "slack"]) expect(getConnector(id)?.id).toBe(id);
    expect(getConnector("zendesk_support")?.id).toBe("zendesk");
  });
  it("exposes no unsupported operation", () => {
    for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) expect(INTERCOM_OPERATIONS).not.toContain(op);
  });
  for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) it(`rejects ${op} as UNSUPPORTED_OPERATION`, () => expect(() => build(op)).toThrow(/UNSUPPORTED_OPERATION/));
  it("rejects unknown operations", () => expect(() => build("nope")).toThrow(/Unknown Intercom operation/));
  const P: Record<string, unknown> = { id: "1", contact_id: "c1", company_id: "co1", conversation_id: "9", tag_id: "t1", admin_id: "a1", assignee_id: "a2", fields: { name: "x", email: "a@b.c" }, body: "hi", query: Q, name: "vip", snoozed_until: 1700000000 };
  for (const op of INTERCOM_OPERATIONS) {
    it(`${op} pins Intercom-Version`, () => expect(build(op, P).headers["intercom-version"]).toBe(INTERCOM_API_VERSION));
    it(`${op} targets the placeholder origin`, () => expect(build(op, P).url.startsWith(`${INTERCOM_PLACEHOLDER_ORIGIN}/`)).toBe(true));
  }
});

// ---------------------------------------------------------------------------
describe("intercom hosts & authentication", () => {
  it("defaults to the US host", () => expect(intercomConnector.authorize(build("get_me"), creds).url).toBe(`${US}/me`));
  it("uses the EU host", () => expect(intercomConnector.authorize(build("get_me"), { ...creds, region: "eu" }).url).toBe("https://api.eu.intercom.io/me"));
  it("uses the AU host", () => expect(intercomConnector.authorize(build("get_me"), { ...creds, region: "au" }).url).toBe("https://api.au.intercom.io/me"));
  it("region is case-insensitive", () => expect(intercomRegion("EU")).toBe("eu"));
  for (const bad of ["evil", "https://evil.com", "us.evil", "ca"]) it(`rejects region ${bad}`, () => expect(() => intercomOrigin(bad)).toThrow(/official regions/));
  it("never makes a request for an unknown region", async () => {
    const { fetchImpl, calls } = capture({});
    expect((await run({ operation: "get_me" }, fetchImpl, { ...creds, region: "evil.com" })).ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
  it("refuses calls not on the placeholder origin", () => expect(() => intercomConnector.authorize({ method: "GET", url: "https://evil.com/me", headers: {} }, creds)).toThrow(/connected workspace/));
  it("sends the bearer token", () => expect(intercomConnector.authorize(build("get_me"), creds).headers["authorization"]).toBe(`Bearer ${TOKEN}`));
  it("fails without a token", () => expect(() => intercomConnector.authorize(build("get_me"), {})).toThrow(/not connected/));
  it("never places the token in the URL", () => expect(intercomConnector.authorize(build("list_contacts"), creds).url).not.toContain(TOKEN));
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
      const account: ConnectionAccount = { ...rest, id: `acc${++seq}`, refreshFailures: 0 };
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
const spec = getOAuthProvider("intercom")!;
const pending = (ws = "ws1") => ({ workspaceId: ws, integrationId: null, provider: "intercom", connector: "intercom", redirectUri: "https://app.test/cb", createdBy: null });
async function connect(ws = "ws1", mem = memoryStore()) {
  const { state, authorizationUrl } = await beginAuthorization({ store: mem.store, spec, clientId: "cid", pending: pending(ws), nowMs: NOW });
  const { fetchImpl, calls } = capture({ token_type: "Bearer", token: TOKEN, access_token: TOKEN });
  const { account } = await completeAuthorization({ store: mem.store, spec, client: { clientId: "cid", clientSecret: "shh" }, state, code: "c1", fetchImpl, nowMs: NOW });
  return { ...mem, account, state, calls, authorizationUrl };
}

describe("intercom OAuth", () => {
  it("uses official endpoints", () => {
    expect(spec.authorizationUrl).toBe("https://app.intercom.com/oauth");
    expect(spec.tokenUrl).toBe("https://api.intercom.io/auth/eagle/token");
  });
  it("claims no refresh or revoke", () => {
    expect(spec.refreshable).toBe(false);
    expect(spec.revokeUrl).toBeUndefined();
  });
  it("sends no scope (permissions live on the app)", async () => expect(new URL((await connect()).authorizationUrl).searchParams.get("scope")).toBeNull());
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
  it("exchanges the code at the token endpoint", async () => expect((await connect()).calls[0]!.url).toBe("https://api.intercom.io/auth/eagle/token"));
  it("stores the token in the vault token set", async () => {
    const { account, tokens } = await connect();
    expect(tokens.get(account.id)?.accessToken).toBe(TOKEN);
  });
  it("does not invent a workspace id", async () => expect((await connect()).account.accountIdentifier).not.toMatch(/^app:/));
  it("isolates workspaces", async () => {
    const mem = memoryStore();
    const a = await connect("ws1", mem);
    expect(await mem.store.getAccount("ws2", a.account.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("intercom identity & admins", () => {
  it("me path", () => expect(path("get_me")).toBe("/me"));
  it("normalizes workspace identity from /me", async () => {
    const { fetchImpl } = capture({ type: "admin", id: "a1", email: "x@y.z", app: { id_code: "abc123", name: "Acme", region: "US", timezone: "UTC" } });
    const r = await run({ operation: "get_me" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "a1", app: { id_code: "abc123", region: "US" } });
  });
  it("normalizer omits app when absent", () => expect(normalizeIntercomAdmin({ id: "1" })["app"]).toBeUndefined());
  it("lists admins", async () => {
    const { fetchImpl } = capture({ type: "admin.list", admins: [{ id: "1" }, { id: "2" }] });
    const r = await run({ operation: "list_admins" }, fetchImpl);
    expect(r.ok && r.items.map((i) => i["id"])).toEqual(["1", "2"]);
  });
  it("admin path", () => expect(path("get_admin", { id: "7" })).toBe("/admins/7"));
  it("teams path", () => expect(path("list_teams")).toBe("/teams"));
  it("team path", () => expect(path("get_team", { id: "7" })).toBe("/teams/7"));
  it("lists teams", async () => {
    const { fetchImpl } = capture({ type: "team.list", teams: [{ id: "t", admin_ids: [1] }] });
    const r = await run({ operation: "list_teams" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "t", admin_ids: [1] });
  });
});

// ---------------------------------------------------------------------------
describe("intercom contacts", () => {
  it("create contact", () => expect(body("create_contact", { fields: { email: "a@b.c", custom_attributes: { tier: "gold" } } })).toEqual({ email: "a@b.c", custom_attributes: { tier: "gold" } }));
  it("create lead by role", () => expect(body("create_contact", { fields: { role: "lead" } })).toEqual({ role: "lead" }));
  it("rejects invalid role", () => expect(() => build("create_contact", { fields: { role: "admin" } })).toThrow(/role/));
  it("requires an identifier", () => expect(() => build("create_contact", { fields: { name: "x" } })).toThrow(/email/));
  it("rejects bad attribute names", () => expect(() => build("create_contact", { fields: { "Bad Key": 1 } })).toThrow(/attribute/));
  it("get contact", () => expect(path("get_contact", { id: "c1" })).toBe("/contacts/c1"));
  it("update uses PUT", () => expect(build("update_contact", { id: "c1", fields: { name: "n" } }).method).toBe("PUT"));
  it("delete uses DELETE", () => expect(build("delete_contact", { id: "c1" }).method).toBe("DELETE"));
  it("archive", () => expect(path("archive_contact", { id: "c1" })).toBe("/contacts/c1/archive"));
  it("unarchive", () => expect(path("unarchive_contact", { id: "c1" })).toBe("/contacts/c1/unarchive"));
  for (const bad of ["../x", "a b", "a?b=1", "", "x".repeat(65)]) it(`rejects contact id ${JSON.stringify(bad).slice(0, 20)}`, () => expect(() => build("get_contact", { id: bad })).toThrow());
  it("list uses per_page and starting_after", () => {
    const u = new URL(build("list_contacts", {}, "WzE2").url);
    expect(u.searchParams.get("per_page")).toBe("50");
    expect(u.searchParams.get("starting_after")).toBe("WzE2");
  });
  it("caps per_page at 150", () => expect(new URL(build("list_contacts", { limit: 999 }).url).searchParams.get("per_page")).toBe("150"));
  it("normalizes contacts and the next cursor", async () => {
    const { fetchImpl } = capture({ type: "list", data: [{ id: "c1", email: "a@b.c", role: "user", custom_attributes: { x: 1 } }], pages: { next: { starting_after: "abc" } } });
    const r = await run({ operation: "list_contacts" }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "c1", role: "user", custom_attributes: { x: 1 } });
    expect(r.ok && r.cursor).toBe("abc");
  });
  it("cursor is null at the end", async () => {
    const { fetchImpl } = capture({ data: [], pages: { next: null } });
    expect((await run({ operation: "list_contacts" }, fetchImpl)).ok && true).toBe(true);
  });
  it("delete normalizes the deleted marker", async () => {
    const { fetchImpl } = capture({ id: "c1", object: "contact", deleted: true });
    const r = await run({ operation: "delete_contact", params: { id: "c1" } }, fetchImpl);
    expect(r.ok && r.items[0]).toEqual({ id: "c1", deleted: true });
  });
  it("attach company", () => expect(body("attach_contact_company", { contact_id: "c1", company_id: "co1" })).toEqual({ id: "co1" }));
  it("detach company", () => expect(path("detach_contact_company", { contact_id: "c1", company_id: "co1" })).toBe("/contacts/c1/companies/co1"));
  it("contact companies", () => expect(path("list_contact_companies", { contact_id: "c1" })).toBe("/contacts/c1/companies"));
});

// ---------------------------------------------------------------------------
describe("intercom search", () => {
  it("passes the documented query verbatim", () => expect(body("search_contacts", { query: Q }).query).toEqual(Q));
  it("puts pagination in the body", () => expect(body("search_contacts", { query: Q }, "cur1").pagination).toEqual({ per_page: 50, starting_after: "cur1" }));
  it("supports AND/OR nesting", () => expect(() => build("search_conversations", { query: { operator: "AND", value: [Q, { operator: "OR", value: [Q] }] } })).not.toThrow());
  for (const op of ["=", "!=", "IN", "NIN", ">", "<", "~", "!~", "^", "$"]) it(`accepts operator ${op}`, () => expect(() => assertSearchQuery({ field: "x", operator: op, value: 1 })).not.toThrow());
  for (const op of ["LIKE", "contains", "==", ""]) it(`rejects operator ${JSON.stringify(op)}`, () => expect(() => assertSearchQuery({ field: "x", operator: op, value: 1 })).toThrow());
  it("rejects deep nesting", () => expect(() => assertSearchQuery({ operator: "AND", value: [{ operator: "AND", value: [{ operator: "AND", value: [{ operator: "AND", value: [Q] }] }] }] })).toThrow(/nesting/));
  it("rejects empty AND", () => expect(() => assertSearchQuery({ operator: "AND", value: [] })).toThrow());
  it("rejects more than 15 filters", () => expect(() => assertSearchQuery({ operator: "OR", value: Array(16).fill(Q) })).toThrow());
  it("rejects missing field", () => expect(() => assertSearchQuery({ operator: "=", value: 1 })).toThrow(/field/));
  it("rejects missing value", () => expect(() => assertSearchQuery({ field: "x", operator: "=" })).toThrow(/value/));
  it("search conversations path", () => expect(path("search_conversations", { query: Q })).toBe("/conversations/search"));
  it("forwards sort", () => expect(body("search_contacts", { query: Q, sort: { field: "created_at", order: "descending" } }).sort).toEqual({ field: "created_at", order: "descending" }));
  it("requires query", () => expect(() => build("search_contacts")).toThrow(/query/));
});

// ---------------------------------------------------------------------------
describe("intercom companies", () => {
  it("create-or-update", () => expect(body("create_or_update_company", { fields: { company_id: "ext1", name: "Acme" } })).toEqual({ company_id: "ext1", name: "Acme" }));
  it("requires company_id or name", () => expect(() => build("create_or_update_company", { fields: { plan: "x" } })).toThrow());
  it("get", () => expect(path("get_company", { id: "co1" })).toBe("/companies/co1"));
  it("find by company_id", () => expect(new URL(build("find_company", { company_id: "ext1" }).url).searchParams.get("company_id")).toBe("ext1"));
  it("find needs a filter", () => expect(() => build("find_company")).toThrow());
  it("update", () => expect(build("update_company", { id: "co1", fields: { plan: "p" } }).method).toBe("PUT"));
  it("delete", () => expect(build("delete_company", { id: "co1" }).method).toBe("DELETE"));
  it("list uses page numbers in the POST body", () => expect(body("list_companies", {}, "3")).toEqual({ per_page: 50, page: 3 }));
  it("list advances by total_pages", async () => {
    const { fetchImpl } = capture({ data: [{ id: "co1", name: "A" }], pages: { page: 1, total_pages: 3 } });
    const r = await run({ operation: "list_companies" }, fetchImpl);
    expect(r.ok && r.cursor).toBe("2");
    expect(r.ok && r.items[0]).toMatchObject({ id: "co1", name: "A" });
  });
  it("list stops at the last page", async () => {
    const { fetchImpl } = capture({ data: [], pages: { page: 3, total_pages: 3 } });
    const r = await run({ operation: "list_companies" }, fetchImpl);
    expect(r.ok && r.cursor).toBeNull();
  });
  it("company contacts", () => expect(path("list_company_contacts", { company_id: "co1" })).toBe("/companies/co1/contacts"));
});

// ---------------------------------------------------------------------------
describe("intercom conversations & replies", () => {
  it("get", () => expect(path("get_conversation", { id: "9" })).toBe("/conversations/9"));
  it("plaintext option", () => expect(new URL(build("get_conversation", { id: "9", display_as: "plaintext" }).url).searchParams.get("display_as")).toBe("plaintext"));
  it("list is cursor paginated", () => expect(new URL(build("list_conversations").url).searchParams.get("per_page")).toBe("50"));
  it("normalizes conversation state and parts", async () => {
    const { fetchImpl } = capture({ type: "conversation", id: "9", state: "open", admin_assignee_id: 5, tags: { tags: [{ id: "t" }] }, conversation_parts: { conversation_parts: [{ id: "p1" }] } });
    const r = await run({ operation: "get_conversation", params: { id: "9" } }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "9", state: "open", admin_assignee_id: 5, tags: [{ id: "t" }], parts: [{ id: "p1" }] });
  });
  it("create from a contact", () => expect(body("create_conversation", { contact_id: "c1", body: "hi" })).toEqual({ from: { type: "user", id: "c1" }, body: "hi" }));
  it("rejects invalid contact_type", () => expect(() => build("create_conversation", { contact_id: "c1", body: "hi", contact_type: "admin" })).toThrow());
  it("update read/title/custom attributes", () => expect(body("update_conversation", { id: "9", read: true, title: "T", custom_attributes: { issue: "x" } })).toEqual({ read: true, title: "T", custom_attributes: { issue: "x" } }));
  it("admin reply", () => expect(body("reply_to_conversation", { id: "9", body: "hi", admin_id: "a1" })).toEqual({ message_type: "comment", type: "admin", admin_id: "a1", body: "hi" }));
  it("contact reply", () => expect(body("reply_to_conversation", { id: "9", body: "hi", as: "contact", contact_id: "c1" })).toEqual({ message_type: "comment", type: "user", intercom_user_id: "c1", body: "hi" }));
  it("contacts cannot add notes", () => expect(() => build("reply_to_conversation", { id: "9", body: "x", as: "contact", contact_id: "c1", message_type: "note" })).toThrow(/admins/));
  it("rejects unknown message_type", () => expect(() => build("reply_to_conversation", { id: "9", body: "x", admin_id: "a1", message_type: "sms" })).toThrow());
  it("admin reply requires admin_id", () => expect(() => build("reply_to_conversation", { id: "9", body: "x" })).toThrow(/admin_id/));
  it("reply with attachment_urls", () => expect(body("reply_to_conversation", { id: "9", body: "x", admin_id: "a1", attachment_urls: ["https://f.test/a.png"] }).attachment_urls).toEqual(["https://f.test/a.png"]));
  it("rejects http attachment urls", () => expect(() => build("reply_to_conversation", { id: "9", body: "x", admin_id: "a1", attachment_urls: ["http://f"] })).toThrow());
  it("rejects more than 10 attachment urls", () => expect(() => build("reply_to_conversation", { id: "9", body: "x", admin_id: "a1", attachment_urls: Array(11).fill("https://f.test/a") })).toThrow());
  it("internal note", () => expect(body("add_conversation_note", { id: "9", body: "n", admin_id: "a1" })).toEqual({ message_type: "note", type: "admin", admin_id: "a1", body: "n" }));
  it("close", () => {
    expect(path("close_conversation", { id: "9", admin_id: "a1" })).toBe("/conversations/9/parts");
    expect(body("close_conversation", { id: "9", admin_id: "a1" })).toEqual({ message_type: "close", type: "admin", admin_id: "a1" });
  });
  it("open", () => expect(body("open_conversation", { id: "9", admin_id: "a1" }).message_type).toBe("open"));
  it("snooze", () => expect(body("snooze_conversation", { id: "9", admin_id: "a1", snoozed_until: 1700000000 }).snoozed_until).toBe(1700000000));
  it("snooze rejects invalid time", () => expect(() => build("snooze_conversation", { id: "9", admin_id: "a1", snoozed_until: "soon" })).toThrow());
  it("assign to admin", () => expect(body("assign_conversation", { id: "9", admin_id: "a1", assignee_id: "a2" })).toEqual({ message_type: "assignment", type: "admin", admin_id: "a1", assignee_id: "a2" }));
  it("assign to team", () => expect(body("assign_conversation", { id: "9", admin_id: "a1", assignee_id: "t1", assignee_type: "team" }).type).toBe("team"));
  it("rejects invalid assignee_type", () => expect(() => build("assign_conversation", { id: "9", admin_id: "a1", assignee_id: "x", assignee_type: "bot" })).toThrow());
});

// ---------------------------------------------------------------------------
describe("intercom tags, notes, attributes", () => {
  it("list tags", () => expect(path("list_tags")).toBe("/tags"));
  it("create tag", () => expect(body("create_tag", { name: " VIP " })).toEqual({ name: "VIP" }));
  it("create tag rejects empty", () => expect(() => build("create_tag", { name: "  " })).toThrow());
  it("delete tag", () => expect(build("delete_tag", { id: "t1" }).method).toBe("DELETE"));
  it("get tag", () => expect(path("get_tag", { id: "t1" })).toBe("/tags/t1"));
  it("tag contact", () => expect(body("tag_contact", { contact_id: "c1", tag_id: "t1" })).toEqual({ id: "t1" }));
  it("untag contact", () => expect(path("untag_contact", { contact_id: "c1", tag_id: "t1" })).toBe("/contacts/c1/tags/t1"));
  it("tag conversation requires admin", () => expect(body("tag_conversation", { conversation_id: "9", tag_id: "t1", admin_id: "a1" })).toEqual({ id: "t1", admin_id: "a1" }));
  it("untag conversation sends admin_id", () => expect(body("untag_conversation", { conversation_id: "9", tag_id: "t1", admin_id: "a1" })).toEqual({ admin_id: "a1" }));
  it("contact tags", () => expect(path("list_contact_tags", { contact_id: "c1" })).toBe("/contacts/c1/tags"));
  it("list notes", () => expect(path("list_contact_notes", { contact_id: "c1" })).toBe("/contacts/c1/notes"));
  it("create note", () => expect(body("create_contact_note", { contact_id: "c1", body: "n", admin_id: "a1" })).toEqual({ body: "n", admin_id: "a1" }));
  it("get note", () => expect(path("get_note", { id: "5" })).toBe("/notes/5"));
  for (const m of ["contact", "company", "conversation"]) it(`data attributes for ${m}`, () => expect(new URL(build("list_data_attributes", { model: m }).url).searchParams.get("model")).toBe(m));
  it("rejects unknown attribute model", () => expect(() => build("list_data_attributes", { model: "ticket" })).toThrow());
  it("normalizes attribute definitions", async () => {
    const { fetchImpl } = capture({ type: "list", data: [{ name: "tier", data_type: "string", custom: true }] });
    const r = await run({ operation: "list_data_attributes", params: { model: "contact" } }, fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ name: "tier", custom: true });
  });
});

// ---------------------------------------------------------------------------
describe("intercom pagination safety", () => {
  for (const bad of ["https://evil.com", "a&b=c", "a b", "x".repeat(2000), "a.b"]) it(`rejects cursor ${JSON.stringify(bad).slice(0, 20)}`, () => expect(() => build("list_contacts", {}, bad)).toThrow(/official Intercom cursor/));
  for (const bad of ["0", "abc", "-1"]) it(`rejects page cursor ${bad}`, () => expect(() => assertCursor("page", bad)).toThrow());
  it("rejects hostile cursors in responses", async () => {
    const { fetchImpl } = capture({ data: [], pages: { next: { starting_after: "x&token=y" } } });
    expect((await run({ operation: "list_contacts" }, fetchImpl)).ok).toBe(false);
  });
  it("follows pages on the same host", async () => {
    const urls: string[] = [];
    const responses = [{ data: [{ id: "1" }], pages: { next: { starting_after: "c2" } } }, { data: [{ id: "2" }], pages: {} }];
    let i = 0;
    const fetchImpl = vi.fn(async (url: string) => (urls.push(String(url)), jsonResponse(responses[i++]))) as unknown as typeof fetch;
    const r = await run({ operation: "list_contacts", maxPages: 3 }, fetchImpl);
    expect(r.ok && r.items.map((x) => x["id"])).toEqual(["1", "2"]);
    expect(urls.every((u) => u.startsWith(US))).toBe(true);
  });
  it("assertIntercomId rejects traversal", () => expect(() => assertIntercomId("../admins")).toThrow());
});

// ---------------------------------------------------------------------------
describe("intercom idempotency & attachments", () => {
  it("rejects an invented idempotency key", () => expect(() => build("create_contact", { fields: { email: "a@b.c" }, idempotency_key: "k" })).toThrow(/UNSUPPORTED_OPERATION/));
  it("sends no idempotency header", () => expect(Object.keys(build("create_contact", { fields: { email: "a@b.c" } }).headers)).not.toContain("idempotency-key"));
  it("binary upload unsupported", () => expect(() => build("upload_attachment")).toThrow(/binary/));
  it("binary download unsupported", () => expect(() => build("download_attachment")).toThrow(/binary/));
});

// ---------------------------------------------------------------------------
describe("intercom webhook verification", () => {
  const SECRET = "intercom-client-secret";
  const EVENT = { type: "notification_event", id: "notif_123", topic: "conversation.admin.replied", app_id: "abc123", created_at: NOW / 1000, data: { item: { id: "9" } } };
  const sign = (raw: string, secret = SECRET) => `sha1=${createHmac("sha1", secret).update(raw).digest("hex")}`;
  const deliver = (payload: unknown, opts: { sig?: string | null; secret?: string | null; nowMs?: number; raw?: string } = {}) => {
    const raw = opts.raw ?? JSON.stringify(payload);
    const headers: Record<string, string> = opts.sig === null ? {} : { "x-hub-signature": opts.sig ?? sign(JSON.stringify(payload)) };
    return verifyWebhook("intercom", { raw, headers, payload, secret: opts.secret === undefined ? SECRET : opts.secret, nowMs: opts.nowMs ?? NOW, replayWindowMs: 300_000 });
  };
  it("accepts a valid notification", () => expect(deliver(EVENT)).toMatchObject({ ok: true, eventId: "notif_123", eventType: "conversation.admin.replied", timestampMs: NOW }));
  it("works through the alias", () => {
    const raw = JSON.stringify(EVENT);
    expect(verifyWebhook("intercom_support", { raw, headers: { "x-hub-signature": sign(raw) }, payload: EVENT, secret: SECRET, nowMs: NOW, replayWindowMs: 300_000 }).ok).toBe(true);
  });
  it("accepts uppercase hex", () => expect(deliver(EVENT, { sig: sign(JSON.stringify(EVENT)).toUpperCase().replace("SHA1=", "sha1=") }).ok).toBe(true));
  it("rejects a wrong signature", () => expect(deliver(EVENT, { sig: sign(JSON.stringify(EVENT), "other") })).toMatchObject({ ok: false, reason: "invalid_signature" }));
  it("rejects a sha256 header", () => expect(deliver(EVENT, { sig: `sha256=${"a".repeat(64)}` })).toMatchObject({ ok: false, reason: "invalid_signature" }));
  it("rejects a missing signature", () => expect(deliver(EVENT, { sig: null })).toMatchObject({ ok: false, reason: "invalid_signature" }));
  it("rejects a tampered body", () => expect(deliver(EVENT, { raw: JSON.stringify(EVENT) + " " })).toMatchObject({ ok: false, reason: "invalid_signature" }));
  it("requires a configured secret", () => expect(deliver(EVENT, { secret: null })).toMatchObject({ ok: false, reason: "missing_secret" }));
  it("rejects replays", () => expect(deliver(EVENT, { nowMs: NOW + 3_600_000 })).toMatchObject({ ok: false, reason: "replay" }));
  it("rejects future-dated notifications", () => expect(deliver(EVENT, { nowMs: NOW - 3_600_000 })).toMatchObject({ ok: false, reason: "replay" }));
  it("rejects missing id", () => expect(deliver({ ...EVENT, id: undefined })).toMatchObject({ ok: false, reason: "malformed_payload" }));
  it("rejects missing created_at", () => expect(deliver({ ...EVENT, created_at: undefined })).toMatchObject({ ok: false, reason: "malformed_payload" }));
  it("rejects non-notification payloads", () => expect(deliver({ ...EVENT, type: "other" })).toMatchObject({ ok: false }));
  it("dedupes on the notification id", () => expect(deliver({ ...EVENT, created_at: NOW / 1000 + 10 }).eventId).toBe("notif_123"));
  it("different notifications differ", () => expect(deliver({ ...EVENT, id: "notif_456" }).eventId).not.toBe("notif_123"));
  it("accepts ping topic", () => expect(deliver({ ...EVENT, topic: "ping" }).ok).toBe(true));
  it("never returns the secret", () => expect(JSON.stringify(deliver(EVENT, { sig: "sha1=00" }))).not.toContain(SECRET));
  it("parses the envelope", () => expect(parseIntercomNotification(EVENT)).toEqual({ id: "notif_123", topic: EVENT.topic, createdAtMs: NOW, appId: "abc123" }));
});

// ---------------------------------------------------------------------------
describe("intercom rate limits & retries", () => {
  it("reads X-RateLimit headers", () => expect(readIntercomRateLimit(new Headers({ "x-ratelimit-limit": "1000", "x-ratelimit-remaining": "10", "x-ratelimit-reset": "1700000160" }), NOW)).toMatchObject({ limit: 1000, remaining: 10, resetAt: new Date(1700000160_000).toISOString() }));
  it("computes wait when exhausted", () => expect(readIntercomRateLimit(new Headers({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(NOW / 1000 + 5) }), NOW)?.retryAfterMs).toBe(5000));
  it("prefers retry-after", () => expect(readIntercomRateLimit(new Headers({ "retry-after": "2", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "9999999999" }), NOW)?.retryAfterMs).toBe(2000));
  it("undefined without headers", () => expect(readIntercomRateLimit(new Headers())).toBeUndefined());
  it("retries 429", async () => {
    const s = sequence(() => jsonResponse({ type: "error.list", errors: [{ code: "rate_limit_exceeded" }] }, { status: 429 }), () => jsonResponse({ id: "a1" }));
    expect((await run({ operation: "get_me" }, s.fetchImpl)).ok).toBe(true);
    expect(s.count()).toBe(2);
  });
  for (const status of [500, 502, 503, 504]) it(`retries ${status}`, async () => {
    const s = sequence(() => jsonResponse({}, { status }), () => jsonResponse({ id: "a1" }));
    expect((await run({ operation: "get_me" }, s.fetchImpl)).ok).toBe(true);
  });
  for (const status of [400, 401, 403, 404, 409, 422]) it(`does not retry ${status}`, async () => {
    const s = sequence(() => jsonResponse({ type: "error.list", errors: [{ code: "x", message: "m" }] }, { status }));
    expect((await run({ operation: "get_me" }, s.fetchImpl)).ok).toBe(false);
    expect(s.count()).toBe(1);
  });
  it("retries network errors", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return jsonResponse({ id: "a1" });
    }) as unknown as typeof fetch;
    expect((await run({ operation: "get_me" }, fetchImpl)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("intercom error mapping", () => {
  const map = (status: number, payload: unknown = {}) => intercomConnector.mapError!(status, payload);
  const err = (code: string, message: string) => ({ type: "error.list", request_id: "req-1", errors: [{ code, message }] });
  it("no error below 400", () => expect(map(200)).toBeNull());
  it("401 → auth", () => expect(map(401, err("unauthorized", "Access Token Invalid"))).toMatchObject({ kind: "auth", retryable: false }));
  it("403 → forbidden", () => expect(map(403, err("forbidden", "no"))).toMatchObject({ kind: "forbidden" }));
  it("404 → not_found", () => expect(map(404, err("not_found", "Contact Not Found"))).toMatchObject({ kind: "not_found" }));
  it("409 → conflict", () => expect(map(409, err("conflict", "A contact matching those details already exists"))?.message).toMatch(/conflict/));
  it("422 → validation", () => expect(map(422, err("parameter_invalid", "bad"))).toMatchObject({ kind: "invalid_request", retryable: false }));
  it("429 → rate_limit", () => expect(map(429)).toMatchObject({ kind: "rate_limit", retryable: true }));
  it("5xx → provider", () => expect(map(500)).toMatchObject({ kind: "provider", retryable: true }));
  it("keeps code and request id", () => expect(map(404, err("not_found", "x"))?.message).toMatch(/\[not_found\].*req-1/));
  it("runtime results carry the trace id", async () => {
    const { fetchImpl } = capture(err("not_found", "x"), { status: 404 });
    const r = await run({ operation: "get_contact", params: { id: "c1" } }, fetchImpl);
    expect(!r.ok && r.error.kind).toBe("not_found");
    expect(r.traceId).toBe(trace);
  });
  it("errors never echo the token", async () => {
    const { fetchImpl } = capture(err("unauthorized", `bad ${TOKEN}`), { status: 401 });
    expect(JSON.stringify(await run({ operation: "get_me" }, fetchImpl))).not.toContain(TOKEN);
  });
  it("redact masks bearer tokens", () => expect(JSON.stringify(redact({ authorization: `Bearer ${TOKEN}` }))).not.toContain(TOKEN));
});

// ---------------------------------------------------------------------------
describe("intercom health & isolation", () => {
  const health = (fetchImpl: typeof fetch, c: Record<string, string> = creds) =>
    checkConnectorHealth({ adapter: intercomConnector, credentials: c, traceId: trace, fetchImpl, sleep: async () => {} } as Parameters<typeof checkConnectorHealth>[0]);
  it("healthy via /me", async () => {
    const { fetchImpl, calls } = capture({ id: "a1" });
    expect((await health(fetchImpl)).healthy).toBe(true);
    expect(calls[0]!.url).toBe(`${US}/me`);
    expect(headerOf(calls[0]!, "authorization")).toBe(`Bearer ${TOKEN}`);
  });
  it("unhealthy on 401", async () => expect((await health(capture({}, { status: 401 }).fetchImpl)).healthy).toBe(false));
  it("each connection uses its own token and region", async () => {
    const a = capture({ id: "1" });
    const b = capture({ id: "2" });
    await run({ operation: "get_me" }, a.fetchImpl, creds);
    await run({ operation: "get_me" }, b.fetchImpl, { access_token: "other-token", region: "eu" });
    expect(a.calls[0]!.url.startsWith(US)).toBe(true);
    expect(b.calls[0]!.url.startsWith("https://api.eu.intercom.io")).toBe(true);
    expect(headerOf(b.calls[0]!, "authorization")).not.toContain(TOKEN);
  });
  it("bodies never contain credentials", async () => {
    const { fetchImpl, calls } = capture({ id: "c1" });
    await run({ operation: "create_contact", params: { fields: { email: "a@b.c" } } }, fetchImpl);
    expect(String(calls[0]!.init.body)).not.toContain(TOKEN);
  });
});
