import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  ASSOCIATION_BATCH_MAX,
  BATCH_MAX,
  HUBSPOT_API_BASE,
  HUBSPOT_OPERATIONS,
  HUBSPOT_SCOPES,
  HUBSPOT_VERSIONS,
  UNSUPPORTED_OPERATIONS,
  assertObjectType,
  buildSearchBody,
  hubspotConnector,
  hubspotScopeFor,
} from "@/lib/connectors/adapters/hubspot";
import { hubSpotBatchEventId, normalizeHubSpotObject, parseHubSpotEvents } from "@/lib/connectors/adapters/hubspot-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { assertCanExecute } from "@/lib/execution/guard.server";
import { beginAuthorization, completeAuthorization, ensureAccessToken, hashState } from "@/lib/oauth/core";
import { getOAuthProvider } from "@/lib/oauth/providers";
import type { ConnectionAccount, OAuthStore, OAuthTokenSet, PendingAuthorization } from "@/lib/oauth/types";
import { verifyWebhook } from "@/lib/webhooks/verify";

const trace = "trace-hubspot";
const TOKEN = "CNHubSpotAccessTokenAAAA1111";
const TOKEN_B = "CNHubSpotAccessTokenBBBB2222";
const PRIVATE_APP = "pat-na1-11111111-2222-3333-4444-555555555555";
const REFRESH = "hubspot-refresh-token-xyz-0000";
const CLIENT_SECRET = "hubspot-app-client-secret-7c1d";
const creds = { access_token: TOKEN };
const NOW = 1_700_000_100_000;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body === null ? "" : JSON.stringify(body), {
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
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
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
  return runConnectorOperation({ adapter: hubspotConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {}, ...extra });
}
const bodyOf = (call: { init: RequestInit } | undefined) => JSON.parse(String(call?.init.body ?? "{}")) as Record<string, unknown>;
const headerOf = (call: { init: RequestInit } | undefined, name: string) => (call?.init.headers as Record<string, string> | undefined)?.[name];
const build = (operation: string, params: Record<string, unknown> = {}, cursor?: string) =>
  hubspotConnector.buildCall({ operation, params, ...(cursor ? { cursor } : {}) });
const urlOf = (c: { url: string }) => new URL(c.url);
const hErr = (message: string, category: string, extra: Record<string, unknown> = {}) => ({ status: "error", message, correlationId: "corr-1", category, ...extra });

const RECORD = { id: "101", properties: { email: "a@example.com", firstname: "A", hs_object_id: "101" }, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z", archived: false };

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
const pending = (ws = "ws1") => ({ workspaceId: ws, integrationId: null, provider: "hubspot", connector: "hubspot", redirectUri: "https://app.test/cb", createdBy: null });
const spec = getOAuthProvider("hubspot")!;
async function connect(ws = "ws1", hub: unknown = 4242) {
  const mem = memoryStore();
  const { state } = await beginAuthorization({ store: mem.store, spec, clientId: "cid", pending: pending(ws), nowMs: NOW });
  const { fetchImpl, calls } = capture({ access_token: TOKEN, refresh_token: REFRESH, expires_in: 1800, token_type: "bearer", hub_id: hub, hub_domain: "acme.hubspot.com" });
  const { account } = await completeAuthorization({ store: mem.store, spec, client: { clientId: "cid", clientSecret: "shh" }, state, code: "c1", fetchImpl, nowMs: NOW });
  return { ...mem, account, state, calls };
}

function sign(raw: string, secret = CLIENT_SECRET) {
  return createHash("sha256").update(secret + raw).digest("hex");
}
const EVENT = { eventId: 9001, subscriptionId: 77, portalId: 4242, appId: 5, occurredAt: NOW - 5_000, subscriptionType: "contact.propertyChange", attemptNumber: 0, objectId: 101, propertyName: "email", changeSource: "CRM" };
function deliver(events: unknown, opts: { headers?: Record<string, string | null>; secret?: string | null; nowMs?: number; signWith?: string } = {}) {
  const raw = JSON.stringify(events);
  const headers: Record<string, string> = { "x-hubspot-signature": sign(raw, opts.signWith ?? CLIENT_SECRET), "x-hubspot-signature-version": "v1" };
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (v === null) delete headers[k];
    else headers[k] = v;
  }
  return verifyWebhook("hubspot", { raw, headers, payload: events, secret: opts.secret === undefined ? CLIENT_SECRET : opts.secret, nowMs: opts.nowMs ?? NOW, replayWindowMs: 300_000 });
}

// ---------------------------------------------------------------------------
describe("hubspot registration", () => {
  it("is registered under hubspot with an alias", () => {
    expect(getConnector("hubspot")?.id).toBe("hubspot");
    expect(getConnector("hubspot_crm")?.id).toBe("hubspot");
    expect(getOAuthProvider("hubspot_crm")?.connector).toBe("hubspot");
  });
  it("describes oauth2 with access_token only", () => {
    const d = describeConnectors().find((c) => c.id === "hubspot");
    expect(d?.authKind).toBe("oauth2");
    expect(d?.requiredCredentials).toEqual(["access_token"]);
  });
  it("leaves previous connectors untouched", () => {
    expect(getConnector("google_drive_api")?.id).toBe("google_drive_api");
    expect(getConnector("google_mail")?.id).toBe("google_mail");
    expect(getConnector("microsoft_graph")?.id).toBe("microsoft_graph");
    expect(getConnector("google_drive")?.id).toBe("google");
  });
  it("uses the health operation get_account_details", () => expect(hubspotConnector.healthOperation).toBe("get_account_details"));
  it("exposes no unsupported operation", () => {
    for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) expect(HUBSPOT_OPERATIONS).not.toContain(op);
  });
  it("every operation maps to an official scope", () => {
    for (const op of HUBSPOT_OPERATIONS) expect(Object.values(HUBSPOT_SCOPES)).toContain(hubspotScopeFor(op, { object_type: "contacts", from_object_type: "contacts" }));
  });
  it("keeps every API version in one table", () => expect(HUBSPOT_VERSIONS).toMatchObject({ objects: "v3", associations: "v4" }));
});

