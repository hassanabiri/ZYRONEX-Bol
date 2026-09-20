import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  normalizeStoreUrl,
  WOOCOMMERCE_API_NAMESPACE,
  woocommerceConnector,
} from "@/lib/connectors/adapters/woocommerce";
import {
  normalizeWooCustomer,
  normalizeWooInventoryLevel,
  normalizeWooOrder,
  normalizeWooProduct,
  normalizeWooWebhookEvent,
} from "@/lib/connectors/adapters/woocommerce-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { verifyWebhook } from "@/lib/webhooks/verify";

/**
 * WooCommerce connector — production test suite.
 *
 * Covers the same contract Salla, Zid and Shopify are held to: authentication
 * and key handling, connection lifecycle, products, inventory, customers,
 * orders, order status, webhooks, duplicate events, idempotency, pagination,
 * rate limits, retry/backoff, error normalization, workspace isolation, secret
 * redaction, health check and normalized responses.
 */

const trace = "trace-woocommerce";
const STORE = "https://shop.zyronex.ai";
const creds = { consumer_key: "ck_live_key", consumer_secret: "cs_live_secret", store_url: STORE };

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
    adapter: woocommerceConnector,
    credentials,
    traceId: trace,
    input,
    fetchImpl,
    sleep: async () => {},
    ...extra,
  });
}

const ORDER = {
  id: 7001,
  number: "7001",
  status: "processing",
  currency: "SAR",
  total: "450.50",
  date_created_gmt: "2026-09-01T10:00:00",
  date_paid: "2026-09-01T10:05:00",
  payment_method: "mada",
  payment_method_title: "Mada",
  customer_id: 42,
  billing: {
    first_name: "Hassan",
    last_name: "Abiri",
    email: "h@example.com",
    phone: "+966555000111",
    city: "Riyadh",
    country: "SA",
    address_1: "King Fahd Rd",
    postcode: "12345",
  },
  shipping: { city: "Riyadh", country: "SA", address_1: "King Fahd Rd", postcode: "12345" },
  shipping_lines: [{ method_id: "flat_rate", method_title: "Aramex" }],
  line_items: [{ id: 1, product_id: 77, variation_id: 0, name: "Shirt", sku: "SH-1", quantity: 2, price: "99.00" }],
};

const PRODUCT = {
  id: 77,
  name: "Shirt",
  slug: "shirt",
  sku: "SH-1",
  status: "publish",
  type: "simple",
  price: "99.00",
  regular_price: "120.00",
  stock_quantity: 14,
  manage_stock: true,
  stock_status: "instock",
  categories: [{ id: 5, name: "Apparel" }],
  date_modified_gmt: "2026-09-02T09:00:00",
};

const CUSTOMER = {
  id: 42,
  email: "h@example.com",
  first_name: "Hassan",
  last_name: "Abiri",
  role: "customer",
  orders_count: 3,
  billing: { phone: "+966555000111", city: "Riyadh", country: "SA" },
  shipping: {},
};

/* ------------------------------------------------------------------ */
/* Registry & contract                                                */
/* ------------------------------------------------------------------ */

describe("woocommerce connector registration", () => {
  it("is registered and exposes its capabilities without credentials", () => {
    expect(getConnector("woocommerce")?.id).toBe("woocommerce");
    expect(getConnector("woo")?.id).toBe("woocommerce");
    const described = describeConnectors().find((entry) => entry.id === "woocommerce");
    expect(described).toMatchObject({ label: "WooCommerce", authKind: "basic" });
    expect(described?.capabilities).toContain("pagination");
    expect(described?.requiredCredentials).toEqual(["consumer_key", "consumer_secret"]);
    expect(JSON.stringify(described)).not.toContain("cs_live_secret");
  });

  it("keeps Salla, Zid and Shopify untouched in the registry", () => {
    expect(getConnector("salla")?.id).toBe("salla");
    expect(getConnector("zid")?.id).toBe("zid");
    expect(getConnector("shopify")?.id).toBe("shopify");
  });

  it("normalizes any form of store URL and rejects insecure ones", () => {
    expect(normalizeStoreUrl("shop.zyronex.ai")).toBe(STORE);
    expect(normalizeStoreUrl("https://shop.zyronex.ai/wp-admin/edit.php")).toBe(STORE);
    expect(normalizeStoreUrl("http://shop.zyronex.ai")).toBe("");
    expect(normalizeStoreUrl("  ")).toBe("");
  });

  it("declares every documented operation family", () => {
    for (const operation of [
      "list_orders",
      "get_order",
      "create_order",
      "update_order",
      "update_order_status",
      "list_products",
      "create_product",
      "update_product",
      "list_inventory",
      "update_inventory",
      "update_variation_inventory",
      "list_customers",
      "create_customer",
      "update_customer",
      "list_webhooks",
      "create_webhook",
      "delete_webhook",
      "system_status",
    ])
      expect(woocommerceConnector.operations).toContain(operation);
  });
});

