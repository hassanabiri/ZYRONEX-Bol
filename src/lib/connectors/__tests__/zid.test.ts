import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { zidConnector } from "@/lib/connectors/adapters/zid";
import { normalizeZidOrder, normalizeZidWebhookEvent } from "@/lib/connectors/adapters/zid-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import {
  beginAuthorization,
  completeAuthorization,
  ensureAccessToken,
} from "@/lib/oauth/core";
import { getOAuthProvider } from "@/lib/oauth/providers";
import type {
  ConnectionAccount,
  OAuthStore,
  OAuthTokenSet,
  PendingAuthorization,
} from "@/lib/oauth/types";
import { verifyWebhook } from "@/lib/webhooks/verify";

const trace = "trace-zid";
const creds = { access_token: "zid-manager-token", authorization: "zid-authorization-jwt" };

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function run(
  input: Parameters<typeof runConnectorOperation>[0]["input"],
  fetchImpl: typeof fetch,
  credentials: Record<string, string> = creds,
) {
  return runConnectorOperation({ adapter: zidConnector, credentials, traceId: trace, input, fetchImpl });
}

const ORDER = {
  id: 4455,
  code: "ZID-4455",
  order_status: { name: { en: "New", ar: "جديد" } },
  payment_method: "mada",
  created_at: "2026-08-20T09:00:00Z",
  currency_code: "SAR",
  order_total: 320.75,
  customer: {
    id: 88,
    name: "Hassan Abiri",
    email: "h@example.com",
    mobile: "555000111",
    mobile_country_code: "+966",
    city: { en: "Riyadh" },
  },
  shipping: {
    method: { name: { en: "Aramex" } },
    tracking_number: "ZTRK9",
    address: { country: { en: "Saudi Arabia" }, city: { en: "Riyadh" }, street: "King Fahd Rd", postal_code: "11564" },
  },
  products: [{ id: 1, product_id: 77, name: { en: "Shirt" }, sku: "SH-1", quantity: 2, price: 100 }],
  store: { id: 321 },
};

/* ------------------------------------------------------------------ */
/* Registry + OAuth wiring                                            */
/* ------------------------------------------------------------------ */

describe("zid registry + oauth wiring", () => {
  it("is registered as an independent adapter on the shared contract", () => {
    expect(getConnector("zid")?.id).toBe("zid");
    expect(zidConnector.capabilities).toEqual(expect.arrayContaining(["read", "write", "webhook", "health_check"]));
    expect(zidConnector.operations).toEqual(expect.arrayContaining(["list_orders", "list_products", "list_customers"]));
  });

  it("declares the official Zid OAuth endpoints", () => {
    const spec = getOAuthProvider("zid");
    expect(spec?.authorizationUrl).toBe("https://oauth.zid.sa/oauth/authorize");
    expect(spec?.tokenUrl).toBe("https://oauth.zid.sa/oauth/token");
    expect(spec?.refreshable).toBe(true);
  });

  it("identifies the connected store from the token response", () => {
    const identified = getOAuthProvider("zid")?.identify?.({ store: { id: 321, name: "Zyronex Zid Store" } });
    expect(identified).toEqual({ accountIdentifier: "321", accountLabel: "Zyronex Zid Store" });
  });

  it("captures the manager JWT as a provider credential field", () => {
    const fields = getOAuthProvider("zid")?.credentialFields?.({ access_token: "a", authorization: "jwt-value" });
    expect(fields).toEqual({ authorization: "jwt-value" });
  });

  it("never leaks credentials through the client-safe catalog", () => {
    const described = JSON.stringify(describeConnectors());
    expect(described).toContain("zid");
    expect(described).not.toContain(creds.access_token);
    expect(described).not.toMatch(/access_token"\s*:\s*"/);
  });
});

/* ------------------------------------------------------------------ */
/* OAuth flow: connect, identify, refresh, workspace isolation        */
/* ------------------------------------------------------------------ */

type StoredState = PendingAuthorization & { stateHash: string; expiresAt: string; consumed: boolean };

