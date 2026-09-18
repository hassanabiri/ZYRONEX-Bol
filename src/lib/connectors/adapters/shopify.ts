import {
  normalizeShopifyCustomer,
  normalizeShopifyInventoryLevel,
  normalizeShopifyOrder,
  normalizeShopifyProduct,
} from "@/lib/connectors/adapters/shopify-map";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Shopify connector — third production commerce adapter.
 *
 * Official Shopify Admin REST API only (`https://{shop}/admin/api/{version}`)
 * with the official OAuth app flow and official webhooks. Like every adapter it
 * owns four concerns and nothing else: API communication, credential injection,
 * mapping/normalization and error handling. No business logic, no AI and no CRM
 * decisions live here — the ZYRONEX runtime stays the source of truth.
 *
 * The store domain is part of the credential set (issued when the merchant
 * installed the app), so `buildCall` emits a host placeholder that `authorize`
 * replaces. Tokens and domains never reach the browser or a log line.
 */

export const SHOPIFY_API_VERSION = "2025-01";
/** Replaced in `authorize` with the store's own `*.myshopify.com` host. */
const SHOP_PLACEHOLDER = "shop-placeholder.invalid";
const DEFAULT_PAGE_SIZE = 50;

type Spec = {
  method: HttpMethod;
  /** `:id` placeholders are filled from params. */
  path: string;
  entity?: "order" | "product" | "customer" | "inventory_level";
  /** Collection endpoints follow Shopify's `since_id` + `limit` pagination. */
  list?: boolean;
  /** Key Shopify uses for the collection / single resource in the body. */
  collection?: string;
  single?: string;
  required?: string[];
  query?: string[];
  /** Params copied into the JSON body (empty = pass `body`/`data` through). */
  body?: string[];
  /** Wraps the request body as `{ [root]: body }`, as the REST API expects. */
  bodyRoot?: string;
};

const OPERATIONS: Record<string, Spec> = {
  // Orders
  list_orders: {
    method: "GET",
    path: "/orders.json",
    entity: "order",
    list: true,
    collection: "orders",
    query: ["status", "financial_status", "fulfillment_status", "created_at_min", "created_at_max", "updated_at_min", "ids"],
  },
  get_order: { method: "GET", path: "/orders/:id.json", entity: "order", single: "order", required: ["id"] },
  update_order: {
    method: "PUT",
    path: "/orders/:id.json",
    entity: "order",
    single: "order",
    required: ["id"],
    body: [],
    bodyRoot: "order",
  },
  cancel_order: {
    method: "POST",
    path: "/orders/:id/cancel.json",
    entity: "order",
    single: "order",
    required: ["id"],
    body: ["reason", "email", "restock"],
  },
  close_order: { method: "POST", path: "/orders/:id/close.json", entity: "order", single: "order", required: ["id"], body: [] },
  count_orders: { method: "GET", path: "/orders/count.json", query: ["status", "financial_status", "fulfillment_status"] },
  // Products
  list_products: {
    method: "GET",
    path: "/products.json",
    entity: "product",
    list: true,
    collection: "products",
    query: ["status", "vendor", "product_type", "handle", "published_status", "updated_at_min", "ids"],
  },
  get_product: { method: "GET", path: "/products/:id.json", entity: "product", single: "product", required: ["id"] },
  create_product: {
    method: "POST",
    path: "/products.json",
    entity: "product",
    single: "product",
    required: ["title"],
    body: [],
    bodyRoot: "product",
  },
  update_product: {
    method: "PUT",
    path: "/products/:id.json",
    entity: "product",
    single: "product",
    required: ["id"],
    body: [],
    bodyRoot: "product",
  },
  // Customers
  list_customers: {
    method: "GET",
    path: "/customers.json",
    entity: "customer",
    list: true,
    collection: "customers",
    query: ["created_at_min", "created_at_max", "updated_at_min", "ids"],
  },
  search_customers: {
    method: "GET",
    path: "/customers/search.json",
    entity: "customer",
    list: true,
    collection: "customers",
    required: ["query"],
    query: ["query", "order"],
  },
  get_customer: { method: "GET", path: "/customers/:id.json", entity: "customer", single: "customer", required: ["id"] },
  create_customer: {
    method: "POST",
    path: "/customers.json",
    entity: "customer",
    single: "customer",
    required: ["email"],
    body: [],
    bodyRoot: "customer",
  },
  update_customer: {
    method: "PUT",
    path: "/customers/:id.json",
    entity: "customer",
    single: "customer",
    required: ["id"],
    body: [],
    bodyRoot: "customer",
  },
  // Inventory
  list_locations: { method: "GET", path: "/locations.json", list: true, collection: "locations" },
  list_inventory_levels: {
    method: "GET",
    path: "/inventory_levels.json",
    entity: "inventory_level",
    list: true,
    collection: "inventory_levels",
    query: ["inventory_item_ids", "location_ids", "updated_at_min"],
  },
  set_inventory_level: {
    method: "POST",
    path: "/inventory_levels/set.json",
    entity: "inventory_level",
    single: "inventory_level",
    required: ["inventory_item_id", "location_id", "available"],
    body: ["inventory_item_id", "location_id", "available", "disconnect_if_necessary"],
  },
  adjust_inventory_level: {
    method: "POST",
    path: "/inventory_levels/adjust.json",
    entity: "inventory_level",
    single: "inventory_level",
    required: ["inventory_item_id", "location_id", "available_adjustment"],
    body: ["inventory_item_id", "location_id", "available_adjustment"],
  },
  // Webhooks
  list_webhooks: { method: "GET", path: "/webhooks.json", list: true, collection: "webhooks" },
  create_webhook: {
    method: "POST",
    path: "/webhooks.json",
    single: "webhook",
    required: ["topic", "address"],
    body: ["topic", "address", "format", "fields", "api_version"],
    bodyRoot: "webhook",
  },
  delete_webhook: { method: "DELETE", path: "/webhooks/:id.json", required: ["id"] },
  // Store identity / health
  shop_info: { method: "GET", path: "/shop.json", single: "shop" },
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
  if (entity === "order") return normalizeShopifyOrder(value) as unknown as Record<string, unknown>;
  if (entity === "product") return normalizeShopifyProduct(value) as unknown as Record<string, unknown>;
  if (entity === "customer") return (normalizeShopifyCustomer(value) ?? {}) as unknown as Record<string, unknown>;
  if (entity === "inventory_level") return normalizeShopifyInventoryLevel(value) as unknown as Record<string, unknown>;
  return asRecord(value);
}

