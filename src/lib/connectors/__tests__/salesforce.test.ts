import { describe, expect, it, vi } from "vitest";

import {
  SALESFORCE_API_VERSION,
  SALESFORCE_OPERATIONS,
  SALESFORCE_PLACEHOLDER_ORIGIN,
  STANDARD_OBJECTS,
  UNSUPPORTED_OPERATIONS,
  assertNextRecordsUrl,
  assertObjectName,
  assertRecordId,
  assertSalesforceInstanceUrl,
  assertSoql,
  assertSosl,
  readSalesforceLimitInfo,
  salesforceConnector,
} from "@/lib/connectors/adapters/salesforce";
import { normalizeSalesforceField, parseSalesforceIdentityUrl } from "@/lib/connectors/adapters/salesforce-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { assertCanExecute } from "@/lib/execution/guard.server";
import { beginAuthorization, completeAuthorization, ensureAccessToken, hashState } from "@/lib/oauth/core";
import { getOAuthProvider } from "@/lib/oauth/providers";
import type { ConnectionAccount, OAuthStore, OAuthTokenSet, PendingAuthorization } from "@/lib/oauth/types";

const trace = "trace-salesforce";
const TOKEN = "00Dxx0000001gPL!AQ4AQSalesforceAccessTokenAAAA";
const TOKEN_B = "00Dxx0000001gPL!AQ4AQSalesforceAccessTokenBBBB";
const REFRESH = "5Aep861SalesforceRefreshToken0000";
const INSTANCE = "https://acme.my.salesforce.com";
const ORG = "00Dxx0000001gPLEAY";
const USER = "005xx000001X8UzAAK";
const ID_URL = `https://login.salesforce.com/id/${ORG}/${USER}`;
const REC_ID = "001xx000003DGb2AAG";
const creds = { access_token: TOKEN, instance_url: INSTANCE };
const NOW = 1_700_000_100_000;
const V = `/services/data/${SALESFORCE_API_VERSION}`;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status: init.status ?? 200,
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
function run(input: Parameters<typeof runConnectorOperation>[0]["input"], fetchImpl: typeof fetch, credentials: Record<string, string> = creds) {
  return runConnectorOperation({ adapter: salesforceConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {} });
}
const build = (operation: string, params: Record<string, unknown> = {}, cursor?: string) => salesforceConnector.buildCall({ operation, params, ...(cursor ? { cursor } : {}) });
const urlOf = (c: { url: string }) => new URL(c.url);
const bodyOf = (c: { init: RequestInit } | undefined) => JSON.parse(String(c?.init.body ?? "{}")) as Record<string, unknown>;
const sfErr = (message: string, errorCode: string) => [{ message, errorCode, fields: [] }];
const RECORD = { attributes: { type: "Account", url: `${V}/sobjects/Account/${REC_ID}` }, Id: REC_ID, Name: "Acme" };

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
const spec = getOAuthProvider("salesforce")!;
const sandbox = getOAuthProvider("salesforce_sandbox")!;
const pending = (ws = "ws1") => ({ workspaceId: ws, integrationId: null, provider: "salesforce", connector: "salesforce", redirectUri: "https://app.test/cb", createdBy: null });
const tokenBody = (over: Record<string, unknown> = {}) => ({ access_token: TOKEN, refresh_token: REFRESH, instance_url: INSTANCE, id: ID_URL, token_type: "Bearer", issued_at: String(NOW), signature: "sig", scope: "api refresh_token id", ...over });
async function connect(ws = "ws1", over: Record<string, unknown> = {}, mem = memoryStore(), s = spec) {
  const { state, authorizationUrl } = await beginAuthorization({ store: mem.store, spec: s, clientId: "cid", pending: pending(ws), nowMs: NOW });
  const { fetchImpl, calls } = capture(tokenBody(over));
  const { account } = await completeAuthorization({ store: mem.store, spec: s, client: { clientId: "cid", clientSecret: "shh" }, state, code: "c1", fetchImpl, nowMs: NOW });
  return { ...mem, account, state, calls, authorizationUrl };
}

// ---------------------------------------------------------------------------
describe("salesforce registration", () => {
  it("is registered with aliases", () => {
    expect(getConnector("salesforce")?.id).toBe("salesforce");
    expect(getConnector("salesforce_crm")?.id).toBe("salesforce");
    expect(getConnector("salesforce_sandbox")?.id).toBe("salesforce");
    expect(getOAuthProvider("salesforce_crm")?.connector).toBe("salesforce");
  });
  it("describes oauth2 with access_token + instance_url", () => {
    const d = describeConnectors().find((c) => c.id === "salesforce");
    expect(d?.authKind).toBe("oauth2");
    expect(d?.requiredCredentials).toEqual(["access_token", "instance_url"]);
  });
  it("leaves previous connectors untouched", () => {
    for (const id of ["hubspot", "google_drive_api", "google_mail", "microsoft_graph", "shopify", "slack"]) expect(getConnector(id)?.id).toBe(id);
    expect(getConnector("google_drive")?.id).toBe("google");
    expect(getOAuthProvider("hubspot")?.connector).toBe("hubspot");
  });
  it("health operation is get_user_info", () => expect(salesforceConnector.healthOperation).toBe("get_user_info"));
  it("exposes no unsupported operation", () => {
    for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) expect(SALESFORCE_OPERATIONS).not.toContain(op);
  });
  it("declares no webhook capability (streaming is unsupported)", () => expect(salesforceConnector.capabilities).not.toContain("webhook"));
  for (const op of Object.keys(UNSUPPORTED_OPERATIONS))
    it(`rejects ${op} as UNSUPPORTED_OPERATION`, () => expect(() => build(op)).toThrow(/UNSUPPORTED_OPERATION/));
  it("rejects unknown operations", () => expect(() => build("nope")).toThrow(/Unknown Salesforce operation/));
});

