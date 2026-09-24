import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  FACEBOOK_API_VERSION,
  UNSUPPORTED_OPERATIONS,
  facebookPagesConnector,
} from "@/lib/connectors/adapters/facebook-pages";
import {
  normalizeFacebookComment,
  normalizeFacebookPage,
  normalizeFacebookPagesWebhookEvent,
  normalizeFacebookPost,
} from "@/lib/connectors/adapters/facebook-pages-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { PROVIDERS } from "@/lib/integrations/catalog";
import { describeOAuthProviders, getOAuthProvider } from "@/lib/oauth/providers";
import { verifyWebhook } from "@/lib/webhooks/verify";

/**
 * Facebook Pages connector — production test suite, held to the same contract
 * as every other ZYRONEX connector.
 */

const trace = "trace-facebook-pages";
const PAGE_ID = "104000000000001";
const POST_ID = `${PAGE_ID}_200000000000002`;
const COMMENT_ID = `${POST_ID.split("_")[1]}_300000000000003`;
const creds = { access_token: "EAAPAGE_secret_page_token", page_id: PAGE_ID };
const APP_SECRET = "meta-facebook-app-secret";
const BASE = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function run(
  input: Parameters<typeof runConnectorOperation>[0]["input"],
  fetchImpl: typeof fetch,
  credentials: Record<string, string> = creds,
  extra: Partial<Parameters<typeof runConnectorOperation>[0]> = {},
) {
  return runConnectorOperation({
    adapter: facebookPagesConnector,
    credentials,
    traceId: trace,
    input,
    fetchImpl,
    sleep: async () => {},
    ...extra,
  });
}

