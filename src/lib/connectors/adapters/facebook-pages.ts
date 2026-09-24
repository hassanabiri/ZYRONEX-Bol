import {
  normalizeFacebookComment,
  normalizeFacebookInsight,
  normalizeFacebookPage,
  normalizeFacebookPost,
  normalizeFacebookPublishResult,
  normalizeFacebookReaction,
} from "@/lib/connectors/adapters/facebook-pages-map";
import { instagramConnector } from "@/lib/connectors/adapters/instagram";
import { asRecord, assertRequiredParams, pickInto } from "@/lib/connectors/adapters/shared";
import { ConnectorError } from "@/lib/connectors/errors";
import type { ConnectorAdapter, ConnectorCall, HttpMethod, NormalizedPage } from "@/lib/connectors/types";

/**
 * Facebook Pages connector (official Meta Graph API — Pages API only).
 *
 * Owns API communication, credential injection, normalization and error
 * handling — nothing else. No business logic, AI, CRM or database access.
 *
 * Page-scoped calls use the Page access token (`access_token`). Page discovery
 * (`/me/accounts`) is the only call that needs the user token, and uses
 * `user_access_token` when the connection holds one.
 *
 * Page inbox messaging is served by the Official Messenger Platform
 * (`pages_messaging`) and intentionally belongs to the separate Messenger
 * connector — see UNSUPPORTED_OPERATIONS.
 */

export const FACEBOOK_API_VERSION = "v23.0";
const GRAPH_HOST = "https://graph.facebook.com";
/** Replaced in `authorize` with the connection's own Page id. */
const PAGE_PLACEHOLDER = "facebook-page-id-placeholder";
const DEFAULT_PAGE_SIZE = 25;

/** Documented, deliberate gaps — no workaround is exposed for any of them. */
export const UNSUPPORTED_OPERATIONS: Record<string, string> = {
  send_page_message:
    "Page inbox messaging is the Messenger Platform (pages_messaging) and is handled by the dedicated Messenger connector, not the Pages connector.",
  create_reaction:
    "The Graph API only reads reactions; creating LOVE/WOW/HAHA/SAD/ANGRY/CARE reactions on behalf of a Page is not available.",
  read_personal_profiles: "The Pages API only serves Pages the app user manages; personal profiles and their feeds are not accessible.",
  post_to_groups_or_profiles: "Publishing is limited to the connected Page's own feed; posting to personal profiles is not permitted.",
  edit_others_comments: "A Page can only edit its own comments; visitors' comments can be hidden or deleted but never edited.",
  upload_media_binary:
    "Photos/videos are published from a publicly reachable url/file_url; multipart binary upload is not part of the JSON runtime.",
  idempotency_key: "Meta publishes no idempotency header for the Pages API; duplicate prevention stays in the ZYRONEX runtime.",
};

type Kind = "page" | "post" | "comment" | "reaction" | "insight" | "publish" | "raw";

type Spec = {
  method: HttpMethod;
  path: string;
  kind?: Kind;
  list?: boolean;
  required?: string[];
  query?: string[];
  body?: string[];
  /** Uses the user token when present (page discovery only). */
  userToken?: boolean;
};

const P = `/${PAGE_PLACEHOLDER}`;

