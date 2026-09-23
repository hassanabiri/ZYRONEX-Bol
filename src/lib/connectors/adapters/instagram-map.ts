/**
 * Instagram (Meta) → ZYRONEX normalization.
 *
 * Pure mapping only. No business logic, no AI, no CRM decisions — this layer
 * turns official Instagram Graph payloads into the same neutral shapes the rest
 * of ZYRONEX already consumes for the other connectors.
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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Messaging webhooks use unix milliseconds; Graph objects use ISO strings. */
function timestamp(value: unknown): string | null {
  const raw = str(value);
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    const ms = raw.length <= 10 ? numeric * 1000 : numeric;
    return new Date(ms).toISOString();
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
}

export type NormalizedInstagramAccount = {
  object: "account";
  source: "instagram";
  id: string | null;
  username: string | null;
  name: string | null;
  account_type: string | null;
  profile_picture_url: string | null;
  followers_count: number | null;
  follows_count: number | null;
  media_count: number | null;
  biography: string | null;
  website: string | null;
};

export type NormalizedInstagramMedia = {
  object: "media";
  source: "instagram";
  id: string | null;
  media_type: string | null;
  media_product_type: string | null;
  caption: string | null;
  permalink: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  username: string | null;
  like_count: number | null;
  comments_count: number | null;
  timestamp: string | null;
  children: string[];
};

export type NormalizedInstagramComment = {
  object: "comment";
  source: "instagram";
  id: string | null;
  media_id: string | null;
  parent_id: string | null;
  text: string | null;
  username: string | null;
  from_id: string | null;
  like_count: number | null;
  hidden: boolean | null;
  timestamp: string | null;
  replies: string[];
};

export type NormalizedInstagramMessage = {
  object: "message";
  source: "instagram";
  id: string | null;
  direction: "inbound" | "outbound";
  conversation_id: string | null;
  from: string | null;
  to: string | null;
  text: string | null;
  reply_to: string | null;
  is_echo: boolean;
  is_deleted: boolean;
  attachments: { type: string | null; url: string | null; id: string | null }[];
  reactions: { action: string | null; reaction: string | null; message_id: string | null }[];
  timestamp: string | null;
  raw: Record<string, unknown>;
};

export type NormalizedInstagramConversation = {
  object: "conversation";
  source: "instagram";
  id: string | null;
  updated_time: string | null;
  unread_count: number | null;
  participants: { id: string | null; username: string | null }[];
  messages: NormalizedInstagramMessage[];
};

export type NormalizedInstagramSendResult = {
  object: "message_receipt";
  source: "instagram";
  id: string | null;
  recipient: string | null;
  status: string;
};

export type NormalizedInstagramContainer = {
  object: "media_container";
  source: "instagram";
  id: string | null;
  status_code: string | null;
  status: string | null;
};

export type NormalizedInstagramInsight = {
  object: "insight";
  source: "instagram";
  name: string | null;
  period: string | null;
  title: string | null;
  values: { value: unknown; end_time: string | null }[];
  total_value: number | null;
};

export function normalizeInstagramAccount(input: unknown): NormalizedInstagramAccount {
  const source = record(input);
  return {
    object: "account",
    source: "instagram",
    id: str(source["id"]),
    username: str(source["username"]),
    name: str(source["name"]),
    account_type: str(source["account_type"]),
    profile_picture_url: str(source["profile_picture_url"]),
    followers_count: num(source["followers_count"]),
    follows_count: num(source["follows_count"]),
    media_count: num(source["media_count"]),
    biography: str(source["biography"]),
    website: str(source["website"]),
  };
}

export function normalizeInstagramMedia(input: unknown): NormalizedInstagramMedia {
  const source = record(input);
  return {
    object: "media",
    source: "instagram",
    id: str(source["id"]),
    media_type: str(source["media_type"]),
    media_product_type: str(source["media_product_type"]),
    caption: str(source["caption"]),
    permalink: str(source["permalink"]),
    media_url: str(source["media_url"]),
    thumbnail_url: str(source["thumbnail_url"]),
    username: str(source["username"]),
    like_count: num(source["like_count"]),
    comments_count: num(source["comments_count"]),
    timestamp: timestamp(source["timestamp"]),
    children: array(record(source["children"])["data"])
      .map((child) => str(record(child)["id"]))
      .filter((id): id is string => id !== null),
  };
}

export function normalizeInstagramComment(input: unknown): NormalizedInstagramComment {
  const source = record(input);
  const from = record(source["from"]);
  return {
    object: "comment",
    source: "instagram",
    id: str(source["id"]),
    media_id: str(record(source["media"])["id"]),
    parent_id: str(record(source["parent"])["id"]),
    text: str(source["text"]),
    username: str(source["username"]) ?? str(from["username"]),
    from_id: str(from["id"]),
    like_count: num(source["like_count"]),
    hidden: typeof source["hidden"] === "boolean" ? (source["hidden"] as boolean) : null,
    timestamp: timestamp(source["timestamp"]),
    replies: array(record(source["replies"])["data"])
      .map((reply) => str(record(reply)["id"]))
      .filter((id): id is string => id !== null),
  };
}