function capture(response: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit ?? {} });
    return jsonResponse(response, init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const body = (call: { init: RequestInit } | undefined) => JSON.parse(String(call?.init.body ?? "{}")) as Record<string, unknown>;
const auth = (call: { init: RequestInit } | undefined) => (call?.init.headers as Record<string, string>)["authorization"];

function feedEvent(value: Record<string, unknown>, time = Math.floor(Date.now() / 1000)) {
  return { object: "page", entry: [{ id: PAGE_ID, time, changes: [{ field: "feed", value }] }] };
}
const COMMENT_EVENT = feedEvent({
  item: "comment",
  verb: "add",
  comment_id: COMMENT_ID,
  post_id: POST_ID,
  parent_id: POST_ID,
  message: "كم السعر؟",
  from: { id: "5550001", name: "Customer" },
  created_time: 1760000000,
});
const REACTION_EVENT = feedEvent({
  item: "reaction",
  verb: "add",
  post_id: POST_ID,
  reaction_type: "love",
  from: { id: "5550002" },
  created_time: 1760000001,
});
const POST_EVENT = feedEvent({ item: "status", verb: "add", post_id: POST_ID, message: "New", published: 1, created_time: 1760000002 });

const sign = (raw: string, secret = APP_SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
function verifierInput(raw: string, headers: Record<string, string>) {
  return { raw, headers, payload: JSON.parse(raw) as unknown, secret: APP_SECRET, nowMs: Date.now(), replayWindowMs: 300_000 };
}
const verifySigned = (payload: unknown) => {
  const raw = JSON.stringify(payload);
  return verifyWebhook("facebook_pages", verifierInput(raw, { "x-hub-signature-256": sign(raw) }));
};

/* Registry & contract */
describe("facebook pages registration", () => {
  it("is registered under its id and aliases", () => {
    for (const id of ["facebook_pages", "facebook", "facebook_page", "meta_pages"])
      expect(getConnector(id)?.id).toBe("facebook_pages");
  });

  it("exposes capabilities without credentials", () => {
    const described = describeConnectors().find((entry) => entry.id === "facebook_pages");
    expect(described).toMatchObject({ label: "Facebook Pages", authKind: "bearer" });
    expect(described?.requiredCredentials).toEqual(["access_token", "page_id"]);
    expect(JSON.stringify(described)).not.toMatch(/EAA/);
  });

  it("declares the official page, post, comment, reaction, insight and subscription operations", () => {
    expect(facebookPagesConnector.operations).toEqual(
      expect.arrayContaining([
        "list_managed_pages", "get_page", "update_page", "get_page_insights",
        "list_posts", "list_published_posts", "list_scheduled_posts", "get_post", "create_post",
        "create_photo_post", "create_video_post", "update_post", "delete_post", "get_post_insights",
        "list_comments", "get_comment", "create_comment", "reply_to_comment", "update_comment",
        "hide_comment", "delete_comment", "list_reactions",
        "list_subscribed_apps", "subscribe_app", "unsubscribe_app",
      ]),
    );
  });

  it("does not implement messaging — it belongs to the Messenger connector", () => {
    expect(facebookPagesConnector.operations.some((op) => /message|conversation/.test(op))).toBe(false);
    expect(facebookPagesConnector.capabilities).not.toContain("messaging");
    expect(UNSUPPORTED_OPERATIONS["send_page_message"]).toMatch(/Messenger/);
  });

  it("documents unsupported operations and never exposes them", () => {
    for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) {
      expect(facebookPagesConnector.operations).not.toContain(op);
      expect(() => facebookPagesConnector.buildCall({ operation: op })).toThrow(/Unknown Facebook Pages operation/);
    }
  });

  it("contains no business logic", () => {
    const source = facebookPagesConnector.buildCall.toString() + facebookPagesConnector.normalize.toString();
    expect(source).not.toMatch(/supabase|workspace|openai|gemini|agent|crm/i);
  });

  it("targets only the official graph host and pinned version", () => {
    expect(facebookPagesConnector.buildCall({ operation: "get_page" }).url).toBe(`${BASE}/facebook-page-id-placeholder`);
  });
});

/* OAuth / scopes / connection accounts */
describe("facebook pages oauth", () => {
  it("uses the official Meta dialog and token endpoints", () => {
    const spec = getOAuthProvider("facebook_pages");
    expect(spec?.authorizationUrl).toBe(`https://www.facebook.com/${FACEBOOK_API_VERSION}/dialog/oauth`);
    expect(spec?.tokenUrl).toBe(`${BASE}/oauth/access_token`);
    expect(spec?.scopeSeparator).toBe(",");
  });

  it("requests only documented Pages permissions", () => {
    const scopes = getOAuthProvider("facebook_pages")?.scopes ?? [];
    expect(scopes).toEqual(expect.arrayContaining(["pages_show_list", "pages_manage_posts", "pages_manage_engagement", "read_insights"]));
    for (const scope of scopes) expect(scope).toMatch(/^(pages_|read_insights$)/);
    expect(scopes).not.toContain("pages_messaging");
  });

  it("resolves through aliases and is non-refreshable with a long-lived default", () => {
    const spec = getOAuthProvider("facebook");
    expect(spec?.connector).toBe("facebook_pages");
    expect(spec?.refreshable).toBe(false);
    expect(spec?.defaultExpiresInSeconds).toBe(60 * 24 * 60 * 60);
  });

  it("stores the exchanged user token as the page-discovery credential", () => {
    expect(getOAuthProvider("facebook_pages")?.credentialFields?.({ access_token: "user-tok" })).toEqual({ user_access_token: "user-tok" });
    expect(getOAuthProvider("facebook_pages")?.credentialFields?.({})).toEqual({});
  });

  it("identifies the connection account", () => {
    expect(getOAuthProvider("facebook_pages")?.identify?.({ page_id: PAGE_ID })).toEqual({
      accountIdentifier: PAGE_ID,
      accountLabel: `Facebook Page ${PAGE_ID}`,
    });
  });

  it("is listed without secrets and the catalog marks tokens as secret", () => {
    const listed = describeOAuthProviders().find((entry) => entry.connector === "facebook_pages");
    expect(listed).toMatchObject({ refreshable: false });
    const provider = PROVIDERS.find((entry) => entry.id === "facebook_pages");
    const fields = Object.fromEntries((provider?.credentialFields ?? []).map((f) => [f.key, f.secret]));
    expect(fields).toMatchObject({ access_token: true, user_access_token: true, app_secret: true, page_id: false });
  });
});

/* Authentication */
describe("facebook pages authentication", () => {
  it("never calls the network without a token", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "get_page" }, fetchImpl, { access_token: "", page_id: PAGE_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("enforces the page id at the vault boundary", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "get_page" }, fetchImpl, { access_token: "t" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/page_id/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a page id that could rewrite the path", () => {
    expect(() =>
      facebookPagesConnector.authorize(facebookPagesConnector.buildCall({ operation: "get_page" }), {
        access_token: "t",
        page_id: "../me",
      }),
    ).toThrow(/Page ID is missing/);
  });

  it("rejects an object id that could rewrite the path", () => {
    expect(() => facebookPagesConnector.buildCall({ operation: "get_post", params: { post_id: "../../me/accounts" } })).toThrow(
      /valid Graph object id/,
    );
  });

  it("sends the page token as bearer on page calls", async () => {
    const { calls, fetchImpl } = capture({ id: PAGE_ID });
    await run({ operation: "get_page" }, fetchImpl, { ...creds, user_access_token: "user-tok" });
    expect(auth(calls[0])).toBe(`Bearer ${creds.access_token}`);
    expect(calls[0]?.url).toContain(`/${PAGE_ID}`);
  });

  it("never leaks the internal token-scope hint to Meta", async () => {
    const { calls, fetchImpl } = capture({ data: [] });
    await run({ operation: "list_managed_pages" }, fetchImpl, { ...creds, user_access_token: "user-tok" });
    expect(Object.keys(calls[0]?.init.headers as Record<string, string>)).not.toContain("x-zyronex-token-scope");
  });
});

/* Page discovery / info */
describe("facebook pages discovery and information", () => {
  it("discovers managed pages with the user token", async () => {
    const { calls, fetchImpl } = capture({
      data: [{ id: PAGE_ID, name: "ZYRONEX", category: "Software", access_token: "EAAPAGE_other", tasks: ["MANAGE", "CREATE_CONTENT"] }],
    });
    const result = await run({ operation: "list_managed_pages" }, fetchImpl, { ...creds, user_access_token: "user-tok" });
    expect(calls[0]?.url).toContain(`${BASE}/me/accounts`);
    expect(auth(calls[0])).toBe("Bearer user-tok");
    if (result.ok) {
      expect(result.items[0]).toMatchObject({ object: "page", id: PAGE_ID, tasks: ["MANAGE", "CREATE_CONTENT"], has_page_token: true });
      expect(JSON.stringify(result.items)).not.toContain("EAAPAGE_other");
    }
  });

  it("falls back to the page token for discovery when no user token exists", async () => {
    const { calls, fetchImpl } = capture({ data: [] });
    await run({ operation: "list_managed_pages" }, fetchImpl);
    expect(auth(calls[0])).toBe(`Bearer ${creds.access_token}`);
  });

  it("normalizes page information", async () => {
    const { calls, fetchImpl } = capture({ id: PAGE_ID, name: "ZYRONEX", fan_count: 1200, followers_count: 1500, username: "zyronex" });
    const result = await run({ operation: "get_page", params: { fields: ["id", "name", "fan_count"] } }, fetchImpl);
    expect(calls[0]?.url).toContain("fields=id%2Cname%2Cfan_count");
    if (result.ok) expect(result.items[0]).toMatchObject({ name: "ZYRONEX", fan_count: 1200, followers_count: 1500 });
  });

  it("updates page fields through the page node", async () => {
    const { calls, fetchImpl } = capture({ success: true });
    await run({ operation: "update_page", params: { about: "AI", secret_field: "x" } }, fetchImpl);
    expect(calls[0]?.init.method).toBe("POST");
    expect(body(calls[0])).toEqual({ about: "AI" });
  });
});

/* Posts */
describe("facebook pages posts", () => {
  it("lists feed, published and scheduled posts", async () => {
    for (const [op, edge] of [["list_posts", "feed"], ["list_published_posts", "published_posts"], ["list_scheduled_posts", "scheduled_posts"]]) {
      const { calls, fetchImpl } = capture({ data: [{ id: POST_ID, message: "Hi", created_time: "2026-01-01T00:00:00+0000" }] });
      const result = await run({ operation: op! }, fetchImpl);
      expect(calls[0]?.url).toContain(`/${PAGE_ID}/${edge}`);
      if (result.ok) expect(result.items[0]).toMatchObject({ object: "post", id: POST_ID, created_at: "2026-01-01T00:00:00.000Z" });
    }
  });

  it("creates a text/link post on the page feed", async () => {
    const { calls, fetchImpl } = capture({ id: POST_ID });
    const result = await run({ operation: "create_post", params: { message: "Hello", link: "https://zyronex.ai" } }, fetchImpl);
    expect(calls[0]?.url).toContain(`/${PAGE_ID}/feed`);
    expect(body(calls[0])).toEqual({ message: "Hello", link: "https://zyronex.ai" });
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "publish_result", post_id: POST_ID, success: true });
  });

  it("schedules a post with the official unpublished + scheduled_publish_time pair", async () => {
    const { calls, fetchImpl } = capture({ id: POST_ID });
    await run({ operation: "create_post", params: { message: "Later", published: false, scheduled_publish_time: 1800000000 } }, fetchImpl);
    expect(body(calls[0])).toMatchObject({ published: false, scheduled_publish_time: 1800000000 });
  });

  it("publishes a photo from a public url", async () => {
    const { calls, fetchImpl } = capture({ id: "400000000000004", post_id: POST_ID });
    const result = await run({ operation: "create_photo_post", params: { url: "https://cdn/x.jpg", caption: "c" } }, fetchImpl);
    expect(calls[0]?.url).toContain(`/${PAGE_ID}/photos`);
    if (result.ok) expect(result.items[0]).toMatchObject({ post_id: POST_ID });
  });

  it("requires the public url for photos and file_url for videos", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    for (const op of ["create_photo_post", "create_video_post"]) {
      const result = await run({ operation: op, params: {} }, fetchImpl);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid_request");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("publishes a video from file_url", async () => {
    const { calls, fetchImpl } = capture({ id: "500000000000005" });
    await run({ operation: "create_video_post", params: { file_url: "https://cdn/v.mp4", description: "d" } }, fetchImpl);
    expect(calls[0]?.url).toContain(`/${PAGE_ID}/videos`);
  });

  it("reads, updates and deletes a post", async () => {
    const read = capture({ id: POST_ID, message: "x", shares: { count: 3 }, comments: { summary: { total_count: 7 } } });
    const got = await run({ operation: "get_post", params: { post_id: POST_ID } }, read.fetchImpl);
    if (got.ok) expect(got.items[0]).toMatchObject({ shares: 3, comments_count: 7 });
    const upd = capture({ success: true });
    await run({ operation: "update_post", params: { post_id: POST_ID, message: "edited" } }, upd.fetchImpl);
    expect(upd.calls[0]?.url).toBe(`${BASE}/${POST_ID}`);
    const del = capture({ success: true });
    await run({ operation: "delete_post", params: { post_id: POST_ID } }, del.fetchImpl);
    expect(del.calls[0]?.init.method).toBe("DELETE");
    expect(del.calls[0]?.init.body).toBeUndefined();
  });
});