const OPERATIONS: Record<string, Spec> = {
  // ---- Page discovery / information ---------------------------------------
  list_managed_pages: { method: "GET", path: "/me/accounts", kind: "page", list: true, query: ["fields"], userToken: true },
  get_page: { method: "GET", path: P, kind: "page", query: ["fields"] },
  update_page: { method: "POST", path: P, kind: "raw", body: ["about", "description", "website", "phone", "emails", "hours"] },
  get_page_insights: {
    method: "GET",
    path: `${P}/insights`,
    kind: "insight",
    list: true,
    required: ["metric"],
    query: ["metric", "period", "since", "until", "date_preset"],
  },

  // ---- Posts ----------------------------------------------------------------
  list_posts: { method: "GET", path: `${P}/feed`, kind: "post", list: true, query: ["fields", "since", "until"] },
  list_published_posts: { method: "GET", path: `${P}/published_posts`, kind: "post", list: true, query: ["fields", "since", "until"] },
  list_scheduled_posts: { method: "GET", path: `${P}/scheduled_posts`, kind: "post", list: true, query: ["fields"] },
  get_post: { method: "GET", path: "/:post_id", kind: "post", required: ["post_id"], query: ["fields"] },
  create_post: {
    method: "POST",
    path: `${P}/feed`,
    kind: "publish",
    body: ["message", "link", "published", "scheduled_publish_time", "targeting", "feed_targeting"],
  },
  create_photo_post: {
    method: "POST",
    path: `${P}/photos`,
    kind: "publish",
    required: ["url"],
    body: ["url", "caption", "message", "published", "scheduled_publish_time", "alt_text_custom"],
  },
  create_video_post: {
    method: "POST",
    path: `${P}/videos`,
    kind: "publish",
    required: ["file_url"],
    body: ["file_url", "title", "description", "published", "scheduled_publish_time"],
  },
  update_post: { method: "POST", path: "/:post_id", kind: "raw", required: ["post_id"], body: ["message", "is_published"] },
  delete_post: { method: "DELETE", path: "/:post_id", kind: "raw", required: ["post_id"] },
  get_post_insights: {
    method: "GET",
    path: "/:post_id/insights",
    kind: "insight",
    list: true,
    required: ["post_id", "metric"],
    query: ["metric", "period"],
  },

  // ---- Comments ---------------------------------------------------------------
  list_comments: {
    method: "GET",
    path: "/:object_id/comments",
    kind: "comment",
    list: true,
    required: ["object_id"],
    query: ["fields", "filter", "order", "summary"],
  },
  get_comment: { method: "GET", path: "/:comment_id", kind: "comment", required: ["comment_id"], query: ["fields"] },
  create_comment: {
    method: "POST",
    path: "/:object_id/comments",
    kind: "raw",
    required: ["object_id", "message"],
    body: ["message", "attachment_url"],
  },
  reply_to_comment: {
    method: "POST",
    path: "/:comment_id/comments",
    kind: "raw",
    required: ["comment_id", "message"],
    body: ["message", "attachment_url"],
  },
  update_comment: { method: "POST", path: "/:comment_id", kind: "raw", required: ["comment_id", "message"], body: ["message"] },
  hide_comment: { method: "POST", path: "/:comment_id", kind: "raw", required: ["comment_id", "is_hidden"], body: ["is_hidden"] },
  delete_comment: { method: "DELETE", path: "/:comment_id", kind: "raw", required: ["comment_id"] },

  // ---- Reactions (read-only, per Meta) ------------------------------------
  list_reactions: {
    method: "GET",
    path: "/:object_id/reactions",
    kind: "reaction",
    list: true,
    required: ["object_id"],
    query: ["type", "summary"],
  },

  // ---- Webhook subscriptions ----------------------------------------------
  list_subscribed_apps: { method: "GET", path: `${P}/subscribed_apps`, kind: "raw", list: true },
  subscribe_app: { method: "POST", path: `${P}/subscribed_apps`, kind: "raw", required: ["subscribed_fields"], body: ["subscribed_fields"] },
  unsubscribe_app: { method: "DELETE", path: `${P}/subscribed_apps`, kind: "raw" },
};

function mapEntity(kind: Kind | undefined, value: unknown): Record<string, unknown> {
  if (kind === "page") return normalizeFacebookPage(value) as unknown as Record<string, unknown>;
  if (kind === "post") return normalizeFacebookPost(value) as unknown as Record<string, unknown>;
  if (kind === "comment") return normalizeFacebookComment(value) as unknown as Record<string, unknown>;
  if (kind === "reaction") return normalizeFacebookReaction(value) as unknown as Record<string, unknown>;
  if (kind === "insight") return normalizeFacebookInsight(value) as unknown as Record<string, unknown>;
  if (kind === "publish") return normalizeFacebookPublishResult(value) as unknown as Record<string, unknown>;
  return asRecord(value);
}

/** Graph object ids: numeric, or `pageid_postid` for posts/comments. */
function safeObjectId(value: unknown): string {
  const raw = String(value ?? "").trim();
  return /^[0-9]{3,}(_[0-9]{3,})?$/.test(raw) ? raw : "";
}

function safePageId(value: string): string {
  const trimmed = value.trim();
  return /^[0-9]{5,}$/.test(trimmed) ? trimmed : "";
}

const USER_TOKEN_OPS = new Set(Object.entries(OPERATIONS).filter(([, s]) => s.userToken).map(([k]) => k));

