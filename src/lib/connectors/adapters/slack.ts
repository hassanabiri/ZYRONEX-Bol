import {
  normalizeSlackChannel,
  normalizeSlackFile,
  normalizeSlackMessage,
  normalizeSlackTeam,
  normalizeSlackUser,
} from "@/lib/connectors/adapters/slack-map";
import { asRecord, assertRequiredParams, pickInto } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Slack connector (official Slack Web API only — https://api.slack.com/methods).
 *
 * Owns authentication, API calls, normalization, pagination and error mapping —
 * nothing else. No AI, business logic, CRM or database access. The OAuth token
 * lives in the Credential Vault and is injected by `authorize` only.
 *
 * Slack signals failures inside a 200 body (`ok:false`), uses cursor pagination
 * (`response_metadata.next_cursor`) and `Retry-After` on HTTP 429.
 */

export const SLACK_API_BASE = "https://slack.com/api";
const DEFAULT_LIMIT = 100;

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  upload_file_binary:
    "Slack uploads need files.getUploadURLExternal, a binary POST to the returned URL, then files.completeUploadExternal; the JSON runtime cannot send file bytes.",
  download_file_binary:
    "url_private downloads return file bytes and require the bearer token; the connector returns metadata and permalinks only.",
  files_upload_legacy: "files.upload is retired by Slack; the external upload flow replaces it.",
  idempotency_key:
    "The Web API publishes no idempotency header; duplicate sends stay guarded by the ZYRONEX runtime and inbound events dedupe on event_id.",
  edit_others_messages: "chat.update / chat.delete only affect messages the token's identity posted (Slack returns cant_update_message).",
  add_reaction_as_other_user: "Reactions are always added as the token owner.",
  search_messages_with_bot_token:
    "search.messages requires a user token; the connector runs on the connection's bot token and does not expose search.",
  read_private_channels_without_membership:
    "Bots can read only conversations they are a member of (not_in_channel); there is no bypass.",
  slash_commands_and_interactivity_responses:
    "Slash commands and interactive payloads must be answered in the HTTP response within 3 seconds; the shared ingress returns a fixed acknowledgement.",
  url_verification_challenge_echo:
    "The Events API url_verification handshake expects the challenge echoed in the response body; the shared ingress acknowledges without echoing it.",
};

type Kind = "message" | "messages" | "channel" | "channels" | "user" | "users" | "team" | "file" | "raw" | "items";

type Spec = {
  method: string;
  verb: "GET" | "POST";
  kind: Kind;
  required?: string[];
  fields?: string[];
  /** Response key that holds the page of items. */
  collection?: string;
};

const MSG_FIELDS = [
  "channel", "text", "blocks", "attachments", "thread_ts", "reply_broadcast", "mrkdwn", "parse", "link_names",
  "unfurl_links", "unfurl_media", "metadata", "username", "icon_emoji", "icon_url",
];

