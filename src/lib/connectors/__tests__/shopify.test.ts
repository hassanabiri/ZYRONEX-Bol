import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { normalizeShopDomain, shopifyConnector } from "@/lib/connectors/adapters/shopify";
import {
  normalizeShopifyOrder,
  normalizeShopifyProduct,
  normalizeShopifyWebhookEvent,
} from "@/lib/connectors/adapters/shopify-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { beginAuthorization, completeAuthorization, ensureAccessToken } from "@/lib/oauth/core";
import { getOAuthProvider, shopifyOAuthSpec } from "@/lib/oauth/providers";
import type { ConnectionAccount, OAuthStore, OAuthTokenSet, PendingAuthorization } from "@/lib/oauth/types";
import { verifyWebhook } from "@/lib/webhooks/verify";

/**
 * Shopify connector — production test suite.
 *
 * Covers the same contract Salla and Zid are held to: OAuth, account
 * identification, orders, products, customers, inventory, webhooks, duplicate
 * and invalid events, auth failures, rate limits, timeouts, retries, workspace
 * isolation, secret redaction, pagination and normalized responses.
 */

const trace = "trace-shopify";
const SHOP = "zyronex-demo.myshopify.com";
const creds = { access_token: "shpat_secret_token", shop_domain: SHOP };
const CLIENT = { clientId: "shopify-client", clientSecret: "shopify-secret" };

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
  extra: Partial<Parameters<typeof runConnectorOperation>[0]> = {},
) {
  return runConnectorOperation({
    adapter: shopifyConnector,
    credentials,
    traceId: trace,
    input,
    fetchImpl,
    sleep: async () => {},
    ...extra,
  });
}

const ORDER = {
  id: 5001,
  name: "#1001",
  order_number: 1001,
  created_at: "2026-09-01T10:00:00Z",
  currency: "SAR",
  total_price: "450.50",
  financial_status: "paid",
  fulfillment_status: null,
  gateway: "mada",
  customer: {
    id: 900,
    first_name: "Hassan",
    last_name: "Abiri",
    email: "h@example.com",
    phone: "+966555000111",
    default_address: { city: "Riyadh", country: "Saudi Arabia" },
  },
  shipping_address: { city: "Riyadh", country: "Saudi Arabia", address1: "King Fahd Rd", zip: "12345" },
  shipping_lines: [{ title: "Aramex" }],
  fulfillments: [{ tracking_number: "SHTRK1" }],
  line_items: [{ id: 1, product_id: 77, variant_id: 88, title: "Shirt", sku: "SH-1", quantity: 2, price: "99.00" }],
};

/* ------------------------------------------------------------------ */
/* Registry & contract                                                */
/* ------------------------------------------------------------------ */

describe("shopify connector registration", () => {
  it("is registered and exposes its capabilities without credentials", () => {
    expect(getConnector("shopify")?.id).toBe("shopify");
    const described = describeConnectors().find((entry) => entry.id === "shopify");
    expect(described).toMatchObject({ label: "Shopify", authKind: "oauth2" });
    expect(described?.capabilities).toContain("pagination");
    expect(JSON.stringify(described)).not.toContain("shpat_");
  });

  it("keeps Salla and Zid untouched in the registry", () => {
    expect(getConnector("salla")?.id).toBe("salla");
    expect(getConnector("zid")?.id).toBe("zid");
  });

  it("normalizes any form of store domain", () => {
    expect(normalizeShopDomain("zyronex-demo")).toBe("zyronex-demo.myshopify.com");
    expect(normalizeShopDomain("https://zyronex-demo.myshopify.com/admin")).toBe(SHOP);
    expect(normalizeShopDomain(" not a domain ")).toBe("");
  });
});

/* ------------------------------------------------------------------ */
/* OAuth & connection account                                         */
/* ------------------------------------------------------------------ */

