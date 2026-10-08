import { asRecord } from "@/lib/connectors/adapters/shared";

/**
 * Microsoft Teams (Graph) normalizers — pure, no collaboration logic.
 * Users/organization reuse the Microsoft Graph connector's normalizers.
 */

const v = (x: unknown) => (x === undefined ? null : x);

export function normalizeTeam(value: unknown): Record<string, unknown> {
  const t = asRecord(value);
  return {
    id: v(t["id"]),
    display_name: v(t["displayName"]),
    description: v(t["description"]),
    visibility: v(t["visibility"]),
    is_archived: v(t["isArchived"]),
    web_url: v(t["webUrl"]),
    tenant_id: v(t["tenantId"]),
    created_at: v(t["createdDateTime"]),
  };
}

export function normalizeChannel(value: unknown): Record<string, unknown> {
  const c = asRecord(value);
  return {
    id: v(c["id"]),
    display_name: v(c["displayName"]),
    description: v(c["description"]),
    // standard | private | shared — capabilities differ per type.
    membership_type: v(c["membershipType"]),
    email: v(c["email"]),
    web_url: v(c["webUrl"]),
    tenant_id: v(c["tenantId"]),
    created_at: v(c["createdDateTime"]),
  };
}

export function normalizeChat(value: unknown): Record<string, unknown> {
  const c = asRecord(value);
  return {
    id: v(c["id"]),
    topic: v(c["topic"]),
    chat_type: v(c["chatType"]),
    web_url: v(c["webUrl"]),
    tenant_id: v(c["tenantId"]),
    created_at: v(c["createdDateTime"]),
    updated_at: v(c["lastUpdatedDateTime"]),
  };
}

export function normalizeTeamsMessage(value: unknown): Record<string, unknown> {
  const m = asRecord(value);
  const body = asRecord(m["body"]);
  const from = asRecord(m["from"]);
  const user = asRecord(from["user"]);
  const app = asRecord(from["application"]);
  const channel = asRecord(m["channelIdentity"]);
  return {
    id: v(m["id"]),
    // "channel" when channelIdentity is present, otherwise a chat message.
    scope: m["channelIdentity"] ? "channel" : m["chatId"] ? "chat" : null,
    reply_to_id: v(m["replyToId"]),
    chat_id: v(m["chatId"]),
    team_id: v(channel["teamId"]),
    channel_id: v(channel["channelId"]),
    message_type: v(m["messageType"]),
    subject: v(m["subject"]),
    importance: v(m["importance"]),
    content_type: v(body["contentType"]),
    content: v(body["content"]),
    from_user_id: v(user["id"]),
    from_user_name: v(user["displayName"]),
    from_application: app["id"] ? { id: app["id"], name: v(app["displayName"]) } : null,
    mentions: Array.isArray(m["mentions"]) ? m["mentions"] : [],
    // Attachment references only (file references, cards); never binary content.
    attachments: Array.isArray(m["attachments"])
      ? (m["attachments"] as unknown[]).map((a) => {
          const r = asRecord(a);
          return { id: v(r["id"]), content_type: v(r["contentType"]), content_url: v(r["contentUrl"]), name: v(r["name"]) };
        })
      : [],
    web_url: v(m["webUrl"]),
    created_at: v(m["createdDateTime"]),
    modified_at: v(m["lastModifiedDateTime"]),
    edited_at: v(m["lastEditedDateTime"]),
    deleted_at: v(m["deletedDateTime"]),
  };
}

export function normalizeMember(value: unknown): Record<string, unknown> {
  const m = asRecord(value);
  return {
    id: v(m["id"]),
    user_id: v(m["userId"]),
    display_name: v(m["displayName"]),
    email: v(m["email"]),
    roles: Array.isArray(m["roles"]) ? m["roles"] : [],
    tenant_id: v(m["tenantId"]),
  };
}

export function normalizeOnlineMeeting(value: unknown): Record<string, unknown> {
  const m = asRecord(value);
  return {
    id: v(m["id"]),
    subject: v(m["subject"]),
    start: v(m["startDateTime"]),
    end: v(m["endDateTime"]),
    join_web_url: v(m["joinWebUrl"]),
    chat_thread_id: asRecord(m["chatInfo"])["threadId"] ?? null,
    allowed_presenters: v(m["allowedPresenters"]),
    created_at: v(m["creationDateTime"]),
  };
}

export function normalizeHostedContent(value: unknown): Record<string, unknown> {
  const h = asRecord(value);
  return { id: v(h["id"]), content_type: v(h["contentType"]) };
}

/** Flattens Microsoft Search `chatMessage` hits. */
export function normalizeSearchHits(payload: unknown): { items: Record<string, unknown>[]; moreResults: boolean; total: number | null } {
  const first = asRecord(Array.isArray(asRecord(payload)["value"]) ? (asRecord(payload)["value"] as unknown[])[0] : undefined);
  const container = asRecord(Array.isArray(first["hitsContainers"]) ? (first["hitsContainers"] as unknown[])[0] : undefined);
  const hits = Array.isArray(container["hits"]) ? (container["hits"] as unknown[]) : [];
  return {
    items: hits.map((h) => {
      const r = asRecord(h);
      return { hit_id: v(r["hitId"]), rank: v(r["rank"]), summary: v(r["summary"]), resource: normalizeTeamsMessage(r["resource"]) };
    }),
    moreResults: container["moreResultsAvailable"] === true,
    total: typeof container["total"] === "number" ? container["total"] : null,
  };
}
