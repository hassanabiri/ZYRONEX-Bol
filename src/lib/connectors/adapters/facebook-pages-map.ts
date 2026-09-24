/**
 * Facebook Pages (Meta) → ZYRONEX normalization.
 *
 * Pure mapping only. No business logic, no AI, no CRM decisions — official
 * Pages Graph payloads become the same neutral shapes the rest of ZYRONEX
 * already consumes for the other connectors.
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

/** Webhooks use unix seconds; Graph objects use ISO strings. */
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

export type NormalizedFacebookPage = {
  object: "page";
  source: "facebook_pages";
  id: string | null;
  name: string | null;
  category: string | null;
  username: string | null;
  link: string | null;
  about: string | null;
  fan_count: number | null;
  followers_count: number | null;
  verification_status: string | null;
  tasks: string[];
  /** True when Meta returned a page token; the token itself is never copied. */
  has_page_token: boolean;
};

export function normalizeFacebookPage(input: unknown): NormalizedFacebookPage {
  const page = record(input);
  return {
    object: "page",
    source: "facebook_pages",
    id: str(page["id"]),
    name: str(page["name"]),
    category: str(page["category"]),
    username: str(page["username"]),
    link: str(page["link"]),
    about: str(page["about"]),
    fan_count: num(page["fan_count"]),
    followers_count: num(page["followers_count"]),
    verification_status: str(page["verification_status"]),
    tasks: array(page["tasks"]).map(String),
    has_page_token: typeof page["access_token"] === "string" && page["access_token"] !== "",
  };
}

export type NormalizedFacebookPost = {
  object: "post";
  source: "facebook_pages";
  id: string | null;
  message: string | null;
  story: string | null;
  permalink_url: string | null;
  full_picture: string | null;
  status_type: string | null;
  is_published: boolean | null;
  scheduled_publish_time: string | null;
  created_at: string | null;
  updated_at: string | null;
  author_id: string | null;
  shares: number | null;
  comments_count: number | null;
  reactions_count: number | null;
};

function summaryCount(value: unknown): number | null {
  return num(record(record(value)["summary"])["total_count"]);
}

export function normalizeFacebookPost(input: unknown): NormalizedFacebookPost {
  const post = record(input);
  return {
    object: "post",
    source: "facebook_pages",
    id: str(post["id"]) ?? str(post["post_id"]),
    message: str(post["message"]),
    story: str(post["story"]),
    permalink_url: str(post["permalink_url"]),
    full_picture: str(post["full_picture"]),
    status_type: str(post["status_type"]),
    is_published: typeof post["is_published"] === "boolean" ? (post["is_published"] as boolean) : null,
    scheduled_publish_time: timestamp(post["scheduled_publish_time"]),
    created_at: timestamp(post["created_time"]),
    updated_at: timestamp(post["updated_time"]),
    author_id: str(record(post["from"])["id"]),
    shares: num(record(post["shares"])["count"]),
    comments_count: summaryCount(post["comments"]),
    reactions_count: summaryCount(post["reactions"]),
  };
}

export type NormalizedFacebookComment = {
  object: "comment";
  source: "facebook_pages";
  id: string | null;
  message: string | null;
  author_id: string | null;
  author_name: string | null;
  post_id: string | null;
  parent_id: string | null;
  is_hidden: boolean | null;
  like_count: number | null;
  comment_count: number | null;
  permalink_url: string | null;
  created_at: string | null;
};

export function normalizeFacebookComment(input: unknown): NormalizedFacebookComment {
  const comment = record(input);
  const from = record(comment["from"]);
  return {
    object: "comment",
    source: "facebook_pages",
    id: str(comment["id"]) ?? str(comment["comment_id"]),
    message: str(comment["message"]),
    author_id: str(from["id"]),
    author_name: str(from["name"]),
    post_id: str(comment["post_id"]) ?? str(record(comment["post"])["id"]),
    parent_id: str(record(comment["parent"])["id"]) ?? str(comment["parent_id"]),
    is_hidden: typeof comment["is_hidden"] === "boolean" ? (comment["is_hidden"] as boolean) : null,
    like_count: num(comment["like_count"]),
    comment_count: num(comment["comment_count"]),
    permalink_url: str(comment["permalink_url"]),
    created_at: timestamp(comment["created_time"]),
  };
}