function memoryStore() {
  const states = new Map<string, StoredState>();
  const accounts = new Map<string, ConnectionAccount>();
  const tokens = new Map<string, OAuthTokenSet>();
  const locks = new Map<string, string>();
  let seq = 0;

  const store: OAuthStore = {
    saveState: async (input) => {
      states.set(input.stateHash, { ...input, consumed: false });
    },
    consumeState: async (hash, nowMs) => {
      const row = states.get(hash);
      if (!row || row.consumed || new Date(row.expiresAt).getTime() <= nowMs) return null;
      row.consumed = true;
      return row;
    },
    upsertAccount: async (input) => {
      seq += 1;
      const account: ConnectionAccount = {
        id: `zid-acc-${seq}`,
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
    acquireRefreshLock: async (accountId, owner) => {
      if (locks.has(accountId)) return false;
      locks.set(accountId, owner);
      return true;
    },
    releaseRefreshLock: async (accountId) => {
      locks.delete(accountId);
    },
  };

  return { store, accounts, tokens };
}

const CLIENT = { clientId: "zid-client", clientSecret: "zid-client-secret" };

describe("zid oauth + connection account", () => {
  const spec = getOAuthProvider("zid")!;

  it("connects a store and stores the manager JWT alongside the access token", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({
      store,
      spec,
      clientId: CLIENT.clientId,
      pending: {
        workspaceId: "ws-1",
        integrationId: null,
        provider: "zid",
        connector: "zid",
        redirectUri: "https://zyronex.test/api/public/oauth/callback/zid",
        createdBy: "user-1",
      },
    });

    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        access_token: "zid-access",
        authorization: "zid-jwt",
        refresh_token: "zid-refresh",
        expires_in: 3600,
        store: { id: 321, name: "Zyronex Zid Store" },
      }),
    ) as unknown as typeof fetch;

    const { account } = await completeAuthorization({
      store,
      spec,
      client: CLIENT,
      state,
      code: "auth-code",
      fetchImpl,
    });

    expect(account.accountIdentifier).toBe("321");
    expect(account.status).toBe("connected");
    const stored = await store.readTokens(account.id);
    expect(stored?.extra).toEqual({ authorization: "zid-jwt" });
  });

  it("refreshes an expired token and keeps the manager JWT", async () => {
    const { store } = memoryStore();
    const account = await store.upsertAccount({
      workspaceId: "ws-1",
      integrationId: null,
      provider: "zid",
      connector: "zid",
      accountIdentifier: "321",
      accountLabel: "Zyronex Zid Store",
      status: "connected",
      scopes: spec.scopes,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      lastVerifiedAt: null,
      lastError: null,
      credentialRef: null,
      tokens: {
        accessToken: "old-access",
        refreshToken: "zid-refresh",
        scopes: spec.scopes,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
        extra: { authorization: "old-jwt" },
      },
    });

    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "new-access", authorization: "new-jwt", expires_in: 3600 }),
    ) as unknown as typeof fetch;

    const result = await ensureAccessToken({ store, spec, client: CLIENT, account, fetchImpl });
    expect(result.refreshed).toBe(true);
    expect(result.token).toBe("new-access");
    expect((await store.readTokens(account.id))?.extra).toEqual({ authorization: "new-jwt" });
  });

  it("isolates connections per workspace", async () => {
    const { store } = memoryStore();
    const account = await store.upsertAccount({
      workspaceId: "ws-1",
      integrationId: null,
      provider: "zid",
      connector: "zid",
      accountIdentifier: "321",
      accountLabel: null,
      status: "connected",
      scopes: [],
      expiresAt: null,
      lastVerifiedAt: null,
      lastError: null,
      credentialRef: null,
      tokens: { accessToken: "t", scopes: [], expiresAt: null },
    });

    expect(await store.getAccount("ws-1", account.id)).not.toBeNull();
    expect(await store.getAccount("ws-2", account.id)).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Store identity, health & authentication headers                    */
/* ------------------------------------------------------------------ */

describe("zid store identification & health", () => {
  it("checks health through the official account profile endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/managers/account/profile");
      return jsonResponse({ status: "Success", user: { id: 321, name: "Zyronex Zid Store" } });
    }) as unknown as typeof fetch;

    const health = await checkConnectorHealth({ adapter: zidConnector, credentials: creds, traceId: trace, fetchImpl });
    expect(health.healthy).toBe(true);
  });

  it("sends both official Zid authentication headers", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer zid-authorization-jwt");
      expect(headers.get("x-manager-token")).toBe("zid-manager-token");
      return jsonResponse({ status: "Success", user: { id: 321 } });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "store_info" }, fetchImpl);
    expect(result.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Orders                                                             */
/* ------------------------------------------------------------------ */

describe("zid orders", () => {
  it("normalizes a single order into the neutral shape", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/managers/store/orders/4455/view");
      return jsonResponse({ status: "Success", order: ORDER });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "get_order", params: { id: 4455 } }, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const order = result.items[0] as unknown as ReturnType<typeof normalizeZidOrder>;
    expect(order).toMatchObject({ object: "order", source: "zid", id: "4455", reference: "ZID-4455", status: "New" });
    expect(order.total).toEqual({ amount: 320.75, currency: "SAR" });
    expect(order.customer?.phone).toBe("+966555000111");
    expect(order.shipping.tracking_number).toBe("ZTRK9");
    expect(order.shipping.method).toBe("Aramex");
    expect(order.items[0]).toMatchObject({ product_id: "77", name: "Shirt", quantity: 2 });
  });

  it("follows page pagination up to the budget", async () => {
    let page = 0;
    const fetchImpl = vi.fn(async () => {
      page += 1;
      return jsonResponse({ status: "Success", orders: [{ ...ORDER, id: page }], total_order_count: 2 });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "list_orders", maxPages: 2 }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(2);
      expect(result.pages).toBe(2);
      // The page budget stops the walk; the cursor stays resumable.
      expect(result.cursor).toBe("2");
    }
  });

  it("updates the order status through the official endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/managers/store/orders/4455/change-order-status");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ order_status: "preparing", note: "packing" });
      return jsonResponse({ status: "Success", order: { id: 4455 } });
    }) as unknown as typeof fetch;

    const result = await run(
      { operation: "update_order_status", params: { id: 4455, order_status: "preparing", note: "packing" } },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
  });

  it("rejects an operation with missing required params before any request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "get_order", params: {} }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an unknown operation", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "delete_store" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unsupported");
  });
});

