import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { sallaConnector } from "@/lib/connectors/adapters/salla";
import { normalizeOrder, normalizeWebhookEvent } from "@/lib/connectors/adapters/salla-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { getConnector, describeConnectors } from "@/lib/connectors/registry";
import { getOAuthProvider } from "@/lib/oauth/providers";
import { verifyWebhook } from "@/lib/webhooks/verify";

const trace = "trace-salla";
const creds = { access_token: "salla-secret-token" };

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function run(input: Parameters<typeof runConnectorOperation>[0]["input"], fetchImpl: typeof fetch, credentials = creds) {
  return runConnectorOperation({ adapter: sallaConnector, credentials, traceId: trace, input, fetchImpl });
}

const ORDER = {
  id: 12345,
  reference_id: 55,
  status: { name: "Under review", slug: "under_review" },
  payment_method: "mada",
  date: { date: "2026-08-01 10:00:00" },
  amounts: { total: { amount: 250.5, currency: "SAR" } },
  customer: { id: 9, first_name: "Hassan", last_name: "Abiri", email: "h@example.com", mobile: "555000111", mobile_code: "+966", city: "Riyadh" },
  shipping: { company: "Aramex", shipment_number: "TRK1", address: { country: "SA", city: "Riyadh", street_number: "12", postal_code: "11564" } },
  items: [{ id: 1, name: "Shirt", sku: "SH-1", quantity: 2, product: { id: 77 }, amounts: { price_without_tax: { amount: 100, currency: "SAR" } } }],
};

describe("salla registry + oauth wiring", () => {
  it("is registered as an independent adapter", () => {
    expect(getConnector("salla")?.id).toBe("salla");
    expect(sallaConnector.capabilities).toContain("webhook");
  });

  it("declares an official OAuth spec with offline access", () => {
    const spec = getOAuthProvider("salla");
    expect(spec?.authorizationUrl).toBe("https://accounts.salla.sa/oauth2/auth");
    expect(spec?.tokenUrl).toBe("https://accounts.salla.sa/oauth2/token");
    expect(spec?.scopes).toContain("offline_access");
    expect(spec?.refreshable).toBe(true);
  });

  it("identifies the store from the token response", () => {
    const identified = getOAuthProvider("salla")?.identify?.({ store: { id: 987, name: "Zyronex Store" } });
    expect(identified).toEqual({ accountIdentifier: "987", accountLabel: "Zyronex Store" });
  });

  it("never leaks credentials through the client-safe catalog", () => {
    const described = JSON.stringify(describeConnectors());
    expect(described).toContain("salla");
    expect(described).not.toMatch(/access_token"\s*:\s*"/);
  });
});

describe("salla store identification & health", () => {
  it("checks health through the official user info endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/oauth2/user/info");
      return jsonResponse({ status: 200, success: true, data: { id: 987, name: "Zyronex Store" } });
    }) as unknown as typeof fetch;

    const health = await checkConnectorHealth({ adapter: sallaConnector, credentials: creds, traceId: trace, fetchImpl });
    expect(health.healthy).toBe(true);
  });
});

describe("salla orders", () => {
  it("normalizes a single order into the neutral shape", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/orders/12345");
      return jsonResponse({ status: 200, success: true, data: ORDER });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "get_order", params: { id: 12345 } }, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const order = result.items[0] as unknown as ReturnType<typeof normalizeOrder>;
    expect(order.object).toBe("order");
    expect(order.status).toBe("Under review");
    expect(order.total).toEqual({ amount: 250.5, currency: "SAR" });
    expect(order.customer?.phone).toBe("+966555000111");
    expect(order.shipping.tracking_number).toBe("TRK1");
    expect(order.items[0]?.product_id).toBe("77");
  });

  it("follows page pagination up to the budget", async () => {
    let page = 0;
    const fetchImpl = vi.fn(async () => {
      page += 1;
      return jsonResponse({
        status: 200,
        success: true,
        data: [{ ...ORDER, id: page }],
        pagination: { currentPage: page, totalPages: 2 },
      });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "list_orders", maxPages: 2 }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(2);
      expect(result.pages).toBe(2);
      expect(result.cursor).toBeNull();
    }
  });

  it("updates the order status through the official endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/orders/12345/status");
      expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({ status: "completed", note: "done" });
      return jsonResponse({ status: 200, success: true, data: { id: 12345 } });
    }) as unknown as typeof fetch;

    const result = await run(
      { operation: "update_order_status", params: { id: 12345, status: "completed", note: "done" } },
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
});

