import {
  normalizeWooCustomer,
  normalizeWooInventoryLevel,
  normalizeWooOrder,
  normalizeWooProduct,
} from "@/lib/connectors/adapters/woocommerce-map";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * WooCommerce connector — fourth production commerce adapter.
 *
 * Official WooCommerce REST API v3 only (`{store}/wp-json/wc/v3`) with official
 * key-pair authentication and official webhooks. Like every adapter it owns four
 * concerns and nothing else: API communication, credential injection,
 * mapping/normalization and error handling. No business logic, no AI and no CRM
 * decisions live here — the ZYRONEX runtime stays the source of truth.
 *
 * The store URL is part of the credential set, so `buildCall` emits a host
 * placeholder that `authorize` replaces. Keys never reach the browser or a log.
 */

export const WOOCOMMERCE_API_NAMESPACE = "wc/v3";
/** Replaced in `authorize` with the merchant's own store origin. */
const STORE_PLACEHOLDER = "https://store-placeholder.invalid";
const DEFAULT_PAGE_SIZE = 50;

type Spec = {
  method: HttpMethod;
  /** `:id` placeholders are filled from params. */
  path: string;
  entity?: "order" | "product" | "customer" | "inventory_level";
  /** Collection endpoints follow WooCommerce's `page` + `per_page` pagination. */
  list?: boolean;
  required?: string[];
  query?: string[];
  /** Params copied into the JSON body (empty = pass `body`/`data` through). */
  body?: string[];
};

const ORDER_QUERY = ["status", "customer", "product", "after", "before", "search", "order", "orderby", "include"];
const PRODUCT_QUERY = ["status", "type", "sku", "category", "search", "stock_status", "modified_after", "order", "orderby", "include"];
const CUSTOMER_QUERY = ["email", "role", "search", "order", "orderby", "include"];

const OPERATIONS: Record<string, Spec> = {
  // Orders
  list_orders: { method: "GET", path: "/orders", entity: "order", list: true, query: ORDER_QUERY },
  get_order: { method: "GET", path: "/orders/:id", entity: "order", required: ["id"] },
  create_order: { method: "POST", path: "/orders", entity: "order", body: [] },
  update_order: { method: "PUT", path: "/orders/:id", entity: "order", required: ["id"], body: [] },
  update_order_status: {
    method: "PUT",
    path: "/orders/:id",
    entity: "order",
    required: ["id", "status"],
    body: ["status", "customer_note"],
  },
  list_order_notes: { method: "GET", path: "/orders/:id/notes", list: true, required: ["id"] },
  // Products
  list_products: { method: "GET", path: "/products", entity: "product", list: true, query: PRODUCT_QUERY },
  get_product: { method: "GET", path: "/products/:id", entity: "product", required: ["id"] },
  create_product: { method: "POST", path: "/products", entity: "product", required: ["name"], body: [] },
  update_product: { method: "PUT", path: "/products/:id", entity: "product", required: ["id"], body: [] },
  list_variations: {
    method: "GET",
    path: "/products/:product_id/variations",
    list: true,
    required: ["product_id"],
    query: ["sku", "status", "stock_status", "search"],
  },
  // Inventory — WooCommerce keeps stock on the product / variation resource.
  list_inventory: {
    method: "GET",
    path: "/products",
    entity: "inventory_level",
    list: true,
    query: PRODUCT_QUERY,
  },
  update_inventory: {
    method: "PUT",
    path: "/products/:id",
    entity: "inventory_level",
    required: ["id"],
    body: ["stock_quantity", "manage_stock", "stock_status", "backorders"],
  },
  update_variation_inventory: {
    method: "PUT",
    path: "/products/:product_id/variations/:id",
    entity: "inventory_level",
    required: ["product_id", "id"],
    body: ["stock_quantity", "manage_stock", "stock_status", "backorders"],
  },
  // Customers
  list_customers: { method: "GET", path: "/customers", entity: "customer", list: true, query: CUSTOMER_QUERY },
  get_customer: { method: "GET", path: "/customers/:id", entity: "customer", required: ["id"] },
  create_customer: { method: "POST", path: "/customers", entity: "customer", required: ["email"], body: [] },
  update_customer: { method: "PUT", path: "/customers/:id", entity: "customer", required: ["id"], body: [] },
  // Webhooks
  list_webhooks: { method: "GET", path: "/webhooks", list: true, query: ["status", "search"] },
  create_webhook: {
    method: "POST",
    path: "/webhooks",
    required: ["topic", "delivery_url"],
    body: ["name", "topic", "delivery_url", "secret", "status"],
  },
  delete_webhook: { method: "DELETE", path: "/webhooks/:id", required: ["id"], query: ["force"] },
  // Store identity / health
  system_status: { method: "GET", path: "/system_status" },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function pickInto(params: Record<string, unknown>, keys: string[] | undefined): Record<string, unknown> {
  if (!keys) return {};
  const out: Record<string, unknown> = {};
  for (const key of keys) if (params[key] !== undefined) out[key] = params[key];
  return out;
}

function mapEntity(entity: Spec["entity"], value: unknown): Record<string, unknown> {
  if (entity === "order") return normalizeWooOrder(value) as unknown as Record<string, unknown>;
  if (entity === "product") return normalizeWooProduct(value) as unknown as Record<string, unknown>;
  if (entity === "customer") return (normalizeWooCustomer(value) ?? {}) as unknown as Record<string, unknown>;
  if (entity === "inventory_level") return normalizeWooInventoryLevel(value) as unknown as Record<string, unknown>;
  return asRecord(value);
}

/** `store.com`, `https://store.com` and a deep link all resolve to the origin. */
export function normalizeStoreUrl(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:") return "";
    if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(url.hostname)) return "";
    return `https://${url.host}`;
  } catch {
    return "";
  }
}