/* ------------------------------------------------------------------ */
/* Authentication & credentials                                       */
/* ------------------------------------------------------------------ */

describe("woocommerce authentication", () => {
  it("signs requests with HTTP Basic over the merchant's own https origin", () => {
    const call = woocommerceConnector.authorize(
      woocommerceConnector.buildCall({ operation: "get_order", params: { id: 7001 } }),
      creds,
    );
    expect(call.url).toBe(`${STORE}/wp-json/${WOOCOMMERCE_API_NAMESPACE}/orders/7001`);
    expect(call.headers["authorization"]).toBe(
      `Basic ${Buffer.from("ck_live_key:cs_live_secret").toString("base64")}`,
    );
  });

  it("refuses to build a call when the store URL is missing", () => {
    expect(() =>
      woocommerceConnector.authorize(woocommerceConnector.buildCall({ operation: "system_status" }), {
        consumer_key: "ck",
        consumer_secret: "cs",
      }),
    ).toThrow(/store URL is missing/i);
  });

  it("refuses to build a call when the keys are missing", () => {
    expect(() =>
      woocommerceConnector.authorize(woocommerceConnector.buildCall({ operation: "system_status" }), {
        store_url: STORE,
      }),
    ).toThrow(/not connected/i);
  });

  it("fails fast before any network call when a credential is absent", async () => {
    const fetchImpl = vi.fn();
    const result = await run({ operation: "list_orders" }, fetchImpl as unknown as typeof fetch, {
      consumer_key: "ck_live_key",
      store_url: STORE,
    });
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    if (!result.ok) expect(result.error.kind).toBe("auth");
  });

  it("maps a rejected key pair to an auth error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { code: "woocommerce_rest_authentication_error", message: "Consumer key is invalid.", data: { status: 401 } },
        { status: 401 },
      ),
    );
    const result = await run({ operation: "list_orders" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("auth");
      expect(result.error.retryable).toBe(false);
    }
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/* Connection lifecycle & health                                      */
/* ------------------------------------------------------------------ */

describe("woocommerce connection lifecycle", () => {
  it("reports a healthy connection from the official system status endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/wp-json/wc/v3/system_status");
      return jsonResponse({ environment: { home_url: STORE, version: "9.4.2" } });
    });
    const health = await checkConnectorHealth({
      adapter: woocommerceConnector,
      credentials: creds,
      traceId: trace,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(health).toMatchObject({ connector: "woocommerce", healthy: true, status: 200 });
  });

  it("reports an unhealthy connection when the REST route is not exposed", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: "rest_no_route", message: "No route was found.", data: { status: 404 } }, { status: 404 }),
    );
    const health = await checkConnectorHealth({
      adapter: woocommerceConnector,
      credentials: creds,
      traceId: trace,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(health.healthy).toBe(false);
    expect(health.message).toMatch(/permalinks/i);
  });
});

/* ------------------------------------------------------------------ */
/* Orders                                                             */
/* ------------------------------------------------------------------ */