/* Comments / replies */
describe("facebook pages comments", () => {
  it("lists comments on a post", async () => {
    const { calls, fetchImpl } = capture({ data: [{ id: COMMENT_ID, message: "hi", from: { id: "5550001", name: "C" } }] });
    const result = await run({ operation: "list_comments", params: { object_id: POST_ID, filter: "stream" } }, fetchImpl);
    expect(calls[0]?.url).toContain(`/${POST_ID}/comments`);
    expect(calls[0]?.url).toContain("filter=stream");
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "comment", author_id: "5550001" });
  });

  it("comments on a post and replies to a comment", async () => {
    const a = capture({ id: COMMENT_ID });
    await run({ operation: "create_comment", params: { object_id: POST_ID, message: "thanks" } }, a.fetchImpl);
    expect(a.calls[0]?.url).toContain(`/${POST_ID}/comments`);
    const b = capture({ id: "600_700" });
    await run({ operation: "reply_to_comment", params: { comment_id: COMMENT_ID, message: "reply" } }, b.fetchImpl);
    expect(b.calls[0]?.url).toContain(`/${COMMENT_ID}/comments`);
    expect(body(b.calls[0])).toEqual({ message: "reply" });
  });

  it("edits the page's own comment", async () => {
    const { calls, fetchImpl } = capture({ success: true });
    await run({ operation: "update_comment", params: { comment_id: COMMENT_ID, message: "fixed" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ message: "fixed" });
  });

  it("hides, unhides and deletes comments", async () => {
    const hide = capture({ success: true });
    await run({ operation: "hide_comment", params: { comment_id: COMMENT_ID, is_hidden: true } }, hide.fetchImpl);
    expect(body(hide.calls[0])).toEqual({ is_hidden: true });
    const unhide = capture({ success: true });
    await run({ operation: "hide_comment", params: { comment_id: COMMENT_ID, is_hidden: false } }, unhide.fetchImpl);
    expect(body(unhide.calls[0])).toEqual({ is_hidden: false });
    const del = capture({ success: true });
    await run({ operation: "delete_comment", params: { comment_id: COMMENT_ID } }, del.fetchImpl);
    expect(del.calls[0]?.init.method).toBe("DELETE");
  });

  it("requires a message before replying", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "reply_to_comment", params: { comment_id: COMMENT_ID } }, fetchImpl);
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/* Reactions */
describe("facebook pages reactions", () => {
  it("reads reactions (the only reaction access Meta allows)", async () => {
    const { calls, fetchImpl } = capture({ data: [{ id: "5550002", name: "U", type: "LOVE" }] });
    const result = await run({ operation: "list_reactions", params: { object_id: POST_ID, type: "LOVE" } }, fetchImpl);
    expect(calls[0]?.init.method).toBe("GET");
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "reaction", type: "LOVE" });
  });

  it("does not offer creating reactions", () => {
    expect(UNSUPPORTED_OPERATIONS["create_reaction"]).toBeDefined();
  });
});

