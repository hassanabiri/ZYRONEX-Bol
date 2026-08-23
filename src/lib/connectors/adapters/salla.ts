import { ConnectorError } from "@/lib/connectors/errors";
import { normalizeCustomer, normalizeOrder, normalizeProduct } from "@/lib/connectors/adapters/salla-map";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Salla connector — first production commerce adapter.
 *
 * Official Salla Merchant API only (`https://api.salla.dev/admin/v2`) with the
 * official OAuth2 app flow and official webhooks. The adapter owns exactly four
 * concerns: API communication, credential injection, mapping/normalization and
 * error handling. No business logic, no AI, no CRM decisions live here — those
 * stay in the ZYRONEX runtime and workflow layers.
 */

const BASE = "https://api.salla.dev/admin/v2";

type Spec = {
  method: HttpMethod;
  /** `:id` placeholders are filled from params. */
  path: string;
  /** Which mapper to apply to each returned record. */
  entity?: "order" | "product" | "customer";
  /** Collection endpoints follow Salla's `page` pagination. */
  list?: boolean;
  required?: string[];
  /** Params copied verbatim into the query string. */
  query?: string[];
  /** Params copied verbatim into the JSON body (empty = pass `body` through). */
  body?: string[];
};

const OPERATIONS: Record<string, Spec> = {
  // Orders
  list_orders: {
    method: "GET",
    path: "/orders",
    entity: "order",
    list: true,
    query: ["status", "from_date", "to_date", "per_page", "expanded"],
  },
  get_order: { method: "GET", path: "/orders/:id", entity: "order", required: ["id"] },
  update_order_status: {
    method: "POST",
    path: "/orders/:id/status",
    required: ["id", "status"],
    body: ["status", "slug", "note", "notify"],
  },
  list_order_items: { method: "GET", path: "/orders/:id/items", list: true, required: ["id"] },
  // Products
  list_products: {
    method: "GET",
    path: "/products",
    entity: "product",
    list: true,
    query: ["keyword", "category", "status", "per_page"],
  },
  get_product: { method: "GET", path: "/products/:id", entity: "product", required: ["id"] },
  create_product: { method: "POST", path: "/products", entity: "product", required: ["name"], body: [] },
  update_product: { method: "PUT", path: "/products/:id", entity: "product", required: ["id"], body: [] },
  update_product_quantity: {
    method: "PUT",
    path: "/products/:id/quantity",
    required: ["id", "quantity"],
    body: ["quantity"],
  },
  // Customers
  list_customers: { method: "GET", path: "/customers", entity: "customer", list: true, query: ["keyword", "per_page"] },
  get_customer: { method: "GET", path: "/customers/:id", entity: "customer", required: ["id"] },
  create_customer: { method: "POST", path: "/customers", entity: "customer", required: ["first_name"], body: [] },
  update_customer: { method: "PUT", path: "/customers/:id", entity: "customer", required: ["id"], body: [] },
  // Webhooks
  list_webhooks: { method: "GET", path: "/webhooks", list: true },
  create_webhook: {
    method: "POST",
    path: "/webhooks/subscribe",
    required: ["name", "event", "url"],
    body: ["name", "event", "url", "version", "rule", "headers", "security_strategy", "secret"],
  },
  delete_webhook: { method: "DELETE", path: "/webhooks/unsubscribe/:id", required: ["id"] },
  // Store identity / health
  store_info: { method: "GET", path: "/oauth2/user/info" },
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
  if (entity === "order") return normalizeOrder(value) as unknown as Record<string, unknown>;
  if (entity === "product") return normalizeProduct(value) as unknown as Record<string, unknown>;
  if (entity === "customer") return (normalizeCustomer(value) ?? {}) as unknown as Record<string, unknown>;
  return asRecord(value);
}

export const sallaConnector: ConnectorAdapter = {
  id: "salla",
  label: "Salla",
  capabilities: ["read", "write", "search", "pagination", "webhook", "health_check"],
  credentials: { kind: "oauth2", required: ["access_token"], optional: ["refresh_token"] },
  operations: Object.keys(OPERATIONS),
  healthOperation: "store_info",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Salla operation "${operation}"`, { retryable: false });

    for (const key of spec.required ?? [])
      if (params[key] === undefined || params[key] === null || params[key] === "")
        throw new ConnectorError("invalid_request", `\`${key}\` is required for ${operation}`, { retryable: false });

    const path = spec.path.replace(/:([a-z_]+)/g, (_match, key: string) => encodeURIComponent(String(params[key])));

    const query: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(pickInto(params, spec.query))) query[key] = value as string | number;
    if (spec.list) {
      const page = Number(cursor ?? 1);
      if (page > 1) query["page"] = page;
      if (query["per_page"] === undefined && params["limit"] !== undefined) query["per_page"] = Number(params["limit"]);
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

  authorize: (call, credentials) => {
    const token = credentials["access_token"];
    if (!token)
      throw new ConnectorError("auth", "The Salla store is not connected yet", { retryable: false });
    return { ...call, headers: { ...call.headers, authorization: `Bearer ${token}` } };
  },

  /** Salla answers with `{ success, status, error: { code, message, fields } }`. */
  mapError: (status, payload) => {
    const body = asRecord(payload);
    const error = asRecord(body["error"]);
    const hasError = body["success"] === false || Object.keys(error).length > 0;
    if (!hasError && status < 400) return null;

    const message = String(error["message"] ?? body["message"] ?? `Salla request failed (${status})`);
    const code = Number(body["status"] ?? status);
    if (code === 401) return { kind: "auth", message: `Salla rejected the token: ${message}`, retryable: false };
    if (code === 403) return { kind: "forbidden", message: `Salla denied the request: ${message}`, retryable: false };
    if (code === 404) return { kind: "not_found", message, retryable: false };
    if (code === 422) return { kind: "invalid_request", message, retryable: false };
    if (code === 429) return { kind: "rate_limit", message: `Salla rate limit reached: ${message}`, retryable: true };
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
      ...(Number.isFinite(seconds) && retryAfter ? { retryAfterMs: Math.max(0, seconds) * 1000 } : {}),
      ...(remaining !== null && Number.isFinite(Number(remaining)) ? { remaining: Number(remaining) } : {}),
      ...(limit !== null && Number.isFinite(Number(limit)) ? { limit: Number(limit) } : {}),
    };
  },

  normalize: (operation, payload): NormalizedPage => {
    const spec = OPERATIONS[operation];
    const body = asRecord(payload);
    if (body["data"] === undefined)
      throw new ConnectorError("malformed_response", "Salla response is missing `data`", { retryable: false });

    const data = body["data"];
    if (!Array.isArray(data)) return { items: [mapEntity(spec?.entity, data)], cursor: null, raw: payload };

    const pagination = asRecord(body["pagination"]);
    const current = Number(pagination["currentPage"] ?? 1);
    const total = Number(pagination["totalPages"] ?? 1);
    const cursor = Number.isFinite(current) && Number.isFinite(total) && current < total ? String(current + 1) : null;

    return { items: data.map((item) => mapEntity(spec?.entity, item)), cursor, raw: payload };
  },
};