function memoryStore() {
  const states = new Map<string, PendingAuthorization & { expiresAt: string; consumed: boolean }>();
  const accounts = new Map<string, ConnectionAccount>();
  const tokens = new Map<string, OAuthTokenSet>();
  const locks = new Map<string, string>();
  let seq = 0;

  const store: OAuthStore = {
    async saveState(input) {
      states.set(input.stateHash, { ...input, consumed: false });
    },
    async peekState(hash, nowMs) {
      const row = states.get(hash);
      if (!row || row.consumed || new Date(row.expiresAt).getTime() <= nowMs) return null;
      return row;
    },
    async consumeState(hash, nowMs) {
      const row = states.get(hash);
      if (!row || row.consumed || new Date(row.expiresAt).getTime() <= nowMs) return null;
      row.consumed = true;
      return row;
    },
    async upsertAccount(input) {
      const key = `${input.workspaceId}:${input.provider}:${input.accountIdentifier}`;
      const existing = [...accounts.values()].find(
        (account) => `${account.workspaceId}:${account.provider}:${account.accountIdentifier}` === key,
      );
      const account: ConnectionAccount = {
        ...input,
        id: existing?.id ?? `acc-${++seq}`,
        refreshFailures: 0,
      };
      accounts.set(account.id, account);
      tokens.set(account.id, input.tokens);
      return account;
    },
    async getAccount(workspaceId, accountId) {
      const account = accounts.get(accountId);
      return account && account.workspaceId === workspaceId ? account : null;
    },
    async readTokens(accountId) {
      return tokens.get(accountId) ?? null;
    },
    async writeTokens(accountId, next) {
      tokens.set(accountId, next);
    },
    async updateAccount(accountId, patch) {
      const account = accounts.get(accountId);
      if (account) accounts.set(accountId, { ...account, ...patch });
    },
    async acquireRefreshLock(accountId, owner) {
      if (locks.has(accountId)) return false;
      locks.set(accountId, owner);
      return true;
    },
    async releaseRefreshLock(accountId) {
      locks.delete(accountId);
    },
  };
  return { store, accounts };
}

