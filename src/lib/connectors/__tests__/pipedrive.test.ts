import { describe, expect, it, vi } from "vitest";

import {
  PIPEDRIVE_OPERATIONS,
  PIPEDRIVE_PLACEHOLDER_ORIGIN,
  UNSUPPORTED_OPERATIONS,
  assertCursor,
  assertLeadId,
  assertNumericId,
  assertPipedriveApiDomain,
  pipedriveConnector,
  readPipedriveRateLimit,
} from "@/lib/connectors/adapters/pipedrive";
import { normalizePipedriveField, pipedriveCompanyDomain } from "@/lib/connectors/adapters/pipedrive-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { assertCanExecute } from "@/lib/execution/guard.server";
import { beginAuthorization, completeAuthorization, ensureAccessToken, hashState } from "@/lib/oauth/core";
import { getOAuthProvider } from "@/lib/oauth/providers";
import type { ConnectionAccount, OAuthStore, OAuthTokenSet, PendingAuthorization } from "@/lib/oauth/types";
import { verifyWebhook } from "@/lib/webhooks/verify";

const trace = "trace-pipedrive";
const TOKEN = "v1u:AQIBAHjPipedriveAccessTokenAAAA";
const TOKEN_B = "v1u:AQIBAHjPipedriveAccessTokenBBBB";
const API_TOKEN = "0123456789abcdef0123456789abcdef01234567";
const REFRESH = "pipedrive-refresh-token-0000";
const DOMAIN = "https://acme.pipedrive.com";
const creds = { access_token: TOKEN, api_domain: DOMAIN };
const NOW = 1_700_000_100_000;
const LEAD = "adf21080-0e10-11eb-879b-05d71fb426ec";

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
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    return responses[Math.min(i++, responses.length - 1)]!();
  }) as unknown as typeof fetch;
  return { fetchImpl, count: () => i, calls };
}
function run(input: Parameters<typeof runConnectorOperation>[0]["input"], fetchImpl: typeof fetch, credentials: Record<string, string> = creds) {
  return runConnectorOperation({ adapter: pipedriveConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {} });
}
const build = (operation: string, params: Record<string, unknown> = {}, cursor?: string) => pipedriveConnector.buildCall({ operation, params, ...(cursor ? { cursor } : {}) });
const urlOf = (c: { url: string }) => new URL(c.url);
const bodyOf = (c: { init: RequestInit } | undefined) => JSON.parse(String(c?.init.body ?? "{}")) as Record<string, unknown>;
const ok = (data: unknown, additional_data?: unknown) => ({ success: true, data, ...(additional_data ? { additional_data } : {}) });
const pdErr = (error: string, errorCode?: number) => ({ success: false, error, ...(errorCode ? { errorCode } : {}) });

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
      const existing = [...accounts.values()].find((a) => a.workspaceId === input.workspaceId && a.provider === input.provider && a.accountIdentifier === input.accountIdentifier);
      const { tokens: t, ...rest } = input;
      const account = { ...rest, id: existing?.id ?? `acc-${++seq}`, refreshFailures: 0 } as ConnectionAccount;
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
const spec = getOAuthProvider("pipedrive")!;
const pending = (ws = "ws1") => ({ workspaceId: ws, integrationId: null, provider: "pipedrive", connector: "pipedrive", redirectUri: "https://app.test/cb", createdBy: null });
const tokenBody = (over: Record<string, unknown> = {}) => ({ access_token: TOKEN, refresh_token: REFRESH, token_type: "Bearer", expires_in: 3599, scope: "base,deals:full", api_domain: DOMAIN, ...over });
async function connect(ws = "ws1", over: Record<string, unknown> = {}, mem = memoryStore()) {
  const { state, authorizationUrl } = await beginAuthorization({ store: mem.store, spec, clientId: "cid", pending: pending(ws), nowMs: NOW });
  const { fetchImpl, calls } = capture(tokenBody(over));
  const { account } = await completeAuthorization({ store: mem.store, spec, client: { clientId: "cid", clientSecret: "shh" }, state, code: "c1", fetchImpl, nowMs: NOW });
  return { ...mem, account, state, calls, authorizationUrl };
}