/** Maps a Graph conversation message or a messaging webhook entry. */
export function normalizeInstagramMessage(
  input: unknown,
  context: { conversationId?: string | null; accountId?: string | null } = {},
): NormalizedInstagramMessage {
  const source = record(input);
  // Messaging webhook shape: { sender, recipient, timestamp, message }
  const webhookMessage = record(source["message"]);
  const isWebhook = Object.keys(webhookMessage).length > 0 || source["sender"] !== undefined;
  const from = isWebhook ? str(record(source["sender"])["id"]) : str(record(source["from"])["id"]);
  const to = isWebhook
    ? str(record(source["recipient"])["id"])
    : str(record(array(record(source["to"])["data"])[0])["id"]);
  const isEcho = webhookMessage["is_echo"] === true;
  const accountId = str(context.accountId ?? null);

  const attachmentsRaw = isWebhook
    ? array(webhookMessage["attachments"])
    : array(record(source["attachments"])["data"]);

  const reaction = record(source["reaction"]);

  return {
    object: "message",
    source: "instagram",
    id: str(webhookMessage["mid"]) ?? str(source["id"]),
    direction: accountId && from === accountId ? "outbound" : isEcho ? "outbound" : "inbound",
    conversation_id: str(context.conversationId ?? null),
    from,
    to,
    text: str(webhookMessage["text"]) ?? str(source["message"]) ?? str(source["text"]),
    reply_to: str(record(webhookMessage["reply_to"])["mid"]) ?? str(record(source["reply_to"])["id"]),
    is_echo: isEcho,
    is_deleted: webhookMessage["is_deleted"] === true,
    attachments: attachmentsRaw.map((entry) => {
      const attachment = record(entry);
      const payload = record(attachment["payload"]);
      return {
        type: str(attachment["type"]) ?? str(attachment["mime_type"]),
        url: str(payload["url"]) ?? str(attachment["image_data"]) ?? str(attachment["file_url"]),
        id: str(attachment["id"]),
      };
    }),
    reactions: Object.keys(reaction).length
      ? [
          {
            action: str(reaction["action"]),
            reaction: str(reaction["reaction"]) ?? str(reaction["emoji"]),
            message_id: str(reaction["mid"]),
          },
        ]
      : [],
    timestamp: timestamp(isWebhook ? source["timestamp"] : source["created_time"]),
    raw: source,
  };
}

export function normalizeInstagramConversation(input: unknown): NormalizedInstagramConversation {
  const source = record(input);
  const id = str(source["id"]);
  return {
    object: "conversation",
    source: "instagram",
    id,
    updated_time: timestamp(source["updated_time"]),
    unread_count: num(source["unread_count"]),
    participants: array(record(source["participants"])["data"]).map((entry) => {
      const participant = record(entry);
      return { id: str(participant["id"]), username: str(participant["username"]) };
    }),
    messages: array(record(source["messages"])["data"]).map((message) =>
      normalizeInstagramMessage(message, { conversationId: id }),
    ),
  };
}

/** `POST /{ig-id}/messages` answers with `{ recipient_id, message_id }`. */
export function normalizeInstagramSendResult(input: unknown): NormalizedInstagramSendResult {
  const source = record(input);
  return {
    object: "message_receipt",
    source: "instagram",
    id: str(source["message_id"]) ?? str(source["id"]),
    recipient: str(source["recipient_id"]),
    status: "accepted",
  };
}

export function normalizeInstagramContainer(input: unknown): NormalizedInstagramContainer {
  const source = record(input);
  return {
    object: "media_container",
    source: "instagram",
    id: str(source["id"]),
    status_code: str(source["status_code"]),
    status: str(source["status"]),
  };
}

export function normalizeInstagramInsight(input: unknown): NormalizedInstagramInsight {
  const source = record(input);
  const totalValue = record(source["total_value"]);
  return {
    object: "insight",
    source: "instagram",
    name: str(source["name"]),
    period: str(source["period"]),
    title: str(source["title"]),
    values: array(source["values"]).map((entry) => {
      const value = record(entry);
      return { value: value["value"] ?? null, end_time: timestamp(value["end_time"]) };
    }),
    total_value: num(totalValue["value"]),
  };
}

export type NormalizedInstagramWebhookEvent = {
  event: string | null;
  field: string | null;
  account_id: string | null;
  messages: NormalizedInstagramMessage[];
  comments: NormalizedInstagramComment[];
  changes: { field: string | null; value: Record<string, unknown> }[];
  resource: Record<string, unknown>;
};

/**
 * Normalizes the official Instagram webhook envelope. Meta batches several
 * entries into one delivery and uses `entry[].messaging[]` for direct messages
 * and `entry[].changes[]` for comments/mentions — every item is preserved, the
 * runtime (not the connector) decides what to do with them.
 */
export function normalizeInstagramWebhookEvent(payload: unknown): NormalizedInstagramWebhookEvent {
  const body = record(payload);
  const entries = array(body["entry"]).map(record);
  const accountId = str(entries[0]?.["id"]);

  const messages: NormalizedInstagramMessage[] = [];
  const comments: NormalizedInstagramComment[] = [];
  const changes: { field: string | null; value: Record<string, unknown> }[] = [];

  for (const entry of entries) {
    for (const item of array(entry["messaging"]))
      messages.push(normalizeInstagramMessage(item, { accountId }));
    for (const item of array(entry["changes"])) {
      const change = record(item);
      const field = str(change["field"]);
      const value = record(change["value"]);
      changes.push({ field, value });
      if (field === "comments" || field === "live_comments")
        comments.push(
          normalizeInstagramComment({
            id: value["id"],
            text: value["text"],
            from: value["from"],
            media: value["media"],
            parent: value["parent_id"] !== undefined ? { id: value["parent_id"] } : undefined,
            timestamp: value["timestamp"] ?? entry["time"],
          }),
        );
    }
  }

  return {
    event: messages.length ? "message.received" : comments.length ? "comment.created" : changes[0]?.field ?? null,
    field: changes[0]?.field ?? (messages.length ? "messages" : null),
    account_id: accountId,
    messages,
    comments,
    changes,
    resource: entries[0] ?? {},
  };
}
