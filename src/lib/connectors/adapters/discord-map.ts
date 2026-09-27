import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * Discord payload normalization (official Discord API v10 object shapes).
 *
 * Pure functions only: no I/O, no AI, no business logic. Shapes follow
 * https://discord.com/developers/docs/resources/* and the Interactions /
 * Webhook Events documentation.
 */

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : typeof value === "number" ? String(value) : undefined;

export type DiscordUser = { id: string; username?: string; globalName?: string; bot: boolean; avatar?: string };

export function normalizeDiscordUser(value: unknown): DiscordUser | null {
  const u = asRecord(value);
  const id = str(u["id"]);
  if (!id) return null;
  const out: DiscordUser = { id, bot: u["bot"] === true };
  const username = str(u["username"]);
  const globalName = str(u["global_name"]);
  const avatar = str(u["avatar"]);
  if (username) out.username = username;
  if (globalName) out.globalName = globalName;
  if (avatar) out.avatar = avatar;
  return out;
}

export function normalizeDiscordGuild(value: unknown): Record<string, unknown> {
  const g = asRecord(value);
  return {
    id: str(g["id"]) ?? null,
    name: str(g["name"]) ?? null,
    icon: str(g["icon"]) ?? null,
    owner: g["owner"] === true,
    permissions: str(g["permissions"]) ?? null,
    features: Array.isArray(g["features"]) ? g["features"] : [],
    approximateMemberCount: typeof g["approximate_member_count"] === "number" ? g["approximate_member_count"] : null,
  };
}

/** Official channel type ids → readable names. */
export const DISCORD_CHANNEL_TYPES: Record<number, string> = {
  0: "guild_text",
  1: "dm",
  2: "guild_voice",
  3: "group_dm",
  4: "guild_category",
  5: "guild_announcement",
  10: "announcement_thread",
  11: "public_thread",
  12: "private_thread",
  13: "guild_stage_voice",
  14: "guild_directory",
  15: "guild_forum",
  16: "guild_media",
};

export function normalizeDiscordChannel(value: unknown): Record<string, unknown> {
  const c = asRecord(value);
  const type = typeof c["type"] === "number" ? (c["type"] as number) : -1;
  const meta = asRecord(c["thread_metadata"]);
  return {
    id: str(c["id"]) ?? null,
    type: DISCORD_CHANNEL_TYPES[type] ?? "unknown",
    typeId: type,
    guildId: str(c["guild_id"]) ?? null,
    parentId: str(c["parent_id"]) ?? null,
    name: str(c["name"]) ?? null,
    topic: str(c["topic"]) ?? null,
    position: typeof c["position"] === "number" ? c["position"] : null,
    nsfw: c["nsfw"] === true,
    lastMessageId: str(c["last_message_id"]) ?? null,
    isThread: type === 10 || type === 11 || type === 12,
    archived: meta["archived"] === true,
    archiveTimestamp: str(meta["archive_timestamp"]) ?? null,
  };
}

export type DiscordMessage = {
  id: string | null;
  channelId: string | null;
  guildId: string | null;
  author: DiscordUser | null;
  content: string;
  timestamp: string | null;
  editedTimestamp: string | null;
  replyToMessageId: string | null;
  threadId: string | null;
  embeds: unknown[];
  attachments: { id: string | null; filename: string | null; url: string | null; contentType: string | null; size: number | null }[];
  reactions: { emoji: string | null; count: number; me: boolean }[];
  nonce: string | null;
  pinned: boolean;
};

export function normalizeDiscordMessage(value: unknown): DiscordMessage {
  const m = asRecord(value);
  const ref = asRecord(m["message_reference"]);
  const thread = asRecord(m["thread"]);
  return {
    id: str(m["id"]) ?? null,
    channelId: str(m["channel_id"]) ?? null,
    guildId: str(m["guild_id"]) ?? null,
    author: normalizeDiscordUser(m["author"]),
    content: typeof m["content"] === "string" ? m["content"] : "",
    timestamp: str(m["timestamp"]) ?? null,
    editedTimestamp: str(m["edited_timestamp"]) ?? null,
    replyToMessageId: str(ref["message_id"]) ?? null,
    threadId: str(thread["id"]) ?? null,
    embeds: Array.isArray(m["embeds"]) ? m["embeds"] : [],
    attachments: (Array.isArray(m["attachments"]) ? m["attachments"] : []).map((a) => {
      const r = asRecord(a);
      return {
        id: str(r["id"]) ?? null,
        filename: str(r["filename"]) ?? null,
        url: str(r["url"]) ?? null,
        contentType: str(r["content_type"]) ?? null,
        size: typeof r["size"] === "number" ? r["size"] : null,
      };
    }),
    reactions: (Array.isArray(m["reactions"]) ? m["reactions"] : []).map((x) => {
      const r = asRecord(x);
      const emoji = asRecord(r["emoji"]);
      return { emoji: str(emoji["name"]) ?? str(emoji["id"]) ?? null, count: Number(r["count"] ?? 0), me: r["me"] === true };
    }),
    nonce: str(m["nonce"]) ?? null,
    pinned: m["pinned"] === true,
  };
}

