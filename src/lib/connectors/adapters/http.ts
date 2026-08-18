import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage } from "@/lib/connectors/types";

/**
 * Generic HTTP/REST connector.
 *
 * Reference adapter #1: proves the contract works for any provider that does
 * not (yet) have a dedicated adapter. Auth style is chosen from the stored
 * credentials — bearer, api key header, or basic — and nothing else is
 * provider-specific.
 */

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Reads a value at a dotted path, used for configurable list/cursor fields. */
function pick(payload: unknown, path?: string): unknown {
  if (!path) return payload;
  return path.split(".").reduce<unknown>((acc, key) => asRecord(acc)[key], payload);
}

export const httpConnector: ConnectorAdapter = {
  id: "http",
  label: "HTTP / REST",
  capabilities: ["read", "write", "pagination", "health_check"],
  credentials: { kind: "custom", required: [], optional: ["bearer_token", "api_key", "api_key_header", "username", "password"] },
  operations: ["request", "health"],
  healthOperation: "health",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const url = String(params["url"] ?? params["health_url"] ?? "");
    if (!url) throw new ConnectorError("invalid_request", "`url` is required", { retryable: false });
    if (!/^https:\/\//i.test(url))
      throw new ConnectorError("invalid_request", "Only https:// URLs are allowed", { retryable: false });

    const method = String(params["method"] ?? (operation === "health" ? "GET" : "GET")).toUpperCase() as HttpMethod;
    if (!METHODS.includes(method))
      throw new ConnectorError("invalid_request", `Unsupported method ${method}`, { retryable: false });

    const query = { ...(asRecord(params["query"]) as Record<string, string>) };
    const cursorParam = String(params["cursor_param"] ?? "cursor");
    if (cursor) query[cursorParam] = cursor;

    const headers: Record<string, string> = {
      accept: "application/json",
      ...(asRecord(params["headers"]) as Record<string, string>),
    };
    const body = params["body"];
    if (body !== undefined && method !== "GET") headers["content-type"] = headers["content-type"] ?? "application/json";

    return {
      method,
      url,
      headers,
      query,
      ...(body === undefined || method === "GET" ? {} : { body }),
      paginated: Boolean(params["items_path"] && params["cursor_path"]),
    };
  },

  authorize: (call, credentials) => {
    const headers = { ...call.headers };
    if (credentials["bearer_token"]) headers["authorization"] = `Bearer ${credentials["bearer_token"]}`;
    else if (credentials["api_key"])
      headers[String(credentials["api_key_header"] ?? "x-api-key").toLowerCase()] = credentials["api_key"];
    else if (credentials["username"] && credentials["password"])
      headers["authorization"] = `Basic ${btoa(`${credentials["username"]}:${credentials["password"]}`)}`;
    return { ...call, headers };
  },

  normalize: (_operation, payload): NormalizedPage => {
    if (Array.isArray(payload)) return { items: payload.map(asRecord), raw: payload };
    const record = asRecord(payload);
    const candidate = record["data"] ?? record["items"] ?? record["results"];
    if (Array.isArray(candidate)) {
      const cursor = record["next_cursor"] ?? record["nextCursor"] ?? record["next"] ?? null;
      return { items: candidate.map(asRecord), cursor: typeof cursor === "string" ? cursor : null, raw: payload };
    }
    return { items: payload === null ? [] : [record], cursor: null, raw: payload };
  },
};

export const __httpInternal = { pick };