/* Insights */
describe("facebook pages insights", () => {
  it("normalizes page insights", async () => {
    const { calls, fetchImpl } = capture({
      data: [{ name: "page_impressions", period: "day", values: [{ value: 42, end_time: "2026-01-02T08:00:00+0000" }] }],
    });
    const result = await run({ operation: "get_page_insights", params: { metric: ["page_impressions"], period: "day" } }, fetchImpl);
    expect(calls[0]?.url).toContain(`/${PAGE_ID}/insights`);
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "insight", name: "page_impressions", values: [{ value: 42 }] });
  });

  it("reads post insights and requires a metric", async () => {
    const { calls, fetchImpl } = capture({ data: [] });
    await run({ operation: "get_post_insights", params: { post_id: POST_ID, metric: "post_impressions" } }, fetchImpl);
    expect(calls[0]?.url).toContain(`/${POST_ID}/insights`);
    const none = vi.fn() as unknown as typeof fetch;
    expect((await run({ operation: "get_page_insights" }, none)).ok).toBe(false);
  });
});

/* Health */
describe("facebook pages health check", () => {
  it("verifies the connection through the page node", async () => {
    const { calls, fetchImpl } = capture({ id: PAGE_ID, name: "ZYRONEX" });
    const health = await checkConnectorHealth({ adapter: facebookPagesConnector, credentials: creds, traceId: trace, fetchImpl });
    expect(health).toMatchObject({ connector: "facebook_pages", healthy: true, status: 200 });
    expect(calls[0]?.url).toBe(`${BASE}/${PAGE_ID}`);
  });

  it("reports an unhealthy connection without the token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: `Invalid token ${creds.access_token}`, code: 190 } }, { status: 401 }),
    ) as unknown as typeof fetch;
    const health = await checkConnectorHealth({ adapter: facebookPagesConnector, credentials: creds, traceId: trace, fetchImpl });
    expect(health.healthy).toBe(false);
    expect(health.message).not.toContain(creds.access_token);
  });
});