// ---------------------------------------------------------------------------
describe("pipedrive registration", () => {
  it("is registered with an alias", () => {
    expect(getConnector("pipedrive")?.id).toBe("pipedrive");
    expect(getConnector("pipedrive_crm")?.id).toBe("pipedrive");
    expect(getOAuthProvider("pipedrive_crm")?.connector).toBe("pipedrive");
  });
  it("describes oauth2 requiring the company domain", () => {
    const d = describeConnectors().find((c) => c.id === "pipedrive");
    expect(d?.authKind).toBe("oauth2");
    expect(d?.requiredCredentials).toEqual(["api_domain"]);
  });
  it("leaves previous connectors untouched", () => {
    for (const id of ["salesforce", "hubspot", "google_drive_api", "google_mail", "microsoft_graph", "shopify"]) expect(getConnector(id)?.id).toBe(id);
    expect(getOAuthProvider("salesforce")?.connector).toBe("salesforce");
  });
  it("health operation is get_current_user", () => expect(pipedriveConnector.healthOperation).toBe("get_current_user"));
  it("exposes no unsupported operation", () => {
    for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) expect(PIPEDRIVE_OPERATIONS).not.toContain(op);
  });
  for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) it(`rejects ${op} as UNSUPPORTED_OPERATION`, () => expect(() => build(op)).toThrow(/UNSUPPORTED_OPERATION/));
  it("rejects unknown operations", () => expect(() => build("nope")).toThrow(/Unknown Pipedrive operation/));
});

// ---------------------------------------------------------------------------
describe("pipedrive OAuth", () => {
  it("uses official endpoints", () => {
    expect(spec.authorizationUrl).toBe("https://oauth.pipedrive.com/oauth/authorize");
    expect(spec.tokenUrl).toBe("https://oauth.pipedrive.com/oauth/token");
    expect(spec.revokeUrl).toBe("https://oauth.pipedrive.com/oauth/revoke");
  });
  it("sends client credentials via Basic auth", async () => {
    const { calls } = await connect();
    const auth = (calls[0]!.init.headers as Record<string, string>)["authorization"] ?? (calls[0]!.init.headers as Record<string, string>)["Authorization"];
    expect(auth).toBe(`Basic ${Buffer.from("cid:shh").toString("base64")}`);
    expect(String(calls[0]!.init.body)).toContain("grant_type=authorization_code");
  });
  it("does not send a scope parameter (scopes live on the app)", async () => {
    const { authorizationUrl } = await connect();
    expect(new URL(authorizationUrl).searchParams.get("scope")).toBeNull();
  });
  it("stores only the hashed state", async () => {
    const { store, states } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    expect(states.has(hashState(state))).toBe(true);
    expect(states.has(state)).toBe(false);
  });
  it("rejects a replayed state", async () => {
    const mem = memoryStore();
    const { state } = await connect("ws1", {}, mem);
    await expect(completeAuthorization({ store: mem.store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "x", fetchImpl: capture(tokenBody()).fetchImpl, nowMs: NOW })).rejects.toThrow();
  });
  it("rejects an unknown state", async () => {
    const { store } = memoryStore();
    await expect(completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: "forged", code: "x", fetchImpl: capture(tokenBody()).fetchImpl, nowMs: NOW })).rejects.toThrow();
  });
  it("rejects an expired state", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    await expect(completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "x", fetchImpl: capture(tokenBody()).fetchImpl, nowMs: NOW + 86_400_000 })).rejects.toThrow();
  });
  it("binds the account to the company domain", async () => {
    const { account } = await connect();
    expect(account.accountIdentifier).toBe("company:acme");
    expect(account.accountLabel).toBe("acme.pipedrive.com");
  });
  it("stores api_domain with the vault token set", async () => {
    const { account, tokens } = await connect();
    expect(tokens.get(account.id)?.extra).toEqual({ api_domain: DOMAIN });
    expect(tokens.get(account.id)?.refreshToken).toBe(REFRESH);
  });
  it("never stores a foreign api_domain", async () => {
    const { account, tokens } = await connect("ws1", { api_domain: "https://evil.example.com" });
    expect(tokens.get(account.id)?.extra?.["api_domain"]).toBeUndefined();
  });
  it("records expiry from expires_in", async () => {
    const { account, tokens } = await connect();
    expect(new Date(tokens.get(account.id)!.expiresAt!).getTime()).toBe(NOW + 3599_000);
  });
  it("keeps a valid token", async () => {
    const { store, account } = await connect();
    const { fetchImpl } = capture({});
    expect((await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW })).refreshed).toBe(false);
  });
  it("refreshes an expired token", async () => {
    const { store, account, tokens } = await connect();
    const { calls, fetchImpl } = capture(tokenBody({ access_token: TOKEN_B }));
    const r = await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW + 7200_000 });
    expect(r.refreshed).toBe(true);
    expect(r.token).toBe(TOKEN_B);
    expect(String(calls[0]!.init.body)).toContain("grant_type=refresh_token");
    expect(tokens.get(account.id)?.extra?.["api_domain"]).toBe(DOMAIN);
  });
  it("marks the account when refresh fails", async () => {
    const { store, account, accounts } = await connect();
    await expect(ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl: capture({ error: "invalid_grant" }, { status: 400 }).fetchImpl, nowMs: NOW + 7200_000 })).rejects.toThrow();
    expect(accounts.get(account.id)?.status).not.toBe("connected");
  });
});

