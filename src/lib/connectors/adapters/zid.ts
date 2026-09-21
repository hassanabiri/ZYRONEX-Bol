import {
  normalizeZidCustomer,
  normalizeZidOrder,
  normalizeZidProduct,
} from "@/lib/connectors/adapters/zid-map";
import { asRecord, assertRequiredParams, pickInto } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Zid connector — second production commerce adapter.
 *
 * Official Zid Merchant API only (`https://api.zid.sa/v1`) with the official
 * OAuth2 app flow and official webhooks. Like every adapter it owns four
 * concerns and nothing else: API communication, credential injection,
 * mapping/normalization and error handling. No business logic, no AI and no CRM
 * decisions live here — the ZYRONEX runtime stays the source of truth.
 *
 * Zid authenticates with two values issued by the same OAuth exchange:
 * `Authorization: Bearer <authorization>` (the manager JWT) and the
 * `X-Manager-Token` header (the OAuth access token). Both come from the vault
 * and never reach the browser or a log line.
 */

const BASE = "https://api.zid.sa/v1";

type Spec = {
  method: HttpMethod;
  /** `:id` placeholders are filled from params. */
  path: string;
  entity?: "order" | "product" | "customer";
  /** Collection endpoints follow Zid's `page` / `page_size` pagination. */
  list?: boolean;
  /** Keys Zid may use for the collection in a list response. */
  collection?: string[];
  required?: string[];
  query?: string[];
  /** Params copied verbatim into the JSON body (empty = pass `body` through). */
  body?: string[];
};

const OPERATIONS: Record<string, Spec> = {
  // Orders
  list_orders: {
    method: "GET",
    path: "/managers/store/orders",
    entity: "order",
    list: true,
    collection: ["orders", "results", "data"],
    query: ["order_status", "payment_status", "created_after", "created_before", "customer_id", "page_size"],
  },
  get_order: { method: "GET", path: "/managers/store/orders/:id/view", entity: "order", required: ["id"] },
  update_order_status: {
    method: "POST",
    path: "/managers/store/orders/:id/change-order-status",
    required: ["id", "order_status"],
    body: ["order_status", "note", "notify_customer"],
  },
  get_order_shipping: { method: "GET", path: "/managers/store/orders/:id/shipping-address", required: ["id"] },
  // Products
  list_products: {
    method: "GET",
    path: "/products",
    entity: "product",
    list: true,
    collection: ["results", "products", "data"],
    query: ["search", "category_id", "is_published", "page_size"],
  },
  get_product: { method: "GET", path: "/products/:id", entity: "product", required: ["id"] },
  create_product: { method: "POST", path: "/products", entity: "product", required: ["name"], body: [] },
  update_product: { method: "PATCH", path: "/products/:id", entity: "product", required: ["id"], body: [] },
  update_product_quantity: {
    method: "PUT",
    path: "/products/:id/quantity",
    required: ["id", "quantity"],
    body: ["quantity", "is_infinite"],
  },
  // Customers
  list_customers: {
    method: "GET",
    path: "/managers/store/customers",
    entity: "customer",
    list: true,
    collection: ["customers", "results", "data"],
    query: ["search", "page_size"],
  },
  get_customer: { method: "GET", path: "/managers/store/customers/:id", entity: "customer", required: ["id"] },
  create_customer: {
    method: "POST",
    path: "/managers/store/customers",
    entity: "customer",
    required: ["name"],
    body: [],
  },
  update_customer: {
    method: "PUT",
    path: "/managers/store/customers/:id",
    entity: "customer",
    required: ["id"],
    body: [],
  },
  // Webhooks
  list_webhooks: { method: "GET", path: "/managers/webhooks", list: true, collection: ["webhooks", "results", "data"] },
  create_webhook: {
    method: "POST",
    path: "/managers/webhooks",
    required: ["event", "target_url"],
    body: ["event", "target_url", "original_id", "subscriber", "conditions"],
  },
  delete_webhook: { method: "DELETE", path: "/managers/webhooks/:id", required: ["id"] },
  // Store identity / health
  store_info: { method: "GET", path: "/managers/account/profile" },
};


function mapEntity(entity: Spec["entity"], value: unknown): Record<string, unknown> {
  if (entity === "order") return normalizeZidOrder(value) as unknown as Record<string, unknown>;
  if (entity === "product") return normalizeZidProduct(value) as unknown as Record<string, unknown>;
  if (entity === "customer") return (normalizeZidCustomer(value) ?? {}) as unknown as Record<string, unknown>;
  return asRecord(value);
}

/** Finds the collection in a Zid list body regardless of which key it used. */
function collectionOf(body: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const key of keys) if (Array.isArray(body[key])) return body[key] as unknown[];
  for (const value of Object.values(body)) if (Array.isArray(value)) return value;
  return null;
}

