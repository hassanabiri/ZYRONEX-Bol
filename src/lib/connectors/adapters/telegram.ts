import {
  normalizeTelegramChat,
  normalizeTelegramFile,
  normalizeTelegramMessage,
  normalizeTelegramUpdate,
  normalizeTelegramUser,
  normalizeTelegramWebhookInfo,
} from "@/lib/connectors/adapters/telegram-map";
import { asRecord, assertRequiredParams, pickInto } from "@/lib/connectors/adapters/shared";
import { ConnectorError, readStandardRateLimit } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, NormalizedPage, RateLimitInfo } from "@/lib/connectors/types";

/**
 * Telegram connector (official Telegram Bot API only — https://core.telegram.org/bots/api).
 *
 * Owns authentication, API calls, normalization and error mapping — nothing
 * else. No AI, business logic, CRM or database access. The bot token lives in
 * the Credential Vault and is injected into the request path by `authorize`
 * only; it never appears in results, logs or error messages.
 */

export const TELEGRAM_API_HOST = "https://api.telegram.org";
/** Replaced in `authorize` with the connection's own bot token. */
const TOKEN_PLACEHOLDER = "telegram-bot-token-placeholder";
const DEFAULT_UPDATES_LIMIT = 100;
const DEFAULT_PHOTOS_LIMIT = 100;

export const CHAT_ACTIONS = [
  "typing", "upload_photo", "record_video", "upload_video", "record_voice", "upload_voice",
  "upload_document", "choose_sticker", "find_location", "record_video_note", "upload_video_note",
] as const;
export const PARSE_MODES = ["HTML", "MarkdownV2", "Markdown"] as const;

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  upload_media_binary:
    "The Bot API accepts new files only as multipart/form-data; the JSON runtime sends media by file_id or public https URL instead.",
  download_file_binary:
    "Downloads use https://api.telegram.org/file/bot<token>/<file_path>, which embeds the bot token; the connector only returns file_path and never builds that URL.",
  read_chat_history:
    "The Bot API has no method to read past chat history; bots only see messages delivered to them as Updates.",
  list_chats: "The Bot API cannot enumerate the chats a bot belongs to; chats are learned from incoming Updates.",
  send_unsolicited_message:
    "Bots cannot message a user who has never started the bot (Telegram returns 403 'bot can't initiate conversation').",
  lookup_user_by_phone: "The Bot API cannot resolve a phone number or username to a user id.",
  edit_message_after_48h:
    "Messages older than 48 hours cannot be edited and messages sent by others in groups cannot be edited by the bot.",
  delete_message_after_48h:
    "Bots may delete messages only within 48 hours of sending (except where admin rights allow otherwise per Bot API rules).",
  user_account_api:
    "Acting as a personal user account needs the MTProto client API, which is not the Bot API and is excluded.",
  idempotency_key:
    "The Bot API publishes no idempotency header; inbound dedupe uses the official update_id and duplicate sends stay guarded by the ZYRONEX runtime.",
};

type Kind = "message" | "messages" | "bool" | "user" | "chat" | "file" | "webhook" | "update" | "raw";

type Spec = {
  method: string;
  kind: Kind;
  required?: string[];
  fields?: string[];
  list?: "updates" | "photos";
};

/** Optional fields shared by every send* method in the Bot API. */
const SEND_COMMON = [
  "chat_id", "message_thread_id", "business_connection_id", "disable_notification", "protect_content",
  "reply_parameters", "reply_markup", "message_effect_id", "allow_paid_broadcast",
];
const CAPTION = ["caption", "parse_mode", "caption_entities", "show_caption_above_media", "has_spoiler"];
const EDIT_TARGET = ["chat_id", "message_id", "inline_message_id", "business_connection_id", "reply_markup"];