// ---------------------------------------------------------------------------
describe("pipedrive company isolation / host safety", () => {
  it("two companies are independent connections", async () => {
    const mem = memoryStore();
    const a = await connect("ws1", {}, mem);
    const b = await connect("ws1", { api_domain: "https://beta.pipedrive.com" }, mem);
    expect(a.account.id).not.toBe(b.account.id);
  });
  it("reconnecting the same company reuses the account", async () => {
    const mem = memoryStore();
    expect((await connect("ws1", {}, mem)).account.id).toBe((await connect("ws1", {}, mem)).account.id);
  });
  it("same company in two workspaces is two accounts", async () => {
    const mem = memoryStore();
    expect((await connect("ws1", {}, mem)).account.id).not.toBe((await connect("ws2", {}, mem)).account.id);
  });
  it("a workspace cannot read another workspace's connection", async () => {
    const mem = memoryStore();
    const { account } = await connect("ws1", {}, mem);
    expect(await mem.store.getAccount("ws2", account.id)).toBeNull();
  });
  for (const good of [DOMAIN, "https://my-co-2.pipedrive.com"]) it(`accepts ${good}`, () => expect(assertPipedriveApiDomain(good)).toBe(good));
  for (const bad of ["http://acme.pipedrive.com", "https://evil.com", "https://pipedrive.com.evil.com", "https://acme.pipedrive.com:444", "https://u:p@acme.pipedrive.com", "https://a.b.pipedrive.com", "", "x"])
    it(`rejects ${bad || "(empty)"}`, () => expect(() => assertPipedriveApiDomain(bad)).toThrow());
  it("company domain parser", () => {
    expect(pipedriveCompanyDomain(DOMAIN)).toBe("acme");
    expect(pipedriveCompanyDomain("https://evil.com")).toBeNull();
  });
  it("calls go to the company's own domain", async () => {
    const { calls, fetchImpl } = capture(ok({ id: 1 }));
    await run({ operation: "get_current_user" }, fetchImpl, { access_token: TOKEN, api_domain: "https://beta.pipedrive.com" });
    expect(urlOf(calls[0]!).origin).toBe("https://beta.pipedrive.com");
  });
  it("foreign api_domain never calls out", async () => {
    const { fetchImpl } = capture({});
    const r = await run({ operation: "get_current_user" }, fetchImpl, { access_token: TOKEN, api_domain: "https://evil.example.com" });
    expect(!r.ok && r.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refuses calls not built for the company", () => expect(() => pipedriveConnector.authorize({ method: "GET", url: "https://evil.com/x", headers: {} }, creds)).toThrow());
  it("builds on the placeholder origin", () => expect(build("get_current_user").url.startsWith(PIPEDRIVE_PLACEHOLDER_ORIGIN)).toBe(true));
  it("uses bearer for OAuth", () => expect(pipedriveConnector.authorize(build("get_current_user"), creds).headers["authorization"]).toBe(`Bearer ${TOKEN}`));
  it("uses the x-api-token header for API tokens, never the URL", () => {
    const c = pipedriveConnector.authorize(build("get_current_user"), { api_token: API_TOKEN, api_domain: DOMAIN });
    expect(c.headers["x-api-token"]).toBe(API_TOKEN);
    expect(c.url).not.toContain(API_TOKEN);
  });
  it("prefers OAuth over an API token", () => expect(pipedriveConnector.authorize(build("get_current_user"), { ...creds, api_token: API_TOKEN }).headers["x-api-token"]).toBeUndefined());
  it("fails without any token", () => expect(() => pipedriveConnector.authorize(build("get_current_user"), { api_domain: DOMAIN })).toThrow(/not connected/));
});

// ---------------------------------------------------------------------------
describe("pipedrive account / users / teams", () => {
  const ME = { id: 7, name: "Ann", email: "ann@acme.com", company_id: 42, company_name: "Acme", company_domain: "acme", active_flag: true, is_admin: 1, timezone_name: "Asia/Riyadh" };
  it("reads the current user and company", async () => {
    const { calls, fetchImpl } = capture(ok(ME));
    const r = await run({ operation: "get_current_user" }, fetchImpl);
    expect(urlOf(calls[0]!).pathname).toBe("/api/v1/users/me");
    expect(r.ok && r.items[0]).toMatchObject({ id: 7, company_id: 42, company_name: "Acme", company_domain: "acme", is_admin: true });
  });
  it("lists users", async () => {
    const r = await run({ operation: "list_users" }, capture(ok([ME, { ...ME, id: 8 }])).fetchImpl);
    expect(r.ok && r.items.length).toBe(2);
  });
  it("gets a user", () => expect(build("get_user", { id: 8 }).url).toContain("/api/v1/users/8"));
  it("lists teams", () => expect(build("list_teams").url).toContain("/api/v1/legacyTeams"));
  it("gets a team", () => expect(build("get_team", { id: 3 }).url).toContain("/api/v1/legacyTeams/3"));
  it("health check is healthy", async () => {
    expect((await checkConnectorHealth({ adapter: pipedriveConnector, credentials: creds, traceId: trace, fetchImpl: capture(ok(ME)).fetchImpl, sleep: async () => {} })).healthy).toBe(true);
  });
  it("health check is unhealthy on 401 without leaking the token", async () => {
    const h = await checkConnectorHealth({ adapter: pipedriveConnector, credentials: creds, traceId: trace, fetchImpl: capture(pdErr(`unauthorized ${TOKEN}`, 401), { status: 401 }).fetchImpl, sleep: async () => {} });
    expect(h.healthy).toBe(false);
    expect(h.message).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
describe("pipedrive v2 entities", () => {
  const entities: [string, string][] = [["person", "persons"], ["organization", "organizations"], ["deal", "deals"], ["activity", "activities"], ["product", "products"]];
  for (const [one, many] of entities) {
    it(`create_${one} POSTs v2`, async () => {
      const { calls, fetchImpl } = capture(ok({ id: 5, name: "X" }), { status: 201 });
      const r = await run({ operation: `create_${one}`, params: { fields: { name: "X" } } }, fetchImpl);
      expect(calls[0]!.init.method).toBe("POST");
      expect(urlOf(calls[0]!).pathname).toBe(`/api/v2/${many}`);
      expect(bodyOf(calls[0])).toEqual({ name: "X" });
      expect(r.ok && r.items[0]).toMatchObject({ id: 5 });
    });
    it(`get_${one}`, async () => {
      const { calls, fetchImpl } = capture(ok({ id: 5 }));
      await run({ operation: `get_${one}`, params: { id: 5, custom_fields: ["abc"] } }, fetchImpl);
      expect(urlOf(calls[0]!).pathname).toBe(`/api/v2/${many}/5`);
      expect(urlOf(calls[0]!).searchParams.get("custom_fields")).toBe("abc");
    });
    it(`update_${one} PATCHes`, async () => {
      const { calls, fetchImpl } = capture(ok({ id: 5 }));
      await run({ operation: `update_${one}`, params: { id: 5, fields: { name: "Y" } } }, fetchImpl);
      expect(calls[0]!.init.method).toBe("PATCH");
    });
    it(`delete_${one}`, async () => {
      const { calls, fetchImpl } = capture(ok({ id: 5 }));
      const r = await run({ operation: `delete_${one}`, params: { id: 5 } }, fetchImpl);
      expect(calls[0]!.init.method).toBe("DELETE");
      expect(r.ok && r.items[0]).toEqual({ id: 5, deleted: true });
    });
    it(`list_${many} follows v2 cursors`, async () => {
      const s = sequence(() => jsonResponse(ok([{ id: 1 }], { next_cursor: "eyJpZCI6MX0" })), () => jsonResponse(ok([{ id: 2 }], { next_cursor: null })));
      const r = await run({ operation: `list_${many}`, maxPages: 5 }, s.fetchImpl);
      expect(r.ok && r.items.length).toBe(2);
      expect(new URL(s.calls[1]!).searchParams.get("cursor")).toBe("eyJpZCI6MX0");
    });
    it(`get_${one} rejects a non-numeric id`, () => expect(() => build(`get_${one}`, { id: "../1" })).toThrow(/numeric/));
  }
  it("deal relationship filters pass through", () => {
    const u = new URL(build("list_deals", { person_id: 1, org_id: 2, pipeline_id: 3, stage_id: 4, status: "open" }).url);
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ person_id: "1", org_id: "2", pipeline_id: "3", stage_id: "4", status: "open" });
  });
  it("activity relationship filters", () => expect(new URL(build("list_activities", { deal_id: 9, done: false }).url).searchParams.get("deal_id")).toBe("9"));
  it("caps limit at 500", () => expect(new URL(build("list_persons", { limit: 9999 }).url).searchParams.get("limit")).toBe("500"));
  it("rejects invalid field keys", () => expect(() => build("create_person", { fields: { "a b": 1 } })).toThrow());
  it("keeps custom field hash keys", () => expect(bodyOf({ init: { body: JSON.stringify(build("create_deal", { fields: { "5f3c0a9b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b": "x" } }).body) } })).toHaveProperty("5f3c0a9b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b"));
  it("requires fields", () => expect(() => build("create_deal")).toThrow(/required/));
});

// ---------------------------------------------------------------------------
describe("pipedrive leads / notes (v1)", () => {
  it("create_lead", () => expect(build("create_lead", { fields: { title: "L" } }).url).toContain("/api/v1/leads"));
  it("get_lead uses UUID", () => expect(build("get_lead", { id: LEAD }).url).toContain(`/api/v1/leads/${LEAD}`));
  it("update_lead PATCHes", () => expect(build("update_lead", { id: LEAD, fields: { title: "M" } }).method).toBe("PATCH"));
  it("delete_lead", () => expect(build("delete_lead", { id: LEAD }).method).toBe("DELETE"));
  it("rejects numeric lead ids", () => expect(() => assertLeadId("12")).toThrow(/UUID/));
  it("list_leads follows offset pagination", async () => {
    const s = sequence(() => jsonResponse(ok([{ id: LEAD }], { pagination: { start: 0, limit: 1, more_items_in_collection: true, next_start: 1 } })), () => jsonResponse(ok([{ id: LEAD }], { pagination: { more_items_in_collection: false } })));
    const r = await run({ operation: "list_leads", maxPages: 5 }, s.fetchImpl);
    expect(r.ok && r.items.length).toBe(2);
    expect(new URL(s.calls[1]!).searchParams.get("start")).toBe("1");
  });
  it("search_leads uses v1 search", async () => {
    const { calls, fetchImpl } = capture(ok({ items: [{ result_score: 1, item: { id: LEAD, type: "lead" } }] }));
    const r = await run({ operation: "search_leads", params: { term: "acme" } }, fetchImpl);
    expect(urlOf(calls[0]!).pathname).toBe("/api/v1/leads/search");
    expect(r.ok && r.items[0]).toMatchObject({ id: LEAD, type: "lead" });
  });
  it("create_note", () => expect(build("create_note", { fields: { content: "hi", deal_id: 1 } }).url).toContain("/api/v1/notes"));
  it("get_note", () => expect(build("get_note", { id: 2 }).url).toContain("/api/v1/notes/2"));
  it("update_note uses PUT", () => expect(build("update_note", { id: 2, fields: { content: "x" } }).method).toBe("PUT"));
  it("delete_note", () => expect(build("delete_note", { id: 2 }).method).toBe("DELETE"));
  it("list_notes with relationship filters", () => expect(new URL(build("list_notes", { deal_id: 4 }).url).searchParams.get("deal_id")).toBe("4"));
});

// ---------------------------------------------------------------------------
describe("pipedrive pipelines / stages / fields", () => {
  it("list_pipelines", () => expect(build("list_pipelines").url).toContain("/api/v2/pipelines"));
  it("get_pipeline", () => expect(build("get_pipeline", { id: 1 }).url).toContain("/api/v2/pipelines/1"));
  it("list_stages by pipeline", () => expect(new URL(build("list_stages", { pipeline_id: 1 }).url).searchParams.get("pipeline_id")).toBe("1"));
  it("get_stage", () => expect(build("get_stage", { id: 2 }).url).toContain("/api/v2/stages/2"));
  for (const [e, p] of [["person", "personFields"], ["organization", "organizationFields"], ["deal", "dealFields"], ["product", "productFields"], ["activity", "activityFields"], ["note", "noteFields"]])
    it(`list_${e}_fields`, () => expect(build(`list_${e}_fields`).url).toContain(`/api/v1/${p}`));
  it("normalizes custom field definitions", async () => {
    const r = await run({ operation: "list_deal_fields" }, capture(ok([{ id: 1, key: "5f3c0a9b8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b", name: "Region", field_type: "enum", options: [{ id: 3, label: "KSA" }] }, { id: 2, key: "title", name: "Title", field_type: "varchar", mandatory_flag: true }])).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ custom: true, field_type: "enum", options: [{ id: 3, label: "KSA" }] });
    expect(r.ok && r.items[1]).toMatchObject({ custom: false, mandatory: true });
  });
  it("field normalizer handles object mandatory_flag", () => expect(normalizePipedriveField({ key: "x", mandatory_flag: { value: true } })["mandatory"]).toBe(true));
});

// ---------------------------------------------------------------------------
describe("pipedrive search", () => {
  for (const [op, path] of [["search_persons", "/api/v2/persons/search"], ["search_organizations", "/api/v2/organizations/search"], ["search_deals", "/api/v2/deals/search"], ["search_products", "/api/v2/products/search"], ["search_items", "/api/v2/itemSearch"]])
    it(`${op} → ${path}`, async () => {
      const { calls, fetchImpl } = capture(ok({ items: [{ result_score: 0.9, item: { id: 1, type: "person", name: "A" } }] }));
      const r = await run({ operation: op!, params: { term: "acme", fields: ["name", "email"] } }, fetchImpl);
      expect(urlOf(calls[0]!).pathname).toBe(path);
      expect(urlOf(calls[0]!).searchParams.get("fields")).toBe("name,email");
      expect(r.ok && r.items[0]).toMatchObject({ id: 1, result_score: 0.9 });
    });
  it("requires 2 characters", () => expect(() => build("search_persons", { term: "a" })).toThrow(/2 characters/));
  it("allows 1 character with exact_match", () => expect(new URL(build("search_persons", { term: "a", exact_match: true }).url).searchParams.get("exact_match")).toBe("true"));
  it("requires term", () => expect(() => build("search_deals")).toThrow(/required/));
  it("search follows v2 cursor", async () => {
    const s = sequence(() => jsonResponse(ok({ items: [] }, { next_cursor: "abc" })), () => jsonResponse(ok({ items: [] })));
    await run({ operation: "search_persons", params: { term: "ac" }, maxPages: 3 }, s.fetchImpl);
    expect(s.count()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
describe("pipedrive pagination safety", () => {
  it("returns the v2 cursor when the page budget ends", async () => {
    const r = await run({ operation: "list_deals" }, capture(ok([], { next_cursor: "nxt" })).fetchImpl);
    expect(r.ok && r.cursor).toBe("nxt");
  });
  it("resumes from a cursor", () => expect(new URL(build("list_deals", {}, "nxt").url).searchParams.get("cursor")).toBe("nxt"));
  it("resumes v1 offsets", () => expect(new URL(build("list_notes", {}, "200").url).searchParams.get("start")).toBe("200"));
  for (const bad of ["https://evil.com", "a b", "x&api_token=1", "../x?y"]) it(`rejects cursor ${bad}`, () => expect(() => assertCursor("cursor", bad)).toThrow());
  it("rejects non-numeric offsets", () => expect(() => assertCursor("offset", "1;2")).toThrow());
  it("cursor cannot change the host", () => expect(urlOf(pipedriveConnector.authorize(build("list_deals", {}, "abc"), creds)).origin).toBe(DOMAIN));
  it("rejects a malformed provider cursor", async () => {
    const r = await run({ operation: "list_deals", maxPages: 2 }, capture(ok([], { next_cursor: "https://evil.com/x y" })).fetchImpl);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("pipedrive webhooks", () => {
  const SECRET = "zx-hook:s3cret-pass";
  const basic = (v = SECRET) => `Basic ${Buffer.from(v).toString("base64")}`;
  const EVENT = { meta: { id: "bd1d6c33-ff4a-4f1c-8a8a-7f9e3c7ab001", action: "change", entity: "deal", entity_id: "99", company_id: "42", version: "2.0", timestamp: new Date(NOW - 5_000).toISOString() }, data: { id: 99 }, previous: {} };
  const deliver = (payload: unknown, opts: { auth?: string | null; secret?: string | null; nowMs?: number } = {}) =>
    verifyWebhook("pipedrive", { raw: JSON.stringify(payload), headers: opts.auth === null ? {} : { authorization: opts.auth ?? basic() }, payload, secret: opts.secret === undefined ? SECRET : opts.secret, nowMs: opts.nowMs ?? NOW, replayWindowMs: 300_000 });
  it("accepts valid v2 events", () => expect(deliver(EVENT)).toMatchObject({ ok: true, eventId: EVENT.meta.id, eventType: "deal.change" }));
  it("uses meta.id as the dedupe key (not the timestamp)", () => {
    const again = deliver({ ...EVENT, meta: { ...EVENT.meta, timestamp: new Date(NOW).toISOString() } });
    expect(again.eventId).toBe(EVENT.meta.id);
  });
  it("different events have different ids", () => expect(deliver({ ...EVENT, meta: { ...EVENT.meta, id: "other-id" } }).eventId).not.toBe(EVENT.meta.id));
  it("works through the alias", () => expect(verifyWebhook("pipedrive_crm", { raw: "{}", headers: { authorization: basic() }, payload: EVENT, secret: SECRET, nowMs: NOW, replayWindowMs: 300_000 }).ok).toBe(true));
  it("rejects wrong credentials", () => expect(deliver(EVENT, { auth: basic("zx-hook:wrong") })).toMatchObject({ ok: false, reason: "invalid_signature" }));
  it("rejects missing auth", () => expect(deliver(EVENT, { auth: null })).toMatchObject({ ok: false, reason: "invalid_signature" }));
  it("rejects bearer auth", () => expect(deliver(EVENT, { auth: `Bearer ${SECRET}` })).toMatchObject({ ok: false }));
  it("rejects without a configured secret", () => expect(deliver(EVENT, { secret: null })).toMatchObject({ ok: false, reason: "missing_secret" }));
  it("rejects v1 payloads", () => expect(deliver({ meta: { v: 1, action: "updated", object: "deal", id: 99, timestamp: NOW / 1000 } })).toMatchObject({ ok: false, reason: "unsupported_event" }));
  it("rejects events without meta.id", () => expect(deliver({ ...EVENT, meta: { ...EVENT.meta, id: undefined } })).toMatchObject({ ok: false, reason: "malformed_payload" }));
  it("rejects events without timestamp", () => expect(deliver({ ...EVENT, meta: { ...EVENT.meta, timestamp: undefined } })).toMatchObject({ ok: false, reason: "malformed_payload" }));
  it("rejects stale events (replay)", () => expect(deliver(EVENT, { nowMs: NOW + 3_600_000 })).toMatchObject({ ok: false, reason: "replay" }));
  it("rejects future-dated events", () => expect(deliver({ ...EVENT, meta: { ...EVENT.meta, timestamp: new Date(NOW + 3_600_000).toISOString() } })).toMatchObject({ ok: false, reason: "replay" }));
  it("never returns the secret", () => expect(JSON.stringify(deliver(EVENT, { auth: basic("x:y") }))).not.toContain("s3cret"));
  it("create_webhook requests v2 with Basic credentials", () => {
    const b = build("create_webhook", { subscription_url: "https://zx.app/api/public/webhooks/abc", event_action: "change", event_object: "deal", http_auth_user: "zx-hook", http_auth_password: "p" }).body as Record<string, unknown>;
    expect(b).toMatchObject({ version: "2.0", event_action: "change", event_object: "deal", http_auth_user: "zx-hook" });
  });
  it("create_webhook rejects http URLs", () => expect(() => build("create_webhook", { subscription_url: "http://x", event_action: "change", event_object: "deal" })).toThrow());
  it("create_webhook rejects unknown objects", () => expect(() => build("create_webhook", { subscription_url: "https://x", event_action: "change", event_object: "invoice" })).toThrow());
  it("create_webhook rejects unknown actions", () => expect(() => build("create_webhook", { subscription_url: "https://x", event_action: "updated", event_object: "deal" })).toThrow());
  it("list/delete webhooks", () => {
    expect(build("list_webhooks").url).toContain("/api/v1/webhooks");
    expect(build("delete_webhook", { id: 3 }).method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
describe("pipedrive errors", () => {
  const cases: [number, unknown, string, boolean][] = [
    [400, pdErr("Bad request"), "invalid_request", false],
    [401, pdErr("unauthorized access", 401), "auth", false],
    [402, pdErr("Payment required"), "forbidden", false],
    [403, pdErr("Forbidden"), "forbidden", false],
    [404, pdErr("Not found"), "not_found", false],
    [409, pdErr("Conflict"), "invalid_request", false],
    [410, pdErr("Gone"), "not_found", false],
    [422, pdErr("Unprocessable"), "invalid_request", false],
    [429, pdErr("Too many requests"), "rate_limit", true],
    [500, pdErr("Internal"), "provider", true],
    [503, pdErr("Unavailable"), "provider", true],
  ];
  for (const [status, body, kind, retryable] of cases) it(`${status} → ${kind}`, () => expect(pipedriveConnector.mapError!(status, body)).toMatchObject({ kind, retryable }));
  it("2xx with success:false is an error", () => expect(pipedriveConnector.mapError!(200, pdErr("nope"))).toMatchObject({ kind: "invalid_request" }));
  it("ignores successful bodies", () => expect(pipedriveConnector.mapError!(200, ok({}))).toBeNull());
  it("keeps safe provider details", () => expect(pipedriveConnector.mapError!(400, pdErr("Field 'x' invalid", 400))?.message).toContain("Field 'x' invalid"));
});

// ---------------------------------------------------------------------------
describe("pipedrive rate limits / retry", () => {
  it("reads x-ratelimit headers", () => expect(readPipedriveRateLimit(new Headers({ "x-ratelimit-limit": "80", "x-ratelimit-remaining": "79", "x-ratelimit-reset": "2" }))).toEqual({ limit: 80, remaining: 79 }));
  it("derives a wait when exhausted", () => expect(readPipedriveRateLimit(new Headers({ "x-ratelimit-limit": "80", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "2" }))?.retryAfterMs).toBe(2000));
  it("reads retry-after", () => expect(readPipedriveRateLimit(new Headers({ "retry-after": "3" }))?.retryAfterMs).toBe(3000));
  it("undefined without headers", () => expect(readPipedriveRateLimit(new Headers())).toBeUndefined());
  it("retries 429 then succeeds", async () => {
    const s = sequence(() => jsonResponse(pdErr("slow"), { status: 429, headers: { "retry-after": "1" } }), () => jsonResponse(ok({ id: 1 })));
    const r = await run({ operation: "get_current_user" }, s.fetchImpl);
    expect(r.ok && r.attempts).toBe(2);
  });
  it("retries 5xx", async () => {
    const s = sequence(() => jsonResponse(pdErr("x"), { status: 502 }), () => jsonResponse(ok({ id: 1 })));
    expect((await run({ operation: "get_current_user" }, s.fetchImpl)).ok).toBe(true);
  });
  it("retries network errors", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return jsonResponse(ok({ id: 1 }));
    }) as unknown as typeof fetch;
    expect((await run({ operation: "get_current_user" }, fetchImpl)).ok).toBe(true);
  });
  for (const status of [400, 401, 403, 404]) it(`does not retry ${status}`, async () => {
    const s = sequence(() => jsonResponse(pdErr("x"), { status }));
    await run({ operation: "get_current_user" }, s.fetchImpl);
    expect(s.count()).toBe(1);
  });
  it("gives up after max attempts", async () => {
    const s = sequence(() => jsonResponse(pdErr("x"), { status: 500 }));
    expect((await run({ operation: "get_current_user" }, s.fetchImpl)).ok).toBe(false);
    expect(s.count()).toBe(3);
  });
  it("rejects malformed JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("{bad", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const r = await run({ operation: "get_current_user" }, fetchImpl);
    expect(!r.ok && r.error.kind).toBe("malformed_response");
  });
});

// ---------------------------------------------------------------------------
describe("pipedrive idempotency / security", () => {
  it("claims no idempotency header", () => {
    expect(Object.keys(build("create_deal", { fields: { title: "x" } }).headers).some((k) => /idempot/i.test(k))).toBe(false);
    expect(UNSUPPORTED_OPERATIONS["idempotency_key"]).toBeDefined();
  });
  function rbacClient(role: string | null) {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: role ? { role } : null, error: null }) };
    return { from: () => chain } as unknown as Parameters<typeof assertCanExecute>[0];
  }
  for (const role of ["owner", "admin", "member"]) it(`RBAC allows ${role}`, async () => expect(assertCanExecute(rbacClient(role), "ws1", "u1")).resolves.toBe(role));
  for (const role of ["viewer", null]) it(`RBAC blocks ${role ?? "non-members"}`, async () => expect(assertCanExecute(rbacClient(role), "ws1", "u1")).rejects.toThrow(/permission/));
  it("never returns the token in results", async () => expect(JSON.stringify(await run({ operation: "get_current_user" }, capture(ok({ id: 1 })).fetchImpl))).not.toContain(TOKEN));
  it("scrubs a token echoed in errors", async () => expect(JSON.stringify(await run({ operation: "get_current_user" }, capture(pdErr(`bad ${TOKEN}`), { status: 401 }).fetchImpl))).not.toContain(TOKEN));
  it("scrubs an API token echoed in errors", async () => expect(JSON.stringify(await run({ operation: "get_current_user" }, capture(pdErr(`bad ${API_TOKEN}`), { status: 401 }).fetchImpl, { api_token: API_TOKEN, api_domain: DOMAIN }))).not.toContain(API_TOKEN));
  it("scrubs network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`reset ${TOKEN}`);
    }) as unknown as typeof fetch;
    expect(JSON.stringify(await run({ operation: "get_current_user" }, fetchImpl))).not.toContain(TOKEN);
  });
  it("redact() masks bearer tokens", () => expect(JSON.stringify(redact({ authorization: `Bearer ${TOKEN}` }))).not.toContain(TOKEN));
  it("carries trace ids", async () => {
    expect((await run({ operation: "get_current_user" }, capture(ok({})).fetchImpl)).traceId).toBe(trace);
    expect((await run({ operation: "get_current_user" }, capture(pdErr("x"), { status: 404 }).fetchImpl)).traceId).toBe(trace);
  });
  it("emits redacted events with the trace id", async () => {
    const events: string[] = [];
    await runConnectorOperation({ adapter: pipedriveConnector, credentials: creds, traceId: trace, input: { operation: "get_current_user" }, fetchImpl: capture(pdErr(`t ${TOKEN}`), { status: 401 }).fetchImpl, sleep: async () => {}, onEvent: (e) => events.push(JSON.stringify(e)) });
    expect(events.join("")).toContain(trace);
    expect(events.join("")).not.toContain(TOKEN);
  });
  it("fails before network without the company domain", async () => {
    const { fetchImpl } = capture({});
    const r = await run({ operation: "get_current_user" }, fetchImpl, { access_token: TOKEN });
    expect(!r.ok && r.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("validates numeric ids", () => {
    expect(assertNumericId(12)).toBe("12");
    expect(() => assertNumericId("0")).toThrow();
    expect(() => assertNumericId("1%2F")).toThrow();
  });
});