export const facebookPagesConnector: ConnectorAdapter = {
  id: "facebook_pages",
  label: "Facebook Pages",
  capabilities: ["read", "write", "files", "pagination", "webhook", "health_check"],
  credentials: {
    kind: "bearer",
    required: ["access_token", "page_id"],
    optional: ["user_access_token", "app_secret", "verify_token"],
  },
  operations: Object.keys(OPERATIONS),
  healthOperation: "get_page",

  buildCall: ({ operation, params = {}, cursor }): ConnectorCall => {
    const spec = OPERATIONS[operation];
    if (!spec)
      throw new ConnectorError("unsupported", `Unknown Facebook Pages operation "${operation}"`, { retryable: false });
    assertRequiredParams(operation, params, spec.required);

    const path = spec.path.replace(/:([a-z_]+)/g, (_m, key: string) => {
      const id = safeObjectId(params[key]);
      if (!id) throw new ConnectorError("invalid_request", `\`${key}\` is not a valid Graph object id`, { retryable: false });
      return id;
    });

    const query: Record<string, string | number | boolean | undefined> = {};
    for (const [key, value] of Object.entries(pickInto(params, spec.query)))
      query[key] = Array.isArray(value) ? value.join(",") : (value as string | number);
    if (spec.list) {
      query["limit"] = Number(params["limit"] ?? DEFAULT_PAGE_SIZE);
      if (cursor) query["after"] = String(cursor);
    }

    const hasBody = spec.method !== "GET" && spec.method !== "DELETE";
    const payload = hasBody ? pickInto(params, spec.body) : {};
    if (operation === "hide_comment") payload["is_hidden"] = Boolean(params["is_hidden"]);
    if (operation === "subscribe_app" && Array.isArray(payload["subscribed_fields"]))
      payload["subscribed_fields"] = (payload["subscribed_fields"] as unknown[]).join(",");

    return {
      method: spec.method,
      url: `${GRAPH_HOST}/${FACEBOOK_API_VERSION}${path}`,
      headers: {
        accept: "application/json",
        ...(hasBody ? { "content-type": "application/json" } : {}),
        ...(USER_TOKEN_OPS.has(operation) ? { "x-zyronex-token-scope": "user" } : {}),
      },
      query,
      ...(hasBody ? { body: payload } : {}),
      paginated: Boolean(spec.list),
    };
  },

  authorize: (call, credentials) => {
    const { ["x-zyronex-token-scope"]: scope, ...headers } = call.headers;
    const token = scope === "user" ? credentials["user_access_token"] || credentials["access_token"] : credentials["access_token"];
    if (!token) throw new ConnectorError("auth", "The Facebook Page is not connected yet", { retryable: false });

    let url = call.url;
    if (url.includes(PAGE_PLACEHOLDER)) {
      const pageId = safePageId(credentials["page_id"] ?? "");
      if (!pageId)
        throw new ConnectorError("auth", "The Facebook Page ID is missing from this connection", { retryable: false });
      url = url.replace(PAGE_PLACEHOLDER, pageId);
    }
    return { ...call, url, headers: { ...headers, authorization: `Bearer ${token}` } };
  },

  /** Same Graph error envelope and official codes as the other Meta adapters. */
  mapError: (status, payload) => {
    const mapped = instagramConnector.mapError?.(status, payload);
    return mapped ? { ...mapped, message: mapped.message.replace(/^Instagram/, "Facebook Pages") } : null;
  },

  /** Graph quota headers (`X-App-Usage`, `X-Page-Usage`, BUC) + `Retry-After`. */
  readRateLimit: (headers, payload) => {
    const pageUsage = headers.get("x-page-usage");
    if (pageUsage && !headers.get("x-business-use-case-usage") && !headers.get("x-app-usage")) {
      const proxied = new Headers(headers);
      proxied.set("x-app-usage", pageUsage);
      return instagramConnector.readRateLimit?.(proxied, payload);
    }
    return instagramConnector.readRateLimit?.(headers, payload);
  },

  normalize: (operation, payload): NormalizedPage => {
    const spec = OPERATIONS[operation];
    const body = asRecord(payload);
    if (Object.keys(body).length === 0)
      throw new ConnectorError("malformed_response", "Facebook Pages returned an empty response body", { retryable: false });
    if (!spec?.list) return { items: [mapEntity(spec?.kind, body)], cursor: null, raw: payload };

    const data = body["data"];
    if (!Array.isArray(data))
      throw new ConnectorError("malformed_response", "Facebook Pages list response did not contain a collection", {
        retryable: false,
      });
    const paging = asRecord(body["paging"]);
    const after = asRecord(paging["cursors"])["after"];
    const cursor = paging["next"] && typeof after === "string" ? after : null;
    return { items: data.map((item) => mapEntity(spec.kind, item)), cursor, raw: payload };
  },
};