const OPERATIONS: Record<string, Spec> = {
  // ---- Bot identity / health -------------------------------------------------
  get_me: { method: "getMe", kind: "user" },
  get_my_commands: { method: "getMyCommands", kind: "raw", fields: ["scope", "language_code"] },
  set_my_commands: { method: "setMyCommands", kind: "bool", required: ["commands"], fields: ["commands", "scope", "language_code"] },
  delete_my_commands: { method: "deleteMyCommands", kind: "bool", fields: ["scope", "language_code"] },
  get_my_name: { method: "getMyName", kind: "raw", fields: ["language_code"] },
  set_my_name: { method: "setMyName", kind: "bool", fields: ["name", "language_code"] },
  get_my_description: { method: "getMyDescription", kind: "raw", fields: ["language_code"] },
  set_my_description: { method: "setMyDescription", kind: "bool", fields: ["description", "language_code"] },
  get_my_short_description: { method: "getMyShortDescription", kind: "raw", fields: ["language_code"] },
  set_my_short_description: { method: "setMyShortDescription", kind: "bool", fields: ["short_description", "language_code"] },

  // ---- Sending ------------------------------------------------------------------
  send_message: {
    method: "sendMessage",
    kind: "message",
    required: ["chat_id", "text"],
    fields: [...SEND_COMMON, "text", "parse_mode", "entities", "link_preview_options"],
  },
  send_reply: {
    method: "sendMessage",
    kind: "message",
    required: ["chat_id", "text", "reply_to_message_id"],
    fields: [...SEND_COMMON, "text", "parse_mode", "entities", "link_preview_options"],
  },
  forward_message: {
    method: "forwardMessage",
    kind: "message",
    required: ["chat_id", "from_chat_id", "message_id"],
    fields: ["chat_id", "message_thread_id", "from_chat_id", "message_id", "disable_notification", "protect_content"],
  },
  copy_message: {
    method: "copyMessage",
    kind: "raw",
    required: ["chat_id", "from_chat_id", "message_id"],
    fields: [...SEND_COMMON, "from_chat_id", "message_id", ...CAPTION],
  },
  send_photo: { method: "sendPhoto", kind: "message", required: ["chat_id", "photo"], fields: [...SEND_COMMON, "photo", ...CAPTION] },
  send_video: {
    method: "sendVideo",
    kind: "message",
    required: ["chat_id", "video"],
    fields: [...SEND_COMMON, "video", "duration", "width", "height", "thumbnail", "supports_streaming", ...CAPTION],
  },
  send_audio: {
    method: "sendAudio",
    kind: "message",
    required: ["chat_id", "audio"],
    fields: [...SEND_COMMON, "audio", "duration", "performer", "title", "thumbnail", ...CAPTION],
  },
  send_voice: { method: "sendVoice", kind: "message", required: ["chat_id", "voice"], fields: [...SEND_COMMON, "voice", "duration", ...CAPTION] },
  send_document: {
    method: "sendDocument",
    kind: "message",
    required: ["chat_id", "document"],
    fields: [...SEND_COMMON, "document", "thumbnail", "disable_content_type_detection", ...CAPTION],
  },
  send_animation: {
    method: "sendAnimation",
    kind: "message",
    required: ["chat_id", "animation"],
    fields: [...SEND_COMMON, "animation", "duration", "width", "height", "thumbnail", ...CAPTION],
  },
  send_video_note: {
    method: "sendVideoNote",
    kind: "message",
    required: ["chat_id", "video_note"],
    fields: [...SEND_COMMON, "video_note", "duration", "length", "thumbnail"],
  },
  send_sticker: { method: "sendSticker", kind: "message", required: ["chat_id", "sticker"], fields: [...SEND_COMMON, "sticker", "emoji"] },
  send_media_group: { method: "sendMediaGroup", kind: "messages", required: ["chat_id", "media"], fields: [...SEND_COMMON, "media"] },
  send_location: {
    method: "sendLocation",
    kind: "message",
    required: ["chat_id", "latitude", "longitude"],
    fields: [...SEND_COMMON, "latitude", "longitude", "horizontal_accuracy", "live_period", "heading", "proximity_alert_radius"],
  },
  send_venue: {
    method: "sendVenue",
    kind: "message",
    required: ["chat_id", "latitude", "longitude", "title", "address"],
    fields: [...SEND_COMMON, "latitude", "longitude", "title", "address", "foursquare_id", "google_place_id"],
  },
  send_contact: {
    method: "sendContact",
    kind: "message",
    required: ["chat_id", "phone_number", "first_name"],
    fields: [...SEND_COMMON, "phone_number", "first_name", "last_name", "vcard"],
  },
  send_poll: {
    method: "sendPoll",
    kind: "message",
    required: ["chat_id", "question", "options"],
    fields: [...SEND_COMMON, "question", "options", "is_anonymous", "type", "allows_multiple_answers", "correct_option_id", "explanation", "open_period"],
  },
  send_dice: { method: "sendDice", kind: "message", required: ["chat_id"], fields: [...SEND_COMMON, "emoji"] },
  send_chat_action: {
    method: "sendChatAction",
    kind: "bool",
    required: ["chat_id", "action"],
    fields: ["chat_id", "message_thread_id", "business_connection_id", "action"],
  },

  // ---- Editing / deleting (official limits apply) --------------------------------
  edit_message_text: { method: "editMessageText", kind: "raw", required: ["text"], fields: [...EDIT_TARGET, "text", "parse_mode", "entities", "link_preview_options"] },
  edit_message_caption: { method: "editMessageCaption", kind: "raw", fields: [...EDIT_TARGET, "caption", "parse_mode", "caption_entities", "show_caption_above_media"] },
  edit_message_media: { method: "editMessageMedia", kind: "raw", required: ["media"], fields: [...EDIT_TARGET, "media"] },
  edit_message_reply_markup: { method: "editMessageReplyMarkup", kind: "raw", fields: EDIT_TARGET },
  delete_message: { method: "deleteMessage", kind: "bool", required: ["chat_id", "message_id"], fields: ["chat_id", "message_id"] },
  delete_messages: { method: "deleteMessages", kind: "bool", required: ["chat_id", "message_ids"], fields: ["chat_id", "message_ids"] },
  set_message_reaction: {
    method: "setMessageReaction",
    kind: "bool",
    required: ["chat_id", "message_id"],
    fields: ["chat_id", "message_id", "reaction", "is_big"],
  },
  pin_chat_message: { method: "pinChatMessage", kind: "bool", required: ["chat_id", "message_id"], fields: ["chat_id", "message_id", "disable_notification", "business_connection_id"] },
  unpin_chat_message: { method: "unpinChatMessage", kind: "bool", required: ["chat_id"], fields: ["chat_id", "message_id", "business_connection_id"] },

  // ---- Callback queries (inline keyboards) -----------------------------------------
  answer_callback_query: {
    method: "answerCallbackQuery",
    kind: "bool",
    required: ["callback_query_id"],
    fields: ["callback_query_id", "text", "show_alert", "url", "cache_time"],
  },

  // ---- Files -------------------------------------------------------------------------
  get_file: { method: "getFile", kind: "file", required: ["file_id"], fields: ["file_id"] },
  get_user_profile_photos: { method: "getUserProfilePhotos", kind: "raw", required: ["user_id"], fields: ["user_id"], list: "photos" },

  // ---- Chats / contacts -------------------------------------------------------------
  get_chat: { method: "getChat", kind: "chat", required: ["chat_id"], fields: ["chat_id"] },
  get_chat_member: { method: "getChatMember", kind: "raw", required: ["chat_id", "user_id"], fields: ["chat_id", "user_id"] },
  get_chat_member_count: { method: "getChatMemberCount", kind: "raw", required: ["chat_id"], fields: ["chat_id"] },

  // ---- Updates / webhook management ---------------------------------------------------
  get_updates: { method: "getUpdates", kind: "update", fields: ["allowed_updates"], list: "updates" },
  set_webhook: {
    method: "setWebhook",
    kind: "bool",
    required: ["url"],
    fields: ["url", "ip_address", "max_connections", "allowed_updates", "drop_pending_updates", "secret_token"],
  },
  get_webhook_info: { method: "getWebhookInfo", kind: "webhook" },
  delete_webhook: { method: "deleteWebhook", kind: "bool", fields: ["drop_pending_updates"] },
};