// ---- Inbound events (Interactions endpoint + Webhook Events) ------------------

/** Official interaction type ids. */
export const DISCORD_INTERACTION_TYPES: Record<number, string> = {
  1: "ping",
  2: "application_command",
  3: "message_component",
  4: "application_command_autocomplete",
  5: "modal_submit",
};

/** Official Webhook Events (application-level) event types. */
export const DISCORD_WEBHOOK_EVENT_TYPES = [
  "APPLICATION_AUTHORIZED",
  "APPLICATION_DEAUTHORIZED",
  "ENTITLEMENT_CREATE",
  "QUEST_USER_ENROLLMENT",
  "LOBBY_MESSAGE_CREATE",
  "LOBBY_MESSAGE_UPDATE",
  "LOBBY_MESSAGE_DELETE",
  "GAME_DIRECT_MESSAGE_CREATE",
  "GAME_DIRECT_MESSAGE_UPDATE",
  "GAME_DIRECT_MESSAGE_DELETE",
] as const;

/** An interaction carries `token` + `type`; a Webhook Event carries `version`. */
export function isDiscordInteraction(body: Record<string, unknown>): boolean {
  return typeof body["token"] === "string" && typeof body["type"] === "number" && typeof body["id"] === "string";
}

export function discordEventType(payload: unknown): string | undefined {
  const body = asRecord(payload);
  if (isDiscordInteraction(body)) {
    const name = DISCORD_INTERACTION_TYPES[body["type"] as number];
    return name ? `interaction.${name}` : undefined;
  }
  if (typeof body["version"] === "number" && typeof body["type"] === "number") {
    if (body["type"] === 0) return "webhook.ping";
    if (body["type"] === 1) {
      const type = str(asRecord(body["event"])["type"]);
      return type && (DISCORD_WEBHOOK_EVENT_TYPES as readonly string[]).includes(type) ? `event.${type.toLowerCase()}` : undefined;
    }
  }
  return undefined;
}

/**
 * Deterministic event id from official identifiers only:
 * - interactions: the interaction snowflake `id`;
 * - Webhook Events: application_id + event type + official event timestamp
 *   (+ the event's own entity id when present). Webhook Events publish no
 *   dedicated event id, so the combination is the narrowest official key.
 */
export function discordEventId(payload: unknown): string | undefined {
  const body = asRecord(payload);
  if (isDiscordInteraction(body)) return `interaction:${body["id"] as string}`;
  const app = str(body["application_id"]);
  if (!app) return undefined;
  if (body["type"] === 0) return undefined; // pings are not events
  const event = asRecord(body["event"]);
  const type = str(event["type"]);
  const timestamp = str(event["timestamp"]);
  if (!type || !timestamp) return undefined;
  const data = asRecord(event["data"]);
  const entity = str(data["id"]) ?? str(asRecord(data["user"])["id"]) ?? str(data["user_id"]);
  return `event:${app}:${type}:${timestamp}${entity ? `:${entity}` : ""}`;
}

export function normalizeDiscordEvent(payload: unknown): Record<string, unknown> {
  const body = asRecord(payload);
  if (isDiscordInteraction(body)) {
    const member = asRecord(body["member"]);
    return {
      kind: "interaction",
      eventType: discordEventType(body) ?? null,
      id: body["id"],
      applicationId: str(body["application_id"]) ?? null,
      guildId: str(body["guild_id"]) ?? null,
      channelId: str(body["channel_id"]) ?? null,
      user: normalizeDiscordUser(member["user"] ?? body["user"]),
      data: asRecord(body["data"]),
      message: body["message"] ? normalizeDiscordMessage(body["message"]) : null,
      // Short-lived interaction token (15 min). Key name is covered by `redact`.
      token: body["token"],
    };
  }
  const event = asRecord(body["event"]);
  return {
    kind: "webhook_event",
    eventType: discordEventType(body) ?? null,
    applicationId: str(body["application_id"]) ?? null,
    type: str(event["type"]) ?? null,
    timestamp: str(event["timestamp"]) ?? null,
    data: asRecord(event["data"]),
  };
}