// ---------------------------------------------------------------------------
describe("salesforce OAuth", () => {
  it("uses official production endpoints", () => {
    expect(spec.authorizationUrl).toBe("https://login.salesforce.com/services/oauth2/authorize");
    expect(spec.tokenUrl).toBe("https://login.salesforce.com/services/oauth2/token");
    expect(spec.revokeUrl).toBe("https://login.salesforce.com/services/oauth2/revoke");
  });
  it("uses official sandbox endpoints on the same connector", () => {
    expect(sandbox.authorizationUrl).toBe("https://test.salesforce.com/services/oauth2/authorize");
    expect(sandbox.tokenUrl).toBe("https://test.salesforce.com/services/oauth2/token");
    expect(sandbox.connector).toBe("salesforce");
  });
  it("requests least-privilege official scopes", () => expect(spec.scopes).toEqual(["api", "refresh_token", "id"]));
  it("uses PKCE (S256)", async () => {
    const { authorizationUrl } = await connect();
    const u = new URL(authorizationUrl);
    expect(u.searchParams.get("code_challenge")).toBeTruthy();
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });
  it("sends the verifier at token exchange", async () => {
    const { calls } = await connect();
    expect(String(calls[0]!.init.body)).toContain("code_verifier=");
    expect(String(calls[0]!.init.body)).toContain("grant_type=authorization_code");
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
    await expect(completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: "forged-state-value", code: "x", fetchImpl: capture(tokenBody()).fetchImpl, nowMs: NOW })).rejects.toThrow();
  });
  it("rejects an expired state", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    await expect(completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "x", fetchImpl: capture(tokenBody()).fetchImpl, nowMs: NOW + 86_400_000 })).rejects.toThrow();
  });
  it("binds the account to org id + user id", async () => {
    const { account } = await connect();
    expect(account.accountIdentifier).toBe(`org:${ORG}:user:${USER}`);
    expect(account.accountLabel).toContain("acme.my.salesforce.com");
  });
  it("stores instance_url and org identity in the vault token set", async () => {
    const { account, tokens } = await connect();
    expect(tokens.get(account.id)?.extra).toMatchObject({ instance_url: INSTANCE, org_id: ORG, user_id: USER, identity_url: ID_URL });
    expect(tokens.get(account.id)?.refreshToken).toBe(REFRESH);
  });
  it("never stores a non-Salesforce instance_url", async () => {
    const { account, tokens } = await connect("ws1", { instance_url: "https://evil.example.com" });
    expect(tokens.get(account.id)?.extra?.["instance_url"]).toBeUndefined();
  });
  it("applies a 1h fallback expiry (Salesforce omits expires_in)", async () => {
    const { account, tokens } = await connect();
    expect(new Date(tokens.get(account.id)!.expiresAt!).getTime()).toBe(NOW + 3600_000);
  });
  it("keeps a valid token without refreshing", async () => {
    const { store, account } = await connect();
    const { fetchImpl } = capture({});
    const r = await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW });
    expect(r.refreshed).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refreshes an expired token and keeps the refresh token", async () => {
    const { store, account, tokens } = await connect();
    const { calls, fetchImpl } = capture({ access_token: TOKEN_B, instance_url: INSTANCE, id: ID_URL, token_type: "Bearer" });
    const r = await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW + 7200_000 });
    expect(r.refreshed).toBe(true);
    expect(r.token).toBe(TOKEN_B);
    expect(calls[0]!.url).toBe(spec.tokenUrl);
    expect(String(calls[0]!.init.body)).toContain("grant_type=refresh_token");
    expect(tokens.get(account.id)?.refreshToken).toBe(REFRESH);
    expect(tokens.get(account.id)?.extra?.["instance_url"]).toBe(INSTANCE);
  });
  it("marks the account when refresh fails", async () => {
    const { store, account, accounts } = await connect();
    await expect(ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl: capture({ error: "invalid_grant", error_description: "expired access/refresh token" }, { status: 400 }).fetchImpl, nowMs: NOW + 7200_000 })).rejects.toThrow();
    expect(accounts.get(account.id)?.status).not.toBe("connected");
  });
  it("sandbox connections exchange at test.salesforce.com", async () => {
    const { calls, account } = await connect("ws1", { id: `https://test.salesforce.com/id/${ORG}/${USER}`, instance_url: "https://acme--dev.sandbox.my.salesforce.com" }, memoryStore(), sandbox);
    expect(calls[0]!.url).toBe(sandbox.tokenUrl);
    expect(account.accountIdentifier).toBe(`org:${ORG}:user:${USER}`);
  });
});