const OPERATIONS: Record<string, Spec> = {
  // ---- Identity / workspace --------------------------------------------------
  auth_test: { method: "auth.test", verb: "POST", kind: "raw" },
  team_info: { method: "team.info", verb: "GET", kind: "team", fields: ["team"] },
  bot_info: { method: "bots.info", verb: "GET", kind: "raw", fields: ["bot", "team_id"] },
  list_users: { method: "users.list", verb: "GET", kind: "users", collection: "members", fields: ["team_id", "include_locale"] },
  get_user: { method: "users.info", verb: "GET", kind: "user", required: ["user"], fields: ["user", "include_locale"] },
  lookup_user_by_email: { method: "users.lookupByEmail", verb: "GET", kind: "user", required: ["email"], fields: ["email"] },

  // ---- Conversations ---------------------------------------------------------
  list_channels: {
    method: "conversations.list", verb: "GET", kind: "channels", collection: "channels",
    fields: ["types", "exclude_archived", "team_id"],
  },
  get_conversation: {
    method: "conversations.info", verb: "GET", kind: "channel", required: ["channel"],
    fields: ["channel", "include_num_members", "include_locale"],
  },
  list_members: { method: "conversations.members", verb: "GET", kind: "items", collection: "members", required: ["channel"], fields: ["channel"] },
  create_channel: { method: "conversations.create", verb: "POST", kind: "channel", required: ["name"], fields: ["name", "is_private", "team_id"] },
  archive_channel: { method: "conversations.archive", verb: "POST", kind: "raw", required: ["channel"], fields: ["channel"] },
  unarchive_channel: { method: "conversations.unarchive", verb: "POST", kind: "raw", required: ["channel"], fields: ["channel"] },
  rename_channel: { method: "conversations.rename", verb: "POST", kind: "channel", required: ["channel", "name"], fields: ["channel", "name"] },
  set_topic: { method: "conversations.setTopic", verb: "POST", kind: "channel", required: ["channel", "topic"], fields: ["channel", "topic"] },
  set_purpose: { method: "conversations.setPurpose", verb: "POST", kind: "channel", required: ["channel", "purpose"], fields: ["channel", "purpose"] },
  join_channel: { method: "conversations.join", verb: "POST", kind: "channel", required: ["channel"], fields: ["channel"] },
  invite_members: { method: "conversations.invite", verb: "POST", kind: "channel", required: ["channel", "users"], fields: ["channel", "users", "force"] },
  remove_member: { method: "conversations.kick", verb: "POST", kind: "raw", required: ["channel", "user"], fields: ["channel", "user"] },
  open_conversation: { method: "conversations.open", verb: "POST", kind: "channel", fields: ["users", "channel", "return_im"] },

  // ---- Messages --------------------------------------------------------------
  post_message: { method: "chat.postMessage", verb: "POST", kind: "message", required: ["channel", "text"], fields: MSG_FIELDS },
  reply_message: { method: "chat.postMessage", verb: "POST", kind: "message", required: ["channel", "text", "thread_ts"], fields: MSG_FIELDS },
  post_ephemeral: {
    method: "chat.postEphemeral", verb: "POST", kind: "raw", required: ["channel", "user", "text"],
    fields: ["channel", "user", "text", "blocks", "attachments", "thread_ts"],
  },
  update_message: {
    method: "chat.update", verb: "POST", kind: "message", required: ["channel", "ts"],
    fields: ["channel", "ts", "text", "blocks", "attachments", "metadata", "reply_broadcast", "file_ids"],
  },
  delete_message: { method: "chat.delete", verb: "POST", kind: "raw", required: ["channel", "ts"], fields: ["channel", "ts"] },
  schedule_message: {
    method: "chat.scheduleMessage", verb: "POST", kind: "raw", required: ["channel", "text", "post_at"],
    fields: [...MSG_FIELDS, "post_at"],
  },
  list_scheduled_messages: {
    method: "chat.scheduledMessages.list", verb: "GET", kind: "items", collection: "scheduled_messages",
    fields: ["channel", "latest", "oldest", "team_id"],
  },
  delete_scheduled_message: {
    method: "chat.deleteScheduledMessage", verb: "POST", kind: "raw", required: ["channel", "scheduled_message_id"],
    fields: ["channel", "scheduled_message_id"],
  },
  get_permalink: { method: "chat.getPermalink", verb: "GET", kind: "raw", required: ["channel", "message_ts"], fields: ["channel", "message_ts"] },
  list_messages: {
    method: "conversations.history", verb: "GET", kind: "messages", collection: "messages",
    fields: ["channel", "latest", "oldest", "inclusive", "include_all_metadata"],
  },
  list_replies: {
    method: "conversations.replies", verb: "GET", kind: "messages", collection: "messages", required: ["channel", "ts"],
    fields: ["channel", "ts", "latest", "oldest", "inclusive"],
  },

  // ---- Reactions -------------------------------------------------------------
  add_reaction: { method: "reactions.add", verb: "POST", kind: "raw", required: ["channel", "timestamp", "name"], fields: ["channel", "timestamp", "name"] },
  remove_reaction: { method: "reactions.remove", verb: "POST", kind: "raw", required: ["name"], fields: ["channel", "timestamp", "name", "file"] },
  get_reactions: { method: "reactions.get", verb: "GET", kind: "message", required: ["channel", "timestamp"], fields: ["channel", "timestamp", "full"] },
  list_reactions: { method: "reactions.list", verb: "GET", kind: "items", collection: "items", fields: ["user", "full", "team_id"] },

  // ---- Files (metadata only) -------------------------------------------------
  get_file: { method: "files.info", verb: "GET", kind: "file", required: ["file"], fields: ["file"] },
  delete_file: { method: "files.delete", verb: "POST", kind: "raw", required: ["file"], fields: ["file"] },
};

/** `get_message` = conversations.history with latest=ts, inclusive, limit 1 (Slack's documented pattern). */
const GET_MESSAGE = "get_message";

export const SLACK_OPERATIONS = [...Object.keys(OPERATIONS), GET_MESSAGE];

const PAGINATED = new Set(Object.entries(OPERATIONS).filter(([, s]) => s.collection).map(([k]) => k));

function toQuery(values: Record<string, unknown>): Record<string, string | number | boolean | undefined> {
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === "object" ? JSON.stringify(v) : (v as string | number | boolean);
  }
  return out;
}

const AUTH_CODES = ["invalid_auth", "not_authed", "token_revoked", "account_inactive", "token_expired", "no_permission_token"];
const FORBIDDEN_CODES = [
  "missing_scope", "not_allowed_token_type", "not_in_channel", "restricted_action", "cant_update_message",
  "cant_delete_message", "cant_invite_self", "cant_kick_self", "ekm_access_denied", "access_denied", "is_archived",
  "channel_is_archived", "team_access_not_granted", "method_deprecated",
];
const NOT_FOUND_CODES = [
  "channel_not_found", "user_not_found", "users_not_found", "message_not_found", "thread_not_found", "file_not_found",
  "file_deleted", "bot_not_found", "team_not_found", "no_item_specified", "invalid_scheduled_message_id",
];
const TRANSIENT_CODES = ["internal_error", "fatal_error", "service_unavailable", "request_timeout"];