// ---------------------------------------------------------------------------
describe("hubspot OAuth / credentials", () => {
  it("uses the official HubSpot endpoints", () => {
    expect(spec.authorizationUrl).toBe("https://app.hubspot.com/oauth/authorize");
    expect(spec.tokenUrl).toBe("https://api.hubapi.com/oauth/v1/token");
    expect(spec.refreshable).toBe(true);
  });
  it("defaults to least-privilege read scopes", () => {
    expect(spec.scopes).toEqual(expect.arrayContaining(["oauth", HUBSPOT_SCOPES.contacts_read]));
    expect(spec.scopes.some((s) => s.endsWith(".write"))).toBe(false);
  });
  it("sends space-separated scopes and a strong state", async () => {
    const { store } = memoryStore();
    const { authorizationUrl } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    const u = new URL(authorizationUrl);
    expect(u.searchParams.get("scope")).toContain("oauth crm.objects.contacts.read");
    expect(u.searchParams.get("state")?.length).toBeGreaterThan(20);
    expect(u.searchParams.get("client_id")).toBe("cid");
  });
  it("can request write scopes per connection", async () => {
    const { store } = memoryStore();
    const { authorizationUrl } = await beginAuthorization({ store, spec, clientId: "cid", pending: { ...pending(), scopes: [...spec.scopes, HUBSPOT_SCOPES.contacts_write] }, nowMs: NOW });
    expect(new URL(authorizationUrl).searchParams.get("scope")).toContain(HUBSPOT_SCOPES.contacts_write);
  });
  it("stores only the hashed state", async () => {
    const { store, states } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    expect(states.has(hashState(state))).toBe(true);
    expect(states.has(state)).toBe(false);
  });
  it("exchanges the code at the official token endpoint", async () => {
    const { calls } = await connect();
    expect(calls[0]!.url).toBe("https://api.hubapi.com/oauth/v1/token");
    expect(String(calls[0]!.init.body)).toContain("grant_type=authorization_code");
  });
  it("binds the connection account to the HubSpot portal", async () => {
    const { account, tokens } = await connect();
    expect(account.accountIdentifier).toBe("hub:4242");
    expect(account.accountLabel).toBe("acme.hubspot.com");
    expect(tokens.get(account.id)?.accessToken).toBe(TOKEN);
    expect(tokens.get(account.id)?.refreshToken).toBe(REFRESH);
    expect(account.expiresAt).not.toBeNull();
  });
  it("keeps the portal id as a vault credential field", () => expect(spec.credentialFields?.({ hub_id: 4242 })).toEqual({ portal_id: "4242" }));
  it("returns no identity without hub_id", () => expect(spec.identify?.({})).toEqual({}));
  it("never exposes tokens on the account projection", async () => {
    const { account } = await connect();
    expect(JSON.stringify(account)).not.toContain(TOKEN);
    expect(JSON.stringify(account)).not.toContain(REFRESH);
  });
  it("rejects a replayed state", async () => {
    const { store, state } = await connect();
    await expect(completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "c", fetchImpl: capture({ access_token: TOKEN }).fetchImpl, nowMs: NOW })).rejects.toThrow();
  });
  it("rejects a forged state", async () => {
    const { store } = memoryStore();
    await expect(completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: "forged", code: "c", fetchImpl: capture({}).fetchImpl, nowMs: NOW })).rejects.toThrow();
  });
  it("rejects an expired state", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    await expect(
      completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "c", fetchImpl: capture({ access_token: TOKEN }).fetchImpl, nowMs: NOW + 24 * 3600_000 }),
    ).rejects.toThrow();
  });
  it("fails token exchange without leaking the client secret", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    const err = await completeAuthorization({
      store, spec, client: { clientId: "c", clientSecret: "super-secret-value" }, state, code: "bad", fetchImpl: capture({ status: "BAD_AUTH_CODE", message: "bad" }, { status: 400 }).fetchImpl, nowMs: NOW,
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain("super-secret-value");
  });
  it("accepts a private-app access token in the same vault field", async () => {
    const { calls, fetchImpl } = capture({ portalId: 1 });
    await run({ operation: "get_account_details" }, fetchImpl, { access_token: PRIVATE_APP });
    expect(headerOf(calls[0], "authorization")).toBe(`Bearer ${PRIVATE_APP}`);
  });
});

describe("hubspot token refresh / expiration", () => {
  it("returns the stored token while fresh", async () => {
    const { store, account } = await connect();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW });
    expect(r.refreshed).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refreshes an expired token (30 min lifetime)", async () => {
    const { store, account, tokens } = await connect();
    const { calls, fetchImpl } = capture({ access_token: TOKEN_B, refresh_token: REFRESH, expires_in: 1800 });
    const r = await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW + 3600_000 });
    expect(r.refreshed).toBe(true);
    expect(r.token).toBe(TOKEN_B);
    expect(calls[0]!.url).toBe("https://api.hubapi.com/oauth/v1/token");
    expect(String(calls[0]!.init.body)).toContain("grant_type=refresh_token");
    expect(tokens.get(account.id)?.refreshToken).toBe(REFRESH);
  });
  it("marks the connection when the refresh token is revoked", async () => {
    const { store, account, accounts } = await connect();
    await expect(ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl: capture({ status: "BAD_REFRESH_TOKEN" }, { status: 400 }).fetchImpl, nowMs: NOW + 3600_000 })).rejects.toThrow();
    expect(accounts.get(account.id)?.status).not.toBe("connected");
  });
});

