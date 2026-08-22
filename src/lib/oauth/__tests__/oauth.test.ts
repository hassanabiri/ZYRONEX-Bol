import { describe, expect, it } from "vitest";

import {
  beginAuthorization,
  completeAuthorization,
  disconnectAccount,
  ensureAccessToken,
  hashState,
  isExpired,
} from "@/lib/oauth/core";
import { customOAuthProvider, getOAuthProvider } from "@/lib/oauth/providers";
import {
  OAuthError,
  type ConnectionAccount,
  type OAuthStore,
  type OAuthTokenSet,
  type PendingAuthorization,
} from "@/lib/oauth/types";

const SPEC = customOAuthProvider({
  connector: "demo",
  authorizationUrl: "https://provider.test/oauth/authorize",
  tokenUrl: "https://provider.test/oauth/token",
  revokeUrl: "https://provider.test/oauth/revoke",
  scopes: ["orders.read"],
});
const CLIENT = { clientId: "client-123", clientSecret: "super-secret-value" };

type StoredState = PendingAuthorization & { stateHash: string; expiresAt: string; consumed: boolean };

function memoryStore() {
  const states = new Map<string, StoredState>();
  const accounts = new Map<string, ConnectionAccount>();
  const tokens = new Map<string, OAuthTokenSet>();
  const locks = new Map<string, { owner: string; until: number }>();
  let seq = 0;

  const store: OAuthStore = {
    saveState: async (input) => {
      states.set(input.stateHash, { ...input, consumed: false });
    },
    peekState: async (hash, nowMs) => {
      const row = states.get(hash);
      if (!row || row.consumed || new Date(row.expiresAt).getTime() <= nowMs) return null;
      return row;
    },
    consumeState: async (hash, nowMs) => {
      const row = states.get(hash);
      if (!row || row.consumed || new Date(row.expiresAt).getTime() <= nowMs) return null;
      row.consumed = true;
      return row;
    },
    upsertAccount: async (input) => {
      const key = `${input.workspaceId}:${input.provider}:${input.accountIdentifier}`;
      const existing = [...accounts.values()].find(
        (a) => `${a.workspaceId}:${a.provider}:${a.accountIdentifier}` === key,
      );
      seq += 1;
      const account: ConnectionAccount = {
        id: existing?.id ?? `acc-${seq}`,
        workspaceId: input.workspaceId,
        integrationId: input.integrationId,
        provider: input.provider,
        connector: input.connector,
        accountIdentifier: input.accountIdentifier,
        accountLabel: input.accountLabel,
        status: input.status,
        credentialRef: null,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
        lastVerifiedAt: input.lastVerifiedAt,
        lastError: null,
        refreshFailures: 0,
      };
      accounts.set(account.id, account);
      tokens.set(account.id, input.tokens);
      return account;
    },
    getAccount: async (workspaceId, accountId) => {
      const account = accounts.get(accountId);
      // Workspace isolation is enforced on the read itself.
      return account && account.workspaceId === workspaceId ? account : null;
    },
    readTokens: async (accountId) => tokens.get(accountId) ?? null,
    writeTokens: async (accountId, next) => {
      tokens.set(accountId, next);
    },
    updateAccount: async (accountId, patch) => {
      const account = accounts.get(accountId);
      if (account) accounts.set(accountId, { ...account, ...patch });
    },
    acquireRefreshLock: async (accountId, owner, ttlMs) => {
      const held = locks.get(accountId);
      if (held && held.until > Date.now()) return false;
      locks.set(accountId, { owner, until: Date.now() + ttlMs });
      return true;
    },
    releaseRefreshLock: async (accountId, owner) => {
      if (locks.get(accountId)?.owner === owner) locks.delete(accountId);
    },
  };

  return { store, accounts, tokens, locks };
}

function jsonFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

const pending = {
  workspaceId: "ws-1",
  integrationId: "int-1",
  provider: "demo",
  connector: "demo",
  redirectUri: "https://app.test/api/public/oauth/callback/demo",
  createdBy: "user-1",
};

async function connect(store: OAuthStore, fetchImpl?: typeof fetch) {
  const { state } = await beginAuthorization({ store, spec: SPEC, clientId: CLIENT.clientId, pending });
  return completeAuthorization({
    store,
    spec: SPEC,
    client: CLIENT,
    state,
    code: "auth-code",
    fetchImpl:
      fetchImpl ??
      jsonFetch({ access_token: "at-1", refresh_token: "rt-1", expires_in: 3600, scope: "orders.read" }),
  });
}