describe("woocommerce orders", () => {
  it("lists orders and returns normalized items", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe("/wp-json/wc/v3/orders");
      expect(parsed.searchParams.get("status")).toBe("processing");
      expect(parsed.searchParams.get("per_page")).toBe("50");
      expect(parsed.searchParams.get("page")).toBe("1");
      return jsonResponse([ORDER]);
    });
    const result = await run({ operation: "list_orders", params: { status: "processing" } }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.items[0]).toMatchObject({
        object: "order",
        source: "woocommerce",
        id: "7001",
        reference: "7001",
        status: "processing",
        financial_status: "paid",
        payment_method: "Mada",
        total: { amount: 450.5, currency: "SAR" },
      });
  });

  it("gets a single order", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(ORDER));
    const result = await run({ operation: "get_order", params: { id: 7001 } }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({ id: "7001" });
      expect(result.cursor).toBeNull();
    }
  });

  it("creates an order with a passthrough body", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toMatchObject({ payment_method: "mada" });
      return jsonResponse({ ...ORDER, status: "pending" }, { status: 201 });
    });
    const result = await run(
      { operation: "create_order", params: { body: { payment_method: "mada", line_items: [{ product_id: 77, quantity: 1 }] } } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ status: "pending" });
  });

  it("updates an order", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      return jsonResponse({ ...ORDER, customer_note: "rush" });
    });
    const result = await run(
      { operation: "update_order", params: { id: 7001, body: { customer_note: "rush" } } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
  });

  it("changes order status through the documented status field", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/orders/7001");
      expect(JSON.parse(String(init?.body))).toMatchObject({ status: "completed" });
      return jsonResponse({ ...ORDER, status: "completed" });
    });
    const result = await run(
      { operation: "update_order_status", params: { id: 7001, status: "completed" } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ status: "completed", financial_status: "paid" });
  });

  it("requires a status for the status transition", async () => {
    const result = await run({ operation: "update_order_status", params: { id: 7001 } }, (async () =>
      jsonResponse({})) as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_request");
  });
});

/* ------------------------------------------------------------------ */
/* Products & inventory                                               */
/* ------------------------------------------------------------------ */

describe("woocommerce products", () => {
  it("lists products with normalized fields", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([PRODUCT]));
    const result = await run({ operation: "list_products" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.items[0]).toMatchObject({
        object: "product",
        source: "woocommerce",
        id: "77",
        name: "Shirt",
        sku: "SH-1",
        quantity: 14,
        manage_stock: true,
        stock_status: "instock",
        categories: ["Apparel"],
      });
  });

  it("creates and updates a product", async () => {
    const created = vi.fn(async () => jsonResponse({ ...PRODUCT, id: 78 }, { status: 201 }));
    const create = await run(
      { operation: "create_product", params: { name: "Shirt", body: { name: "Shirt", regular_price: "120.00" } } },
      created as unknown as typeof fetch,
    );
    expect(create.ok).toBe(true);

    const updated = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("PUT");
      return jsonResponse({ ...PRODUCT, regular_price: "150.00" });
    });
    const update = await run(
      { operation: "update_product", params: { id: 77, body: { regular_price: "150.00" } } },
      updated as unknown as typeof fetch,
    );
    expect(update.ok).toBe(true);
  });

  it("requires a name to create a product", async () => {
    const result = await run({ operation: "create_product", params: {} }, (async () => jsonResponse({})) as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/`name` is required/);
  });
});

describe("woocommerce inventory", () => {
  it("reads stock levels projected from the product resource", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([PRODUCT]));
    const result = await run({ operation: "list_inventory" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.items[0]).toMatchObject({
        object: "inventory_level",
        source: "woocommerce",
        product_id: "77",
        variation_id: null,
        available: 14,
        stock_status: "instock",
        manage_stock: true,
      });
  });

  it("updates product stock with the documented stock fields", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/products/77");
      expect(JSON.parse(String(init?.body))).toEqual({ stock_quantity: 5, manage_stock: true });
      return jsonResponse({ ...PRODUCT, stock_quantity: 5 });
    });
    const result = await run(
      { operation: "update_inventory", params: { id: 77, stock_quantity: 5, manage_stock: true } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ available: 5 });
  });

  it("updates variation stock on the variation resource", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/products/77/variations/91");
      return jsonResponse({ id: 91, parent_id: 77, sku: "SH-1-L", stock_quantity: 3, manage_stock: true, stock_status: "instock" });
    });
    const result = await run(
      { operation: "update_variation_inventory", params: { product_id: 77, id: 91, stock_quantity: 3 } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ product_id: "77", variation_id: "91", available: 3 });
  });
});

/* ------------------------------------------------------------------ */
/* Customers                                                          */
/* ------------------------------------------------------------------ */