// ---------------------------------------------------------------------------
describe("hubspot identity / health", () => {
  const ACCOUNT = { portalId: 4242, accountType: "STANDARD", timeZone: "Asia/Riyadh", companyCurrency: "SAR", uiDomain: "app.hubspot.com", dataHostingLocation: "na1" };
  it("reads account-info details", async () => {
    const { calls, fetchImpl } = capture(ACCOUNT);
    const r = await run({ operation: "get_account_details" }, fetchImpl);
    expect(calls[0]!.url).toBe(`${HUBSPOT_API_BASE}/account-info/v3/details`);
    expect(r.ok && r.items[0]).toMatchObject({ portal_id: "4242", time_zone: "Asia/Riyadh", company_currency: "SAR" });
  });
  it("is healthy when account details load", async () => {
    expect((await checkConnectorHealth({ adapter: hubspotConnector, credentials: creds, traceId: trace, fetchImpl: capture(ACCOUNT).fetchImpl })).healthy).toBe(true);
  });
  it("is unhealthy on an expired token without leaking it", async () => {
    const h = await checkConnectorHealth({ adapter: hubspotConnector, credentials: creds, traceId: trace, fetchImpl: capture(hErr(`expired ${TOKEN}`, "EXPIRED_AUTHENTICATION"), { status: 401 }).fetchImpl });
    expect(h.healthy).toBe(false);
    expect(h.message).not.toContain(TOKEN);
  });
  it("fails before any call when not connected", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await run({ operation: "get_account_details" }, fetchImpl, { access_token: "" });
    expect(r.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("token introspection is unsupported (token would sit in the URL)", () => expect(() => build("token_introspection")).toThrow(/UNSUPPORTED_OPERATION/));
});

// ---------------------------------------------------------------------------
const OBJECTS: [string, string, keyof typeof HUBSPOT_SCOPES, keyof typeof HUBSPOT_SCOPES][] = [
  ["contact", "contacts", "contacts_read", "contacts_write"],
  ["company", "companies", "companies_read", "companies_write"],
  ["deal", "deals", "deals_read", "deals_write"],
  ["ticket", "tickets", "tickets", "tickets"],
];

for (const [one, type, read, write] of OBJECTS) {
  describe(`hubspot ${type}`, () => {
    const base = `/crm/v3/objects/${type}`;
    it("creates with properties", () => {
      const c = build(`create_${one}`, { properties: { name: "X" } });
      expect(c.method).toBe("POST");
      expect(new URL(c.url).pathname).toBe(base);
      expect(c.body).toEqual({ properties: { name: "X" } });
    });
    it("creates with inline official associations", () => {
      const associations = [{ to: { id: "9" }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 1 }] }];
      expect(build(`create_${one}`, { properties: { a: 1 }, associations }).body).toMatchObject({ associations });
    });
    it("rejects non-object properties", () => expect(() => build(`create_${one}`, { properties: ["x"] })).toThrow(/properties/));
    it("gets by id with properties and associations", () => {
      const u = new URL(build(`get_${one}`, { id: "101", properties: ["a", "b"], associations: ["companies"] }).url);
      expect(u.pathname).toBe(`${base}/101`);
      expect(u.searchParams.get("properties")).toBe("a,b");
      expect(u.searchParams.get("associations")).toBe("companies");
    });
    it("gets by a unique id property", () => expect(new URL(build(`get_${one}`, { id: "a@x.com", id_property: "email" }).url).searchParams.get("idProperty")).toBe("email"));
    it("normalizes a record without interpreting properties", async () => {
      const r = await run({ operation: `get_${one}`, params: { id: "101" } }, capture(RECORD).fetchImpl);
      expect(r.ok && r.items[0]).toMatchObject({ id: "101", properties: RECORD.properties, archived: false });
    });
    it("updates with PATCH", () => {
      const c = build(`update_${one}`, { id: "101", properties: { a: "b" } });
      expect(c.method).toBe("PATCH");
      expect(c.body).toEqual({ properties: { a: "b" } });
    });
    it("archives with DELETE", async () => {
      const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
      const r = await run({ operation: `archive_${one}`, params: { id: "101" } }, fetchImpl);
      expect(r.ok && r.items[0]).toEqual({ ok: true, operation: `archive_${one}` });
    });
    it("lists with limit and after", () => {
      const u = new URL(build(`list_${one}s`, { limit: 50 }, "cur1").url);
      expect(u.searchParams.get("limit")).toBe("50");
      expect(u.searchParams.get("after")).toBe("cur1");
    });
    it("clamps list limit to 100", () => expect(new URL(build(`list_${one}s`, { limit: 999 }).url).searchParams.get("limit")).toBe("100"));
    it("lists archived records on request", () => expect(new URL(build(`list_${one}s`, { archived: true }).url).searchParams.get("archived")).toBe("true"));
    it("searches via the CRM Search API", () => {
      const c = build(`search_${one}s`, { filters: [{ propertyName: "createdate", operator: "gte", value: "1" }] });
      expect(new URL(c.url).pathname).toBe(`${base}/search`);
      expect(c.method).toBe("POST");
      expect((c.body as { filterGroups: unknown[] }).filterGroups).toHaveLength(1);
    });
    it("batch reads", () => {
      const c = build(`batch_read_${one}s`, { ids: ["1", 2], properties: ["a"] });
      expect(new URL(c.url).pathname).toBe(`${base}/batch/read`);
      expect(c.body).toEqual({ inputs: [{ id: "1" }, { id: "2" }], properties: ["a"] });
    });
    it("batch creates", () => expect(build(`batch_create_${one}s`, { inputs: [{ properties: { a: 1 } }] }).body).toEqual({ inputs: [{ properties: { a: 1 } }] }));
    it("batch updates require ids", () => {
      expect(build(`batch_update_${one}s`, { inputs: [{ id: 5, properties: { a: 1 } }] }).body).toEqual({ inputs: [{ id: "5", properties: { a: 1 } }] });
      expect(() => build(`batch_update_${one}s`, { inputs: [{ properties: { a: 1 } }] })).toThrow(/id/);
    });
    it("batch archives", () => expect(build(`batch_archive_${one}s`, { ids: ["1"] }).body).toEqual({ inputs: [{ id: "1" }] }));
    it(`enforces the ${BATCH_MAX}-item batch limit`, () => {
      expect(() => build(`batch_create_${one}s`, { inputs: Array.from({ length: BATCH_MAX + 1 }, () => ({ properties: {} })) })).toThrow(/1–100/);
      expect(() => build(`batch_read_${one}s`, { ids: [] })).toThrow(/1–100/);
    });
    it("maps read/write scopes", () => {
      expect(hubspotScopeFor(`get_${one}`)).toBe(HUBSPOT_SCOPES[read]);
      expect(hubspotScopeFor(`create_${one}`)).toBe(HUBSPOT_SCOPES[write]);
    });
  });
}