export type NormalizedFacebookReaction = {
  object: "reaction";
  source: "facebook_pages";
  id: string | null;
  name: string | null;
  type: string | null;
};

export function normalizeFacebookReaction(input: unknown): NormalizedFacebookReaction {
  const reaction = record(input);
  return {
    object: "reaction",
    source: "facebook_pages",
    id: str(reaction["id"]),
    name: str(reaction["name"]),
    type: str(reaction["type"]),
  };
}

export type NormalizedFacebookInsight = {
  object: "insight";
  source: "facebook_pages";
  name: string | null;
  period: string | null;
  title: string | null;
  values: { value: unknown; end_time: string | null }[];
};

export function normalizeFacebookInsight(input: unknown): NormalizedFacebookInsight {
  const insight = record(input);
  return {
    object: "insight",
    source: "facebook_pages",
    name: str(insight["name"]),
    period: str(insight["period"]),
    title: str(insight["title"]),
    values: array(insight["values"]).map((entry) => {
      const value = record(entry);
      return { value: value["value"] ?? null, end_time: timestamp(value["end_time"]) };
    }),
  };
}

export type NormalizedFacebookPublishResult = {
  object: "publish_result";
  source: "facebook_pages";
  id: string | null;
  post_id: string | null;
  success: boolean;
};

export function normalizeFacebookPublishResult(input: unknown): NormalizedFacebookPublishResult {
  const result = record(input);
  const id = str(result["id"]);
  return {
    object: "publish_result",
    source: "facebook_pages",
    id,
    post_id: str(result["post_id"]) ?? id,
    success: result["success"] === true || id !== null,
  };
}

export type NormalizedFacebookWebhookEvent = {
  event: string | null;
  field: string | null;
  page_id: string | null;
  posts: NormalizedFacebookPost[];
  comments: NormalizedFacebookComment[];
  reactions: { post_id: string | null; comment_id: string | null; reaction_type: string | null; verb: string | null; user_id: string | null }[];
  changes: { field: string | null; value: Record<string, unknown> }[];
  resource: Record<string, unknown>;
};

/** Pages deliver `entry[].changes[]` with `field: "feed"` and an `item`/`verb`. */
export function normalizeFacebookPagesWebhookEvent(payload: unknown): NormalizedFacebookWebhookEvent {
  const body = record(payload);
  const entries = array(body["entry"]).map(record);
  const pageId = str(entries[0]?.["id"]);
  const posts: NormalizedFacebookPost[] = [];
  const comments: NormalizedFacebookComment[] = [];
  const reactions: NormalizedFacebookWebhookEvent["reactions"] = [];
  const changes: NormalizedFacebookWebhookEvent["changes"] = [];
  let event: string | null = null;

  for (const entry of entries) {
    for (const item of array(entry["changes"])) {
      const change = record(item);
      const field = str(change["field"]);
      const value = record(change["value"]);
      changes.push({ field, value });
      const kind = str(value["item"]);
      const verb = str(value["verb"]);
      if (!event && field) event = kind ? `${field}.${kind}.${verb ?? "event"}` : field;
      const from = value["from"];
      if (kind === "comment")
        comments.push(
          normalizeFacebookComment({
            id: value["comment_id"],
            message: value["message"],
            from,
            post_id: value["post_id"],
            parent_id: value["parent_id"] !== value["post_id"] ? value["parent_id"] : undefined,
            created_time: value["created_time"],
          }),
        );
      else if (kind === "reaction")
        reactions.push({
          post_id: str(value["post_id"]),
          comment_id: str(value["comment_id"]),
          reaction_type: str(value["reaction_type"]),
          verb,
          user_id: str(record(from)["id"]),
        });
      else if (kind === "post" || kind === "status" || kind === "photo" || kind === "video")
        posts.push(
          normalizeFacebookPost({
            id: value["post_id"],
            message: value["message"],
            from,
            created_time: value["created_time"],
            is_published: value["published"] === undefined ? undefined : Boolean(value["published"]),
          }),
        );
    }
  }

  return { event, field: changes[0]?.field ?? null, page_id: pageId, posts, comments, reactions, changes, resource: entries[0] ?? {} };
}
