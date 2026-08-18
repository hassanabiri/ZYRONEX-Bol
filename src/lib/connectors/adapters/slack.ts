import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Slack connector.
 *
 * Reference adapter #2: proves the contract handles a provider that returns
 * failures inside a 200 body (`ok:false`), uses cursor pagination and its own
 * rate-limit semantics (`Retry-After`). No Slack logic exists anywhere else.
 */

const BASE = "https://slack.com/api";

const OPERATIONS = {
  post_message: { method: "POST" as const, path: "/chat.postMessage", collection: null },
  list_channels: { method: "GET" as const, path: "/conversations.list", collection: "channels" },
  list_messages: { method: "GET" as const, path: "/conversations.history", collection: "messages" },
  list_users: { method: "GET" as const, path: "/users.list", collection: "members" },
  auth_test: { method: "POST" as const, path: "/auth.test", collection: null },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export const slackConnector: ConnectorAdapter = {
  id: "slack",
  label: "Slack",
  capabilities: ["read", "write", "messaging", "pagination", "search", "health_check"],
  credentials: { kind: "bearer", required: ["access_token"] },
  operations: Object.keys(OPERATIONS),
  healthOperation: "auth_test",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation as keyof typeof OPERATIONS];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Slack operation "${operation}"`, { retryable: false });

    if (operation === "post_message") {
      const channel = params["channel"];
      const text = params["text"];
      if (!channel || !text)
        throw new ConnectorError("invalid_request", "`channel` and `text` are required", { retryable: false });
      return {
        method: "POST",
        url: `${BASE}${spec.path}`,
        headers: { "content-type": "application/json; charset=utf-8", accept: "application/json" },
        body: { channel, text, ...(params["thread_ts"] ? { thread_ts: params["thread_ts"] } : {}) },
      };
    }

    if (operation === "auth_test")
      return { method: "POST", url: `${BASE}${spec.path}`, headers: { accept: "application/json" } };

    const query: Record<string, string | number | undefined> = {
      limit: Number(params["limit"] ?? 100),
      ...(params["channel"] ? { channel: String(params["channel"]) } : {}),
      ...(cursor ? { cursor } : {}),
    };
    return { method: spec.method, url: `${BASE}${spec.path}`, headers: { accept: "application/json" }, query, paginated: true };
  },

  authorize: (call, credentials) => ({
    ...call,
    headers: { ...call.headers, authorization: `Bearer ${credentials["access_token"]}` },
  }),

  /** Slack signals errors in a 200 body — mapped here, not in the runtime. */
  mapError: (_status, payload) => {
    const body = asRecord(payload);
    if (body["ok"] === false) {
      const code = String(body["error"] ?? "unknown_error");
      if (["invalid_auth", "not_authed", "token_revoked", "account_inactive"].includes(code))
        return { kind: "auth", message: `Slack rejected the token (${code})`, retryable: false };
      if (code === "missing_scope" || code === "not_allowed_token_type")
        return { kind: "forbidden", message: `Slack scope missing (${code})`, retryable: false };
      if (code === "ratelimited") return { kind: "rate_limit", message: "Slack rate limit reached", retryable: true };
      if (["channel_not_found", "user_not_found"].includes(code))
        return { kind: "not_found", message: `Slack resource not found (${code})`, retryable: false };
      return { kind: "invalid_request", message: `Slack error: ${code}`, retryable: false };
    }
    return null;
  },

  readRateLimit: (headers): RateLimitInfo | undefined => {
    const retryAfter = headers.get("retry-after");
    if (!retryAfter) return undefined;
    const seconds = Number(retryAfter);
    return Number.isFinite(seconds) ? { retryAfterMs: Math.max(0, seconds) * 1000, remaining: 0 } : undefined;
  },

  normalize: (operation, payload): NormalizedPage => {
    const body = asRecord(payload);
    if (body["ok"] === undefined)
      throw new ConnectorError("malformed_response", "Slack response is missing the `ok` field", { retryable: false });

    const spec = OPERATIONS[operation as keyof typeof OPERATIONS];
    const collection = spec?.collection;
    if (!collection) return { items: [body], cursor: null, raw: payload };

    const list = body[collection];
    if (!Array.isArray(list))
      throw new ConnectorError("malformed_response", `Slack response is missing "${collection}"`, { retryable: false });

    const cursor = asRecord(body["response_metadata"])["next_cursor"];
    return {
      items: list.map(asRecord),
      cursor: typeof cursor === "string" && cursor.length > 0 ? cursor : null,
      raw: payload,
    };
  },
};