describe("shopify oauth & connection account", () => {
  const spec = shopifyOAuthSpec(SHOP);

  it("registers an official Shopify OAuth spec", () => {
    const base = getOAuthProvider("shopify");
    expect(base?.label).toBe("Shopify");
    expect(base?.refreshable).toBe(false);
    expect(spec.authorizationUrl).toBe(`https://${SHOP}/admin/oauth/authorize`);
    expect(spec.tokenUrl).toBe(`https://${SHOP}/admin/oauth/access_token`);
  });

  it("builds a consent URL on the merchant domain with comma-separated scopes", async () => {
    const { store } = memoryStore();
    const { authorizationUrl, state } = await beginAuthorization({
      store,
      spec,
      clientId: CLIENT.clientId,
      pending: {
        workspaceId: "ws-1",
        integrationId: null,
        provider: "shopify",
        connector: "shopify",
        redirectUri: "https://app.zyronex.ai/api/public/oauth/callback/shopify",
        createdBy: "user-1",
      },
    });
    const url = new URL(authorizationUrl);
    expect(url.host).toBe(SHOP);
    expect(url.searchParams.get("scope")).toContain("read_orders,write_orders");
    expect(url.searchParams.get("state")).toBe(state);
    expect(authorizationUrl).not.toContain(CLIENT.clientSecret);
  });

  it("exchanges the code and identifies the store, storing the domain as a credential", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({
      store,
      spec,
      clientId: CLIENT.clientId,
      pending: {
        workspaceId: "ws-1",
        integrationId: null,
        provider: "shopify",
        connector: "shopify",
        redirectUri: "https://app.zyronex.ai/api/public/oauth/callback/shopify",
        createdBy: "user-1",
      },
    });

    const fetchImpl = vi.fn(async () =>
      jsonResponse({ access_token: "shpat_new_token", scope: "read_orders,write_orders" }),
    ) as unknown as typeof fetch;

    const { account } = await completeAuthorization({ store, spec, client: CLIENT, state, code: "code-1", fetchImpl });
    expect(account.accountIdentifier).toBe(SHOP);
    expect(account.status).toBe("connected");
    // Offline tokens never expire, so nothing ever schedules a refresh.
    expect(account.expiresAt).toBeNull();
    expect((await store.readTokens(account.id))?.extra).toEqual({ shop_domain: SHOP });
  });

  it("rejects a replayed authorization state", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({
      store,
      spec,
      clientId: CLIENT.clientId,
      pending: {
        workspaceId: "ws-1",
        integrationId: null,
        provider: "shopify",
        connector: "shopify",
        redirectUri: "https://app.zyronex.ai/api/public/oauth/callback/shopify",
        createdBy: "user-1",
      },
    });
    const fetchImpl = vi.fn(async () => jsonResponse({ access_token: "shpat_new_token" })) as unknown as typeof fetch;
    await completeAuthorization({ store, spec, client: CLIENT, state, code: "code-1", fetchImpl });
    await expect(
      completeAuthorization({ store, spec, client: CLIENT, state, code: "code-1", fetchImpl }),
    ).rejects.toThrow();
  });

  it("asks for reconnection instead of refreshing a non-refreshable token", async () => {
    const { store } = memoryStore();
    const account = await store.upsertAccount({
      workspaceId: "ws-1",
      integrationId: null,
      provider: "shopify",
      connector: "shopify",
      accountIdentifier: SHOP,
      accountLabel: SHOP,
      status: "connected",
      scopes: spec.scopes,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      lastVerifiedAt: null,
      lastError: null,
      credentialRef: null,
      tokens: { accessToken: "old", refreshToken: "r", scopes: spec.scopes, expiresAt: new Date(Date.now() - 1000).toISOString() },
    });

    await expect(ensureAccessToken({ store, spec, client: CLIENT, account })).rejects.toThrow();
    expect((await store.getAccount("ws-1", account.id))?.status).toBe("reauth_required");
  });

  it("isolates connections per workspace", async () => {
    const { store } = memoryStore();
    const account = await store.upsertAccount({
      workspaceId: "ws-1",
      integrationId: null,
      provider: "shopify",
      connector: "shopify",
      accountIdentifier: SHOP,
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
/* Store identity, health & authentication                            */
/* ------------------------------------------------------------------ */

describe("shopify store identification & health", () => {
  it("checks health through the official shop endpoint on the store domain", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toBe(`https://${SHOP}/admin/api/2025-01/shop.json`);
      return jsonResponse({ shop: { id: 1, name: "ZYRONEX Demo", domain: SHOP } });
    }) as unknown as typeof fetch;

    const health = await checkConnectorHealth({ adapter: shopifyConnector, credentials: creds, traceId: trace, fetchImpl });
    expect(health.healthy).toBe(true);
  });

  it("sends the official access-token header", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("x-shopify-access-token")).toBe("shpat_secret_token");
      return jsonResponse({ shop: { id: 1 } });
    }) as unknown as typeof fetch;

    expect((await run({ operation: "shop_info" }, fetchImpl)).ok).toBe(true);
  });

  it("refuses to call anything when the store domain is missing", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "shop_info" }, fetchImpl, { access_token: "shpat_secret_token" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to call anything when the token is missing", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "shop_info" }, fetchImpl, { shop_domain: SHOP });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Orders                                                             */
/* ------------------------------------------------------------------ */

describe("shopify orders", () => {
  it("normalizes a single order into the neutral shape", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/orders/5001.json");
      return jsonResponse({ order: ORDER });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "get_order", params: { id: 5001 } }, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const order = result.items[0] as unknown as ReturnType<typeof normalizeShopifyOrder>;
    expect(order).toMatchObject({ object: "order", source: "shopify", id: "5001", reference: "#1001", status: "open" });
    expect(order.total).toEqual({ amount: 450.5, currency: "SAR" });
    expect(order.financial_status).toBe("paid");
    expect(order.customer?.first_name).toBe("Hassan");
    expect(order.shipping.tracking_number).toBe("SHTRK1");
    expect(order.shipping.method).toBe("Aramex");
    expect(order.items[0]).toMatchObject({ product_id: "77", name: "Shirt", quantity: 2 });
  });

  it("follows since_id pagination up to the page budget", async () => {
    const seen: string[] = [];
    let page = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seen.push(String(url));
      page += 1;
      return jsonResponse({ orders: [{ ...ORDER, id: page * 10 }] });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "list_orders", maxPages: 2 }, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items).toHaveLength(2);
    expect(result.pages).toBe(2);
    expect(seen[1]).toContain("since_id=10");
    expect(result.cursor).toBe("20");
  });

  it("stops paginating on an empty page", async () => {
    let page = 0;
    const fetchImpl = vi.fn(async () => {
      page += 1;
      return jsonResponse({ orders: page === 1 ? [{ ...ORDER, id: 1 }] : [] });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "list_orders", maxPages: 5 }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(1);
      expect(result.cursor).toBeNull();
    }
  });

  it("updates an order through the official wrapped body", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/orders/5001.json");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({ order: { note: "gift wrap" } });
      return jsonResponse({ order: { ...ORDER, note: "gift wrap" } });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "update_order", params: { id: 5001, body: { note: "gift wrap" } } }, fetchImpl);
    expect(result.ok).toBe(true);
  });

  it("cancels an order through the official endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/orders/5001/cancel.json");
      expect(JSON.parse(String(init?.body))).toEqual({ reason: "customer" });
      return jsonResponse({ order: { ...ORDER, cancelled_at: "2026-09-02T10:00:00Z" } });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "cancel_order", params: { id: 5001, reason: "customer" } }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ status: "cancelled" });
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
    const result = await run({ operation: "delete_shop" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unsupported");
  });
});