/* ------------------------------------------------------------------ */
/* Products, inventory, customers                                     */
/* ------------------------------------------------------------------ */

describe("zid products, inventory & customers", () => {
  it("lists and normalizes products", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/products");
      return jsonResponse({
        count: 1,
        results: [
          { id: 7, name: { en: "Shirt" }, sku: "SH-1", price: 99, currency: "SAR", quantity: 5, is_published: true },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "list_products" }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.items[0]).toMatchObject({ object: "product", source: "zid", name: "Shirt", sku: "SH-1", quantity: 5 });
  });

  it("updates inventory through the quantity endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/products/7/quantity");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({ quantity: 12 });
      return jsonResponse({ status: "Success", product: { id: 7, quantity: 12 } });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "update_product_quantity", params: { id: 7, quantity: 12 } }, fetchImpl);
    expect(result.ok).toBe(true);
  });

  it("creates a product with a pass-through body", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.zid.sa/v1/products");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ name: "Shirt", price: 99 });
      return jsonResponse({ status: "Success", product: { id: 9, name: { en: "Shirt" } } });
    }) as unknown as typeof fetch;

    const result = await run(
      { operation: "create_product", params: { name: "Shirt", body: { name: "Shirt", price: 99 } } },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
  });

  it("lists and normalizes customers", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/managers/store/customers");
      return jsonResponse({
        status: "Success",
        customers: [{ id: 88, name: "Sara Ali", email: "s@example.com", mobile: "+966500000000" }],
        total_customers_count: 1,
      });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "list_customers" }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.items[0]).toMatchObject({ object: "customer", first_name: "Sara", last_name: "Ali", id: "88" });
  });
});