function invalid(message: string): never {
  throw new ConnectorError("invalid_request", message, { retryable: false });
}

/** Official chat ids: signed integers or `@channelusername`. */
function assertChatId(value: unknown, label = "chat_id") {
  const raw = String(value ?? "").trim();
  if (!/^(-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/.test(raw)) invalid(`\`${label}\` is not a valid Telegram chat id`);
}

/** Media inputs: an existing file_id or a public https URL (no multipart). */
function assertInputFile(value: unknown, label: string) {
  if (typeof value !== "string" || value.trim() === "") invalid(`\`${label}\` must be a file_id or an https URL`);
  if (/^attach:\/\//i.test(value)) invalid(`\`${label}\` multipart attach:// uploads are not supported`);
  if (/^[a-z]+:\/\//i.test(value) && !/^https:\/\//i.test(value)) invalid(`\`${label}\` URL must use https`);
}

/** Inline / reply keyboards follow the official ReplyMarkup object shapes. */
function assertReplyMarkup(value: unknown) {
  if (value === undefined) return;
  const markup = asRecord(value);
  const rows = markup["inline_keyboard"] ?? markup["keyboard"];
  if (rows !== undefined) {
    if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row))) invalid("`reply_markup` keyboard must be an array of button rows");
    if (markup["inline_keyboard"])
      for (const row of rows as unknown[][])
        for (const button of row) {
          const b = asRecord(button);
          if (typeof b["text"] !== "string") invalid("Every inline keyboard button needs `text`");
          const data = b["callback_data"];
          if (typeof data === "string" && new TextEncoder().encode(data).length > 64)
            invalid("`callback_data` must be at most 64 bytes");
        }
    return;
  }
  if (markup["remove_keyboard"] === true || markup["force_reply"] === true) return;
  invalid("`reply_markup` must be inline_keyboard, keyboard, remove_keyboard or force_reply");
}

