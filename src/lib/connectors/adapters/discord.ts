import {
  normalizeDiscordChannel,
  normalizeDiscordGuild,
  normalizeDiscordMessage,
  normalizeDiscordUser,
} from "@/lib/connectors/adapters/discord-map";
import { asRecord, assertRequiredParams, pickInto } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Discord connector (official Discord HTTP API v10 only —
 * https://discord.com/developers/docs/reference).
 *
 * Owns authentication, API calls, normalization, error and rate-limit mapping
 * only. No AI, CRM or business logic. The bot token lives in the Credential
 * Vault and is injected as `Authorization: Bot <token>` by `authorize`; it is
 * never returned, logged or echoed in errors.
 *
 * Inbound events arrive through the unified Webhook Engine (Interactions
 * endpoint + Webhook Events, Ed25519-signed). The Gateway WebSocket is not
 * used: it needs a persistent connection the serverless runtime does not
 * provide (see UNSUPPORTED_OPERATIONS / roadmap technical debt).
 */

export const DISCORD_API_BASE = "https://discord.com/api/v10";
const SNOWFLAKE = /^\d{17,20}$/;
const MAX_CONTENT = 2000;
const MAX_EMBEDS = 10;
const MAX_NONCE = 25;

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  gateway_events:
    "Real-time events such as MESSAGE_CREATE are delivered only over the Gateway WebSocket, which requires a persistent connection; the serverless runtime cannot hold one. Inbound events are limited to the Interactions endpoint and Webhook Events.",
  upload_attachment_binary:
    "New files require multipart/form-data (`files[n]`); the JSON runtime sends media by public URL inside embeds or by referencing existing attachments.",
  read_dm_history_of_users:
    "Bots cannot read a user's private DMs with other users; only channels the bot can access are readable.",
  read_message_content_without_intent:
    "Message content in guilds the bot is not mentioned in is empty unless the privileged MESSAGE_CONTENT intent is approved for the application.",
  list_all_guild_channels_messages:
    "There is no endpoint to search or bulk-read all messages of a guild; history is read per channel with before/after pagination.",
  bulk_delete_older_than_14_days:
    "Bulk delete rejects messages older than 14 days; they must be deleted one by one.",
  edit_others_messages: "Bots can edit only messages they authored.",
  user_account_automation: "Automating a user account (self-bot) violates Discord's terms; only bot tokens are supported.",
  interaction_sync_response:
    "Synchronous HTTP replies to interactions (PONG / type 4 in the response body) require the ingress to return a provider-specific body; the connector replies through the official interaction callback endpoint instead.",
  idempotency_header:
    "Discord has no idempotency header; message creation uses the official `nonce` + `enforce_nonce` fields instead.",
};

type Kind = "user" | "application" | "guild" | "guilds" | "channel" | "channels" | "message" | "messages" | "users" | "threads" | "members" | "empty" | "raw";

type Spec = {
  method: HttpMethod;
  path: (p: Record<string, unknown>) => string;
  kind: Kind;
  required?: string[];
  /** JSON body fields (allowlist). */
  body?: string[];
  /** Query fields (allowlist). */
  query?: string[];
  list?: { max: number; def: number; cursor: "after" | "before" | "archive" };
  /** Interaction webhook endpoints authenticate by the interaction token in the path. */
  noAuth?: boolean;
};

const id = (p: Record<string, unknown>, key: string) => {
  const value = String(p[key] ?? "");
  if (!SNOWFLAKE.test(value)) invalid(`\`${key}\` must be a Discord snowflake id`);
  return value;
};
const emoji = (p: Record<string, unknown>) => {
  const value = String(p["emoji"] ?? "").trim();
  // Unicode emoji or custom `name:id` — both URL-encoded per the docs.
  if (!value || (value.includes(":") && !/^[\w~-]{1,32}:\d{17,20}$/.test(value))) invalid("`emoji` must be a unicode emoji or name:id");
  return encodeURIComponent(value);
};
const interactionToken = (p: Record<string, unknown>) => {
  const value = String(p["interaction_token"] ?? "");
  if (!/^[A-Za-z0-9._-]{20,500}$/.test(value)) invalid("`interaction_token` is invalid");
  return value;
};