// ---------------------------------------------------------------------------
describe("hubspot batch partial results", () => {
  it("reports full success with a summary", async () => {
    const r = await run({ operation: "batch_read_contacts", params: { ids: ["1"] } }, capture({ status: "COMPLETE", results: [RECORD] }).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "101", batch_status: "ok" });
    expect(r.ok && r.items.at(-1)).toMatchObject({ type: "batch_summary", succeeded: 1, failed: 0, partial: false });
  });
  it("never reports a 207 multi-status as full success", async () => {
    const r = await run(
      { operation: "batch_create_contacts", params: { inputs: [{ properties: { email: "a" } }, { properties: { email: "b" } }] } },
      capture({ status: "COMPLETE", results: [RECORD], numErrors: 1, errors: [{ status: "error", category: "VALIDATION_ERROR", message: "Property values were not valid", context: { ids: ["b"] } }] }, { status: 207 }).fetchImpl,
    );
    expect(r.ok && r.items.find((i) => i["batch_status"] === "error")).toMatchObject({ category: "VALIDATION_ERROR", context: { ids: ["b"] } });
    expect(r.ok && r.items.at(-1)).toMatchObject({ http_status: 207, succeeded: 1, failed: 1, partial: true });
  });
  it("flags 207 as partial even without an errors list", async () => {
    const r = await run({ operation: "batch_update_deals", params: { inputs: [{ id: 1, properties: {} }] } }, capture({ status: "COMPLETE", results: [] }, { status: 207 }).fetchImpl);
    expect(r.ok && r.items.at(-1)).toMatchObject({ partial: true });
  });
  it("does not retry a failed batch create (no duplicates)", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(hErr("invalid", "VALIDATION_ERROR"), { status: 400 }));
    await run({ operation: "batch_create_contacts", params: { inputs: [{ properties: {} }] } }, fetchImpl);
    expect(count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("hubspot custom objects", () => {
  it("lists by official object type id", () => expect(new URL(build("list_objects", { object_type: "2-12345" }).url).pathname).toBe("/crm/v3/objects/2-12345"));
  it("supports fully qualified names", () => expect(new URL(build("get_object", { object_type: "p_cars", id: "1" }).url).pathname).toBe("/crm/v3/objects/p_cars/1"));
  it("creates / updates / archives / searches", () => {
    expect(build("create_object", { object_type: "2-1", properties: { a: 1 } }).method).toBe("POST");
    expect(build("update_object", { object_type: "2-1", id: "1", properties: { a: 1 } }).method).toBe("PATCH");
    expect(build("archive_object", { object_type: "2-1", id: "1" }).method).toBe("DELETE");
    expect(new URL(build("search_objects", { object_type: "2-1" }).url).pathname).toBe("/crm/v3/objects/2-1/search");
  });
  it("requires object_type", () => expect(() => build("list_objects")).toThrow(/object_type/));
  it("rejects path-injection object types", () => {
    expect(() => assertObjectType("../owners")).toThrow(/object_type/);
    expect(() => build("list_objects", { object_type: "a/b" })).toThrow(/object_type/);
  });
  it("uses custom scopes for custom types and object scopes for standard types", () => {
    expect(hubspotScopeFor("list_objects", { object_type: "2-1" })).toBe(HUBSPOT_SCOPES.custom_read);
    expect(hubspotScopeFor("create_object", { object_type: "2-1" })).toBe(HUBSPOT_SCOPES.custom_write);
    expect(hubspotScopeFor("list_objects", { object_type: "deals" })).toBe(HUBSPOT_SCOPES.deals_read);
  });
});

// ---------------------------------------------------------------------------
describe("hubspot associations (v4)", () => {
  const TYPES = [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 279 }];
  it("reads associations with pagination", async () => {
    const { calls, fetchImpl } = capture({ results: [{ toObjectId: 55, associationTypes: [{ category: "HUBSPOT_DEFINED", typeId: 279, label: null }] }], paging: { next: { after: "n1" } } });
    const r = await run({ operation: "list_associations", params: { from_object_type: "contacts", from_object_id: "101", to_object_type: "companies" } }, fetchImpl);
    expect(urlOf(calls[0]!).pathname).toBe("/crm/v4/objects/contacts/101/associations/companies");
    expect(r.ok && r.items[0]).toEqual({ to_object_id: "55", association_types: [{ category: "HUBSPOT_DEFINED", type_id: 279, label: null }] });
    expect(r.ok && r.cursor).toBe("n1");
  });
  it("creates a labelled association with official type ids", () => {
    const c = build("create_association", { from_object_type: "contacts", from_object_id: "1", to_object_type: "companies", to_object_id: "2", association_types: TYPES });
    expect(c.method).toBe("PUT");
    expect(new URL(c.url).pathname).toBe("/crm/v4/objects/contacts/1/associations/companies/2");
    expect(c.body).toEqual(TYPES);
  });
  it("creates the HubSpot default association", () => {
    expect(new URL(build("create_default_association", { from_object_type: "deals", from_object_id: "1", to_object_type: "contacts", to_object_id: "2" }).url).pathname).toBe("/crm/v4/objects/deals/1/associations/default/contacts/2");
  });
  it("rejects invented association categories / non-numeric type ids", () => {
    const base = { from_object_type: "contacts", from_object_id: "1", to_object_type: "companies", to_object_id: "2" };
    expect(() => build("create_association", { ...base, association_types: [{ associationCategory: "FRIENDS", associationTypeId: 1 }] })).toThrow(/associationCategory/);
    expect(() => build("create_association", { ...base, association_types: [{ associationCategory: "USER_DEFINED", associationTypeId: "1" }] })).toThrow(/associationTypeId/);
    expect(() => build("create_association", { ...base, association_types: [] })).toThrow(/association_types/);
  });
  it("removes an association", () => expect(build("remove_association", { from_object_type: "contacts", from_object_id: "1", to_object_type: "companies", to_object_id: "2" }).method).toBe("DELETE"));
  it("batch reads associations", async () => {
    const { calls, fetchImpl } = capture({ status: "COMPLETE", results: [{ from: { id: "1" }, to: [{ toObjectId: 2, associationTypes: [] }] }] });
    const r = await run({ operation: "batch_read_associations", params: { from_object_type: "contacts", to_object_type: "companies", ids: ["1"] } }, fetchImpl);
    expect(urlOf(calls[0]!).pathname).toBe("/crm/v4/associations/contacts/companies/batch/read");
    expect(r.ok && r.items[0]).toMatchObject({ from_object_id: "1", to: [{ to_object_id: "2" }], batch_status: "ok" });
  });
  it("batch creates associations", () => {
    const c = build("batch_create_associations", { from_object_type: "contacts", to_object_type: "companies", inputs: [{ from_id: 1, to_id: 2, association_types: TYPES }] });
    expect(c.body).toEqual({ inputs: [{ from: { id: "1" }, to: { id: "2" }, types: TYPES }] });
  });
  it("batch archives associations", () => {
    expect(build("batch_archive_associations", { from_object_type: "contacts", to_object_type: "companies", inputs: [{ from_id: 1, to_ids: [2, 3] }] }).body).toEqual({ inputs: [{ from: { id: "1" }, to: [{ id: "2" }, { id: "3" }] }] });
  });
  it(`enforces the ${ASSOCIATION_BATCH_MAX} association batch limit`, () => {
    expect(() => build("batch_read_associations", { from_object_type: "a", to_object_type: "b", ids: Array.from({ length: ASSOCIATION_BATCH_MAX + 1 }, (_, i) => i) })).toThrow(/1–1000/);
  });
  it("reports partial association batch errors", async () => {
    const r = await run(
      { operation: "batch_read_associations", params: { from_object_type: "contacts", to_object_type: "companies", ids: ["1", "2"] } },
      capture({ status: "COMPLETE", results: [], errors: [{ category: "OBJECT_NOT_FOUND", message: "missing", context: { ids: ["2"] } }] }, { status: 207 }).fetchImpl,
    );
    expect(r.ok && r.items.at(-1)).toMatchObject({ partial: true, failed: 1 });
  });
  it("lists official association labels", async () => {
    const r = await run({ operation: "list_association_labels", params: { from_object_type: "contacts", to_object_type: "companies" } }, capture({ results: [{ category: "USER_DEFINED", typeId: 36, label: "Manager" }] }).fetchImpl);
    expect(r.ok && r.items[0]).toEqual({ category: "USER_DEFINED", type_id: 36, label: "Manager" });
  });
});

// ---------------------------------------------------------------------------
describe("hubspot properties / schemas / pipelines / owners", () => {
  it("lists properties", async () => {
    const { calls, fetchImpl } = capture({ results: [{ name: "email", label: "Email", type: "string", fieldType: "text", groupName: "contactinformation", hubspotDefined: true }] });
    const r = await run({ operation: "list_properties", params: { object_type: "contacts" } }, fetchImpl);
    expect(urlOf(calls[0]!).pathname).toBe("/crm/v3/properties/contacts");
    expect(r.ok && r.items[0]).toMatchObject({ name: "email", field_type: "text", hubspot_defined: true });
  });
  it("gets one property", () => expect(new URL(build("get_property", { object_type: "deals", property_name: "dealstage" }).url).pathname).toBe("/crm/v3/properties/deals/dealstage"));
  it("lists schemas", async () => {
    const r = await run({ operation: "list_schemas" }, capture({ results: [{ id: "1", objectTypeId: "2-1", name: "cars", labels: { singular: "Car" }, properties: [] }] }).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ object_type_id: "2-1", name: "cars" });
  });
  it("gets one schema", () => expect(new URL(build("get_schema", { object_type: "2-1" }).url).pathname).toBe("/crm/v3/schemas/2-1"));
  it("lists pipelines with stage ids as official values", async () => {
    const r = await run({ operation: "list_pipelines", params: { object_type: "deals" } }, capture({ results: [{ id: "default", label: "Sales", stages: [{ id: "appointmentscheduled", label: "Appointment", displayOrder: 0, metadata: { probability: "0.2" } }] }] }).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "default", stages: [{ id: "appointmentscheduled", metadata: { probability: "0.2" } }] });
  });
  it("gets a pipeline", () => expect(new URL(build("get_pipeline", { object_type: "tickets", pipeline_id: "0" }).url).pathname).toBe("/crm/v3/pipelines/tickets/0"));
  it("lists owners with pagination", async () => {
    const { calls, fetchImpl } = capture({ results: [{ id: "7", email: "o@x.com", firstName: "O" }], paging: { next: { after: "8" } } });
    const r = await run({ operation: "list_owners", params: { email: "o@x.com" } }, fetchImpl);
    expect(urlOf(calls[0]!).searchParams.get("email")).toBe("o@x.com");
    expect(r.ok && r.items[0]).toMatchObject({ id: "7", email: "o@x.com" });
  });
  it("gets an owner", () => expect(new URL(build("get_owner", { owner_id: "7" }).url).pathname).toBe("/crm/v3/owners/7"));
});