/* Pagination */
describe("facebook pages pagination", () => {
  it("follows the after cursor only while a next link exists", async () => {
    const pages = [
      jsonResponse({ data: [{ id: "1" }], paging: { cursors: { after: "A" }, next: "https://graph/next" } }),
      jsonResponse({ data: [{ id: "2" }], paging: { cursors: { after: "B" } } }),
    ];
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return pages.shift()!;
    }) as unknown as typeof fetch;
    const result = await run({ operation: "list_posts", maxPages: 5 }, fetchImpl);
    if (result.ok) {
      expect(result.items).toHaveLength(2);
      expect(result.pages).toBe(2);
      expect(result.cursor).toBeNull();
    }
    expect(urls[1]).toContain("after=A");
  });

  it("stops at the page budget and honours limit", async () => {
    const { calls, fetchImpl } = capture({ data: [{ id: "1" }], paging: { cursors: { after: "A" }, next: "n" } });
    const result = await run({ operation: "list_posts", params: { limit: 10 }, maxPages: 2 }, fetchImpl);
    if (result.ok) expect(result.pages).toBe(2);
    expect(calls[0]?.url).toContain("limit=10");
  });

  it("resumes from a supplied cursor", async () => {
    const { calls, fetchImpl } = capture({ data: [] });
    await run({ operation: "list_comments", params: { object_id: POST_ID }, cursor: "RESUME" }, fetchImpl);
    expect(calls[0]?.url).toContain("after=RESUME");
  });
});