/* ------------------------------------------------------------------ */
/* Products, customers & inventory                                    */
/* ------------------------------------------------------------------ */

describe("shopify products, customers & inventory", () => {
  it("lists and normalizes products with their variants", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/products.json");
      return jsonResponse({
        products: [
          {
            id: 77,
            title: "Shirt",
            handle: "shirt",
            status: "active",
            vendor: "ZYRONEX",
            variants: [
              { id: 88, sku: "SH-1", title: "M", price: "99.00", inventory_quantity: 5, inventory_item_id: 999 },
              { id: 89, sku: "SH-2", title: "L", price: "99.00", inventory_quantity: 3, inventory_item_id: 1000 },
            ],
          },
        ],
      });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "list_products" }, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const product = result.items[0] as unknown as ReturnType<typeof normalizeShopifyProduct>;
    expect(product).toMatchObject({ object: "product", source: "shopify", id: "77", name: "Shirt", quantity: 8 });
    expect(product.price).toEqual({ amount: 99, currency: null });
    expect(product.variants).toHaveLength(2);
  });

  it("creates a product with a wrapped pass-through body", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/products.json");
      expect(JSON.parse(String(init?.body))).toEqual({ product: { title: "Shirt", vendor: "ZYRONEX" } });
      return jsonResponse({ product: { id: 90, title: "Shirt" } });
    }) as unknown as typeof fetch;

    const result = await run(
      { operation: "create_product", params: { title: "Shirt", body: { title: "Shirt", vendor: "ZYRONEX" } } },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
  });

  it("searches customers through the official search endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/customers/search.json");
      expect(String(url)).toContain("query=email%3Ah%40example.com");
      return jsonResponse({ customers: [{ id: 900, first_name: "Hassan", last_name: "Abiri", email: "h@example.com" }] });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "search_customers", params: { query: "email:h@example.com" } }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "customer", id: "900", first_name: "Hassan" });
  });

  it("reads inventory levels and normalizes them", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/inventory_levels.json");
      expect(String(url)).toContain("location_ids=5");
      return jsonResponse({ inventory_levels: [{ inventory_item_id: 999, location_id: 5, available: 7 }] });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "list_inventory_levels", params: { location_ids: 5 } }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.items[0]).toMatchObject({
        object: "inventory_level",
        inventory_item_id: "999",
        location_id: "5",
        available: 7,
      });
  });

  it("sets an inventory level through the official endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/inventory_levels/set.json");
      expect(JSON.parse(String(init?.body))).toEqual({ inventory_item_id: 999, location_id: 5, available: 12 });
      return jsonResponse({ inventory_level: { inventory_item_id: 999, location_id: 5, available: 12 } });
    }) as unknown as typeof fetch;

    const result = await run(
      { operation: "set_inventory_level", params: { inventory_item_id: 999, location_id: 5, available: 12 } },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ available: 12 });
  });
});

/* ------------------------------------------------------------------ */
/* Failure handling: auth, rate limits, timeout, retry, redaction     */
/* ------------------------------------------------------------------ */

describe("shopify failure handling", () => {
  it("maps an invalid token to a non-retryable auth error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: "[API] Invalid API key or access token" }, { status: 401 }),
    ) as unknown as typeof fetch;

    const result = await run({ operation: "shop_info" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("auth");
      expect(result.error.retryable).toBe(false);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps validation errors to invalid_request", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: { title: ["can't be blank"] } }, { status: 422 }),
    ) as unknown as typeof fetch;

    const result = await run({ operation: "create_product", params: { title: "x", body: {} } }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_request");
  });

  it("retries a rate limit and reports the call-limit bucket", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      if (calls === 1)
        return jsonResponse(
          { errors: "Exceeded 2 calls per second" },
          { status: 429, headers: { "retry-after": "1", "x-shopify-shop-api-call-limit": "40/40" } },
        );
      return jsonResponse({ shop: { id: 1 } }, { headers: { "x-shopify-shop-api-call-limit": "2/40" } });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "shop_info" }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(2);
      expect(result.rateLimit).toMatchObject({ limit: 40, remaining: 38 });
    }
  });

  it("retries a 5xx and gives up as a provider error after the attempt budget", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ errors: "boom" }, { status: 503 })) as unknown as typeof fetch;
    const result = await run({ operation: "shop_info" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("provider");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("reports a timeout when the store does not answer", async () => {
    const fetchImpl = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
        }),
    ) as unknown as typeof fetch;

    const result = await run({ operation: "shop_info" }, fetchImpl, creds, { timeoutMs: 10, maxAttempts: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("timeout");
  });

  it("reports malformed responses instead of crashing", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("not json at all", { status: 200, headers: { "content-type": "application/json" } }),
    ) as unknown as typeof fetch;

    const result = await run({ operation: "list_orders" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed_response");
  });

  it("never echoes the access token back in an error message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ errors: `Invalid token shpat_secret_token` }, { status: 401 }),
    ) as unknown as typeof fetch;

    const result = await run({ operation: "shop_info" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).not.toContain("shpat_secret_token");
  });
});