// ---------------------------------------------------------------------------
describe("hubspot search", () => {
  it("builds filters into one filter group", () => {
    const b = buildSearchBody({ filters: [{ propertyName: "email", operator: "eq", value: "a@x.com" }] }, null);
    expect(b).toEqual({ filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: "a@x.com" }] }], limit: 100 });
  });
  it("supports OR-ed filter groups", () => {
    const b = buildSearchBody({ filter_groups: [{ filters: [{ propertyName: "a", operator: "EQ", value: 1 }] }, { filters: [{ propertyName: "b", operator: "HAS_PROPERTY" }] }] }, null);
    expect((b["filterGroups"] as unknown[]).length).toBe(2);
  });
  it("passes sorts, properties and query", () => {
    const b = buildSearchBody({ sorts: [{ propertyName: "createdate", direction: "DESCENDING" }], properties: ["email"], query: "acme" }, null);
    expect(b).toMatchObject({ sorts: [{ propertyName: "createdate", direction: "DESCENDING" }], properties: ["email"], query: "acme" });
  });
  it("puts the cursor in `after`", () => expect(buildSearchBody({}, "200")).toMatchObject({ after: "200" }));
  it("clamps limit to 200", () => expect(buildSearchBody({ limit: 5000 }, null)).toMatchObject({ limit: 200 }));
  it("rejects unofficial operators", () => expect(() => buildSearchBody({ filters: [{ propertyName: "a", operator: "LIKE" }] }, null)).toThrow(/operator/));
  it("enforces 5 groups, 6 filters per group, 18 total", () => {
    const f = (n: number) => Array.from({ length: n }, () => ({ propertyName: "a", operator: "EQ", value: 1 }));
    expect(() => buildSearchBody({ filter_groups: Array.from({ length: 6 }, () => ({ filters: f(1) })) }, null)).toThrow(/5 filter groups/);
    expect(() => buildSearchBody({ filters: f(7) }, null)).toThrow(/6 filters/);
    expect(() => buildSearchBody({ filter_groups: Array.from({ length: 4 }, () => ({ filters: f(5) })) }, null)).toThrow(/18 filters/);
  });
  it("follows paging.next.after across search pages", async () => {
    const { fetchImpl, calls } = sequence(
      () => jsonResponse({ total: 2, results: [RECORD], paging: { next: { after: "1" } } }),
      () => jsonResponse({ total: 2, results: [{ ...RECORD, id: "102" }] }),
    );
    const r = await run({ operation: "search_contacts", params: { filters: [{ propertyName: "email", operator: "HAS_PROPERTY" }] }, maxPages: 5 }, fetchImpl);
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]!.body)).toMatchObject({ after: "1" });
    expect(r.ok && r.items.map((i) => i["id"])).toEqual(["101", "102"]);
  });
  it("documents the 10k search cap", () => expect(UNSUPPORTED_OPERATIONS["search_beyond_10000"]).toMatch(/10,000/));
});