export const zidConnector: ConnectorAdapter = {
  id: "zid",
  label: "Zid",
  capabilities: ["read", "write", "search", "pagination", "webhook", "health_check"],
  credentials: { kind: "oauth2", required: ["access_token"], optional: ["authorization", "refresh_token", "store_id"] },
  operations: Object.keys(OPERATIONS),
  healthOperation: "store_info",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Zid operation "${operation}"`, { retryable: false });

    assertRequiredParams(operation, params, spec.required);

    const path = spec.path.replace(/:([a-z_]+)/g, (_match, key: string) => encodeURIComponent(String(params[key])));

    const query: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(pickInto(params, spec.query))) query[key] = value as string | number;
    if (spec.list) {
      const page = Number(cursor ?? 1);
      if (Number.isFinite(page) && page > 1) query["page"] = page;
      if (query["page_size"] === undefined && params["limit"] !== undefined) query["page_size"] = Number(params["limit"]);
    }

    const passthrough = spec.body?.length === 0 ? asRecord(params["body"] ?? params["data"]) : pickInto(params, spec.body);
    const hasBody = spec.method !== "GET" && spec.method !== "DELETE";

    return {
      method: spec.method,
      url: `${BASE}${path}`,
      headers: { accept: "application/json", ...(hasBody ? { "content-type": "application/json" } : {}) },
      query,
      ...(hasBody ? { body: passthrough } : {}),
      paginated: Boolean(spec.list),
    };
  },

  /**
   * Zid requires the manager JWT as the bearer and the OAuth access token as
   * `X-Manager-Token`. Older, manually pasted connections may only carry one
   * value, so each falls back to the other rather than failing silently.
   */
  authorize: (call, credentials) => {
    const managerToken = credentials["access_token"];
    const bearer = credentials["authorization"] ?? credentials["manager_jwt"] ?? managerToken;
    if (!managerToken || !bearer)
      throw new ConnectorError("auth", "The Zid store is not connected yet", { retryable: false });

    const storeId = credentials["store_id"];
    return {
      ...call,
      headers: {
        ...call.headers,
        authorization: `Bearer ${bearer}`,
        "x-manager-token": managerToken,
        role: "Manager",
        ...(storeId ? { "store-id": storeId } : {}),
      },
    };
  },

  /** Zid answers with `{ status: "Error", message: {...} | string, ... }`. */
  mapError: (status, payload) => {
    const body = asRecord(payload);
    const statusField = typeof body["status"] === "string" ? (body["status"] as string).toLowerCase() : null;
    const failed = statusField === "error" || statusField === "failure" || body["success"] === false;
    if (!failed && status < 400) return null;

    const rawMessage = body["message"] ?? body["detail"] ?? body["error"];
    const message =
      typeof rawMessage === "string"
        ? rawMessage
        : rawMessage
          ? JSON.stringify(rawMessage)
          : `Zid request failed (${status})`;
    const code = Number(body["code"] ?? status);

    if (code === 401) return { kind: "auth", message: `Zid rejected the token: ${message}`, retryable: false };
    if (code === 403) return { kind: "forbidden", message: `Zid denied the request: ${message}`, retryable: false };
    if (code === 404) return { kind: "not_found", message, retryable: false };
    if (code === 422 || code === 400) return { kind: "invalid_request", message, retryable: false };
    if (code === 429) return { kind: "rate_limit", message: `Zid rate limit reached: ${message}`, retryable: true };
    if (code >= 500) return { kind: "provider", message, retryable: true };
    return { kind: "invalid_request", message, retryable: false };
  },

  readRateLimit: (headers): RateLimitInfo | undefined => {
    const retryAfter = headers.get("retry-after");
    const remaining = headers.get("x-ratelimit-remaining");
    const limit = headers.get("x-ratelimit-limit");
    if (!retryAfter && !remaining && !limit) return undefined;
    const seconds = Number(retryAfter);
    return {
      ...(retryAfter && Number.isFinite(seconds) ? { retryAfterMs: Math.max(0, seconds) * 1000 } : {}),
      ...(remaining !== null && Number.isFinite(Number(remaining)) ? { remaining: Number(remaining) } : {}),
      ...(limit !== null && Number.isFinite(Number(limit)) ? { limit: Number(limit) } : {}),
    };
  },

  normalize: (operation, payload): NormalizedPage => {
    const spec = OPERATIONS[operation];
    const body = asRecord(payload);
    if (Object.keys(body).length === 0)
      throw new ConnectorError("malformed_response", "Zid returned an empty response body", { retryable: false });

    if (!spec?.list) {
      const single = body["order"] ?? body["product"] ?? body["customer"] ?? body["data"] ?? body;
      return { items: [mapEntity(spec?.entity, single)], cursor: null, raw: payload };
    }

    const items = collectionOf(body, spec.collection ?? ["results", "data"]);
    if (!items)
      throw new ConnectorError("malformed_response", "Zid list response did not contain a collection", {
        retryable: false,
      });

    // Zid paginates by page number and reports either a `next` link or a total
    // count; either one is enough to decide whether another page exists.
    const page = Number(asRecord(body["pagination"])["current_page"] ?? body["current_page"] ?? 1) || 1;
    const total = Number(
      body["count"] ?? body["total_order_count"] ?? body["total_customers_count"] ?? asRecord(body["pagination"])["total"] ?? NaN,
    );
    const hasNextLink = typeof body["next"] === "string" && body["next"].length > 0;
    const hasMore = hasNextLink || (Number.isFinite(total) && items.length > 0 && page * items.length < total);

    return {
      items: items.map((item) => mapEntity(spec.entity, item)),
      cursor: hasMore ? String(page + 1) : null,
      raw: payload,
    };
  },
};