const MESSAGE_BODY = ["content", "embeds", "allowed_mentions", "components", "sticker_ids", "flags", "attachments", "tts", "poll"];

const OPERATIONS: Record<string, Spec> = {
  // ---- Identity / health --------------------------------------------------------
  get_current_user: { method: "GET", path: () => "/users/@me", kind: "user" },
  get_current_application: { method: "GET", path: () => "/applications/@me", kind: "application" },
  get_gateway_bot: { method: "GET", path: () => "/gateway/bot", kind: "raw" },

  // ---- Guilds -------------------------------------------------------------------
  list_guilds: {
    method: "GET", path: () => "/users/@me/guilds", kind: "guilds", query: ["with_counts"],
    list: { max: 200, def: 200, cursor: "after" },
  },
  get_guild: { method: "GET", path: (p) => `/guilds/${id(p, "guild_id")}`, kind: "guild", required: ["guild_id"], query: ["with_counts"] },
  list_guild_channels: { method: "GET", path: (p) => `/guilds/${id(p, "guild_id")}/channels`, kind: "channels", required: ["guild_id"] },
  list_guild_members: {
    method: "GET", path: (p) => `/guilds/${id(p, "guild_id")}/members`, kind: "members", required: ["guild_id"],
    list: { max: 1000, def: 100, cursor: "after" },
  },
  list_active_threads: { method: "GET", path: (p) => `/guilds/${id(p, "guild_id")}/threads/active`, kind: "threads", required: ["guild_id"] },

  // ---- Channels -----------------------------------------------------------------
  get_channel: { method: "GET", path: (p) => `/channels/${id(p, "channel_id")}`, kind: "channel", required: ["channel_id"] },
  trigger_typing: { method: "POST", path: (p) => `/channels/${id(p, "channel_id")}/typing`, kind: "empty", required: ["channel_id"] },
  create_dm: { method: "POST", path: () => "/users/@me/channels", kind: "channel", required: ["recipient_id"], body: ["recipient_id"] },

  // ---- Messages -----------------------------------------------------------------
  list_messages: {
    method: "GET", path: (p) => `/channels/${id(p, "channel_id")}/messages`, kind: "messages", required: ["channel_id"],
    list: { max: 100, def: 50, cursor: "before" },
  },
  get_message: {
    method: "GET", path: (p) => `/channels/${id(p, "channel_id")}/messages/${id(p, "message_id")}`, kind: "message",
    required: ["channel_id", "message_id"],
  },
  send_message: { method: "POST", path: (p) => `/channels/${id(p, "channel_id")}/messages`, kind: "message", required: ["channel_id"], body: MESSAGE_BODY },
  send_reply: {
    method: "POST", path: (p) => `/channels/${id(p, "channel_id")}/messages`, kind: "message",
    required: ["channel_id", "reply_to_message_id"], body: MESSAGE_BODY,
  },
  edit_message: {
    method: "PATCH", path: (p) => `/channels/${id(p, "channel_id")}/messages/${id(p, "message_id")}`, kind: "message",
    required: ["channel_id", "message_id"], body: ["content", "embeds", "allowed_mentions", "components", "flags", "attachments"],
  },
  delete_message: {
    method: "DELETE", path: (p) => `/channels/${id(p, "channel_id")}/messages/${id(p, "message_id")}`, kind: "empty",
    required: ["channel_id", "message_id"],
  },
  bulk_delete_messages: {
    method: "POST", path: (p) => `/channels/${id(p, "channel_id")}/messages/bulk-delete`, kind: "empty",
    required: ["channel_id", "messages"], body: ["messages"],
  },
  list_pinned_messages: { method: "GET", path: (p) => `/channels/${id(p, "channel_id")}/pins`, kind: "messages", required: ["channel_id"] },
  pin_message: {
    method: "PUT", path: (p) => `/channels/${id(p, "channel_id")}/pins/${id(p, "message_id")}`, kind: "empty", required: ["channel_id", "message_id"],
  },
  unpin_message: {
    method: "DELETE", path: (p) => `/channels/${id(p, "channel_id")}/pins/${id(p, "message_id")}`, kind: "empty", required: ["channel_id", "message_id"],
  },

  // ---- Reactions ----------------------------------------------------------------
  add_reaction: {
    method: "PUT", path: (p) => `/channels/${id(p, "channel_id")}/messages/${id(p, "message_id")}/reactions/${emoji(p)}/@me`, kind: "empty",
    required: ["channel_id", "message_id", "emoji"],
  },
  remove_own_reaction: {
    method: "DELETE", path: (p) => `/channels/${id(p, "channel_id")}/messages/${id(p, "message_id")}/reactions/${emoji(p)}/@me`, kind: "empty",
    required: ["channel_id", "message_id", "emoji"],
  },
  list_reactions: {
    method: "GET", path: (p) => `/channels/${id(p, "channel_id")}/messages/${id(p, "message_id")}/reactions/${emoji(p)}`, kind: "users",
    required: ["channel_id", "message_id", "emoji"], query: ["type"], list: { max: 100, def: 25, cursor: "after" },
  },

  // ---- Threads ------------------------------------------------------------------
  start_thread_from_message: {
    method: "POST", path: (p) => `/channels/${id(p, "channel_id")}/messages/${id(p, "message_id")}/threads`, kind: "channel",
    required: ["channel_id", "message_id", "name"], body: ["name", "auto_archive_duration", "rate_limit_per_user"],
  },
  start_thread: {
    method: "POST", path: (p) => `/channels/${id(p, "channel_id")}/threads`, kind: "channel",
    required: ["channel_id", "name"], body: ["name", "auto_archive_duration", "type", "invitable", "rate_limit_per_user"],
  },
  join_thread: { method: "PUT", path: (p) => `/channels/${id(p, "thread_id")}/thread-members/@me`, kind: "empty", required: ["thread_id"] },
  leave_thread: { method: "DELETE", path: (p) => `/channels/${id(p, "thread_id")}/thread-members/@me`, kind: "empty", required: ["thread_id"] },
  list_public_archived_threads: {
    method: "GET", path: (p) => `/channels/${id(p, "channel_id")}/threads/archived/public`, kind: "threads", required: ["channel_id"],
    list: { max: 100, def: 50, cursor: "archive" },
  },

  // ---- Interaction replies (official callback / webhook endpoints) -------------
  create_interaction_response: {
    method: "POST", path: (p) => `/interactions/${id(p, "interaction_id")}/${interactionToken(p)}/callback`, kind: "empty",
    required: ["interaction_id", "interaction_token", "type"], body: ["type", "data"], noAuth: true,
  },
  edit_original_interaction_response: {
    method: "PATCH", path: (p) => `/webhooks/${id(p, "application_id")}/${interactionToken(p)}/messages/@original`, kind: "message",
    required: ["application_id", "interaction_token"], body: ["content", "embeds", "allowed_mentions", "components", "attachments"], noAuth: true,
  },
  create_followup_message: {
    method: "POST", path: (p) => `/webhooks/${id(p, "application_id")}/${interactionToken(p)}`, kind: "message",
    required: ["application_id", "interaction_token"], body: ["content", "embeds", "allowed_mentions", "components", "flags", "tts"], noAuth: true,
  },
};

