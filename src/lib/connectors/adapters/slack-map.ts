import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * Slack normalization (official Web API + Events API payload shapes only).
 *
 * Pure mapping: no I/O, no business logic, no AI. Every normalized record keeps
 * the provider `id` so existing consumers of the Slack adapter keep working.
 */

const str = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const bool = (value: unknown): boolean => value === true;

/** Converts a Slack `ts` ("1700000000.000100") into ISO time. */
export function slackTsToIso(ts: unknown): string | null {
  const seconds = Number(ts);
  return typeof ts === "string" && Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
}

export function normalizeSlackMessage(raw: unknown, channel?: string | null): Record<string, unknown> {
  const m = asRecord(raw);
  const ts = str(m["ts"]);
  const files = Array.isArray(m["files"]) ? (m["files"] as unknown[]).map((f) => str(asRecord(f)["id"])).filter(Boolean) : [];
  const reactions = Array.isArray(m["reactions"])
    ? (m["reactions"] as unknown[]).map((r) => {
        const x = asRecord(r);
        return { name: str(x["name"]), count: Number(x["count"] ?? 0) };
      })
    : [];
  return {
    id: ts,
    kind: "message",
    ts,
    channel: str(m["channel"]) ?? channel ?? null,
    threadTs: str(m["thread_ts"]),
    isThreadReply: Boolean(str(m["thread_ts"]) && m["thread_ts"] !== ts),
    replyCount: Number(m["reply_count"] ?? 0),
    user: str(m["user"]),
    botId: str(m["bot_id"]),
    subtype: str(m["subtype"]),
    text: typeof m["text"] === "string" ? m["text"] : "",
    edited: Boolean(m["edited"]),
    fileIds: files,
    reactions,
    sentAt: slackTsToIso(ts),
  };
}

export function normalizeSlackChannel(raw: unknown): Record<string, unknown> {
  const c = asRecord(raw);
  return {
    id: str(c["id"]),
    kind: "conversation",
    name: str(c["name"]),
    isChannel: bool(c["is_channel"]),
    isPrivate: bool(c["is_private"]),
    isIm: bool(c["is_im"]),
    isMpim: bool(c["is_mpim"]),
    isArchived: bool(c["is_archived"]),
    isMember: bool(c["is_member"]),
    memberCount: typeof c["num_members"] === "number" ? c["num_members"] : null,
    topic: str(asRecord(c["topic"])["value"]),
    purpose: str(asRecord(c["purpose"])["value"]),
    user: str(c["user"]),
  };
}

export function normalizeSlackUser(raw: unknown): Record<string, unknown> {
  const u = asRecord(raw);
  const profile = asRecord(u["profile"]);
  return {
    id: str(u["id"]),
    kind: "user",
    teamId: str(u["team_id"]),
    name: str(u["name"]),
    displayName: str(profile["display_name"]) ?? str(u["real_name"]) ?? str(u["name"]),
    realName: str(u["real_name"]),
    email: str(profile["email"]),
    isBot: bool(u["is_bot"]),
    isAdmin: bool(u["is_admin"]),
    deleted: bool(u["deleted"]),
    timezone: str(u["tz"]),
  };
}

export function normalizeSlackFile(raw: unknown): Record<string, unknown> {
  const f = asRecord(raw);
  return {
    id: str(f["id"]),
    kind: "file",
    name: str(f["name"]),
    title: str(f["title"]),
    mimeType: str(f["mimetype"]),
    size: typeof f["size"] === "number" ? f["size"] : null,
    user: str(f["user"]),
    isExternal: bool(f["is_external"]),
    // `url_private*` requires the bearer token to download; the connector only
    // returns the permalink and never fetches file bytes.
    permalink: str(f["permalink"]),
    createdAt: typeof f["created"] === "number" ? new Date((f["created"] as number) * 1000).toISOString() : null,
  };
}

export function normalizeSlackTeam(raw: unknown): Record<string, unknown> {
  const t = asRecord(raw);
  return {
    id: str(t["id"]),
    kind: "team",
    name: str(t["name"]),
    domain: str(t["domain"]),
    enterpriseId: str(t["enterprise_id"]),
  };
}

/** Official Events API envelope types delivered to a Request URL. */
export const SLACK_ENVELOPE_TYPES = ["url_verification", "event_callback", "app_rate_limited"] as const;

/** Event type used for subscription filtering: inner event type, else envelope type. */
export function slackEventType(payload: unknown): string | undefined {
  const body = asRecord(payload);
  return str(asRecord(body["event"])["type"]) ?? str(body["type"]) ?? undefined;
}

/**
 * Stable dedupe id. `event_id` is Slack's official unique id and stays the same
 * across Slack's retries (X-Slack-Retry-Num). Non-event envelopes get a
 * deterministic id derived from their own documented fields.
 */
export function slackEventId(payload: unknown): string | undefined {
  const body = asRecord(payload);
  const eventId = str(body["event_id"]);
  if (eventId) return eventId;
  if (body["type"] === "url_verification" && str(body["challenge"])) return `url_verification:${body["challenge"]}`;
  if (body["type"] === "app_rate_limited" && body["minute_rate_limited"] !== undefined)
    return `app_rate_limited:${str(body["api_app_id"]) ?? ""}:${String(body["minute_rate_limited"])}`;
  return undefined;
}

/** Normalizes an Events API envelope. Pure data mapping. */
export function normalizeSlackEvent(payload: unknown): Record<string, unknown> {
  const body = asRecord(payload);
  const event = asRecord(body["event"]);
  const item = asRecord(event["item"]);
  return {
    id: slackEventId(payload) ?? null,
    kind: "event",
    envelope: str(body["type"]),
    type: slackEventType(payload) ?? null,
    subtype: str(event["subtype"]),
    teamId: str(body["team_id"]),
    apiAppId: str(body["api_app_id"]),
    eventTime: typeof body["event_time"] === "number" ? new Date((body["event_time"] as number) * 1000).toISOString() : null,
    channel: str(event["channel"]) ?? str(item["channel"]),
    user: str(event["user"]),
    ts: str(event["ts"]) ?? str(item["ts"]),
    threadTs: str(event["thread_ts"]),
    reaction: str(event["reaction"]),
    message: event["type"] === "message" || event["type"] === "app_mention" ? normalizeSlackMessage(event) : null,
  };
}