// ---------------------------------------------------------------------------
describe("hubspot pagination", () => {
  it("returns paging.next.after as cursor", async () => {
    const r = await run({ operation: "list_contacts" }, capture({ results: [RECORD], paging: { next: { after: "abc", link: "x" } } }).fetchImpl);
    expect(r.ok && r.cursor).toBe("abc");
  });
  it("returns null on the last page", async () => expect(((await run({ operation: "list_contacts" }, capture({ results: [] }).fetchImpl)) as { cursor: unknown }).cursor).toBeNull());
  it("follows pages up to maxPages", async () => {
    const { fetchImpl, calls } = sequence(
      () => jsonResponse({ results: [RECORD], paging: { next: { after: "a" } } }),
      () => jsonResponse({ results: [RECORD], paging: { next: { after: "b" } } }),
    );
    const r = await run({ operation: "list_deals", maxPages: 2 }, fetchImpl);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1]!.url).searchParams.get("after")).toBe("a");
    expect(r.ok && r.cursor).toBe("b");
  });
  it("rejects a non-list results field", async () => {
    const r = await run({ operation: "list_contacts" }, capture({ results: "x" }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("malformed_response");
  });
});

// ---------------------------------------------------------------------------
describe("hubspot webhooks", () => {
  it("accepts a valid v1-signed batch", () => {
    const v = deliver([EVENT]);
    expect(v.ok).toBe(true);
    expect(v.eventId).toBe("hubspot:4242:77:9001");
    expect(v.eventType).toBe("contact.propertyChange");
  });
  it("accepts v1 when the version header is absent", () => expect(deliver([EVENT], { headers: { "x-hubspot-signature-version": null } }).ok).toBe(true));
  it("rejects a tampered body", () => {
    const raw = JSON.stringify([EVENT]);
    const v = verifyWebhook("hubspot", { raw: raw.replace("9001", "9002"), headers: { "x-hubspot-signature": sign(raw) }, payload: [EVENT], secret: CLIENT_SECRET, nowMs: NOW, replayWindowMs: 300_000 });
    expect(v.reason).toBe("invalid_signature");
  });
  it("rejects a wrong secret", () => expect(deliver([EVENT], { signWith: "other" }).reason).toBe("invalid_signature"));
  it("rejects a missing signature", () => expect(deliver([EVENT], { headers: { "x-hubspot-signature": null } }).reason).toBe("invalid_signature"));
  it("rejects v3-only requests (URI not available to the shared verifier)", () =>
    expect(deliver([EVENT], { headers: { "x-hubspot-signature-version": "v3", "x-hubspot-signature-v3": "abc" } }).reason).toBe("invalid_signature"));
  it("rejects when no secret is configured", () => expect(deliver([EVENT], { secret: null }).reason).toBe("missing_secret"));
  it("rejects old events (replay)", () => expect(deliver([{ ...EVENT, occurredAt: NOW - 3600_000 }]).reason).toBe("replay"));
  it("rejects an old request timestamp (replay)", () => expect(deliver([EVENT], { headers: { "x-hubspot-request-timestamp": String(NOW - 3600_000) } }).reason).toBe("replay"));
  it("accepts a fresh request timestamp", () => expect(deliver([EVENT], { headers: { "x-hubspot-request-timestamp": String(NOW) } }).ok).toBe(true));
  it("rejects malformed timestamps", () => expect(deliver([EVENT], { headers: { "x-hubspot-request-timestamp": "soon" } }).reason).toBe("replay"));
  it("rejects a non-array body", () => expect(deliver({ hello: 1 }).reason).toBe("malformed_payload"));
  it("rejects events without official ids", () => expect(deliver([{ ...EVENT, eventId: undefined }]).reason).toBe("malformed_payload"));
  it("dedupes retries of the same batch (attemptNumber ignored)", () => expect(deliver([{ ...EVENT, attemptNumber: 3 }]).eventId).toBe(deliver([EVENT]).eventId));
  it("dedupe key is order-independent", () => {
    const e2 = { ...EVENT, eventId: 9002 };
    expect(deliver([EVENT, e2]).eventId).toBe(deliver([e2, EVENT]).eventId);
  });
  it("uses official ids, not timestamps, for event ids", () => expect(deliver([{ ...EVENT, occurredAt: NOW - 1 }]).eventId).toBe(deliver([EVENT]).eventId));
  it("different portals never collide", () => expect(deliver([{ ...EVENT, portalId: 1 }]).eventId).toBe("hubspot:1:77:9001"));
  it("rejects mixed-portal batches", () => expect(deliver([EVENT, { ...EVENT, portalId: 1, eventId: 2 }]).reason).toBe("malformed_payload"));
  it("labels mixed subscription types as batch", () => expect(deliver([EVENT, { ...EVENT, eventId: 2, subscriptionType: "deal.creation" }]).eventType).toBe("batch"));
  it("parses official event fields", () => expect(parseHubSpotEvents([EVENT])[0]).toMatchObject({ eventId: "9001", portalId: "4242", subscriptionId: "77", objectId: "101" }));
  it("never echoes the secret", () => expect(JSON.stringify(deliver([EVENT], { signWith: "x" }))).not.toContain(CLIENT_SECRET));
  it("each workspace endpoint verifies with its own app secret", () => {
    expect(deliver([EVENT], { secret: "ws2-secret" }).reason).toBe("invalid_signature");
    expect(hubSpotBatchEventId([])).toBeUndefined();
  });
  it("subscription management is documented as developer-app scope", () => expect(UNSUPPORTED_OPERATIONS["webhook_subscription_management"]).toMatch(/developer/));
});