/* Rate limits & retry */
describe("facebook pages rate limits and retries", () => {
  it("reads X-App-Usage", async () => {
    const { fetchImpl } = capture({ id: PAGE_ID }, { headers: { "x-app-usage": JSON.stringify({ call_count: 40 }) } });
    const result = await run({ operation: "get_page" }, fetchImpl);
    if (result.ok) expect(result.rateLimit).toMatchObject({ limit: 100, remaining: 60 });
  });

  it("reads the official X-Page-Usage header", async () => {
    const { fetchImpl } = capture({ id: PAGE_ID }, { headers: { "x-page-usage": JSON.stringify({ call_count: 95, estimated_time_to_regain_access: 1 }) } });
    const result = await run({ operation: "get_page" }, fetchImpl);
    if (result.ok) expect(result.rateLimit).toMatchObject({ remaining: 5, retryAfterMs: 60_000 });
  });

  it("reads business use case usage keyed by page id", async () => {
    const { fetchImpl } = capture({ id: PAGE_ID }, { headers: { "x-business-use-case-usage": JSON.stringify({ [PAGE_ID]: [{ call_count: 80 }] }) } });
    const result = await run({ operation: "get_page" }, fetchImpl);
    if (result.ok) expect(result.rateLimit).toMatchObject({ remaining: 20 });
  });

  it("tolerates a malformed quota header", async () => {
    const { fetchImpl } = capture({ id: PAGE_ID }, { headers: { "x-page-usage": "nope" } });
    expect((await run({ operation: "get_page" }, fetchImpl)).ok).toBe(true);
  });

  it("retries a 429 with Retry-After and succeeds", async () => {
    const responses = [
      jsonResponse({ error: { message: "limit", code: 32 } }, { status: 429, headers: { "retry-after": "1" } }),
      jsonResponse({ id: PAGE_ID }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
    const result = await run({ operation: "get_page" }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
  });

  it("treats page throttling code 32 on a 400 as retryable", async () => {
    const responses = [jsonResponse({ error: { message: "Page request limit", code: 32 } }, { status: 400 }), jsonResponse({ id: PAGE_ID })];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
    expect((await run({ operation: "get_page" }, fetchImpl)).ok).toBe(true);
  });

  it("gives up after the attempt budget on a persistent 500", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "x", code: 1 } }, { status: 500 })) as unknown as typeof fetch;
    const result = await run({ operation: "get_page" }, fetchImpl);
    if (!result.ok) {
      expect(result.error.kind).toBe("provider");
      expect(result.attempts).toBe(3);
    }
  });

  it("does not retry a non-retryable auth failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { code: 190 } }, { status: 401 })) as unknown as typeof fetch;
    await run({ operation: "get_page" }, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps an aborted request to a timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    const result = await run({ operation: "get_page" }, fetchImpl, creds, { timeoutMs: 5 });
    if (!result.ok) expect(result.error.kind).toBe("timeout");
  });
});

/* Error normalization */
describe("facebook pages error normalization", () => {
  const cases: [number, number, string][] = [
    [401, 190, "auth"],
    [403, 10, "forbidden"],
    [400, 200, "forbidden"],
    [404, 803, "not_found"],
    [400, 100, "invalid_request"],
    [429, 4, "rate_limit"],
    [400, 613, "rate_limit"],
    [500, 2, "provider"],
  ];
  for (const [status, code, kind] of cases)
    it(`maps HTTP ${status} / code ${code} to ${kind}`, async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "failure", code } }, { status })) as unknown as typeof fetch;
      const result = await run({ operation: "get_page" }, fetchImpl, creds, { maxAttempts: 1 });
      if (!result.ok) {
        expect(result.error.kind).toBe(kind);
        expect(result.error.message).toMatch(/^Facebook Pages:/);
      } else throw new Error("expected failure");
    });

  it("treats a 200 envelope carrying an error as a failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "bad", code: 100 } })) as unknown as typeof fetch;
    expect((await run({ operation: "get_page" }, fetchImpl, creds, { maxAttempts: 1 })).ok).toBe(false);
  });

  it("flags malformed and empty responses", async () => {
    const list = await run({ operation: "list_posts" }, capture({ data: "x" }).fetchImpl, creds, { maxAttempts: 1 });
    if (!list.ok) expect(list.error.kind).toBe("malformed_response");
    const empty = await run({ operation: "get_page" }, capture({}).fetchImpl, creds, { maxAttempts: 1 });
    if (!empty.ok) expect(empty.error.kind).toBe("malformed_response");
  });

  it("rejects an unknown operation without calling Meta", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "boost_post" }, fetchImpl);
    if (!result.ok) expect(result.error.kind).toBe("unsupported");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/* Idempotency */