/* ------------------------------------------------------------------ */
/* Failure handling                                                   */
/* ------------------------------------------------------------------ */

describe("zid failure handling", () => {
  it("maps an authentication failure to a non-retryable auth error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: "Error", message: "Unauthenticated" }, { status: 401 }),
    ) as unknown as typeof fetch;

    const result = await run({ operation: "list_orders" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("auth");
      expect(result.error.retryable).toBe(false);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the store is not connected", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "list_orders" }, fetchImpl, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("retries a rate limit and then succeeds", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ status: "Error", message: "Too many requests" }, { status: 429, headers: { "retry-after": "0" } })
        : jsonResponse({ status: "Success", orders: [], total_order_count: 0 });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "list_orders" }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBeGreaterThan(1);
  });

  it("retries a timeout and surfaces a retryable error when it persists", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    }) as unknown as typeof fetch;

    const result = await runConnectorOperation({
      adapter: zidConnector,
      credentials: creds,
      traceId: trace,
      input: { operation: "list_orders" },
      fetchImpl,
      maxAttempts: 2,
      timeoutMs: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(["timeout", "network"]).toContain(result.error.kind);
      expect(result.attempts).toBe(2);
    }
  });

  it("never echoes the credentials in a failure result", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { status: "Error", message: `Token ${creds.access_token} / ${creds.authorization} is forbidden` },
        { status: 403 },
      ),
    ) as unknown as typeof fetch;

    const result = await run({ operation: "list_orders" }, fetchImpl);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(creds.access_token);
    expect(serialized).not.toContain(creds.authorization);
  });
});

/* ------------------------------------------------------------------ */
/* Webhooks                                                           */
/* ------------------------------------------------------------------ */

describe("zid webhooks", () => {
  const secret = "whsec-zid";
  const payload = { ...ORDER, updated_at: "2026-08-20T09:05:00Z" };
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  const base = { raw, payload, secret, nowMs: Date.now(), replayWindowMs: 300_000 };
  const headers = { "x-zid-signature": signature, "x-zid-event": "order.create" };

  it("accepts a correctly signed Zid event and derives a stable event id", () => {
    const result = verifyWebhook("zid", { ...base, headers });
    expect(result.ok).toBe(true);
    expect(result.eventType).toBe("order.create");
    expect(result.eventId).toBe("order.create:4455:2026-08-20T09:05:00Z");
  });

  it("produces the same event id for a duplicate delivery (idempotency key)", () => {
    const first = verifyWebhook("zid", { ...base, headers });
    const second = verifyWebhook("zid", { ...base, headers });
    expect(second.eventId).toBe(first.eventId);
    expect(second.ok).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const result = verifyWebhook("zid", { ...base, headers: { ...headers, "x-zid-signature": "deadbeef" } });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_signature");
  });

  it("rejects a delivery with no security header", () => {
    expect(verifyWebhook("zid", { ...base, headers: {} }).ok).toBe(false);
  });

  it("reports a missing signing secret instead of accepting the event", () => {
    const result = verifyWebhook("zid", { ...base, secret: null, headers });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("missing_secret");
  });

  it("supports the subscriber token strategy", () => {
    const result = verifyWebhook("zid", { ...base, headers: { authorization: `Bearer ${secret}` } });
    expect(result.ok).toBe(true);
  });

  it("normalizes the webhook resource without any business logic", () => {
    const normalized = normalizeZidWebhookEvent(payload, "order.create");
    expect(normalized.event).toBe("order.create");
    expect(normalized.store_id).toBe("321");
    expect((normalized.normalized as ReturnType<typeof normalizeZidOrder>).object).toBe("order");
  });

  it("never returns the signing secret", () => {
    expect(JSON.stringify(verifyWebhook("zid", { ...base, headers }))).not.toContain(secret);
  });
});