describe("oauth authorization", () => {
  it("builds an authorize URL with PKCE and a single-use state", async () => {
    const { store } = memoryStore();
    const { authorizationUrl, state } = await beginAuthorization({
      store,
      spec: SPEC,
      clientId: CLIENT.clientId,
      pending,
    });
    const url = new URL(authorizationUrl);

    expect(url.origin + url.pathname).toBe("https://provider.test/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(CLIENT.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(pending.redirectUri);
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(state);
    // Only the hash of the state is persisted.
    expect(await store.peekState?.(hashState(state), Date.now())).toMatchObject({ workspaceId: "ws-1" });
    expect(authorizationUrl).not.toContain(CLIENT.clientSecret);
  });

  it("completes the flow and stores a connected account", async () => {
    const { store, tokens } = memoryStore();
    const { account } = await connect(store);

    expect(account.status).toBe("connected");
    expect(account.workspaceId).toBe("ws-1");
    expect(account.scopes).toEqual(["orders.read"]);
    expect(tokens.get(account.id)?.refreshToken).toBe("rt-1");
  });

  it("rejects an invalid state before contacting the provider", async () => {
    const { store } = memoryStore();
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;

    await expect(
      completeAuthorization({ store, spec: SPEC, client: CLIENT, state: "forged", code: "x", fetchImpl: spy }),
    ).rejects.toThrow(OAuthError);
    expect(called).toBe(false);
  });

  it("rejects a replayed state", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec: SPEC, clientId: CLIENT.clientId, pending });
    const fetchImpl = jsonFetch({ access_token: "at-1", expires_in: 60 });

    await completeAuthorization({ store, spec: SPEC, client: CLIENT, state, code: "c", fetchImpl });
    await expect(
      completeAuthorization({ store, spec: SPEC, client: CLIENT, state, code: "c", fetchImpl }),
    ).rejects.toThrow("no longer valid");
  });

  it("rejects an expired state", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec: SPEC, clientId: CLIENT.clientId, pending });
    await expect(
      completeAuthorization({
        store,
        spec: SPEC,
        client: CLIENT,
        state,
        code: "c",
        nowMs: Date.now() + 60 * 60 * 1000,
        fetchImpl: jsonFetch({ access_token: "at" }),
      }),
    ).rejects.toThrow("no longer valid");
  });

  it("surfaces a token exchange failure without leaking the client secret", async () => {
    const { store } = memoryStore();
    const failing = jsonFetch({ error: "invalid_grant", error_description: "code expired" }, 400);
    await expect(connect(store, failing)).rejects.toMatchObject({ kind: "token_exchange_failed" });
    await expect(connect(store, failing)).rejects.toSatisfy(
      (error: Error) => !error.message.includes(CLIENT.clientSecret),
    );
  });
});