/** `store`, `store.myshopify.com` and a full URL all resolve to the API host. */
export function normalizeShopDomain(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!trimmed) return "";
  const host = trimmed.includes(".") ? trimmed : `${trimmed}.myshopify.com`;
  return /^[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/.test(host) ? host : "";
}

export const shopifyConnector: ConnectorAdapter = {
  id: "shopify",
  label: "Shopify",
  capabilities: ["read", "write", "search", "pagination", "webhook", "health_check"],
  credentials: {
    kind: "oauth2",
    required: ["access_token"],
    optional: ["shop_domain", "shop", "store_domain", "myshopify_domain"],
  },
  operations: Object.keys(OPERATIONS),
  healthOperation: "shop_info",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Shopify operation "${operation}"`, { retryable: false });

    for (const key of spec.required ?? [])
      if (params[key] === undefined || params[key] === null || params[key] === "")
        throw new ConnectorError("invalid_request", `\`${key}\` is required for ${operation}`, { retryable: false });

    const path = spec.path.replace(/:([a-z_]+)/g, (_match, key: string) => encodeURIComponent(String(params[key])));

    const query: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(pickInto(params, spec.query))) query[key] = value as string | number;
    if (spec.list) {
      // Shopify REST paginates by `since_id`: the cursor is the last id read.
      query["limit"] = Number(params["limit"] ?? DEFAULT_PAGE_SIZE);
      if (cursor) query["since_id"] = String(cursor);
    }

    const passthrough = spec.body?.length === 0 ? asRecord(params["body"] ?? params["data"]) : pickInto(params, spec.body);
    const hasBody = spec.method !== "GET" && spec.method !== "DELETE";
    const payload = spec.bodyRoot ? { [spec.bodyRoot]: passthrough } : passthrough;

    return {
      method: spec.method,
      url: `https://${SHOP_PLACEHOLDER}/admin/api/${SHOPIFY_API_VERSION}${path}`,
      headers: { accept: "application/json", ...(hasBody ? { "content-type": "application/json" } : {}) },
      query,
      ...(hasBody ? { body: payload } : {}),
      paginated: Boolean(spec.list),
    };
  },

  /**
   * Shopify authenticates with `X-Shopify-Access-Token` against the merchant's
   * own domain, so both the token and the store domain must be present before a
   * single byte leaves the runtime.
   */
  authorize: (call, credentials) => {
    const token = credentials["access_token"];
    const domain = normalizeShopDomain(
      credentials["shop_domain"] ?? credentials["shop"] ?? credentials["store_domain"] ?? credentials["myshopify_domain"] ?? "",
    );
    if (!token) throw new ConnectorError("auth", "The Shopify store is not connected yet", { retryable: false });
    if (!domain)
      throw new ConnectorError("auth", "The Shopify store domain is missing from this connection", { retryable: false });

    return {
      ...call,
      url: call.url.replace(SHOP_PLACEHOLDER, domain),
      headers: { ...call.headers, "x-shopify-access-token": token },
    };
  },

  /** Shopify answers with `{ errors: "..." }` or `{ errors: { field: [...] } }`. */
  mapError: (status, payload) => {
    const body = asRecord(payload);
    const errors = body["errors"] ?? body["error"];
    if (status < 400 && errors === undefined) return null;

    const message =
      typeof errors === "string"
        ? errors
        : errors
          ? JSON.stringify(errors)
          : `Shopify request failed (${status})`;

    if (status === 401) return { kind: "auth", message: `Shopify rejected the token: ${message}`, retryable: false };
    if (status === 402 || status === 403)
      return { kind: "forbidden", message: `Shopify denied the request: ${message}`, retryable: false };
    if (status === 404) return { kind: "not_found", message, retryable: false };
    if (status === 422 || status === 400) return { kind: "invalid_request", message, retryable: false };
    if (status === 423) return { kind: "forbidden", message: `Shopify store is locked: ${message}`, retryable: false };
    if (status === 429) return { kind: "rate_limit", message: `Shopify rate limit reached: ${message}`, retryable: true };
    if (status >= 500) return { kind: "provider", message, retryable: true };
    if (status >= 400) return { kind: "invalid_request", message, retryable: false };
    return null;
  },

  /** `X-Shopify-Shop-Api-Call-Limit: used/total` plus `Retry-After` on 429. */
  readRateLimit: (headers): RateLimitInfo | undefined => {
    const bucket = headers.get("x-shopify-shop-api-call-limit");
    const retryAfter = headers.get("retry-after");
    if (!bucket && !retryAfter) return undefined;

    const info: RateLimitInfo = {};
    if (bucket) {
      const [used, total] = bucket.split("/").map((part) => Number(part.trim()));
      if (Number.isFinite(total)) info.limit = total as number;
      if (Number.isFinite(used) && Number.isFinite(total)) info.remaining = Math.max(0, (total as number) - (used as number));
    }
    const seconds = Number(retryAfter);
    if (retryAfter && Number.isFinite(seconds)) info.retryAfterMs = Math.max(0, seconds) * 1000;
    return info;
  },

  normalize: (operation, payload): NormalizedPage => {
    const spec = OPERATIONS[operation];
    const body = asRecord(payload);
    if (Object.keys(body).length === 0)
      throw new ConnectorError("malformed_response", "Shopify returned an empty response body", { retryable: false });

    if (!spec?.list) {
      const single = spec?.single ? body[spec.single] ?? body : body;
      return { items: [mapEntity(spec?.entity, single)], cursor: null, raw: payload };
    }

    const raw = spec.collection ? body[spec.collection] : undefined;
    const items = Array.isArray(raw) ? raw : Array.isArray(body["data"]) ? (body["data"] as unknown[]) : null;
    if (!items)
      throw new ConnectorError("malformed_response", "Shopify list response did not contain a collection", {
        retryable: false,
      });

    // A short page means the collection is exhausted; otherwise the next page
    // continues after the last id Shopify returned.
    const lastId = items.length ? asRecord(items[items.length - 1])["id"] : undefined;
    const full = items.length >= DEFAULT_PAGE_SIZE;
    const cursor = full && lastId !== undefined && lastId !== null ? String(lastId) : null;

    return { items: items.map((item) => mapEntity(spec.entity, item)), cursor, raw: payload };
  },
};