/* ------------------------------------------------------------------ */
/* Webhooks                                                           */
/* ------------------------------------------------------------------ */

describe("shopify webhooks", () => {
  const secret = "shopify-webhook-secret";
  const raw = JSON.stringify({ id: 5001, updated_at: "2026-09-01T11:00:00Z", name: "#1001" });
  const signature = createHmac("sha256", secret).update(raw, "utf8").digest("base64");

  function verify(headers: Record<string, string>, body = raw, secretValue: string | null = secret) {
    return verifyWebhook("shopify", {
      raw: body,
      headers,
      payload: JSON.parse(body),
      secret: secretValue,
      nowMs: Date.now(),
      replayWindowMs: 300_000,
    });
  }

  it("accepts an officially signed delivery and reads topic + delivery id", () => {
    const result = verify({
      "x-shopify-hmac-sha256": signature,
      "x-shopify-topic": "orders/updated",
      "x-shopify-webhook-id": "delivery-1",
    });
    expect(result).toMatchObject({ ok: true, eventType: "orders/updated", eventId: "delivery-1" });
  });

  it("rejects a forged signature", () => {
    const result = verify({ "x-shopify-hmac-sha256": "AAAA", "x-shopify-topic": "orders/updated" });
    expect(result).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a tampered body signed for different content", () => {
    const tampered = JSON.stringify({ id: 5001, total_price: "0.01" });
    const result = verify({ "x-shopify-hmac-sha256": signature, "x-shopify-topic": "orders/updated" }, tampered);
    expect(result.ok).toBe(false);
  });

  it("rejects a delivery with no signature header", () => {
    const result = verify({ "x-shopify-topic": "orders/updated" });
    expect(result).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("refuses to verify when no secret is configured", () => {
    const result = verify({ "x-shopify-hmac-sha256": signature }, raw, null);
    expect(result).toMatchObject({ ok: false, reason: "missing_secret" });
  });

  it("derives a stable event id so a redelivery is idempotent", () => {
    const first = verify({ "x-shopify-hmac-sha256": signature, "x-shopify-topic": "orders/updated" });
    const second = verify({ "x-shopify-hmac-sha256": signature, "x-shopify-topic": "orders/updated" });
    expect(first.eventId).toBe(second.eventId);
    expect(first.eventId).toBe("orders/updated:5001:2026-09-01T11:00:00Z");
  });

  it("never leaks the webhook secret in the verification result", () => {
    const result = verify({ "x-shopify-hmac-sha256": "AAAA", "x-shopify-topic": "orders/updated" });
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("normalizes a webhook payload by topic family", () => {
    const order = normalizeShopifyWebhookEvent(ORDER, "orders/updated");
    expect(order.event).toBe("orders/updated");
    expect(order.normalized).toMatchObject({ object: "order", id: "5001" });

    const product = normalizeShopifyWebhookEvent({ id: 77, title: "Shirt" }, "products/create");
    expect(product.normalized).toMatchObject({ object: "product", name: "Shirt" });

    const unknown = normalizeShopifyWebhookEvent({ id: 1 }, "app/uninstalled");
    expect(unknown.normalized).toBeNull();
  });

  it("registers webhooks through the official endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/webhooks.json");
      expect(JSON.parse(String(init?.body))).toEqual({
        webhook: { topic: "orders/create", address: "https://app.zyronex.ai/api/public/webhooks/shopify-1", format: "json" },
      });
      return jsonResponse({ webhook: { id: 1, topic: "orders/create" } });
    }) as unknown as typeof fetch;

    const result = await run(
      {
        operation: "create_webhook",
        params: {
          topic: "orders/create",
          address: "https://app.zyronex.ai/api/public/webhooks/shopify-1",
          format: "json",
        },
      },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
  });
});