describe("facebook pages idempotency", () => {
  it("never invents an undocumented idempotency header or field", async () => {
    const { calls, fetchImpl } = capture({ id: POST_ID });
    await run({ operation: "create_post", params: { message: "x", idempotency_key: "k-1" } }, fetchImpl, creds, { idempotencyKey: "k-1" } as never);
    expect(JSON.stringify(calls[0]?.init.headers)).not.toMatch(/idempotency/i);
    expect(body(calls[0])).toEqual({ message: "x" });
  });

  it("produces byte-identical calls for identical inputs so the runtime can dedupe", () => {
    const a = facebookPagesConnector.buildCall({ operation: "create_post", params: { message: "same" } });
    const b = facebookPagesConnector.buildCall({ operation: "create_post", params: { message: "same" } });
    expect(a).toEqual(b);
  });
});

/* Webhooks */
describe("facebook pages webhooks", () => {
  it("accepts a signed comment event with a typed event", () => {
    const v = verifySigned(COMMENT_EVENT);
    expect(v.ok).toBe(true);
    expect(v.eventType).toBe("feed.comment.add");
    expect(v.eventId).toContain(COMMENT_ID);
  });

  it("rejects tampered bodies, wrong secrets and missing signatures", () => {
    const raw = JSON.stringify(COMMENT_EVENT);
    expect(verifyWebhook("facebook_pages", verifierInput(raw.replace("كم", "xx"), { "x-hub-signature-256": sign(raw) })).reason).toBe(
      "invalid_signature",
    );
    expect(verifyWebhook("facebook_pages", verifierInput(raw, { "x-hub-signature-256": sign(raw, "other") })).ok).toBe(false);
    expect(verifyWebhook("facebook_pages", verifierInput(raw, {})).reason).toBe("invalid_signature");
  });

  it("reports a missing app secret", () => {
    const raw = JSON.stringify(COMMENT_EVENT);
    expect(verifyWebhook("facebook_pages", { ...verifierInput(raw, { "x-hub-signature-256": sign(raw) }), secret: "" }).reason).toBe(
      "missing_secret",
    );
  });

  it("rejects a replay outside the window", () => {
    const stale = { ...COMMENT_EVENT, entry: [{ ...COMMENT_EVENT.entry[0]!, time: Math.floor(Date.now() / 1000) - 7200 }] };
    expect(verifySigned(stale).reason).toBe("replay");
  });

  it("deduplicates redeliveries with a stable event id", () => {
    expect(verifySigned(COMMENT_EVENT).eventId).toBe(verifySigned(JSON.parse(JSON.stringify(COMMENT_EVENT))).eventId);
  });

  it("distinguishes edits, removals, reactions and posts", () => {
    const edited = feedEvent({ ...COMMENT_EVENT.entry[0]!.changes[0]!.value, verb: "edited" });
    const ids = new Set([verifySigned(COMMENT_EVENT).eventId, verifySigned(edited).eventId, verifySigned(REACTION_EVENT).eventId, verifySigned(POST_EVENT).eventId]);
    expect(ids.size).toBe(4);
    expect(verifySigned(REACTION_EVENT).eventType).toBe("feed.reaction.add");
    expect(verifySigned(POST_EVENT).eventType).toBe("feed.status.add");
  });

  it("gives reactions from different users distinct ids", () => {
    const other = feedEvent({ ...REACTION_EVENT.entry[0]!.changes[0]!.value, from: { id: "5550009" } });
    expect(verifySigned(other).eventId).not.toBe(verifySigned(REACTION_EVENT).eventId);
  });

  it("resolves the verifier through aliases", () => {
    const raw = JSON.stringify(COMMENT_EVENT);
    expect(verifyWebhook("facebook", verifierInput(raw, { "x-hub-signature-256": sign(raw) })).ok).toBe(true);
  });

  it("manages page webhook subscriptions through the official edge", async () => {
    const sub = capture({ success: true });
    await run({ operation: "subscribe_app", params: { subscribed_fields: ["feed", "mention"] } }, sub.fetchImpl);
    expect(sub.calls[0]?.url).toContain(`/${PAGE_ID}/subscribed_apps`);
    expect(body(sub.calls[0])).toEqual({ subscribed_fields: "feed,mention" });
    const list = capture({ data: [{ id: "app", subscribed_fields: ["feed"] }] });
    expect((await run({ operation: "list_subscribed_apps" }, list.fetchImpl)).ok).toBe(true);
    const un = capture({ success: true });
    await run({ operation: "unsubscribe_app" }, un.fetchImpl);
    expect(un.calls[0]?.init.method).toBe("DELETE");
  });
});