// ---------------------------------------------------------------------------
describe("hubspot rate limits / retry / errors", () => {
  it("retries 429 and succeeds", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(hErr("You have reached your secondly limit.", "RATE_LIMITS"), { status: 429, headers: { "retry-after": "1" } }), () => jsonResponse({ results: [] }));
    expect((await run({ operation: "list_contacts" }, fetchImpl)).ok).toBe(true);
    expect(count()).toBe(2);
  });
  it("gives up after max attempts on persistent 429", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(hErr("slow", "RATE_LIMITS"), { status: 429 }));
    const r = await run({ operation: "list_contacts" }, fetchImpl, creds, { maxAttempts: 3 });
    if (!r.ok) expect(r.error.kind).toBe("rate_limit");
    expect(count()).toBe(3);
  });
  it("reads Retry-After seconds", () => expect(hubspotConnector.readRateLimit?.(new Headers({ "retry-after": "3" }), null)).toEqual({ retryAfterMs: 3000, remaining: 0 }));
  it("reads Retry-After dates", () => expect(hubspotConnector.readRateLimit?.(new Headers({ "retry-after": new Date(Date.now() + 10_000).toUTCString() }), null)?.retryAfterMs).toBeGreaterThan(0));
  it("reads X-HubSpot-RateLimit headers", () => {
    expect(hubspotConnector.readRateLimit?.(new Headers({ "x-hubspot-ratelimit-max": "190", "x-hubspot-ratelimit-remaining": "0", "x-hubspot-ratelimit-interval-milliseconds": "10000" }), null)).toEqual({
      limit: 190, remaining: 0, retryAfterMs: 10000,
    });
  });
  it("returns undefined without headers", () => expect(hubspotConnector.readRateLimit?.(new Headers(), null)).toBeUndefined());
  it("retries 5xx", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse({ status: "error", message: "down" }, { status: 502 }), () => jsonResponse({ results: [] }));
    expect((await run({ operation: "list_contacts" }, fetchImpl)).ok).toBe(true);
    expect(count()).toBe(2);
  });
  it("retries transient network failures", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      if (n++ === 0) throw new Error("ECONNRESET");
      return jsonResponse({ results: [] });
    }) as unknown as typeof fetch;
    expect((await run({ operation: "list_contacts" }, fetchImpl)).ok).toBe(true);
  });
  const CASES: [number, string, string, boolean][] = [
    [400, "VALIDATION_ERROR", "invalid_request", false],
    [401, "INVALID_AUTHENTICATION", "auth", false],
    [403, "MISSING_SCOPES", "forbidden", false],
    [404, "OBJECT_NOT_FOUND", "not_found", false],
    [409, "CONFLICT", "invalid_request", false],
    [429, "RATE_LIMITS", "rate_limit", true],
    [500, "", "provider", true],
    [503, "", "provider", true],
  ];
  for (const [status, category, kind, retryable] of CASES)
    it(`maps ${status} ${category || ""} to ${kind}`, () => expect(hubspotConnector.mapError?.(status, hErr("m", category))).toMatchObject({ kind, retryable }));
  it("keeps HubSpot's correlationId for support", () => expect(hubspotConnector.mapError?.(400, hErr("bad", "VALIDATION_ERROR"))?.message).toContain("corr-1"));
  it("409 duplicate contact is not retried", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(hErr("Contact already exists. Existing ID: 101", "CONFLICT"), { status: 409 }));
    const r = await run({ operation: "create_contact", params: { properties: { email: "a@x.com" } } }, fetchImpl);
    if (!r.ok) expect(r.error.message).toMatch(/conflict/);
    expect(count()).toBe(1);
  });
  it("ignores 2xx", () => expect(hubspotConnector.mapError?.(200, {})).toBeNull());
  it("unknown operations fail", () => expect(() => build("hack")).toThrow(/Unknown HubSpot operation/));
  it("non-JSON bodies fail normalization", () => expect(() => hubspotConnector.normalize("get_contact", "oops", 200)).toThrow(/non-JSON/));
});