describe("salla products, inventory & customers", () => {
  it("lists and normalizes products", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        status: 200,
        success: true,
        data: [{ id: 7, name: "Shirt", sku: "SH-1", status: "sale", price: { amount: 99, currency: "SAR" }, quantity: 5 }],
        pagination: { currentPage: 1, totalPages: 1 },
      }),
    ) as unknown as typeof fetch;

    const result = await run({ operation: "list_products" }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "product", sku: "SH-1", quantity: 5 });
  });

  it("updates inventory through the quantity endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/products/7/quantity");
      expect(init?.method).toBe("PUT");
      expect(JSON.parse(String(init?.body))).toEqual({ quantity: 12 });
      return jsonResponse({ status: 200, success: true, data: { id: 7, quantity: 12 } });
    }) as unknown as typeof fetch;

    const result = await run({ operation: "update_product_quantity", params: { id: 7, quantity: 12 } }, fetchImpl);
    expect(result.ok).toBe(true);
  });

  it("creates a customer and normalizes the response", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain("/customers");
      expect(init?.method).toBe("POST");
      return jsonResponse({ status: 201, success: true, data: { id: 4, first_name: "Sara", email: "s@example.com" } });
    }) as unknown as typeof fetch;

    const result = await run(
      { operation: "create_customer", params: { first_name: "Sara", body: { first_name: "Sara", email: "s@example.com" } } },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "customer", first_name: "Sara" });
  });
});

describe("salla failure handling", () => {
  it("maps an authentication failure to a non-retryable auth error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: 401, success: false, error: { message: "Unauthenticated" } }, { status: 401 }),
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
    const result = await run({ operation: "list_orders" }, fetchImpl, {} as Record<string, string>);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
  });

  it("retries a rate limit and then succeeds", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ status: 429, success: false, error: { message: "Too many requests" } }, { status: 429, headers: { "retry-after": "0" } })
        : jsonResponse({ status: 200, success: true, data: [], pagination: { currentPage: 1, totalPages: 1 } });
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
      adapter: sallaConnector,
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

  it("never echoes the access token in a failure result", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ status: 403, success: false, error: { message: `Token ${creds.access_token} is forbidden` } }, { status: 403 }),
    ) as unknown as typeof fetch;

    const result = await run({ operation: "list_orders" }, fetchImpl);
    expect(JSON.stringify(result)).not.toContain(creds.access_token);
  });
});

describe("salla webhooks", () => {
  const secret = "whsec-salla";
  const payload = { event: "order.created", merchant: 987, created_at: "2026-08-01 10:00:00", data: ORDER };
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", secret).update(raw).digest("hex");
  const base = { raw, payload, secret, nowMs: Date.now(), replayWindowMs: 300_000 };

  it("accepts a correctly signed Salla event and derives a stable event id", () => {
    const result = verifyWebhook("salla", { ...base, headers: { "x-salla-signature": signature } });
    expect(result.ok).toBe(true);
    expect(result.eventType).toBe("order.created");
    expect(result.eventId).toBe("order.created:12345:2026-08-01 10:00:00");
  });

  it("produces the same event id for a duplicate delivery (idempotency key)", () => {
    const first = verifyWebhook("salla", { ...base, headers: { "x-salla-signature": signature } });
    const second = verifyWebhook("salla", { ...base, headers: { "x-salla-signature": signature } });
    expect(second.eventId).toBe(first.eventId);
  });

  it("rejects an invalid signature", () => {
    const result = verifyWebhook("salla", { ...base, headers: { "x-salla-signature": "deadbeef" } });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_signature");
  });

  it("rejects a delivery with no security header", () => {
    const result = verifyWebhook("salla", { ...base, headers: {} });
    expect(result.ok).toBe(false);
  });

  it("supports the token security strategy", () => {
    const result = verifyWebhook("salla", { ...base, headers: { authorization: `Bearer ${secret}` } });
    expect(result.ok).toBe(true);
  });

  it("normalizes the webhook envelope without any business logic", () => {
    const normalized = normalizeWebhookEvent(payload);
    expect(normalized.event).toBe("order.created");
    expect(normalized.merchant_id).toBe("987");
    expect((normalized.normalized as ReturnType<typeof normalizeOrder>).object).toBe("order");
  });

  it("never returns the signing secret", () => {
    const result = verifyWebhook("salla", { ...base, headers: { "x-salla-signature": signature } });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