function base64(value: string): string {
  if (typeof globalThis.btoa === "function") return globalThis.btoa(value);
  return Buffer.from(value, "utf8").toString("base64");
}

/**
 * WooCommerce has no idempotency header. The documented `meta_data` field is
 * used instead so a replayed create carries the same ZYRONEX key and the
 * runtime (not the store) can recognise the duplicate.
 */
function withIdempotency(payload: Record<string, unknown>, key: unknown): Record<string, unknown> {
  if (typeof key !== "string" || !key) return payload;
  const existing = Array.isArray(payload["meta_data"]) ? (payload["meta_data"] as unknown[]) : [];
  return { ...payload, meta_data: [...existing, { key: "_zyronex_idempotency_key", value: key }] };
}

export const woocommerceConnector: ConnectorAdapter = {
  id: "woocommerce",
  label: "WooCommerce",
  capabilities: ["read", "write", "search", "pagination", "webhook", "health_check"],
  credentials: {
    kind: "basic",
    required: ["consumer_key", "consumer_secret"],
    optional: ["store_url", "store_domain", "base_url", "site_url"],
  },
  operations: Object.keys(OPERATIONS),
  healthOperation: "system_status",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown WooCommerce operation "${operation}"`, { retryable: false });

    for (const key of spec.required ?? [])
      if (params[key] === undefined || params[key] === null || params[key] === "")
        throw new ConnectorError("invalid_request", `\`${key}\` is required for ${operation}`, { retryable: false });

    const path = spec.path.replace(/:([a-z_]+)/g, (_match, key: string) => encodeURIComponent(String(params[key])));

    const query: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(pickInto(params, spec.query))) query[key] = value as string | number;
    if (spec.list) {
      // WooCommerce paginates by page number; the cursor is the next page.
      query["per_page"] = Number(params["per_page"] ?? DEFAULT_PAGE_SIZE);
      query["page"] = cursor ? Number(cursor) : Number(params["page"] ?? 1);
    }

    const passthrough = spec.body?.length === 0 ? asRecord(params["body"] ?? params["data"]) : pickInto(params, spec.body);
    const hasBody = spec.method !== "GET" && spec.method !== "DELETE";
    const payload = hasBody ? withIdempotency(passthrough, params["idempotency_key"]) : passthrough;

    return {
      method: spec.method,
      url: `${STORE_PLACEHOLDER}/wp-json/${WOOCOMMERCE_API_NAMESPACE}${path}`,
      headers: { accept: "application/json", ...(hasBody ? { "content-type": "application/json" } : {}) },
      query,
      ...(hasBody ? { body: payload } : {}),
      paginated: Boolean(spec.list),
    };
  },

  /**
   * WooCommerce authenticates the key pair with HTTP Basic over HTTPS (the
   * documented method for SSL stores). Both the keys and the store origin must
   * be present before a single byte leaves the runtime.
   */
  authorize: (call, credentials) => {
    const key = credentials["consumer_key"];
    const secret = credentials["consumer_secret"];
    const store = normalizeStoreUrl(
      credentials["store_url"] ?? credentials["store_domain"] ?? credentials["base_url"] ?? credentials["site_url"] ?? "",
    );
    if (!key || !secret) throw new ConnectorError("auth", "The WooCommerce store is not connected yet", { retryable: false });
    if (!store)
      throw new ConnectorError("auth", "The WooCommerce store URL is missing or is not a secure https address", {
        retryable: false,
      });

    return {
      ...call,
      url: call.url.replace(STORE_PLACEHOLDER, store),
      headers: { ...call.headers, authorization: `Basic ${base64(`${key}:${secret}`)}` },
    };
  },

  /** WooCommerce answers with `{ code, message, data: { status } }`. */
  mapError: (status, payload) => {
    const body = asRecord(payload);
    const code = typeof body["code"] === "string" ? (body["code"] as string) : undefined;
    if (status < 400 && !code) return null;

    const message = typeof body["message"] === "string" ? (body["message"] as string) : `WooCommerce request failed (${status})`;
    const effective = Number(asRecord(body["data"])["status"] ?? status);

    if (code === "woocommerce_rest_authentication_error" || effective === 401)
      return { kind: "auth", message: `WooCommerce rejected the API keys: ${message}`, retryable: false };
    if (effective === 403)
      return { kind: "forbidden", message: `WooCommerce denied the request: ${message}`, retryable: false };
    if (effective === 404)
      return {
        kind: "not_found",
        message: code === "rest_no_route" ? `${message} (the store's permalinks must not be set to plain)` : message,
        retryable: false,
      };
    if (effective === 400 || effective === 422) return { kind: "invalid_request", message, retryable: false };
    if (effective === 429) return { kind: "rate_limit", message: `WooCommerce throttled the request: ${message}`, retryable: true };
    if (effective >= 500) return { kind: "provider", message, retryable: true };
    if (effective >= 400) return { kind: "invalid_request", message, retryable: false };
    return null;
  },

  /**
   * WooCommerce core defines no rate-limit headers; hosts and security plugins
   * front the store and answer with `Retry-After` (and sometimes the common
   * `X-RateLimit-*` set), so both are read when present.
   */
  readRateLimit: (headers): RateLimitInfo | undefined => {
    const retryAfter = headers.get("retry-after");
    const limit = headers.get("x-ratelimit-limit");
    const remaining = headers.get("x-ratelimit-remaining");
    if (!retryAfter && !limit && !remaining) return undefined;

    const info: RateLimitInfo = {};
    if (limit && Number.isFinite(Number(limit))) info.limit = Number(limit);
    if (remaining && Number.isFinite(Number(remaining))) info.remaining = Number(remaining);
    if (retryAfter && Number.isFinite(Number(retryAfter))) info.retryAfterMs = Math.max(0, Number(retryAfter)) * 1000;
    return info;
  },

  normalize: (operation, payload): NormalizedPage => {
    const spec = OPERATIONS[operation];
    if (payload === null || payload === undefined)
      throw new ConnectorError("malformed_response", "WooCommerce returned an empty response body", { retryable: false });

    if (!spec?.list) {
      const body = asRecord(payload);
      if (Object.keys(body).length === 0)
        throw new ConnectorError("malformed_response", "WooCommerce returned an empty response body", { retryable: false });
      return { items: [mapEntity(spec?.entity, body)], cursor: null, raw: payload };
    }

    // Collections come back as a bare JSON array.
    if (!Array.isArray(payload))
      throw new ConnectorError("malformed_response", "WooCommerce list response was not a collection", { retryable: false });

    const items = payload as unknown[];
    // A short page means the walk is over; otherwise continue with page + 1.
    const cursor = items.length === 0 ? null : String(items.length);

    return { items: items.map((item) => mapEntity(spec.entity, item)), cursor, raw: payload };
  },
};