// ---------------------------------------------------------------------------
describe("salesforce org isolation", () => {
  it("two orgs for the same user are independent connections", async () => {
    const mem = memoryStore();
    const a = await connect("ws1", {}, mem);
    const b = await connect("ws1", { id: `https://login.salesforce.com/id/00Dyy0000002hQMEAY/${USER}`, instance_url: "https://beta.my.salesforce.com" }, mem);
    expect(a.account.id).not.toBe(b.account.id);
  });
  it("reconnecting the same org reuses the account", async () => {
    const mem = memoryStore();
    const a = await connect("ws1", {}, mem);
    const b = await connect("ws1", {}, mem);
    expect(a.account.id).toBe(b.account.id);
  });
  it("the same org in two workspaces is two accounts", async () => {
    const mem = memoryStore();
    const a = await connect("ws1", {}, mem);
    const b = await connect("ws2", {}, mem);
    expect(a.account.id).not.toBe(b.account.id);
  });
  it("a workspace cannot read another workspace's org connection", async () => {
    const mem = memoryStore();
    const { account } = await connect("ws1", {}, mem);
    expect(await mem.store.getAccount("ws2", account.id)).toBeNull();
  });
  it("calls go to the org's own instance", async () => {
    const { calls, fetchImpl } = capture({ records: [], done: true });
    await run({ operation: "query", params: { soql: "SELECT Id FROM Account" } }, fetchImpl, { access_token: TOKEN, instance_url: "https://beta.my.salesforce.com" });
    expect(urlOf(calls[0]!).origin).toBe("https://beta.my.salesforce.com");
  });
  it("parses official identity URLs", () => {
    expect(parseSalesforceIdentityUrl(ID_URL)).toEqual({ orgId: ORG, userId: USER, host: "login.salesforce.com" });
    expect(parseSalesforceIdentityUrl("http://login.salesforce.com/id/x/y")).toBeNull();
    expect(parseSalesforceIdentityUrl("garbage")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("salesforce instance host safety", () => {
  for (const ok of [INSTANCE, "https://na1.salesforce.com", "https://acme--dev.sandbox.my.salesforce.com", "https://acme.lightning.force.com", "https://x.my.salesforce.mil"])
    it(`accepts ${ok}`, () => expect(assertSalesforceInstanceUrl(ok)).toBe(new URL(ok).origin));
  for (const bad of ["http://acme.my.salesforce.com", "https://evil.com", "https://salesforce.com.evil.com", "https://acme.my.salesforce.com:8443", "https://u:p@acme.my.salesforce.com", "", "not a url"])
    it(`rejects ${bad || "(empty)"}`, () => expect(() => assertSalesforceInstanceUrl(bad)).toThrow());
  it("authorize fails without instance_url", async () => {
    const r = await run({ operation: "get_user_info" }, capture({}).fetchImpl, { access_token: TOKEN });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("auth");
  });
  it("authorize fails with a foreign instance_url and never calls out", async () => {
    const { fetchImpl } = capture({});
    const r = await run({ operation: "get_user_info" }, fetchImpl, { access_token: TOKEN, instance_url: "https://evil.example.com" });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("authorize refuses calls not built for the org", () => {
    expect(() => salesforceConnector.authorize({ method: "GET", url: "https://evil.example.com/x", headers: {} }, creds)).toThrow();
  });
  it("authorize fails without a token", () => expect(() => salesforceConnector.authorize(build("get_user_info"), { instance_url: INSTANCE, access_token: "" })).toThrow(/not connected/));
  it("builds calls on the placeholder origin", () => expect(build("get_user_info").url.startsWith(SALESFORCE_PLACEHOLDER_ORIGIN)).toBe(true));
  it("adds the bearer token", () => expect(salesforceConnector.authorize(build("get_user_info"), creds).headers["authorization"]).toBe(`Bearer ${TOKEN}`));
});

// ---------------------------------------------------------------------------
describe("salesforce identity / health", () => {
  it("reads userinfo", async () => {
    const { calls, fetchImpl } = capture({ user_id: USER, organization_id: ORG, preferred_username: "a@acme.com", email: "a@acme.com", name: "A", active: true });
    const r = await run({ operation: "get_user_info" }, fetchImpl);
    expect(urlOf(calls[0]!).pathname).toBe("/services/oauth2/userinfo");
    expect(r.ok && r.items[0]).toMatchObject({ user_id: USER, organization_id: ORG, username: "a@acme.com" });
  });
  it("reads organization info via SOQL", async () => {
    const { calls, fetchImpl } = capture({ done: true, records: [{ attributes: { type: "Organization" }, Id: ORG, Name: "Acme", IsSandbox: false }] });
    const r = await run({ operation: "get_organization" }, fetchImpl);
    expect(urlOf(calls[0]!).searchParams.get("q")).toContain("FROM Organization");
    expect(r.ok && r.items[0]).toMatchObject({ id: ORG, object_type: "Organization" });
  });
  it("reads limits", async () => {
    const r = await run({ operation: "get_limits" }, capture({ DailyApiRequests: { Max: 15000, Remaining: 14000 } }).fetchImpl);
    expect(r.ok && r.items[0]).toEqual({ name: "DailyApiRequests", max: 15000, remaining: 14000 });
  });
  it("lists API versions", async () => {
    const r = await run({ operation: "list_api_versions" }, capture([{ version: "62.0", label: "Summer '24", url: "/services/data/v62.0" }]).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ version: "62.0" });
  });
  it("global describe lists sobjects", async () => {
    const r = await run({ operation: "list_sobjects" }, capture({ sobjects: [{ name: "Account", queryable: true, custom: false }] }).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ name: "Account", queryable: true });
  });
  it("health check is healthy on 200", async () => {
    const h = await checkConnectorHealth({ adapter: salesforceConnector, credentials: creds, traceId: trace, fetchImpl: capture({ user_id: USER }).fetchImpl, sleep: async () => {} });
    expect(h.healthy).toBe(true);
  });
  it("health check is unhealthy on 401", async () => {
    const h = await checkConnectorHealth({ adapter: salesforceConnector, credentials: creds, traceId: trace, fetchImpl: capture(sfErr("Session expired or invalid", "INVALID_SESSION_ID"), { status: 401 }).fetchImpl, sleep: async () => {} });
    expect(h.healthy).toBe(false);
    expect(h.message).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
describe("salesforce standard objects", () => {
  for (const [key, name] of Object.entries(STANDARD_OBJECTS)) {
    const plural = key.endsWith("y") ? `${key.slice(0, -1)}ies` : `${key}s`;
    it(`create_${key} POSTs to /sobjects/${name}`, async () => {
      const { calls, fetchImpl } = capture({ id: REC_ID, success: true, errors: [] }, { status: 201 });
      const r = await run({ operation: `create_${key}`, params: { fields: { Name: "X" } } }, fetchImpl);
      expect(calls[0]!.init.method).toBe("POST");
      expect(urlOf(calls[0]!).pathname).toBe(`${V}/sobjects/${name}`);
      expect(bodyOf(calls[0])).toEqual({ Name: "X" });
      expect(r.ok && r.items[0]).toMatchObject({ id: REC_ID, success: true });
    });
    it(`get_${key} reads a record with selected fields`, async () => {
      const { calls, fetchImpl } = capture({ ...RECORD, attributes: { type: name } });
      const r = await run({ operation: `get_${key}`, params: { id: REC_ID, fields: ["Id", "Name"] } }, fetchImpl);
      expect(urlOf(calls[0]!).pathname).toBe(`${V}/sobjects/${name}/${REC_ID}`);
      expect(urlOf(calls[0]!).searchParams.get("fields")).toBe("Id,Name");
      expect(r.ok && r.items[0]).toMatchObject({ id: REC_ID, object_type: name });
    });
    it(`update_${key} PATCHes and accepts 204`, async () => {
      const { calls, fetchImpl } = capture(null, { status: 204 });
      const r = await run({ operation: `update_${key}`, params: { id: REC_ID, fields: { Name: "Y" } } }, fetchImpl);
      expect(calls[0]!.init.method).toBe("PATCH");
      expect(r.ok && r.items).toEqual([]);
    });
    it(`delete_${key} DELETEs`, async () => {
      const { calls, fetchImpl } = capture(null, { status: 204 });
      const r = await run({ operation: `delete_${key}`, params: { id: REC_ID } }, fetchImpl);
      expect(calls[0]!.init.method).toBe("DELETE");
      expect(r.ok).toBe(true);
    });
    it(`list_${plural} issues official SOQL`, async () => {
      const { calls, fetchImpl } = capture({ done: true, records: [RECORD] });
      await run({ operation: `list_${plural}`, params: { fields: ["Id", "Name"], limit: 10, order_by: "CreatedDate", order_direction: "DESC" } }, fetchImpl);
      expect(urlOf(calls[0]!).searchParams.get("q")).toBe(`SELECT Id, Name FROM ${name} ORDER BY CreatedDate DESC LIMIT 10`);
    });
    it(`search_${plural} uses parameterized SOSL`, async () => {
      const { calls, fetchImpl } = capture({ searchRecords: [RECORD] });
      const r = await run({ operation: `search_${plural}`, params: { search_text: "acme" } }, fetchImpl);
      expect(urlOf(calls[0]!).pathname).toBe(`${V}/parameterizedSearch`);
      expect(urlOf(calls[0]!).searchParams.get("sobject")).toBe(name);
      expect(r.ok && r.items.length).toBe(1);
    });
    it(`describe_${key} reads metadata`, async () => {
      const { calls } = capture({});
      await run({ operation: `describe_${key}` }, capture({ name }).fetchImpl);
      expect(build(`describe_${key}`).url).toContain(`/sobjects/${name}/describe`);
      expect(calls).toEqual([]);
    });
    it(`upsert_${key} uses an external id`, () => {
      const call = build(`upsert_${key}`, { external_id_field: "Ext_Id__c", external_id: "A/1", fields: { Name: "Z" } });
      expect(call.method).toBe("PATCH");
      expect(call.url).toContain(`/sobjects/${name}/Ext_Id__c/A%2F1`);
    });
    it(`get_${key} rejects a malformed id`, () => expect(() => build(`get_${key}`, { id: "../../etc" })).toThrow(/Salesforce id/));
  }
  it("rejects a search text below the SOSL minimum", () => expect(() => build("search_accounts", { search_text: "a" })).toThrow(/2 characters/));
  it("rejects an invalid field name in update", () => expect(() => build("update_account", { id: REC_ID, fields: { "Name; DROP": 1 } })).toThrow());
  it("rejects non-object fields", () => expect(() => build("create_account", { fields: ["x"] })).toThrow());
  it("requires fields for create", () => expect(() => build("create_account")).toThrow(/required/));
  it("caps list limit at 2000", () => expect(new URL(build("list_accounts", { limit: 99999 }).url).searchParams.get("q")).toContain("LIMIT 2000"));
  it("upsert reports created flag", async () => {
    const r = await run({ operation: "upsert_account", params: { external_id_field: "Ext__c", external_id: "1", fields: { Name: "Z" } } }, capture({ id: REC_ID, success: true, errors: [], created: true }, { status: 201 }).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ created: true });
  });
  it("upsert with multiple matches (300) is an invalid request", async () => {
    const r = await run({ operation: "upsert_account", params: { external_id_field: "Ext__c", external_id: "1", fields: { Name: "Z" } } }, capture(["/a", "/b"], { status: 300 }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
  });
});

// ---------------------------------------------------------------------------
describe("salesforce custom objects", () => {
  const p = { object_type: "Invoice__c" };
  it("describe_object", () => expect(build("describe_object", p).url).toContain("/sobjects/Invoice__c/describe"));
  it("create_record", () => expect(build("create_record", { ...p, fields: { Amount__c: 1 } }).url).toContain("/sobjects/Invoice__c"));
  it("get_record", () => expect(build("get_record", { ...p, id: "a01xx0000001AAAAAA" }).url).toContain("/sobjects/Invoice__c/a01xx0000001AAAAAA"));
  it("update_record", () => expect(build("update_record", { ...p, id: "a01xx0000001AAAAAA", fields: { Amount__c: 2 } }).method).toBe("PATCH"));
  it("delete_record", () => expect(build("delete_record", { ...p, id: "a01xx0000001AAAAAA" }).method).toBe("DELETE"));
  it("list_records", () => expect(new URL(build("list_records", p).url).searchParams.get("q")).toContain("FROM Invoice__c"));
  it("search_records", () => expect(new URL(build("search_records", { ...p, search_text: "inv" }).url).searchParams.get("sobject")).toBe("Invoice__c"));
  it("upsert_record", () => expect(build("upsert_record", { ...p, external_id_field: "Ext__c", external_id: "9", fields: {} }).url).toContain("/Ext__c/9"));
  it("namespaced objects are accepted", () => expect(assertObjectName("ns__Thing__c")).toBe("ns__Thing__c"));
  for (const bad of ["../Account", "Account/x", "Acc ount", "1Account", "Account?x=1", "", "a".repeat(81), "Bad_"])
    it(`rejects object path ${JSON.stringify(bad).slice(0, 20)}`, () => expect(() => assertObjectName(bad)).toThrow());
  it("requires object_type", () => expect(() => build("get_record", { id: REC_ID })).toThrow(/object_type/));
  it("related records follow official relationship names", () => {
    const call = build("get_related_records", { object_type: "Account", id: REC_ID, relationship_name: "Contacts" });
    expect(call.url).toContain(`/sobjects/Account/${REC_ID}/Contacts`);
  });
  it("related records reject path injection", () => expect(() => build("get_related_records", { object_type: "Account", id: REC_ID, relationship_name: "../x" })).toThrow());
  it("get_updated_records", async () => {
    const r = await run({ operation: "get_updated_records", params: { object_type: "Account", start: "2026-01-01T00:00:00Z", end: "2026-01-02T00:00:00Z" } }, capture({ ids: [REC_ID], latestDateCovered: "x" }).fetchImpl);
    expect(r.ok && r.items).toEqual([{ id: REC_ID }]);
  });
  it("get_deleted_records", async () => {
    const r = await run({ operation: "get_deleted_records", params: { object_type: "Account", start: "a", end: "b" } }, capture({ deletedRecords: [{ id: REC_ID, deletedDate: "d" }] }).fetchImpl);
    expect(r.ok && r.items[0]).toEqual({ id: REC_ID, deleted_date: "d" });
  });
});

// ---------------------------------------------------------------------------
describe("salesforce metadata", () => {
  const DESCRIBE = {
    name: "Account", label: "Account", custom: false, keyPrefix: "001", createable: true, updateable: true, deletable: true, queryable: true, searchable: true, retrieveable: true,
    fields: [
      { name: "Name", type: "string", createable: true, updateable: true, nillable: false, defaultedOnCreate: false },
      { name: "Id", type: "id", createable: false, updateable: false, nillable: false },
      { name: "OwnerId", type: "reference", createable: true, nillable: false, defaultedOnCreate: true, referenceTo: ["User"], relationshipName: "Owner" },
    ],
    childRelationships: [{ childSObject: "Contact", field: "AccountId", relationshipName: "Contacts" }],
  };
  it("normalizes capabilities", async () => {
    const r = await run({ operation: "describe_account" }, capture(DESCRIBE).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ name: "Account", capabilities: { createable: true, queryable: true } });
  });
  it("flags required fields from official metadata", () => {
    expect(normalizeSalesforceField(DESCRIBE.fields[0])["required"]).toBe(true);
    expect(normalizeSalesforceField(DESCRIBE.fields[1])["required"]).toBe(false);
    expect(normalizeSalesforceField(DESCRIBE.fields[2])["required"]).toBe(false);
  });
  it("exposes relationships", async () => {
    const r = await run({ operation: "describe_account" }, capture(DESCRIBE).fetchImpl);
    const d = r.ok ? (r.items[0] as Record<string, unknown>) : {};
    expect(d["child_relationships"]).toEqual([{ child_object: "Contact", field: "AccountId", relationship_name: "Contacts" }]);
    expect((d["fields"] as Record<string, unknown>[])[2]).toMatchObject({ reference_to: ["User"], relationship_name: "Owner" });
  });
});

// ---------------------------------------------------------------------------
describe("salesforce SOQL / SOSL", () => {
  it("passes SOQL unchanged", () => expect(new URL(build("query", { soql: "SELECT Id FROM Contact WHERE Email = 'a@b.c' ORDER BY Name LIMIT 5" }).url).searchParams.get("q")).toBe("SELECT Id FROM Contact WHERE Email = 'a@b.c' ORDER BY Name LIMIT 5"));
  it("query_all uses /queryAll", () => expect(build("query_all", { soql: "SELECT Id FROM Account" }).url).toContain(`${V}/queryAll`));
  for (const bad of ["DELETE FROM Account", "", "   ", "FIND {x}", "SELECT\u0000 Id FROM A"])
    it(`rejects SOQL ${JSON.stringify(bad).slice(0, 20)}`, () => expect(() => assertSoql(bad)).toThrow());
  it("rejects oversized SOQL", () => expect(() => assertSoql(`SELECT ${"a".repeat(100_001)}`)).toThrow());
  it("follows nextRecordsUrl", async () => {
    const next = `${V}/query/01gxx000000AbcdAAA-2000`;
    const s = sequence(() => jsonResponse({ done: false, nextRecordsUrl: next, records: [RECORD] }), () => jsonResponse({ done: true, records: [RECORD] }));
    const r = await run({ operation: "query", params: { soql: "SELECT Id FROM Account" }, maxPages: 5 }, s.fetchImpl);
    expect(r.ok && r.items.length).toBe(2);
    expect(s.calls[1]).toBe(`${INSTANCE}${next}`);
  });
  it("returns the cursor when the page budget ends", async () => {
    const next = `${V}/query/01gxx000000AbcdAAA-2000`;
    const r = await run({ operation: "query", params: { soql: "SELECT Id FROM Account" } }, capture({ done: false, nextRecordsUrl: next, records: [] }).fetchImpl);
    expect(r.ok && r.cursor).toBe(next);
  });
  it("resumes from a cursor", () => expect(build("query", { soql: "SELECT Id FROM Account" }, `${V}/query/01gxx000000AbcdAAA-4000`).url).toBe(`${SALESFORCE_PLACEHOLDER_ORIGIN}${V}/query/01gxx000000AbcdAAA-4000`));
  for (const bad of ["https://evil.com/services/data/v62.0/query/01g-2", "//evil.com/x", "/services/data/v62.0/sobjects/Account", "/services/data/v62.0/query/../../x-1"])
    it(`rejects foreign cursor ${bad.slice(0, 25)}`, () => expect(() => assertNextRecordsUrl(bad)).toThrow(/nextRecordsUrl/));
  it("rejects a foreign nextRecordsUrl in a response", async () => {
    const r = await run({ operation: "query", params: { soql: "SELECT Id FROM Account" }, maxPages: 3 }, capture({ done: false, nextRecordsUrl: "https://evil.com/steal", records: [] }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("malformed_response");
  });
  it("maps MALFORMED_QUERY to invalid_request", async () => {
    const r = await run({ operation: "query", params: { soql: "SELECT Nope FROM Account" } }, capture(sfErr("No such column 'Nope'", "INVALID_FIELD"), { status: 400 }).fetchImpl);
    expect(!r.ok && r.error.kind).toBe("invalid_request");
    expect(!r.ok && r.error.message).toContain("INVALID_FIELD");
  });
  it("SOSL uses /search", async () => {
    const { calls, fetchImpl } = capture({ searchRecords: [RECORD] });
    const r = await run({ operation: "search", params: { sosl: "FIND {Acme} IN NAME FIELDS RETURNING Account(Id, Name)" } }, fetchImpl);
    expect(urlOf(calls[0]!).pathname).toBe(`${V}/search`);
    expect(r.ok && r.items[0]).toMatchObject({ id: REC_ID });
  });
  it("SOSL rejects SOQL", () => expect(() => assertSosl("SELECT Id FROM Account")).toThrow());
  it("SOQL rejects SOSL", () => expect(() => assertSoql("FIND {x}")).toThrow());
});

// ---------------------------------------------------------------------------
describe("salesforce composite", () => {
  const sub = (url: string, method = "GET", referenceId = "r1") => ({ method, url, referenceId });
  it("composite success", async () => {
    const r = await run({ operation: "composite", params: { requests: [sub(`${V}/sobjects/Account/${REC_ID}`)] } }, capture({ compositeResponse: [{ httpStatusCode: 200, referenceId: "r1", body: RECORD }] }).fetchImpl);
    const s = r.ok ? r.items.at(-1) : {};
    expect(s).toMatchObject({ type: "composite_summary", succeeded: 1, failed: 0, partial: false });
  });
  it("composite partial failure is not a full success", async () => {
    const r = await run(
      { operation: "composite", params: { requests: [sub(`${V}/sobjects/Account`, "POST", "a"), sub(`${V}/sobjects/Contact`, "POST", "b")] } },
      capture({ compositeResponse: [{ httpStatusCode: 201, referenceId: "a", body: { id: REC_ID } }, { httpStatusCode: 400, referenceId: "b", body: sfErr("Required fields are missing", "REQUIRED_FIELD_MISSING") }] }).fetchImpl,
    );
    const items = r.ok ? r.items : [];
    expect(items[1]).toMatchObject({ status: "error", errors: [{ error_code: "REQUIRED_FIELD_MISSING" }] });
    expect(items.at(-1)).toMatchObject({ partial: true, failed: 1 });
  });
  it("composite all failed", async () => {
    const r = await run({ operation: "composite", params: { requests: [sub(`${V}/x`)] } }, capture({ compositeResponse: [{ httpStatusCode: 404, body: sfErr("nf", "NOT_FOUND") }] }).fetchImpl);
    expect(r.ok && r.items.at(-1)).toMatchObject({ all_failed: true });
  });
  it("sends allOrNone", () => expect((build("composite", { requests: [sub(`${V}/x`)], all_or_none: true }).body as Record<string, unknown>)["allOrNone"]).toBe(true));
  it("caps composite at 25 subrequests", () => expect(() => build("composite", { requests: Array.from({ length: 26 }, () => sub(`${V}/x`)) })).toThrow(/25/));
  for (const bad of ["https://evil.com/x", "/other/path", `${V}/../../x`, `/${V}`])
    it(`rejects subrequest url ${bad.slice(0, 20)}`, () => expect(() => build("composite", { requests: [sub(bad)] })).toThrow(/relative/));
  it("rejects bad subrequest method", () => expect(() => build("composite", { requests: [sub(`${V}/x`, "TRACE")] })).toThrow());
  it("composite batch reports hasErrors", async () => {
    const r = await run({ operation: "composite_batch", params: { requests: [sub(`${V}/a`), sub(`${V}/b`)] } }, capture({ hasErrors: true, results: [{ statusCode: 200, result: {} }, { statusCode: 404, result: sfErr("nf", "NOT_FOUND") }] }).fetchImpl);
    expect(r.ok && r.items.at(-1)).toMatchObject({ has_errors: true, partial: true });
  });
  it("composite graph reports failed graphs", async () => {
    const r = await run(
      { operation: "composite_graph", params: { graphs: [{ graphId: "g1", compositeRequest: [sub(`${V}/a`)] }, { graphId: "g2", compositeRequest: [sub(`${V}/b`)] }] } },
      capture({ graphs: [{ graphId: "g1", isSuccessful: true, graphResponse: { compositeResponse: [{ httpStatusCode: 201, body: {} }] } }, { graphId: "g2", isSuccessful: false, graphResponse: { compositeResponse: [{ httpStatusCode: 400, body: sfErr("x", "X") }] } }] }).fetchImpl,
    );
    expect(r.ok && r.items.at(-1)).toMatchObject({ partial: true, failed: 1 });
  });
  it("collections create reports per-record errors", async () => {
    const r = await run(
      { operation: "create_records", params: { records: [{ attributes: { type: "Account" }, Name: "A" }, { attributes: { type: "Account" } }] } },
      capture([{ id: REC_ID, success: true, errors: [] }, { success: false, errors: [{ statusCode: "REQUIRED_FIELD_MISSING", message: "Name", fields: ["Name"] }] }]).fetchImpl,
    );
    expect(r.ok && r.items.at(-1)).toMatchObject({ partial: true, succeeded: 1, failed: 1 });
  });
  it("collections update requires ids", () => expect(() => build("update_records", { records: [{ attributes: { type: "Account" } }] })).toThrow());
  it("collections delete uses ids query", () => expect(new URL(build("delete_records", { ids: [REC_ID] }).url).searchParams.get("ids")).toBe(REC_ID));
  it("collections cap at 200", () => expect(() => build("delete_records", { ids: Array.from({ length: 201 }, () => REC_ID) })).toThrow(/200/));
  it("collections reject invalid object types", () => expect(() => build("create_records", { records: [{ attributes: { type: "../x" } }] })).toThrow());
});

// ---------------------------------------------------------------------------
describe("salesforce errors", () => {
  const cases: [number, unknown, string, boolean][] = [
    [400, sfErr("bad", "MALFORMED_QUERY"), "invalid_request", false],
    [401, sfErr("Session expired or invalid", "INVALID_SESSION_ID"), "auth", false],
    [403, sfErr("insufficient access", "INSUFFICIENT_ACCESS"), "forbidden", false],
    [403, sfErr("TotalRequests Limit exceeded.", "REQUEST_LIMIT_EXCEEDED"), "rate_limit", false],
    [404, sfErr("not found", "NOT_FOUND"), "not_found", false],
    [409, sfErr("conflict", "CONFLICT"), "invalid_request", false],
    [429, sfErr("slow down", "REQUEST_LIMIT_EXCEEDED"), "rate_limit", false],
    [500, sfErr("boom", "UNKNOWN_EXCEPTION"), "provider", true],
    [503, sfErr("down", "SERVER_UNAVAILABLE"), "provider", true],
  ];
  for (const [status, body, kind, retryable] of cases)
    it(`${status} ${JSON.stringify(body).slice(30, 60)} → ${kind}`, () => {
      expect(salesforceConnector.mapError!(status, body)).toMatchObject({ kind, retryable });
    });
  it("429 without daily-limit code is retryable", () => expect(salesforceConnector.mapError!(429, sfErr("busy", "CONCURRENT"))).toMatchObject({ kind: "rate_limit", retryable: true }));
  it("ignores 2xx", () => expect(salesforceConnector.mapError!(200, {})).toBeNull());
  it("reads OAuth-style errors", () => expect(salesforceConnector.mapError!(400, { error: "invalid_grant", error_description: "expired" })?.message).toContain("expired"));
});

// ---------------------------------------------------------------------------
describe("salesforce rate limits / retry", () => {
  it("reads Sforce-Limit-Info", () => expect(readSalesforceLimitInfo(new Headers({ "sforce-limit-info": "api-usage=18/15000" }))).toEqual({ limit: 15000, remaining: 14982 }));
  it("returns undefined without the header", () => expect(readSalesforceLimitInfo(new Headers())).toBeUndefined());
  it("surfaces rate limit info in results", async () => {
    const r = await run({ operation: "get_user_info" }, capture({ user_id: USER }, { headers: { "sforce-limit-info": "api-usage=1/100" } }).fetchImpl);
    expect(r.ok && r.rateLimit).toEqual({ limit: 100, remaining: 99 });
  });
  it("retries 5xx then succeeds", async () => {
    const s = sequence(() => jsonResponse(sfErr("x", "UNKNOWN_EXCEPTION"), { status: 503 }), () => jsonResponse({ user_id: USER }));
    const r = await run({ operation: "get_user_info" }, s.fetchImpl);
    expect(r.ok && r.attempts).toBe(2);
  });
  it("retries a transient 429", async () => {
    const s = sequence(() => jsonResponse(sfErr("busy", "CONCURRENT"), { status: 429 }), () => jsonResponse({ user_id: USER }));
    expect((await run({ operation: "get_user_info" }, s.fetchImpl)).ok).toBe(true);
  });
  it("does not retry daily API limit exhaustion", async () => {
    const s = sequence(() => jsonResponse(sfErr("limit", "REQUEST_LIMIT_EXCEEDED"), { status: 403 }));
    const r = await run({ operation: "get_user_info" }, s.fetchImpl);
    expect(s.count()).toBe(1);
    expect(!r.ok && r.error.kind).toBe("rate_limit");
  });
  it("retries network errors", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return jsonResponse({ user_id: USER });
    }) as unknown as typeof fetch;
    expect((await run({ operation: "get_user_info" }, fetchImpl)).ok).toBe(true);
  });
  it("gives up after max attempts", async () => {
    const s = sequence(() => jsonResponse(sfErr("x", "UNKNOWN_EXCEPTION"), { status: 500 }));
    const r = await run({ operation: "get_user_info" }, s.fetchImpl);
    expect(s.count()).toBe(3);
    expect(r.ok).toBe(false);
  });
  it("does not retry 400", async () => {
    const s = sequence(() => jsonResponse(sfErr("x", "INVALID_FIELD"), { status: 400 }));
    await run({ operation: "get_user_info" }, s.fetchImpl);
    expect(s.count()).toBe(1);
  });
  it("rejects malformed JSON", async () => {
    const fetchImpl = vi.fn(async () => new Response("{bad", { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const r = await run({ operation: "get_user_info" }, fetchImpl);
    expect(!r.ok && r.error.kind).toBe("malformed_response");
  });
});

// ---------------------------------------------------------------------------
describe("salesforce idempotency", () => {
  it("claims no idempotency header", () => {
    const h = build("create_account", { fields: { Name: "x" } }).headers;
    expect(Object.keys(h).some((k) => /idempot/i.test(k))).toBe(false);
    expect(UNSUPPORTED_OPERATIONS["idempotency_key"]).toMatch(/External ID/);
  });
  it("upsert by external id is the official idempotent write", () => {
    const a = build("upsert_contact", { external_id_field: "Ext__c", external_id: "k1", fields: { LastName: "L" } });
    const b = build("upsert_contact", { external_id_field: "Ext__c", external_id: "k1", fields: { LastName: "L" } });
    expect(a.url).toBe(b.url);
    expect(a.method).toBe("PATCH");
  });
  it("rejects an invalid external id field", () => expect(() => build("upsert_contact", { external_id_field: "a/b", external_id: "1", fields: {} })).toThrow());
});

// ---------------------------------------------------------------------------
describe("salesforce security", () => {
  function rbacClient(role: string | null) {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: role ? { role } : null, error: null }) };
    return { from: () => chain } as unknown as Parameters<typeof assertCanExecute>[0];
  }
  for (const role of ["owner", "admin", "member"]) it(`RBAC allows ${role}`, async () => expect(assertCanExecute(rbacClient(role), "ws1", "u1")).resolves.toBe(role));
  for (const role of ["viewer", null]) it(`RBAC blocks ${role ?? "non-members"}`, async () => expect(assertCanExecute(rbacClient(role), "ws1", "u1")).rejects.toThrow(/permission/));
  it("never returns the token in results", async () => expect(JSON.stringify(await run({ operation: "get_user_info" }, capture({ user_id: USER }).fetchImpl))).not.toContain(TOKEN));
  it("scrubs the token echoed in an error body", async () => {
    const r = await run({ operation: "get_user_info" }, capture(sfErr(`bad token ${TOKEN}`, "INVALID_SESSION_ID"), { status: 401 }).fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("scrubs the token in network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`socket closed for ${TOKEN}`);
    }) as unknown as typeof fetch;
    expect(JSON.stringify(await run({ operation: "get_user_info" }, fetchImpl))).not.toContain(TOKEN);
  });
  it("redact() masks bearer tokens", () => expect(JSON.stringify(redact({ authorization: `Bearer ${TOKEN}` }))).not.toContain(TOKEN));
  it("credentials of one org are never used for another org's host", async () => {
    const { calls, fetchImpl } = capture({ user_id: USER });
    await run({ operation: "get_user_info" }, fetchImpl);
    expect(urlOf(calls[0]!).origin).toBe(INSTANCE);
  });
  it("carries the trace id on success and failure", async () => {
    expect((await run({ operation: "get_user_info" }, capture({}).fetchImpl)).traceId).toBe(trace);
    expect((await run({ operation: "get_user_info" }, capture(sfErr("x", "X"), { status: 404 }).fetchImpl)).traceId).toBe(trace);
  });
  it("emits redacted events with the trace id", async () => {
    const events: string[] = [];
    await runConnectorOperation({ adapter: salesforceConnector, credentials: creds, traceId: trace, input: { operation: "get_user_info" }, fetchImpl: capture(sfErr(`t ${TOKEN}`, "X"), { status: 401 }).fetchImpl, sleep: async () => {}, onEvent: (e) => events.push(JSON.stringify(e)) });
    expect(events.join("")).toContain(trace);
    expect(events.join("")).not.toContain(TOKEN);
  });
  it("validates record ids", () => {
    expect(assertRecordId(REC_ID)).toBe(REC_ID);
    expect(assertRecordId("001xx000003DGb2")).toBe("001xx000003DGb2");
    expect(() => assertRecordId("001%2F..")).toThrow();
  });
  it("fails before network on missing credentials", async () => {
    const { fetchImpl } = capture({});
    const r = await run({ operation: "get_user_info" }, fetchImpl, {});
    expect(!r.ok && r.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
