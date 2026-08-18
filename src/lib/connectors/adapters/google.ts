import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, NormalizedPage } from "@/lib/connectors/types";

/**
 * Google connector (Drive, Gmail, Calendar read surface).
 *
 * Reference adapter #3: proves the contract handles Google's `pageToken`
 * pagination and its `{ error: { code, message, status } }` envelope. The full
 * OAuth dance is a later phase — this adapter consumes whatever access token
 * the credential vault already holds.
 */

const OPERATIONS = {
  list_files: {
    method: "GET" as const,
    url: "https://www.googleapis.com/drive/v3/files",
    collection: "files",
  },
  list_messages: {
    method: "GET" as const,
    url: "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    collection: "messages",
  },
  list_events: {
    method: "GET" as const,
    url: "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    collection: "items",
  },
  user_info: {
    method: "GET" as const,
    url: "https://www.googleapis.com/oauth2/v3/userinfo",
    collection: null,
  },
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export const googleConnector: ConnectorAdapter = {
  id: "google",
  label: "Google",
  capabilities: ["read", "files", "calendar", "pagination", "search", "health_check"],
  credentials: { kind: "oauth2", required: ["access_token"], optional: ["refresh_token", "client_id", "client_secret"] },
  operations: Object.keys(OPERATIONS),
  healthOperation: "user_info",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation as keyof typeof OPERATIONS];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Google operation "${operation}"`, { retryable: false });

    const query: Record<string, string | number | undefined> = {};
    if (spec.collection) {
      query["pageSize"] = Number(params["limit"] ?? 50);
      if (operation === "list_messages") {
        delete query["pageSize"];
        query["maxResults"] = Number(params["limit"] ?? 50);
      }
      if (params["query"]) query[operation === "list_files" ? "q" : "q"] = String(params["query"]);
      if (cursor) query["pageToken"] = cursor;
    }

    return {
      method: spec.method,
      url: spec.url,
      headers: { accept: "application/json" },
      query,
      paginated: Boolean(spec.collection),
    };
  },

  authorize: (call, credentials) => ({
    ...call,
    headers: { ...call.headers, authorization: `Bearer ${credentials["access_token"]}` },
  }),

  mapError: (status, payload) => {
    const error = asRecord(asRecord(payload)["error"]);
    if (!error["code"] && !error["message"]) return null;
    const message = String(error["message"] ?? "Google request failed");
    const code = Number(error["code"] ?? status);
    if (code === 401) return { kind: "auth", message: `Google token rejected: ${message}`, retryable: false };
    if (code === 403) {
      const reason = String(error["status"] ?? "");
      if (reason === "RESOURCE_EXHAUSTED" || /rate limit|quota/i.test(message))
        return { kind: "rate_limit", message: `Google quota exceeded: ${message}`, retryable: true };
      return { kind: "forbidden", message: `Google denied the request: ${message}`, retryable: false };
    }
    if (code === 404) return { kind: "not_found", message, retryable: false };
    if (code === 429) return { kind: "rate_limit", message, retryable: true };
    if (code >= 500) return { kind: "provider", message, retryable: true };
    return { kind: "invalid_request", message, retryable: false };
  },

  normalize: (operation, payload): NormalizedPage => {
    const spec = OPERATIONS[operation as keyof typeof OPERATIONS];
    const body = asRecord(payload);
    if (!spec?.collection) return { items: [body], cursor: null, raw: payload };

    const list = body[spec.collection];
    if (list !== undefined && !Array.isArray(list))
      throw new ConnectorError("malformed_response", `Google response field "${spec.collection}" is not a list`, {
        retryable: false,
      });

    const token = body["nextPageToken"];
    return {
      items: Array.isArray(list) ? list.map(asRecord) : [],
      cursor: typeof token === "string" && token.length > 0 ? token : null,
      raw: payload,
    };
  },
};