const MEDIA_FIELDS = ["photo", "video", "audio", "voice", "document", "animation", "video_note", "sticker"];

export const telegramConnector: ConnectorAdapter = {
  id: "telegram",
  label: "Telegram",
  capabilities: ["read", "write", "messaging", "files", "pagination", "webhook", "health_check"],
  credentials: {
    kind: "custom",
    // The vault canonicalizes `bot_token` → `access_token`.
    required: ["access_token"],
    optional: ["bot_token", "webhook_secret_token"],
  },
  operations: Object.keys(OPERATIONS),
  healthOperation: "get_me",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation];
    if (!spec) throw new ConnectorError("unsupported", `Unknown Telegram operation "${operation}"`, { retryable: false });
    assertRequiredParams(operation, params, spec.required);

    const body: Record<string, unknown> = pickInto(params, spec.fields);
    if (body["chat_id"] !== undefined) assertChatId(body["chat_id"]);
    if (body["from_chat_id"] !== undefined) assertChatId(body["from_chat_id"], "from_chat_id");
    if (body["parse_mode"] !== undefined && !(PARSE_MODES as readonly string[]).includes(String(body["parse_mode"])))
      invalid(`\`parse_mode\` must be one of ${PARSE_MODES.join(", ")}`);
    for (const key of MEDIA_FIELDS) if (body[key] !== undefined) assertInputFile(body[key], key);
    assertReplyMarkup(body["reply_markup"]);

    if (operation === "send_reply") {
      const replyTo = Number(params["reply_to_message_id"]);
      if (!Number.isInteger(replyTo) || replyTo <= 0) invalid("`reply_to_message_id` must be a positive integer");
      body["reply_parameters"] = { ...asRecord(params["reply_parameters"]), message_id: replyTo };
    }
    if (operation === "send_chat_action" && !(CHAT_ACTIONS as readonly string[]).includes(String(body["action"])))
      invalid(`\`action\` must be one of ${CHAT_ACTIONS.join(", ")}`);
    if (operation === "send_media_group") {
      const media = body["media"];
      if (!Array.isArray(media) || media.length < 2 || media.length > 10) invalid("`media` must contain 2–10 items");
      for (const item of media as unknown[]) assertInputFile(asRecord(item)["media"], "media[].media");
    }
    if (operation.startsWith("edit_message_") && body["inline_message_id"] === undefined && (body["chat_id"] === undefined || body["message_id"] === undefined))
      invalid("`chat_id` + `message_id` or `inline_message_id` is required");
    if (operation === "delete_messages") {
      const ids = body["message_ids"];
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) invalid("`message_ids` must contain 1–100 ids");
    }
    if (operation === "set_webhook") {
      if (typeof body["url"] !== "string" || !/^https:\/\//.test(body["url"])) invalid("`url` must be an https URL");
      const secret = body["secret_token"];
      if (secret !== undefined && (typeof secret !== "string" || !/^[A-Za-z0-9_-]{1,256}$/.test(secret)))
        invalid("`secret_token` must be 1–256 characters of A-Z, a-z, 0-9, _ or -");
    }
    if (spec.list === "updates") {
      body["limit"] = Math.min(100, Math.max(1, Number(params["limit"] ?? DEFAULT_UPDATES_LIMIT)));
      body["timeout"] = 0; // Short polling only: long polls would outlive the runtime timeout.
      const offset = cursor ?? params["offset"];
      if (offset !== undefined && offset !== null) body["offset"] = Number(offset);
    }
    if (spec.list === "photos") {
      body["limit"] = Math.min(100, Math.max(1, Number(params["limit"] ?? DEFAULT_PHOTOS_LIMIT)));
      const offset = cursor ?? params["offset"];
      if (offset !== undefined && offset !== null) body["offset"] = Number(offset);
    }

    return {
      method: "POST",
      url: `${TELEGRAM_API_HOST}/bot${TOKEN_PLACEHOLDER}/${spec.method}`,
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
      paginated: Boolean(spec.list),
    };
  },

  authorize: (call, credentials) => {
    const token = (credentials["access_token"] ?? credentials["bot_token"] ?? "").trim();
    if (!token) throw new ConnectorError("auth", "The Telegram bot is not connected yet", { retryable: false });
    if (!/^[0-9]{3,20}:[A-Za-z0-9_-]{20,}$/.test(token))
      throw new ConnectorError("auth", "The Telegram bot token format is invalid", { retryable: false });
    return { ...call, url: call.url.replace(TOKEN_PLACEHOLDER, token) };
  },

  /** Bot API envelope: `{ ok:false, error_code, description, parameters }`. */
  mapError: (status, payload) => {
    const body = asRecord(payload);
    if (body["ok"] !== false && status < 400) return null;
    const code = Number(body["error_code"] ?? status);
    const description = typeof body["description"] === "string" ? body["description"] : `HTTP ${status}`;
    const message = `Telegram error ${code}: ${description}`;
    if (code === 401) return { kind: "auth", message, retryable: false };
    if (code === 403) return { kind: "forbidden", message, retryable: false };
    if (code === 404) return { kind: "not_found", message, retryable: false };
    if (code === 429) return { kind: "rate_limit", message, retryable: true };
    if (code === 409) return { kind: "invalid_request", message, retryable: false };
    if (code >= 500) return { kind: "provider", message, retryable: true };
    if (code >= 400) return { kind: "invalid_request", message, retryable: false };
    return { kind: "provider", message, retryable: false };
  },

  /** Flood control arrives as `parameters.retry_after` (seconds). */
  readRateLimit: (headers, payload): RateLimitInfo | undefined => {
    const retryAfter = Number(asRecord(asRecord(payload)["parameters"])["retry_after"]);
    if (Number.isFinite(retryAfter) && retryAfter > 0) return { retryAfterMs: retryAfter * 1000 };
    return readStandardRateLimit(headers);
  },

  normalize: (operation, payload, _status, context): NormalizedPage => {
    const spec = OPERATIONS[operation];
    const body = asRecord(payload);
    if (body["ok"] !== true || !("result" in body))
      throw new ConnectorError("malformed_response", "Telegram returned an unexpected envelope", { retryable: false });
    const result = body["result"];

    if (spec?.list === "updates") {
      if (!Array.isArray(result)) throw new ConnectorError("malformed_response", "getUpdates did not return a list", { retryable: false });
      const items = result.map((u) => normalizeTelegramUpdate(u) as unknown as Record<string, unknown>);
      const limit = Number(asRecord(context?.call.body)["limit"] ?? DEFAULT_UPDATES_LIMIT);
      const ids = result.map((u) => Number(asRecord(u)["update_id"])).filter(Number.isFinite);
      // Official offset semantics: next offset = highest update_id + 1.
      const cursor = ids.length >= limit && ids.length > 0 ? String(Math.max(...ids) + 1) : null;
      return { items, cursor, raw: payload };
    }
    if (spec?.list === "photos") {
      const r = asRecord(result);
      const photos = Array.isArray(r["photos"]) ? r["photos"] : null;
      if (!photos) throw new ConnectorError("malformed_response", "getUserProfilePhotos returned no photos list", { retryable: false });
      const offset = Number(asRecord(context?.call.body)["offset"] ?? 0);
      const next = offset + photos.length;
      const total = Number(r["total_count"] ?? 0);
      const items = photos.map((sizes) => ({ sizes: (Array.isArray(sizes) ? sizes : []).map(normalizeTelegramFile) }));
      return { items, cursor: photos.length > 0 && next < total ? String(next) : null, raw: payload };
    }

    let item: Record<string, unknown>;
    switch (spec?.kind) {
      case "message":
        item = normalizeTelegramMessage(result) as unknown as Record<string, unknown>;
        break;
      case "messages":
        if (!Array.isArray(result)) throw new ConnectorError("malformed_response", "Expected a list of messages", { retryable: false });
        return { items: result.map((m) => normalizeTelegramMessage(m) as unknown as Record<string, unknown>), cursor: null, raw: payload };
      case "user":
        item = (normalizeTelegramUser(result) ?? {}) as Record<string, unknown>;
        break;
      case "chat":
        item = { ...(normalizeTelegramChat(result) ?? {}), raw: result };
        break;
      case "file":
        item = normalizeTelegramFile(result);
        break;
      case "webhook":
        item = normalizeTelegramWebhookInfo(result);
        break;
      case "bool":
        item = { ok: result === true };
        break;
      default:
        item = typeof result === "object" && result !== null && !Array.isArray(result)
          ? (result as Record<string, unknown>)
          : { result };
    }
    return { items: [item], cursor: null, raw: payload };
  },
};