function invalid(message: string): never {
  throw new ConnectorError("invalid_request", message, { retryable: false });
}

const INTERACTION_CALLBACK_TYPES = [1, 4, 5, 6, 7, 8, 9, 10, 12];

function assertEmbeds(value: unknown) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > MAX_EMBEDS) invalid(`\`embeds\` must be an array of at most ${MAX_EMBEDS} embeds`);
  let total = 0;
  for (const embed of value as unknown[]) {
    const e = asRecord(embed);
    if (typeof e["title"] === "string") {
      if (e["title"].length > 256) invalid("Embed `title` is limited to 256 characters");
      total += e["title"].length;
    }
    if (typeof e["description"] === "string") {
      if (e["description"].length > 4096) invalid("Embed `description` is limited to 4096 characters");
      total += e["description"].length;
    }
    if (Array.isArray(e["fields"]) && e["fields"].length > 25) invalid("An embed may have at most 25 fields");
    for (const key of ["image", "thumbnail"]) {
      const url = asRecord(e[key])["url"];
      if (url !== undefined && (typeof url !== "string" || !/^(https:\/\/|attachment:\/\/)/.test(url)))
        invalid(`Embed \`${key}.url\` must be https:// or attachment://`);
    }
  }
  if (total > 6000) invalid("Embeds are limited to 6000 characters in total");
}

