import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * Telegram Bot API → neutral shapes. Pure functions: no I/O, no business logic.
 * Field names follow the official Bot API objects (Message, Chat, User, File,
 * Update, CallbackQuery, WebhookInfo).
 */

export type TelegramUser = { id: string; isBot: boolean; firstName: string | null; username: string | null; languageCode: string | null };
export type TelegramChat = { id: string; type: string | null; title: string | null; username: string | null };

export type TelegramMessage = {
  id: string;
  messageId: number | null;
  chatId: string | null;
  chat: TelegramChat | null;
  from: TelegramUser | null;
  date: string | null;
  editedAt: string | null;
  threadId: number | null;
  replyToMessageId: number | null;
  kind: string;
  text: string | null;
  caption: string | null;
  fileIds: string[];
  mediaGroupId: string | null;
  hasReplyMarkup: boolean;
};

const MEDIA_KINDS = [
  "photo", "video", "audio", "voice", "document", "animation", "video_note", "sticker",
  "location", "venue", "contact", "poll", "dice",
] as const;

function str(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function iso(seconds: unknown): string | null {
  const n = num(seconds);
  return n === null ? null : new Date(n * 1000).toISOString();
}

export function normalizeTelegramUser(value: unknown): TelegramUser | null {
  const u = asRecord(value);
  const id = str(u["id"]);
  if (!id) return null;
  return {
    id,
    isBot: u["is_bot"] === true,
    firstName: str(u["first_name"]),
    username: str(u["username"]),
    languageCode: str(u["language_code"]),
  };
}

export function normalizeTelegramChat(value: unknown): TelegramChat | null {
  const c = asRecord(value);
  const id = str(c["id"]);
  if (!id) return null;
  return { id, type: str(c["type"]), title: str(c["title"]) ?? str(c["first_name"]), username: str(c["username"]) };
}

function collectFileIds(m: Record<string, unknown>): string[] {
  const ids: string[] = [];
  const photo = m["photo"];
  if (Array.isArray(photo) && photo.length > 0) {
    const largest = asRecord(photo[photo.length - 1])["file_id"];
    if (typeof largest === "string") ids.push(largest);
  }
  for (const key of ["video", "audio", "voice", "document", "animation", "video_note", "sticker"]) {
    const id = asRecord(m[key])["file_id"];
    if (typeof id === "string") ids.push(id);
  }
  return ids;
}

export function normalizeTelegramMessage(value: unknown): TelegramMessage {
  const m = asRecord(value);
  const chat = normalizeTelegramChat(m["chat"]);
  const messageId = num(m["message_id"]);
  const kind = typeof m["text"] === "string" ? "text" : (MEDIA_KINDS.find((k) => m[k] !== undefined) ?? "other");
  return {
    id: chat && messageId !== null ? `${chat.id}:${messageId}` : String(messageId ?? ""),
    messageId,
    chatId: chat?.id ?? null,
    chat,
    from: normalizeTelegramUser(m["from"]),
    date: iso(m["date"]),
    editedAt: iso(m["edit_date"]),
    threadId: num(m["message_thread_id"]),
    replyToMessageId: num(asRecord(m["reply_to_message"])["message_id"]),
    kind,
    text: str(m["text"]),
    caption: str(m["caption"]),
    fileIds: collectFileIds(m),
    mediaGroupId: str(m["media_group_id"]),
    hasReplyMarkup: m["reply_markup"] !== undefined,
  };
}

export function normalizeTelegramFile(value: unknown) {
  const f = asRecord(value);
  // Only the relative `file_path` is exposed; the download URL embeds the bot
  // token and is therefore never produced by the connector.
  return {
    fileId: str(f["file_id"]),
    fileUniqueId: str(f["file_unique_id"]),
    fileSize: num(f["file_size"]),
    filePath: str(f["file_path"]),
  };
}

export function normalizeTelegramWebhookInfo(value: unknown) {
  const w = asRecord(value);
  return {
    url: str(w["url"]) ?? "",
    hasCustomCertificate: w["has_custom_certificate"] === true,
    pendingUpdateCount: num(w["pending_update_count"]) ?? 0,
    lastErrorAt: iso(w["last_error_date"]),
    lastErrorMessage: str(w["last_error_message"]),
    maxConnections: num(w["max_connections"]),
    allowedUpdates: Array.isArray(w["allowed_updates"]) ? w["allowed_updates"].map(String) : [],
  };
}

/** Update keys defined by the Bot API (`Update` object), in documented order. */
export const TELEGRAM_UPDATE_TYPES = [
  "message", "edited_message", "channel_post", "edited_channel_post",
  "business_connection", "business_message", "edited_business_message", "deleted_business_messages",
  "message_reaction", "message_reaction_count", "inline_query", "chosen_inline_result", "callback_query",
  "shipping_query", "pre_checkout_query", "purchased_paid_media", "poll", "poll_answer",
  "my_chat_member", "chat_member", "chat_join_request", "chat_boost", "removed_chat_boost",
] as const;

const EVENT_NAMES: Record<string, string> = {
  message: "message.received",
  edited_message: "message.edited",
  channel_post: "channel_post.received",
  edited_channel_post: "channel_post.edited",
  business_message: "business_message.received",
  edited_business_message: "business_message.edited",
  callback_query: "callback_query",
  message_reaction: "message.reaction",
};

export function telegramUpdateType(update: unknown): string | undefined {
  const u = asRecord(update);
  return TELEGRAM_UPDATE_TYPES.find((key) => u[key] !== undefined);
}

export function telegramEventType(update: unknown): string | undefined {
  const type = telegramUpdateType(update);
  return type ? (EVENT_NAMES[type] ?? type) : undefined;
}

/** Official unix `date` carried by the update's payload, when it has one. */
export function telegramUpdateDateSeconds(update: unknown): number | undefined {
  const u = asRecord(update);
  const type = telegramUpdateType(u);
  if (!type) return undefined;
  const inner = asRecord(u[type]);
  const d = num(inner["edit_date"]) ?? num(inner["date"]) ?? num(asRecord(inner["message"])["date"]);
  return d ?? undefined;
}

export function normalizeTelegramUpdate(value: unknown) {
  const u = asRecord(value);
  const type = telegramUpdateType(u) ?? "unknown";
  const inner = asRecord(u[type]);
  const isMessage = ["message", "edited_message", "channel_post", "edited_channel_post", "business_message", "edited_business_message"].includes(type);
  const callback = type === "callback_query"
    ? {
        id: str(inner["id"]),
        data: str(inner["data"]),
        from: normalizeTelegramUser(inner["from"]),
        message: inner["message"] ? normalizeTelegramMessage(inner["message"]) : null,
      }
    : null;
  return {
    updateId: num(u["update_id"]),
    type,
    event: telegramEventType(u) ?? "unknown",
    message: isMessage ? normalizeTelegramMessage(inner) : null,
    callbackQuery: callback,
    from: normalizeTelegramUser(inner["from"] ?? inner["user"]),
    chatId: normalizeTelegramChat(inner["chat"])?.id ?? callback?.message?.chatId ?? null,
    raw: inner,
  };
}