describe("woocommerce customers", () => {
  it("lists and normalizes customers", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([CUSTOMER]));
    const result = await run({ operation: "list_customers" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.items[0]).toMatchObject({
        object: "customer",
        source: "woocommerce",
        id: "42",
        email: "h@example.com",
        phone: "+966555000111",
        city: "Riyadh",
        country: "SA",
        orders_count: 3,
      });
  });

  it("gets, creates and updates a customer", async () => {
    const get = await run({ operation: "get_customer", params: { id: 42 } }, (async () =>
      jsonResponse(CUSTOMER)) as unknown as typeof fetch);
    expect(get.ok).toBe(true);

    const create = await run(
      { operation: "create_customer", params: { email: "new@example.com", body: { email: "new@example.com" } } },
      (async () => jsonResponse({ ...CUSTOMER, id: 43 }, { status: 201 })) as unknown as typeof fetch,
    );
    expect(create.ok).toBe(true);

    const update = await run(
      { operation: "update_customer", params: { id: 42, body: { first_name: "Hassan" } } },
      (async () => jsonResponse(CUSTOMER)) as unknown as typeof fetch,
    );
    expect(update.ok).toBe(true);
  });

  it("requires an email to create a customer", async () => {
    const result = await run({ operation: "create_customer", params: {} }, (async () =>
      jsonResponse({})) as unknown as typeof fetch);
    expect(result.ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* Pagination                                                         */
/* ------------------------------------------------------------------ */

describe("woocommerce pagination", () => {
  it("walks pages by page number and stops on a short page", async () => {
    const pages: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      pages.push(parsed.searchParams.get("page") ?? "");
      return parsed.searchParams.get("page") === "1"
        ? jsonResponse([ORDER, { ...ORDER, id: 7002 }])
        : jsonResponse([{ ...ORDER, id: 7003 }]);
    });
    const result = await run(
      { operation: "list_orders", params: { per_page: 2 }, maxPages: 3 },
      fetchImpl as unknown as typeof fetch,
    );
    expect(pages).toEqual(["1", "2"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(3);
      expect(result.pages).toBe(2);
      expect(result.cursor).toBeNull();
    }
  });

  it("stops immediately on an empty collection", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse([]));
    const result = await run({ operation: "list_products", maxPages: 3 }, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (result.ok) expect(result.items).toEqual([]);
  });

  it("honours an explicit starting cursor", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(new URL(String(url)).searchParams.get("page")).toBe("4");
      return jsonResponse([PRODUCT]);
    });
    const result = await run({ operation: "list_products", cursor: "4", params: { per_page: 50 } }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Rate limits, retries, timeouts                                     */
/* ------------------------------------------------------------------ */

describe("woocommerce throttling and resilience", () => {
  it("retries a throttled request and honours Retry-After", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ code: "too_many_requests", message: "Slow down.", data: { status: 429 } }, {
            status: 429,
            headers: { "retry-after": "2" },
          })
        : jsonResponse([ORDER]);
    });
    const waits: number[] = [];
    const result = await run({ operation: "list_orders" }, fetchImpl as unknown as typeof fetch, creds, {
      sleep: async (ms: number) => {
        waits.push(ms);
      },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(2);
      expect(result.status).toBe(200);
    }
    expect(waits[0]).toBe(2000);
  });

  it("retries a 5xx and succeeds", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls < 3
        ? jsonResponse({ code: "internal_server_error", message: "Boom", data: { status: 500 } }, { status: 500 })
        : jsonResponse([PRODUCT]);
    });
    const result = await run({ operation: "list_products" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(3);
  });

  it("does not retry a non-retryable error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: "woocommerce_rest_invalid_id", message: "Invalid ID.", data: { status: 404 } }, { status: 404 }),
    );
    const result = await run({ operation: "get_order", params: { id: 1 } }, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("maps a timeout to a timeout error", async () => {
    const fetchImpl = vi.fn(async () => {
      const error = new Error("The operation was aborted");
      error.name = "AbortError";
      throw error;
    });
    const result = await run({ operation: "list_orders" }, fetchImpl as unknown as typeof fetch, creds, { timeoutMs: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("timeout");
  });

  it("reads throttling headers when the host provides them", () => {
    const info = woocommerceConnector.readRateLimit?.(
      new Headers({ "x-ratelimit-limit": "600", "x-ratelimit-remaining": "12", "retry-after": "3" }),
      null,
    );
    expect(info).toEqual({ limit: 600, remaining: 12, retryAfterMs: 3000 });
  });
});

/* ------------------------------------------------------------------ */
/* Error normalization & malformed responses                          */
/* ------------------------------------------------------------------ */

describe("woocommerce error normalization", () => {
  it("maps the documented error codes to the shared error kinds", () => {
    const map = (status: number, body: unknown) => woocommerceConnector.mapError?.(status, body)?.kind;
    expect(map(401, { code: "woocommerce_rest_authentication_error", message: "x", data: { status: 401 } })).toBe("auth");
    expect(map(403, { code: "woocommerce_rest_cannot_view", message: "x", data: { status: 403 } })).toBe("forbidden");
    expect(map(404, { code: "woocommerce_rest_invalid_id", message: "x", data: { status: 404 } })).toBe("not_found");
    expect(map(400, { code: "rest_invalid_param", message: "x", data: { status: 400 } })).toBe("invalid_request");
    expect(map(429, { code: "too_many_requests", message: "x", data: { status: 429 } })).toBe("rate_limit");
    expect(map(503, { code: "unavailable", message: "x", data: { status: 503 } })).toBe("provider");
    expect(woocommerceConnector.mapError?.(200, { id: 1 })).toBeNull();
  });

  it("rejects a list payload that is not a collection", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ unexpected: true }));
    const result = await run({ operation: "list_orders" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed_response");
  });

  it("rejects an unsupported operation", async () => {
    const result = await run({ operation: "delete_store" }, (async () => jsonResponse({})) as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unsupported");
  });
});

/* ------------------------------------------------------------------ */
/* Idempotency                                                        */
/* ------------------------------------------------------------------ */

describe("woocommerce idempotency", () => {
  it("stamps a create with the ZYRONEX idempotency key in meta_data", async () => {
    const bodies: unknown[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return jsonResponse(ORDER, { status: 201 });
    });
    const params = { body: { payment_method: "mada" }, idempotency_key: "run-123" };
    await run({ operation: "create_order", params }, fetchImpl as unknown as typeof fetch);
    await run({ operation: "create_order", params }, fetchImpl as unknown as typeof fetch);

    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toMatchObject({
      payment_method: "mada",
      meta_data: [{ key: "_zyronex_idempotency_key", value: "run-123" }],
    });
  });

  it("leaves the body untouched when no key is supplied", () => {
    const call = woocommerceConnector.buildCall({ operation: "create_order", params: { body: { payment_method: "mada" } } });
    expect(call.body).toEqual({ payment_method: "mada" });
  });
});