describe("token lifecycle", () => {
  it("treats a token inside the refresh skew as expired", () => {
    const now = Date.now();
    expect(isExpired({ expiresAt: new Date(now + 10_000).toISOString() }, now)).toBe(true);
    expect(isExpired({ expiresAt: new Date(now + 600_000).toISOString() }, now)).toBe(false);
    expect(isExpired({ expiresAt: null }, now)).toBe(false);
  });

  it("refreshes an expired token and keeps the rotated refresh token", async () => {
    const { store, accounts } = memoryStore();
    const { account } = await connect(store);
    await store.updateAccount(account.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const stale = (await store.getAccount("ws-1", account.id))!;

    const result = await ensureAccessToken({
      store,
      spec: SPEC,
      client: CLIENT,
      account: stale,
      fetchImpl: jsonFetch({ access_token: "at-2", expires_in: 3600 }),
    });

    expect(result.refreshed).toBe(true);
    expect(result.token).toBe("at-2");
    // The provider omitted refresh_token on rotation — the stored one survives.
    expect((await store.readTokens(account.id))?.refreshToken).toBe("rt-1");
    expect(accounts.get(account.id)?.status).toBe("connected");
  });

  it("returns the cached token when it is still valid", async () => {
    const { store } = memoryStore();
    const { account } = await connect(store);
    const never = (() => {
      throw new Error("provider must not be called");
    }) as unknown as typeof fetch;

    const result = await ensureAccessToken({ store, spec: SPEC, client: CLIENT, account, fetchImpl: never });
    expect(result).toMatchObject({ token: "at-1", refreshed: false });
  });

  it("parks the account in reauth_required when the refresh is rejected", async () => {
    const { store, accounts } = memoryStore();
    const { account } = await connect(store);
    await store.updateAccount(account.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const stale = (await store.getAccount("ws-1", account.id))!;

    await expect(
      ensureAccessToken({
        store,
        spec: SPEC,
        client: CLIENT,
        account: stale,
        fetchImpl: jsonFetch({ error: "invalid_grant" }, 400),
      }),
    ).rejects.toMatchObject({ kind: "refresh_failed" });

    const parked = accounts.get(account.id)!;
    expect(parked.status).toBe("reauth_required");
    expect(parked.refreshFailures).toBe(1);
    // A parked account never calls the provider again on its own.
    await expect(
      ensureAccessToken({ store, spec: SPEC, client: CLIENT, account: parked }),
    ).rejects.toThrow("needs to be reconnected");
  });

  it("requires reconnection when there is no refresh token", async () => {
    const { store, accounts } = memoryStore();
    const { account } = await connect(store, jsonFetch({ access_token: "at-1", expires_in: 30 }));

    await expect(ensureAccessToken({ store, spec: SPEC, client: CLIENT, account })).rejects.toThrow(
      "must be reconnected",
    );
    expect(accounts.get(account.id)?.status).toBe("reauth_required");
  });

  it("performs exactly one refresh for concurrent callers", async () => {
    const { store } = memoryStore();
    const { account } = await connect(store);
    await store.updateAccount(account.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    const stale = (await store.getAccount("ws-1", account.id))!;

    let calls = 0;
    const slow = (async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return new Response(JSON.stringify({ access_token: "at-2", expires_in: 3600 }));
    }) as unknown as typeof fetch;

    const results = await Promise.allSettled([
      ensureAccessToken({ store, spec: SPEC, client: CLIENT, account: stale, fetchImpl: slow }),
      ensureAccessToken({ store, spec: SPEC, client: CLIENT, account: stale, fetchImpl: slow }),
    ]);

    expect(calls).toBe(1);
    expect(results.filter((r) => r.status === "fulfilled")).not.toHaveLength(0);
  });

  it("refuses to use a revoked connection", async () => {
    const { store } = memoryStore();
    const { account } = await connect(store);
    await store.updateAccount(account.id, { status: "revoked" });
    const revoked = (await store.getAccount("ws-1", account.id))!;

    await expect(ensureAccessToken({ store, spec: SPEC, client: CLIENT, account: revoked })).rejects.toMatchObject({
      kind: "revoked",
    });
  });
});

describe("disconnect and isolation", () => {
  it("revokes at the provider and clears the stored tokens", async () => {
    const { store, accounts } = memoryStore();
    const { account } = await connect(store);
    let revokeCalled = false;
    const fetchImpl = (async (url: string) => {
      revokeCalled = String(url).endsWith("/revoke");
      return new Response("{}");
    }) as unknown as typeof fetch;

    const result = await disconnectAccount({ store, spec: SPEC, client: CLIENT, account, fetchImpl });

    expect(result.revokedAtProvider).toBe(true);
    expect(revokeCalled).toBe(true);
    expect(accounts.get(account.id)?.status).toBe("disconnected");
    expect((await store.readTokens(account.id))?.accessToken).toBe("");
  });

  it("disconnects locally even when the provider revoke call fails", async () => {
    const { store, accounts } = memoryStore();
    const { account } = await connect(store);
    const failing = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    const result = await disconnectAccount({ store, spec: SPEC, client: CLIENT, account, fetchImpl: failing });
    expect(result.revokedAtProvider).toBe(false);
    expect(accounts.get(account.id)?.status).toBe("disconnected");
  });

  it("keeps several accounts of one provider apart inside a workspace", async () => {
    const { store } = memoryStore();
    const spec = { ...SPEC, identify: (t: Record<string, unknown>) => ({ accountIdentifier: String(t["shop"]) }) };
    const first = await beginAuthorization({ store, spec, clientId: CLIENT.clientId, pending });
    const a = await completeAuthorization({
      store,
      spec,
      client: CLIENT,
      state: first.state,
      code: "c1",
      fetchImpl: jsonFetch({ access_token: "at-a", shop: "store-a", expires_in: 3600 }),
    });
    const second = await beginAuthorization({ store, spec, clientId: CLIENT.clientId, pending });
    const b = await completeAuthorization({
      store,
      spec,
      client: CLIENT,
      state: second.state,
      code: "c2",
      fetchImpl: jsonFetch({ access_token: "at-b", shop: "store-b", expires_in: 3600 }),
    });

    expect(a.account.id).not.toBe(b.account.id);
    expect([a.account.accountIdentifier, b.account.accountIdentifier]).toEqual(["store-a", "store-b"]);
  });

  it("never resolves an account belonging to another workspace", async () => {
    const { store } = memoryStore();
    const { account } = await connect(store);

    expect(await store.getAccount("ws-2", account.id)).toBeNull();
    expect(await store.getAccount("ws-1", account.id)).not.toBeNull();
  });

  it("keeps provider specs bound to the connector registry aliases", () => {
    expect(getOAuthProvider("gmail")?.connector).toBe("google");
    expect(getOAuthProvider("slack")?.tokenUrl).toContain("slack.com");
    expect(getOAuthProvider("nope")).toBeUndefined();
  });

  it("redacts provider text that echoes a bearer token", async () => {
    const { store } = memoryStore();
    const leaky = jsonFetch({ error: "invalid_client", error_description: "Bearer at-leaked-token rejected" }, 401);

    await expect(connect(store, leaky)).rejects.toSatisfy(
      (error: Error) => error.message.includes("[redacted]") && !error.message.includes("at-leaked-token"),
    );
  });
});