// ---------------------------------------------------------------------------
describe("hubspot idempotency", () => {
  it("sends no invented idempotency header or field", async () => {
    const { calls, fetchImpl } = capture(RECORD);
    await run({ operation: "create_contact", params: { properties: { a: 1 }, idempotency_key: "k1" } }, fetchImpl);
    const headers = Object.keys((calls[0]!.init.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase());
    expect(headers.some((h) => h.includes("idempot"))).toBe(false);
    expect(JSON.stringify(bodyOf(calls[0]))).not.toContain("k1");
  });
  it("documents that HubSpot has no idempotency header", () => expect(UNSUPPORTED_OPERATIONS["idempotency_key"]).toMatch(/no idempotency/));
  it("returns HubSpot ids for runtime records", async () => expect(((await run({ operation: "create_deal", params: { properties: {} } }, capture(RECORD).fetchImpl)) as { items: unknown[] }).items[0]).toMatchObject({ id: "101" }));
  it("does not retry a failed create", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(hErr("bad", "VALIDATION_ERROR"), { status: 400 }));
    await run({ operation: "create_company", params: { properties: {} } }, fetchImpl);
    expect(count()).toBe(1);
  });
  for (const op of ["file_upload", "imports_api", "gdpr_delete", "merge_records", "workflow_automation"])
    it(`${op} is UNSUPPORTED without network`, async () => {
      const fetchImpl = vi.fn() as unknown as typeof fetch;
      const r = await run({ operation: op }, fetchImpl);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe("unsupported");
      expect(fetchImpl).not.toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
describe("hubspot workspace / credential / portal isolation / RBAC", () => {
  it("each run uses only its own token", async () => {
    const a = capture({ results: [] });
    const b = capture({ results: [] });
    await run({ operation: "list_contacts" }, a.fetchImpl, { access_token: TOKEN });
    await run({ operation: "list_contacts" }, b.fetchImpl, { access_token: TOKEN_B });
    expect(headerOf(a.calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headerOf(b.calls[0], "authorization")).toBe(`Bearer ${TOKEN_B}`);
  });
  it("accounts are scoped to the initiating workspace", async () => {
    const { store } = memoryStore();
    const s1 = await beginAuthorization({ store, spec, clientId: "c", pending: pending("ws1"), nowMs: NOW });
    const s2 = await beginAuthorization({ store, spec, clientId: "c", pending: pending("ws2"), nowMs: NOW });
    const fetchImpl = capture({ access_token: TOKEN, hub_id: 1 }).fetchImpl;
    const a1 = await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: s1.state, code: "x", fetchImpl, nowMs: NOW });
    const a2 = await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: s2.state, code: "x", fetchImpl, nowMs: NOW });
    expect(a1.account.id).not.toBe(a2.account.id);
    expect(await store.getAccount("ws2", a1.account.id)).toBeNull();
  });
  it("two portals in one workspace are two accounts", async () => {
    const { store } = memoryStore();
    const ids: string[] = [];
    for (const hub of [1, 2]) {
      const { state } = await beginAuthorization({ store, spec, clientId: "c", pending: pending("ws1"), nowMs: NOW });
      const { account } = await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "x", fetchImpl: capture({ access_token: TOKEN, hub_id: hub }).fetchImpl, nowMs: NOW });
      ids.push(account.accountIdentifier);
    }
    expect(ids).toEqual(["hub:1", "hub:2"]);
  });
  it("reconnecting the same portal reuses the account", async () => {
    const { store } = memoryStore();
    const ids: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { state } = await beginAuthorization({ store, spec, clientId: "c", pending: pending("ws1"), nowMs: NOW });
      const { account } = await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "x", fetchImpl: capture({ access_token: TOKEN, hub_id: 9 }).fetchImpl, nowMs: NOW });
      ids.push(account.id);
    }
    expect(ids[0]).toBe(ids[1]);
  });
  function rbacClient(role: string | null) {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: role ? { role } : null, error: null }) };
    return { from: () => chain } as unknown as Parameters<typeof assertCanExecute>[0];
  }
  for (const role of ["owner", "admin", "member"]) it(`RBAC allows ${role}`, async () => expect(assertCanExecute(rbacClient(role), "ws1", "u1")).resolves.toBe(role));
  for (const role of ["viewer", null]) it(`RBAC blocks ${role ?? "non-members"}`, async () => expect(assertCanExecute(rbacClient(role), "ws1", "u1")).rejects.toThrow(/permission/));
  it("documents that tokens carry scopes, not user record permissions", () => expect(UNSUPPORTED_OPERATIONS["user_permission_scoping"]).toBeDefined());
});

// ---------------------------------------------------------------------------
describe("hubspot secret redaction / trace ids", () => {
  it("never returns the token in results", async () => expect(JSON.stringify(await run({ operation: "list_contacts" }, capture({ results: [] }).fetchImpl))).not.toContain(TOKEN));
  it("scrubs the token from provider errors", async () =>
    expect(JSON.stringify(await run({ operation: "list_contacts" }, capture(hErr(`bad ${TOKEN}`, "VALIDATION_ERROR"), { status: 400 }).fetchImpl))).not.toContain(TOKEN));
  it("scrubs private-app tokens from errors", async () =>
    expect(JSON.stringify(await run({ operation: "list_contacts" }, capture(hErr(`bad ${PRIVATE_APP}`, "VALIDATION_ERROR"), { status: 400 }).fetchImpl, { access_token: PRIVATE_APP }))).not.toContain(PRIVATE_APP));
  it("scrubs the token from network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`socket ${TOKEN}`);
    }) as unknown as typeof fetch;
    expect(JSON.stringify(await run({ operation: "list_contacts" }, fetchImpl, creds, { maxAttempts: 1 }))).not.toContain(TOKEN);
  });
  it("redacts token-like keys", () => {
    const out = JSON.stringify(redact({ access_token: TOKEN, refresh_token: REFRESH, client_secret: CLIENT_SECRET }));
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(REFRESH);
    expect(out).not.toContain(CLIENT_SECRET);
  });
  it("does not emit the token in runtime events and keeps the trace id", async () => {
    const events: unknown[] = [];
    const { fetchImpl } = sequence(() => jsonResponse(hErr("slow", "RATE_LIMITS"), { status: 429 }), () => jsonResponse({ results: [] }));
    await run({ operation: "list_contacts" }, fetchImpl, creds, { onEvent: (e) => events.push(e) });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    expect(events.every((e) => (e as { traceId: string }).traceId === trace)).toBe(true);
  });
  it("carries the trace id on success and failure", async () => {
    expect((await run({ operation: "list_contacts" }, capture({ results: [] }).fetchImpl)).traceId).toBe(trace);
    expect((await run({ operation: "get_contact", params: { id: "x" } }, capture(hErr("nf", "OBJECT_NOT_FOUND"), { status: 404 }).fetchImpl)).traceId).toBe(trace);
  });
  it("normalizes records without leaking extra fields", () => expect(Object.keys(normalizeHubSpotObject(RECORD))).toEqual(["id", "properties", "created_at", "updated_at", "archived", "archived_at"]));
});