function assertMessageBody(operation: string, body: Record<string, unknown>) {
  const content = body["content"];
  if (content !== undefined && (typeof content !== "string" || content.length > MAX_CONTENT))
    invalid(`\`content\` must be a string of at most ${MAX_CONTENT} characters`);
  assertEmbeds(body["embeds"]);
  const creates = operation === "send_message" || operation === "send_reply" || operation === "create_followup_message";
  if (creates) {
    const hasPayload =
      (typeof content === "string" && content.length > 0) ||
      (Array.isArray(body["embeds"]) && body["embeds"].length > 0) ||
      Array.isArray(body["sticker_ids"]) ||
      Array.isArray(body["components"]) ||
      body["poll"] !== undefined;
    if (!hasPayload) invalid("A message needs `content`, `embeds`, `sticker_ids`, `components` or `poll`");
  }
  if (Array.isArray(body["attachments"]))
    for (const a of body["attachments"] as unknown[])
      if (!SNOWFLAKE.test(String(asRecord(a)["id"] ?? "")))
        invalid("`attachments` may only reference existing attachment ids (binary upload is unsupported)");
}

/** Reads Discord rate-limit headers and the 429 body `retry_after` (seconds). */
function readDiscordRateLimit(headers: Headers, payload: unknown): RateLimitInfo | undefined {
  const info: RateLimitInfo = {};
  const bodyRetry = Number(asRecord(payload)["retry_after"]);
  const headerRetry = Number(headers.get("retry-after"));
  const resetAfter = Number(headers.get("x-ratelimit-reset-after"));
  const limit = headers.get("x-ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (limit !== null && Number.isFinite(Number(limit))) info.limit = Number(limit);
  if (remaining !== null && Number.isFinite(Number(remaining))) info.remaining = Number(remaining);
  if (reset) {
    const seconds = Number(reset);
    info.resetAt = Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : reset;
  }
  if (Number.isFinite(bodyRetry) && bodyRetry > 0) info.retryAfterMs = Math.ceil(bodyRetry * 1000);
  else if (headers.get("retry-after") !== null && Number.isFinite(headerRetry)) info.retryAfterMs = Math.ceil(headerRetry * 1000);
  else if (info.remaining === 0 && Number.isFinite(resetAfter)) info.retryAfterMs = Math.ceil(resetAfter * 1000);
  return Object.keys(info).length > 0 ? info : undefined;
}

export const discordConnector: ConnectorAdapter = {
  id: "discord",
  label: "Discord",
  capabilities: ["read", "write", "messaging", "files", "pagination", "webhook", "health_check"],
  credentials: {
    kind: "bearer",
    // The vault canonicalizes `bot_token` → `access_token`.
    required: ["access_token"],
    optional: ["bot_token", "application_id", "public_key"],
  },
  operations: Object.keys(OPERATIONS),
  healthOperation: "get_current_user",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation];
    if (!spec) {
      const reason = UNSUPPORTED_OPERATIONS[operation];
      throw new ConnectorError("unsupported", reason ? `UNSUPPORTED_OPERATION: ${reason}` : `Unknown Discord operation "${operation}"`, {
        retryable: false,
      });
    }
    assertRequiredParams(operation, params, spec.required);

    const path = spec.path(params);
    const body: Record<string, unknown> = pickInto(params, spec.body);
    const query: Record<string, string | number | boolean | undefined> = {};
    for (const [k, v] of Object.entries(pickInto(params, spec.query))) query[k] = v as string | number | boolean;

    if (spec.body === MESSAGE_BODY || operation === "edit_message" || operation === "create_followup_message" || operation === "edit_original_interaction_response")
      assertMessageBody(operation, body);

    if (operation === "send_reply") {
      const replyTo = String(params["reply_to_message_id"]);
      if (!SNOWFLAKE.test(replyTo)) invalid("`reply_to_message_id` must be a Discord snowflake id");
      body["message_reference"] = {
        message_id: replyTo,
        channel_id: String(params["channel_id"]),
        fail_if_not_exists: params["fail_if_not_exists"] !== false,
      };
    }
    // Official create-message idempotency: `nonce` + `enforce_nonce`.
    if (operation === "send_message" || operation === "send_reply") {
      const key = params["idempotency_key"] ?? params["nonce"];
      if (key !== undefined) {
        const nonce = String(key);
        if (nonce.length === 0 || nonce.length > MAX_NONCE) invalid(`\`nonce\` must be 1–${MAX_NONCE} characters`);
        body["nonce"] = nonce;
        body["enforce_nonce"] = true;
      }
    }
    if (operation === "bulk_delete_messages") {
      const ids = body["messages"];
      if (!Array.isArray(ids) || ids.length < 2 || ids.length > 100 || ids.some((m) => !SNOWFLAKE.test(String(m))))
        invalid("`messages` must contain 2–100 message ids");
    }
    if (operation === "create_dm" && !SNOWFLAKE.test(String(body["recipient_id"]))) invalid("`recipient_id` must be a Discord snowflake id");
    if (operation.startsWith("start_thread")) {
      const name = body["name"];
      if (typeof name !== "string" || name.length < 1 || name.length > 100) invalid("Thread `name` must be 1–100 characters");
      const archive = body["auto_archive_duration"];
      if (archive !== undefined && ![60, 1440, 4320, 10080].includes(Number(archive)))
        invalid("`auto_archive_duration` must be 60, 1440, 4320 or 10080");
    }
    if (operation === "create_interaction_response" && !INTERACTION_CALLBACK_TYPES.includes(Number(body["type"])))
      invalid("`type` must be an official interaction callback type");

    if (spec.list) {
      query["limit"] = Math.min(spec.list.max, Math.max(1, Number(params["limit"] ?? spec.list.def)));
      const position = cursor ?? (params[spec.list.cursor === "archive" ? "before" : spec.list.cursor] as string | undefined);
      if (position !== undefined && position !== null && position !== "") {
        if (spec.list.cursor === "archive") query["before"] = String(position);
        else {
          if (!SNOWFLAKE.test(String(position))) invalid(`\`${spec.list.cursor}\` must be a Discord snowflake id`);
          query[spec.list.cursor] = String(position);
        }
      }
    }

    const hasBody = spec.method !== "GET" && spec.method !== "DELETE" && Object.keys(body).length > 0;
    return {
      method: spec.method,
      url: `${DISCORD_API_BASE}${path}`,
      headers: {
        accept: "application/json",
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...(spec.noAuth ? { "x-zyronex-no-auth": "1" } : {}),
      },
      ...(Object.keys(query).length > 0 ? { query } : {}),
      ...(hasBody ? { body } : {}),
      paginated: Boolean(spec.list),
    };
  },

  authorize: (call, credentials) => {
    const headers = { ...call.headers };
    // Interaction endpoints authenticate by the interaction token in the path.
    if (headers["x-zyronex-no-auth"]) {
      delete headers["x-zyronex-no-auth"];
      return { ...call, headers };
    }
    const token = (credentials["access_token"] ?? credentials["bot_token"] ?? "").trim();
    if (!token) throw new ConnectorError("auth", "The Discord bot is not connected yet", { retryable: false });
    if (!/^[\w-]{10,}\.[\w-]{4,}\.[\w-]{20,}$/.test(token))
      throw new ConnectorError("auth", "The Discord bot token format is invalid", { retryable: false });
    return { ...call, headers: { ...headers, authorization: `Bot ${token}` } };
  },

  /** Discord error body: `{ code, message, errors? }` (JSON error codes). */
  mapError: (status, payload) => {
    if (status < 400) return null;
    const body = asRecord(payload);
    const code = Number(body["code"] ?? 0);
    const text = typeof body["message"] === "string" ? body["message"] : `HTTP ${status}`;
    const message = `Discord error ${code || status}: ${text}`;
    if (status === 401) return { kind: "auth", message, retryable: false };
    if (status === 403) return { kind: "forbidden", message, retryable: false };
    if (status === 404) return { kind: "not_found", message, retryable: false };
    if (status === 429) return { kind: "rate_limit", message, retryable: true };
    if (status >= 500) return { kind: "provider", message, retryable: true };
    return { kind: "invalid_request", message, retryable: false };
  },

  readRateLimit: readDiscordRateLimit,

  normalize: (operation, payload, status, context): NormalizedPage => {
    const spec = OPERATIONS[operation];
    if (spec?.kind === "empty") return { items: [{ ok: status >= 200 && status < 300 }], cursor: null, raw: payload };
    if (payload === null || typeof payload !== "object")
      throw new ConnectorError("malformed_response", "Discord returned an unexpected payload", { retryable: false });

    const limit = Number(asRecord(context?.call.query)["limit"] ?? spec?.list?.def ?? 0);
    const list = (value: unknown, what: string): unknown[] => {
      if (!Array.isArray(value)) throw new ConnectorError("malformed_response", `Expected a list of ${what}`, { retryable: false });
      return value;
    };
    const lastId = (rows: unknown[], pick: (r: Record<string, unknown>) => unknown = (r) => r["id"]) =>
      spec?.list && rows.length >= limit && rows.length > 0 ? String(pick(asRecord(rows[rows.length - 1]))) : null;

    switch (spec?.kind) {
      case "user":
        return { items: [(normalizeDiscordUser(payload) ?? {}) as Record<string, unknown>], cursor: null, raw: payload };
      case "application": {
        const a = asRecord(payload);
        return {
          items: [{ id: a["id"] ?? null, name: a["name"] ?? null, verifyKey: a["verify_key"] ?? null, botPublic: a["bot_public"] === true, bot: normalizeDiscordUser(a["bot"]) }],
          cursor: null,
          raw: payload,
        };
      }
      case "guild":
        return { items: [normalizeDiscordGuild(payload)], cursor: null, raw: payload };
      case "guilds": {
        const rows = list(payload, "guilds");
        return { items: rows.map(normalizeDiscordGuild), cursor: lastId(rows), raw: payload };
      }
      case "channel":
        return { items: [normalizeDiscordChannel(payload)], cursor: null, raw: payload };
      case "channels":
        return { items: list(payload, "channels").map(normalizeDiscordChannel), cursor: null, raw: payload };
      case "message":
        return { items: [normalizeDiscordMessage(payload) as unknown as Record<string, unknown>], cursor: null, raw: payload };
      case "messages": {
        // Newest first: the next page is `before` the oldest (last) id.
        const rows = list(payload, "messages");
        return { items: rows.map((m) => normalizeDiscordMessage(m) as unknown as Record<string, unknown>), cursor: lastId(rows), raw: payload };
      }
      case "users": {
        const rows = list(payload, "users");
        return { items: rows.map((u) => (normalizeDiscordUser(u) ?? {}) as Record<string, unknown>), cursor: lastId(rows), raw: payload };
      }
      case "members": {
        const rows = list(payload, "members");
        return {
          items: rows.map((m) => {
            const r = asRecord(m);
            return { user: normalizeDiscordUser(r["user"]), nick: r["nick"] ?? null, roles: Array.isArray(r["roles"]) ? r["roles"] : [], joinedAt: r["joined_at"] ?? null };
          }),
          cursor: lastId(rows, (r) => asRecord(r["user"])["id"]),
          raw: payload,
        };
      }
      case "threads": {
        const body = asRecord(payload);
        const rows = list(body["threads"], "threads");
        const items = rows.map(normalizeDiscordChannel);
        const last = items[items.length - 1];
        const cursor = spec.list && body["has_more"] === true && last?.["archiveTimestamp"] ? String(last["archiveTimestamp"]) : null;
        return { items, cursor, raw: payload };
      }
      default:
        return { items: [payload as Record<string, unknown>], cursor: null, raw: payload };
    }
  },
};