export const slackConnector: ConnectorAdapter = {
  id: "slack",
  label: "Slack",
  capabilities: ["read", "write", "messaging", "pagination", "search", "files", "webhook", "health_check"],
  credentials: { kind: "bearer", required: ["access_token"] },
  operations: SLACK_OPERATIONS,
  healthOperation: "auth_test",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    if (operation === GET_MESSAGE) {
      assertRequiredParams(operation, params, ["channel", "ts"]);
      return {
        method: "GET",
        url: `${SLACK_API_BASE}/conversations.history`,
        headers: { accept: "application/json" },
        query: { channel: String(params["channel"]), latest: String(params["ts"]), inclusive: true, limit: 1 },
      };
    }

    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Slack operation "${operation}"`, { retryable: false });
    assertRequiredParams(operation, params, spec.required);
    const picked = pickInto(params, spec.fields);
    const url = `${SLACK_API_BASE}/${spec.method}`;

    if (spec.verb === "POST") {
      return {
        method: "POST",
        url,
        headers: { "content-type": "application/json; charset=utf-8", accept: "application/json" },
        ...(Object.keys(picked).length ? { body: picked } : {}),
      };
    }

    const paginated = PAGINATED.has(operation);
    const query = toQuery({
      ...picked,
      ...(paginated ? { limit: Math.min(Math.max(Number(params["limit"] ?? DEFAULT_LIMIT), 1), 1000) } : {}),
      ...(paginated && cursor ? { cursor } : {}),
    });
    return { method: "GET", url, headers: { accept: "application/json" }, query, ...(paginated ? { paginated: true } : {}) };
  },

  authorize: (call, credentials) => {
    const token = (credentials["access_token"] ?? "").trim();
    if (!token) throw new ConnectorError("auth", "The Slack workspace is not connected yet", { retryable: false });
    return { ...call, headers: { ...call.headers, authorization: `Bearer ${token}` } };
  },

  /** Slack signals errors in a 200 body — mapped here, not in the runtime. */
  mapError: (_status, payload) => {
    const body = asRecord(payload);
    if (body["ok"] !== false) return null;
    const code = String(body["error"] ?? "unknown_error");
    if (AUTH_CODES.includes(code)) return { kind: "auth", message: `Slack rejected the token (${code})`, retryable: false };
    if (code === "missing_scope" || code === "not_allowed_token_type")
      return { kind: "forbidden", message: `Slack scope missing (${code})`, retryable: false };
    if (FORBIDDEN_CODES.includes(code)) return { kind: "forbidden", message: `Slack refused the action (${code})`, retryable: false };
    if (code === "ratelimited" || code === "rate_limited") return { kind: "rate_limit", message: "Slack rate limit reached", retryable: true };
    if (NOT_FOUND_CODES.includes(code)) return { kind: "not_found", message: `Slack resource not found (${code})`, retryable: false };
    if (TRANSIENT_CODES.includes(code)) return { kind: "provider", message: `Slack is temporarily unavailable (${code})`, retryable: true };
    return { kind: "invalid_request", message: `Slack error: ${code}`, retryable: false };
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

    if (operation === GET_MESSAGE) {
      const list = Array.isArray(body["messages"]) ? (body["messages"] as unknown[]) : [];
      return { items: list.slice(0, 1).map((m) => normalizeSlackMessage(m)), cursor: null, raw: payload };
    }

    const spec = OPERATIONS[operation];
    const channel = typeof body["channel"] === "string" ? body["channel"] : null;

    if (spec?.collection) {
      const list = body[spec.collection];
      if (!Array.isArray(list))
        throw new ConnectorError("malformed_response", `Slack response is missing "${spec.collection}"`, { retryable: false });
      const map =
        spec.kind === "channels" ? normalizeSlackChannel
        : spec.kind === "users" ? normalizeSlackUser
        : spec.kind === "messages" ? (m: unknown) => normalizeSlackMessage(m)
        : (x: unknown) => (typeof x === "string" ? { id: x } : asRecord(x));
      const next = asRecord(body["response_metadata"])["next_cursor"];
      return { items: list.map(map), cursor: typeof next === "string" && next.length > 0 ? next : null, raw: payload };
    }

    let item: Record<string, unknown>;
    switch (spec?.kind) {
      case "message":
        item = normalizeSlackMessage(body["message"] ?? body, channel);
        if (!item["ts"] && typeof body["ts"] === "string") item = { ...item, id: body["ts"], ts: body["ts"] };
        break;
      case "channel":
        item = body["channel"] && typeof body["channel"] === "object" ? normalizeSlackChannel(body["channel"]) : { ...body };
        break;
      case "user":
        item = normalizeSlackUser(body["user"]);
        break;
      case "team":
        item = normalizeSlackTeam(body["team"]);
        break;
      case "file":
        item = normalizeSlackFile(body["file"]);
        break;
      default:
        item = body;
    }
    return { items: [item], cursor: null, raw: payload };
  },
};
