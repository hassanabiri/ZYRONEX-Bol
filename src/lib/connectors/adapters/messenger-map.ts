/**
 * Messenger (Meta Messenger Platform) → ZYRONEX normalization.
 *
 * Pure mapping only. No business logic, AI or CRM decisions — official
 * Messenger payloads become neutral shapes the rest of ZYRONEX consumes.
 */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Webhooks use epoch milliseconds; Graph objects use ISO strings. */
function timestamp(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return new Date(raw.length <= 10 ? numeric * 1000 : numeric).toISOString();
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}

export type NormalizedMessengerAttachment = { type: string | null; url: string | null; attachment_id: string | null };

function attachments(value: unknown): NormalizedMessengerAttachment[] {
  const list = Array.isArray(value) ? value : array(record(value)["data"]);
  return list.map((item) => {
    const a = record(item);
    const payload = record(a["payload"]);
    return {
      type: str(a["type"]) ?? str(a["mime_type"]),
      url: str(payload["url"]) ?? str(a["file_url"]) ?? str(record(a["image_data"])["url"]),
      attachment_id: str(payload["attachment_id"]) ?? str(a["id"]),
    };
  });
}

export type NormalizedMessengerMessage = {
  object: "message";
  source: "messenger";
  id: string | null;
  conversation_id: string | null;
  from_id: string | null;
  to_ids: string[];
  text: string | null;
  attachments: NormalizedMessengerAttachment[];
  reply_to_id: string | null;
  created_at: string | null;
};

export function normalizeMessengerMessage(input: unknown): NormalizedMessengerMessage {
  const m = record(input);
  return {
    object: "message",
    source: "messenger",
    id: str(m["id"]) ?? str(m["mid"]),
    conversation_id: str(m["conversation_id"]),
    from_id: str(record(m["from"])["id"]),
    to_ids: array(record(m["to"])["data"]).map((t) => str(record(t)["id"])).filter((v): v is string => v !== null),
    text: str(m["message"]) ?? str(m["text"]),
    attachments: attachments(m["attachments"]),
    reply_to_id: str(record(m["reply_to"])["mid"]),
    created_at: timestamp(m["created_time"]),
  };
}

export type NormalizedMessengerConversation = {
  object: "conversation";
  source: "messenger";
  id: string | null;
  participant_ids: string[];
  message_count: number | null;
  unread_count: number | null;
  updated_at: string | null;
  link: string | null;
};

export function normalizeMessengerConversation(input: unknown): NormalizedMessengerConversation {
  const c = record(input);
  return {
    object: "conversation",
    source: "messenger",
    id: str(c["id"]),
    participant_ids: array(record(c["participants"])["data"])
      .map((p) => str(record(p)["id"]))
      .filter((v): v is string => v !== null),
    message_count: num(c["message_count"]),
    unread_count: num(c["unread_count"]),
    updated_at: timestamp(c["updated_time"]),
    link: str(c["link"]),
  };
}

export type NormalizedMessengerSendResult = {
  object: "send_result";
  source: "messenger";
  recipient_id: string | null;
  message_id: string | null;
  attachment_id: string | null;
};

export function normalizeMessengerSendResult(input: unknown): NormalizedMessengerSendResult {
  const r = record(input);
  return {
    object: "send_result",
    source: "messenger",
    recipient_id: str(r["recipient_id"]),
    message_id: str(r["message_id"]),
    attachment_id: str(r["attachment_id"]),
  };
}

export type NormalizedMessengerProfile = {
  object: "user_profile";
  source: "messenger";
  psid: string | null;
  first_name: string | null;
  last_name: string | null;
  name: string | null;
  profile_pic: string | null;
  locale: string | null;
};

export function normalizeMessengerUserProfile(input: unknown): NormalizedMessengerProfile {
  const p = record(input);
  return {
    object: "user_profile",
    source: "messenger",
    psid: str(p["id"]),
    first_name: str(p["first_name"]),
    last_name: str(p["last_name"]),
    name: str(p["name"]),
    profile_pic: str(p["profile_pic"]),
    locale: str(p["locale"]),
  };
}

export type MessengerEventType =
  | "message.received"
  | "message.echo"
  | "message.delivered"
  | "message.read"
  | "message.reaction"
  | "postback"
  | "referral"
  | "optin"
  | "unknown";

export type NormalizedMessengerWebhookEvent = {
  object: "webhook_event";
  source: "messenger";
  event: MessengerEventType;
  page_id: string | null;
  sender_id: string | null;
  recipient_id: string | null;
  message_id: string | null;
  message_ids: string[];
  text: string | null;
  attachments: NormalizedMessengerAttachment[];
  reply_to_id: string | null;
  postback_payload: string | null;
  reaction: string | null;
  watermark: string | null;
  occurred_at: string | null;
};

export function messengerEventType(messaging: Record<string, unknown>): MessengerEventType {
  const message = record(messaging["message"]);
  if (Object.keys(message).length > 0) return message["is_echo"] === true ? "message.echo" : "message.received";
  if (Object.keys(record(messaging["delivery"])).length > 0) return "message.delivered";
  if (Object.keys(record(messaging["read"])).length > 0) return "message.read";
  if (Object.keys(record(messaging["reaction"])).length > 0) return "message.reaction";
  if (Object.keys(record(messaging["postback"])).length > 0) return "postback";
  if (Object.keys(record(messaging["referral"])).length > 0) return "referral";
  if (Object.keys(record(messaging["optin"])).length > 0) return "optin";
  return "unknown";
}

/** Flattens every `entry[].messaging[]` item of a batched delivery. */
export function normalizeMessengerWebhookEvent(input: unknown): NormalizedMessengerWebhookEvent[] {
  const body = record(input);
  const out: NormalizedMessengerWebhookEvent[] = [];
  for (const rawEntry of array(body["entry"])) {
    const entry = record(rawEntry);
    for (const rawItem of array(entry["messaging"])) {
      const item = record(rawItem);
      const message = record(item["message"]);
      const delivery = record(item["delivery"]);
      const read = record(item["read"]);
      const reaction = record(item["reaction"]);
      const postback = record(item["postback"]);
      out.push({
        object: "webhook_event",
        source: "messenger",
        event: messengerEventType(item),
        page_id: str(entry["id"]),
        sender_id: str(record(item["sender"])["id"]),
        recipient_id: str(record(item["recipient"])["id"]),
        message_id: str(message["mid"]) ?? str(reaction["mid"]) ?? str(postback["mid"]),
        message_ids: array(delivery["mids"]).map(String),
        text: str(message["text"]),
        attachments: attachments(message["attachments"]),
        reply_to_id: str(record(message["reply_to"])["mid"]),
        postback_payload: str(postback["payload"]),
        reaction: str(reaction["reaction"]) ?? str(reaction["emoji"]),
        watermark: str(delivery["watermark"]) ?? str(read["watermark"]),
        occurred_at: timestamp(item["timestamp"]),
      });
    }
  }
  return out;
}