/* ------------------------------------------------------------------ */
/* Webhooks                                                           */
/* ------------------------------------------------------------------ */

describe("woocommerce webhooks", () => {
  const secret = "wh_secret_value";
  const raw = JSON.stringify({ id: 7001, date_modified_gmt: "2026-09-01T10:10:00", status: "completed" });
  const signature = createHmac("sha256", secret).update(raw, "utf8").digest("base64");

  it("manages webhook subscriptions through the official endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/wp-json/wc/v3/webhooks");
      expect(JSON.parse(String(init?.body))).toMatchObject({ topic: "order.updated" });
      return jsonResponse({ id: 12, topic: "order.updated", status: "active" }, { status: 201 });
    });
    const result = await run(
      { operation: "create_webhook", params: { topic: "order.updated", delivery_url: "https://zyronex.ai/hook", secret } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
  });

  it("lists and deletes webhooks", async () => {
    const list = await run({ operation: "list_webhooks" }, (async () =>
      jsonResponse([{ id: 12, topic: "order.updated" }])) as unknown as typeof fetch);
    expect(list.ok).toBe(true);

    const remove = await run({ operation: "delete_webhook", params: { id: 12, force: true } }, (async () =>
      jsonResponse({ id: 12, deleted: true })) as unknown as typeof fetch);
    expect(remove.ok).toBe(true);
  });

  it("accepts a correctly signed delivery", () => {
    const verification = verifyWebhook("woocommerce", {
      raw,
      payload: JSON.parse(raw),
      headers: {
        "x-wc-webhook-signature": signature,
        "x-wc-webhook-topic": "order.updated",
        "x-wc-webhook-delivery-id": "delivery-1",
      },
      secret,
      nowMs: Date.now(),
      replayWindowMs: 300_000,
    });
    expect(verification).toMatchObject({ ok: true, eventType: "order.updated", eventId: "delivery-1" });
  });

  it("rejects a forged signature", () => {
    const verification = verifyWebhook("woocommerce", {
      raw,
      payload: JSON.parse(raw),
      headers: { "x-wc-webhook-signature": "AAAA", "x-wc-webhook-topic": "order.updated" },
      secret,
      nowMs: Date.now(),
      replayWindowMs: 300_000,
    });
    expect(verification).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a delivery with no signature header and with no configured secret", () => {
    const base = { raw, payload: JSON.parse(raw), nowMs: Date.now(), replayWindowMs: 300_000 };
    expect(verifyWebhook("woocommerce", { ...base, headers: {}, secret })).toMatchObject({ ok: false });
    expect(
      verifyWebhook("woocommerce", { ...base, headers: { "x-wc-webhook-signature": signature }, secret: "" }),
    ).toMatchObject({ ok: false, reason: "missing_secret" });
  });

  it("gives a redelivered event a stable id so duplicates are detected", () => {
    const headers = { "x-wc-webhook-signature": signature, "x-wc-webhook-topic": "order.updated" };
    const input = { raw, payload: JSON.parse(raw), headers, secret, nowMs: Date.now(), replayWindowMs: 300_000 };
    const first = verifyWebhook("woocommerce", input);
    const second = verifyWebhook("woocommerce", input);
    expect(first.eventId).toBe(second.eventId);
    expect(first.eventId).toBe("order.updated:7001:2026-09-01T10:10:00");
  });

  it("derives the topic from the resource and event headers when needed", () => {
    const verification = verifyWebhook("woocommerce", {
      raw,
      payload: JSON.parse(raw),
      headers: {
        "x-wc-webhook-signature": signature,
        "x-wc-webhook-resource": "product",
        "x-wc-webhook-event": "created",
      },
      secret,
      nowMs: Date.now(),
      replayWindowMs: 300_000,
    });
    expect(verification.eventType).toBe("product.created");
  });

  it("normalizes a webhook payload by topic family", () => {
    expect(normalizeWooWebhookEvent(ORDER, "order.updated").normalized).toMatchObject({ object: "order", id: "7001" });
    expect(normalizeWooWebhookEvent(PRODUCT, "product.updated").normalized).toMatchObject({ object: "product", id: "77" });
    expect(normalizeWooWebhookEvent(CUSTOMER, "customer.created").normalized).toMatchObject({ object: "customer", id: "42" });
    expect(normalizeWooWebhookEvent({}, "coupon.created").normalized).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Workspace isolation & secret redaction                             */
/* ------------------------------------------------------------------ */

describe("woocommerce workspace isolation and redaction", () => {
  it("sends each workspace's request to its own store with its own keys", async () => {
    const seen: { url: string; auth: string | undefined }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") ?? undefined });
      return jsonResponse([PRODUCT]);
    });

    await run({ operation: "list_products" }, fetchImpl as unknown as typeof fetch);
    await run({ operation: "list_products" }, fetchImpl as unknown as typeof fetch, {
      consumer_key: "ck_other",
      consumer_secret: "cs_other",
      store_url: "https://other-store.example",
    });

    expect(seen[0]?.url).toContain("shop.zyronex.ai");
    expect(seen[1]?.url).toContain("other-store.example");
    expect(seen[0]?.auth).not.toBe(seen[1]?.auth);
  });

  it("never leaks keys into a returned error message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect failed for ck_live_key:cs_live_secret");
    });
    const result = await run({ operation: "list_orders" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain("cs_live_secret");
      expect(result.error.message).not.toContain("ck_live_key");
    }
  });

  it("never leaks keys into emitted log events", async () => {
    const events: string[] = [];
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ code: "unavailable", message: "cs_live_secret rejected", data: { status: 503 } }, { status: 503 }),
    );
    await run({ operation: "list_orders" }, fetchImpl as unknown as typeof fetch, creds, {
      onEvent: (event) => events.push(JSON.stringify(event)),
    });
    expect(events.join("\n")).not.toContain("cs_live_secret");
  });
});

/* ------------------------------------------------------------------ */
/* Normalization contract                                             */
/* ------------------------------------------------------------------ */

describe("woocommerce normalization contract", () => {
  it("produces the shared neutral shapes", () => {
    expect(normalizeWooOrder(ORDER)).toMatchObject({
      object: "order",
      source: "woocommerce",
      items: [{ product_id: "77", quantity: 2, price: { amount: 99, currency: "SAR" } }],
      shipping: { method: "Aramex", address: { city: "Riyadh", street: "King Fahd Rd", postal_code: "12345" } },
    });
    expect(normalizeWooProduct(PRODUCT).price).toEqual({ amount: 99, currency: null });
    expect(normalizeWooCustomer({})).toBeNull();
    expect(normalizeWooInventoryLevel(PRODUCT)).toMatchObject({ product_id: "77", available: 14 });
  });

  it("treats an unpaid order as unpaid", () => {
    expect(normalizeWooOrder({ id: 1, status: "pending" }).financial_status).toBe("unpaid");
    expect(normalizeWooOrder({ id: 1, status: "completed" }).financial_status).toBe("paid");
  });
});