/* Webhook normalization */
describe("facebook pages webhook normalization", () => {
  it("normalizes a comment event", () => {
    const event = normalizeFacebookPagesWebhookEvent(COMMENT_EVENT);
    expect(event).toMatchObject({ event: "feed.comment.add", page_id: PAGE_ID });
    expect(event.comments[0]).toMatchObject({ id: COMMENT_ID, post_id: POST_ID, parent_id: null, author_id: "5550001" });
  });

  it("keeps the parent for a nested reply", () => {
    const reply = feedEvent({ item: "comment", verb: "add", comment_id: "9_9", post_id: POST_ID, parent_id: COMMENT_ID });
    expect(normalizeFacebookPagesWebhookEvent(reply).comments[0]?.parent_id).toBe(COMMENT_ID);
  });

  it("normalizes reactions and posts", () => {
    expect(normalizeFacebookPagesWebhookEvent(REACTION_EVENT).reactions[0]).toMatchObject({ reaction_type: "love", user_id: "5550002" });
    expect(normalizeFacebookPagesWebhookEvent(POST_EVENT).posts[0]).toMatchObject({ id: POST_ID, is_published: true });
  });

  it("keeps every batched entry", () => {
    const batch = { object: "page", entry: [COMMENT_EVENT.entry[0], REACTION_EVENT.entry[0]] };
    const event = normalizeFacebookPagesWebhookEvent(batch);
    expect(event.changes).toHaveLength(2);
    expect(event.comments).toHaveLength(1);
    expect(event.reactions).toHaveLength(1);
  });

  it("tolerates an empty envelope", () => {
    expect(normalizeFacebookPagesWebhookEvent({})).toMatchObject({ event: null, changes: [] });
  });

  it("normalizes standalone objects defensively", () => {
    expect(normalizeFacebookPage({}).has_page_token).toBe(false);
    expect(normalizeFacebookPost({ post_id: POST_ID, scheduled_publish_time: 1800000000 }).scheduled_publish_time).toBe(
      new Date(1800000000 * 1000).toISOString(),
    );
    expect(normalizeFacebookComment({ id: COMMENT_ID, is_hidden: true }).is_hidden).toBe(true);
  });
});

/* Isolation, redaction, tracing */
describe("facebook pages isolation, redaction and tracing", () => {
  it("never mixes two workspaces' tokens or pages", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push(`${String(url)}|${String((init?.headers as Record<string, string>)["authorization"])}`);
      return jsonResponse({ id: PAGE_ID });
    }) as unknown as typeof fetch;
    await run({ operation: "get_page" }, fetchImpl, { access_token: "tok-a", page_id: PAGE_ID });
    await run({ operation: "get_page" }, fetchImpl, { access_token: "tok-b", page_id: "104000000000009" });
    expect(seen).toEqual([`${BASE}/${PAGE_ID}|Bearer tok-a`, `${BASE}/104000000000009|Bearer tok-b`]);
  });

  it("never echoes tokens in errors", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: `Bad ${creds.access_token}`, code: 190 } }, { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await run({ operation: "get_page" }, fetchImpl);
    expect(JSON.stringify(result)).not.toContain(creds.access_token);
  });

  it("never returns discovered page tokens in normalized items", async () => {
    const { fetchImpl } = capture({ data: [{ id: PAGE_ID, access_token: "EAAPAGE_leak" }] });
    const result = await run({ operation: "list_managed_pages" }, fetchImpl);
    expect(JSON.stringify(result.ok ? result.items : result)).not.toContain("EAAPAGE_leak");
  });

  it("carries the trace id on success and failure", async () => {
    expect((await run({ operation: "get_page" }, capture({ id: PAGE_ID }).fetchImpl)).traceId).toBe(trace);
    const failing = vi.fn(async () => jsonResponse({ error: { code: 190 } }, { status: 401 })) as unknown as typeof fetch;
    expect((await run({ operation: "get_page" }, failing)).traceId).toBe(trace);
  });

  it("emits redacted breadcrumbs on retry", async () => {
    const events: { level: string; message: string }[] = [];
    const responses = [jsonResponse({ error: { code: 4 } }, { status: 429 }), jsonResponse({ id: PAGE_ID })];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
    await run({ operation: "get_page" }, fetchImpl, creds, { onEvent: (e) => events.push({ level: e.level, message: e.message }) });
    expect(events.some((e) => e.level === "warn")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(creds.access_token);
  });
});
