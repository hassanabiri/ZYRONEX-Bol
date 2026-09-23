import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  INSTAGRAM_API_VERSION,
  UNSUPPORTED_OPERATIONS,
  instagramConnector,
} from "@/lib/connectors/adapters/instagram";
import {
  normalizeInstagramComment,
  normalizeInstagramMessage,
  normalizeInstagramWebhookEvent,
} from "@/lib/connectors/adapters/instagram-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { describeOAuthProviders, getOAuthProvider } from "@/lib/oauth/providers";
import { verifyWebhook } from "@/lib/webhooks/verify";

/**
 * Instagram connector — production test suite.
 *
 * Holds Instagram to the same contract as Salla, Zid, Shopify, WooCommerce and
 * WhatsApp: OAuth/auth, connection accounts, scopes, messages, webhooks, event
 * deduplication, idempotency, media/publishing, comments, pagination, rate
 * limits, retry/backoff, error normalization, health, workspace isolation,
 * secret redaction and trace ids.
 */

const trace = "trace-instagram";
const IG_ID = "17841400000000001";
const creds = {
  access_token: "IGQV_permanent_secret_token",
  instagram_account_id: IG_ID,
};
const APP_SECRET = "meta-instagram-app-secret";

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
    adapter: instagramConnector,
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

const INBOUND_DM = {
  object: "instagram",
  entry: [
    {
      id: IG_ID,
      time: Date.now(),
      messaging: [
        {
          sender: { id: "9988776655" },
          recipient: { id: IG_ID },
          timestamp: Date.now(),
          message: { mid: "aWdfZG1faXRlbTox", text: "مرحبا" },
        },
      ],
    },
  ],
};

const COMMENT_EVENT = {
  object: "instagram",
  entry: [
    {
      id: IG_ID,
      time: Date.now(),
      changes: [
        {
          field: "comments",
          value: {
            id: "17900000000000001",
            text: "كم السعر؟",
            from: { id: "9988776655", username: "customer" },
            media: { id: "17800000000000002" },
          },
        },
      ],
    },
  ],
};

function verifierInput(raw: string, headers: Record<string, string>) {
  return {
    raw,
    headers,
    payload: JSON.parse(raw) as unknown,
    secret: APP_SECRET,
    nowMs: Date.now(),
    replayWindowMs: 300_000,
  };
}

function sign(raw: string, secret = APP_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

/* ------------------------------------------------------------------ */
/* Registry & contract                                                */
/* ------------------------------------------------------------------ */

describe("instagram connector registration", () => {
  it("is registered under its id and aliases", () => {
    expect(getConnector("instagram")?.id).toBe("instagram");
    expect(getConnector("instagram_business")?.id).toBe("instagram");
    expect(getConnector("instagram_graph")?.id).toBe("instagram");
    expect(getConnector("instagram_messaging")?.id).toBe("instagram");
  });

  it("exposes capabilities without ever exposing credentials", () => {
    const described = describeConnectors().find((entry) => entry.id === "instagram");
    expect(described).toMatchObject({ label: "Instagram", authKind: "bearer" });
    expect(described?.capabilities).toEqual(
      expect.arrayContaining(["messaging", "pagination", "webhook", "health_check", "files"]),
    );
    expect(described?.requiredCredentials).toEqual(["access_token", "instagram_account_id"]);
    expect(JSON.stringify(described)).not.toContain("IGQV");
  });

  it("declares the official account, media, publishing, comment and messaging operations", () => {
    for (const operation of [
      "get_account",
      "get_account_insights",
      "list_media",
      "get_media",
      "get_media_insights",
      "create_media_container",
      "publish_media",
      "get_media_container",
      "get_publishing_limit",
      "list_media_comments",
      "get_comment",
      "reply_to_comment",
      "hide_comment",
      "delete_comment",
      "send_message",
      "send_reply",
      "send_sender_action",
      "list_conversations",
      "get_conversation",
      "get_message",
      "list_subscribed_apps",
      "subscribe_app",
      "unsubscribe_app",
    ])
      expect(instagramConnector.operations).toContain(operation);
  });

  it("documents the operations Meta does not support instead of faking them", () => {
    for (const key of ["upload_media_binary", "edit_message", "delete_media", "send_unsolicited_message"])
      expect(UNSUPPORTED_OPERATIONS[key]).toBeTruthy();
    for (const key of Object.keys(UNSUPPORTED_OPERATIONS)) expect(instagramConnector.operations).not.toContain(key);
  });

  it("contains no business logic: it only talks to the Graph API", () => {
    const source = instagramConnector.buildCall.toString() + instagramConnector.normalize.toString();
    expect(source).not.toMatch(/supabase|workspace|openai|gemini|agent|crm/i);
  });

  it("targets only the official graph host and pinned API version", () => {
    const call = instagramConnector.buildCall({ operation: "get_account" });
    expect(call.url).toBe(`https://graph.facebook.com/${INSTAGRAM_API_VERSION}/instagram-account-id-placeholder`);
  });
});

/* ------------------------------------------------------------------ */
/* OAuth, connection accounts and scopes                              */
/* ------------------------------------------------------------------ */

describe("instagram oauth", () => {
  it("uses the official Meta authorization and token endpoints", () => {
    const spec = getOAuthProvider("instagram");
    expect(spec?.authorizationUrl).toBe(`https://www.facebook.com/${INSTAGRAM_API_VERSION}/dialog/oauth`);
    expect(spec?.tokenUrl).toBe(`https://graph.facebook.com/${INSTAGRAM_API_VERSION}/oauth/access_token`);
    expect(spec?.scopeSeparator).toBe(",");
  });

  it("requests only officially documented Instagram permissions", () => {
    const scopes = getOAuthProvider("instagram")?.scopes ?? [];
    expect(scopes).toEqual(
      expect.arrayContaining([
        "instagram_basic",
        "instagram_manage_messages",
        "instagram_manage_comments",
        "instagram_content_publish",
        "instagram_manage_insights",
      ]),
    );
    for (const scope of scopes) expect(scope).toMatch(/^(instagram|pages)_/);
  });

  it("is resolvable through the connector aliases", () => {
    expect(getOAuthProvider("instagram_business")?.connector).toBe("instagram");
    expect(getOAuthProvider("instagram_graph")?.connector).toBe("instagram");
  });

  it("declares long-lived, non-refreshable tokens (Meta has no refresh grant)", () => {
    const spec = getOAuthProvider("instagram");
    expect(spec?.refreshable).toBe(false);
    expect(spec?.defaultExpiresInSeconds).toBe(60 * 24 * 60 * 60);
  });

  it("identifies the connection account from the token response", () => {
    expect(getOAuthProvider("instagram")?.identify?.({ user_id: 123456 })).toEqual({
      accountIdentifier: "123456",
      accountLabel: "Instagram account 123456",
    });
    expect(getOAuthProvider("instagram")?.identify?.({})).toEqual({});
  });

  it("is listed for the Integration Center without leaking secrets", () => {
    const listed = describeOAuthProviders().find((entry) => entry.connector === "instagram");
    expect(listed).toBeTruthy();
    expect(JSON.stringify(listed)).not.toContain("secret");
  });
});

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

describe("instagram authentication", () => {
  it("never calls the network when credentials are missing", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "get_account" }, fetchImpl, { access_token: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails fast when the professional account id is missing", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "get_account" }, fetchImpl, {
      access_token: "token",
      instagram_account_id: "not-an-id",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/account ID is missing/i);
  });

  it("accepts ig_user_id as the documented alternative identifier", () => {
    const call = instagramConnector.authorize(instagramConnector.buildCall({ operation: "get_account" }), {
      access_token: "token",
      ig_user_id: IG_ID,
    });
    expect(call.url).toContain(`/${IG_ID}`);
  });

  it("still enforces the declared required credentials at the vault boundary", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "get_account" }, fetchImpl, { access_token: "token" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toMatch(/instagram_account_id/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an identifier that could rewrite the request path", () => {
    expect(() =>
      instagramConnector.authorize(instagramConnector.buildCall({ operation: "get_account" }), {
        access_token: "token",
        instagram_account_id: "../../me",
      }),
    ).toThrow(/account ID is missing/i);
  });

  it("sends the bearer token on every authorized call", async () => {
    const { calls, fetchImpl } = capture({ id: IG_ID });
    await run({ operation: "get_account" }, fetchImpl);
    expect((calls[0]?.init.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${creds.access_token}`);
  });
});

/* ------------------------------------------------------------------ */
/* Health check                                                        */
/* ------------------------------------------------------------------ */

describe("instagram health check", () => {
  it("verifies the connection with the official account endpoint", async () => {
    const { calls, fetchImpl } = capture({ id: IG_ID, username: "zyronex", account_type: "BUSINESS" });
    const health = await checkConnectorHealth({
      adapter: instagramConnector,
      credentials: creds,
      traceId: trace,
      fetchImpl,
    });
    expect(health).toMatchObject({ connector: "instagram", healthy: true, status: 200 });
    expect(calls[0]?.url).toContain(`/${IG_ID}`);
  });

  it("reports an unhealthy connection without leaking the token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: `Invalid OAuth token ${creds.access_token}`, code: 190 } }, { status: 401 }),
    ) as unknown as typeof fetch;
    const health = await checkConnectorHealth({
      adapter: instagramConnector,
      credentials: creds,
      traceId: trace,
      fetchImpl,
    });
    expect(health.healthy).toBe(false);
    expect(health.message).not.toContain(creds.access_token);
  });
});

/* ------------------------------------------------------------------ */
/* Messaging                                                           */
/* ------------------------------------------------------------------ */

describe("instagram messaging", () => {
  it("sends a text message with the official recipient/message envelope", async () => {
    const { calls, fetchImpl } = capture({ recipient_id: "9988776655", message_id: "mid.OUT1" });
    const result = await run(
      { operation: "send_message", params: { recipient_id: "9988776655", message: "أهلاً" } },
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(calls[0]?.url).toContain(`/${IG_ID}/messages`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      recipient: { id: "9988776655" },
      message: { text: "أهلاً" },
    });
    if (result.ok)
      expect(result.items[0]).toMatchObject({
        object: "message_receipt",
        source: "instagram",
        id: "mid.OUT1",
        recipient: "9988776655",
      });
  });

  it("passes a structured message payload (attachment) through untouched", async () => {
    const { calls, fetchImpl } = capture({ recipient_id: "998", message_id: "mid.OUT2" });
    const attachment = { attachment: { type: "image", payload: { url: "https://cdn.example.com/a.jpg" } } };
    await run({ operation: "send_message", params: { recipient_id: "998", message: attachment } }, fetchImpl);
    expect(JSON.parse(String(calls[0]?.init.body)).message).toEqual(attachment);
  });

  it("replies to a message using the official reply_to.mid field", async () => {
    const { calls, fetchImpl } = capture({ recipient_id: "998", message_id: "mid.OUT3" });
    await run(
      {
        operation: "send_reply",
        params: { recipient_id: "998", message: "تم", reply_to_message_id: "aWdfZG1faXRlbTox" },
      },
      fetchImpl,
    );
    expect(JSON.parse(String(calls[0]?.init.body)).message).toEqual({
      text: "تم",
      reply_to: { mid: "aWdfZG1faXRlbTox" },
    });
  });

  it("rejects a reply without the message it answers before any request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "send_reply", params: { recipient_id: "998", message: "x" } }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends the official sender actions (mark_seen / typing)", async () => {
    const { calls, fetchImpl } = capture({ recipient_id: "998" });
    await run({ operation: "send_sender_action", params: { recipient_id: "998", sender_action: "mark_seen" } }, fetchImpl);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      recipient: { id: "998" },
      sender_action: "mark_seen",
    });
  });

  it("drops parameters the operation does not declare", async () => {
    const { calls, fetchImpl } = capture({ recipient_id: "998", message_id: "mid.OUT4" });
    await run(
      { operation: "send_message", params: { recipient_id: "998", message: "hi", internal_note: "crm" } },
      fetchImpl,
    );
    expect(String(calls[0]?.init.body)).not.toContain("internal_note");
  });

  it("lists conversations scoped to the instagram platform", async () => {
    const { calls, fetchImpl } = capture({
      data: [
        {
          id: "conv-1",
          updated_time: "2026-02-01T10:00:00+0000",
          participants: { data: [{ id: "998", username: "customer" }] },
          messages: { data: [{ id: "mid.1", from: { id: "998" }, message: "hi", created_time: "2026-02-01T10:00:00+0000" }] },
        },
      ],
      paging: { cursors: { after: "CUR" } },
    });
    const result = await run({ operation: "list_conversations" }, fetchImpl);
    expect(calls[0]?.url).toContain("platform=instagram");
    if (result.ok) {
      expect(result.items[0]).toMatchObject({ object: "conversation", id: "conv-1" });
      expect((result.items[0] as { messages: unknown[] }).messages).toHaveLength(1);
    }
  });

  it("reads a single message through the official node", async () => {
    const { calls, fetchImpl } = capture({ id: "mid.1", from: { id: "998" }, message: "hi" });
    const result = await run({ operation: "get_message", params: { message_id: "mid.1", fields: "id,from,message" } }, fetchImpl);
    expect(calls[0]?.url).toContain("/mid.1");
    expect(calls[0]?.url).toContain("fields=id%2Cfrom%2Cmessage");
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "message", source: "instagram", text: "hi" });
  });
});

/* ------------------------------------------------------------------ */
/* Media & publishing                                                  */
/* ------------------------------------------------------------------ */

describe("instagram media and publishing", () => {
  it("lists media with cursor pagination", async () => {
    const { calls, fetchImpl } = capture({
      data: [{ id: "17800000000000002", media_type: "IMAGE", caption: "جديد", like_count: 5 }],
      paging: { cursors: { after: "CUR" } },
    });
    const result = await run({ operation: "list_media", params: { fields: "id,caption", limit: 10 } }, fetchImpl);
    expect(calls[0]?.url).toContain(`/${IG_ID}/media`);
    expect(calls[0]?.url).toContain("limit=10");
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "media", media_type: "IMAGE", like_count: 5 });
  });

  it("creates a media container from a public URL (the only documented input)", async () => {
    const { calls, fetchImpl } = capture({ id: "1800000000000003" });
    const result = await run(
      {
        operation: "create_media_container",
        params: { image_url: "https://cdn.example.com/a.jpg", caption: "تجربة", binary: "AAAA" },
      },
      fetchImpl,
    );
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({ image_url: "https://cdn.example.com/a.jpg", caption: "تجربة" });
    expect(body.binary).toBeUndefined();
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "media_container", id: "1800000000000003" });
  });

  it("publishes a container through the official creation_id step", async () => {
    const { calls, fetchImpl } = capture({ id: "17800000000000009" });
    await run({ operation: "publish_media", params: { creation_id: "1800000000000003" } }, fetchImpl);
    expect(calls[0]?.url).toContain(`/${IG_ID}/media_publish`);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ creation_id: "1800000000000003" });
  });

  it("refuses to publish without a container id", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "publish_media", params: {} }, fetchImpl);
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reads container status and the publishing limit", async () => {
    const container = capture({ id: "180", status_code: "FINISHED", status: "Finished" });
    const containerResult = await run(
      { operation: "get_media_container", params: { container_id: "180", fields: "status_code" } },
      container.fetchImpl,
    );
    if (containerResult.ok) expect(containerResult.items[0]).toMatchObject({ status_code: "FINISHED" });

    const limit = capture({ data: [{ quota_usage: 3, config: { quota_total: 50 } }] });
    const limitResult = await run({ operation: "get_publishing_limit" }, limit.fetchImpl);
    expect(limit.calls[0]?.url).toContain("content_publishing_limit");
    if (limitResult.ok) expect(limitResult.items[0]).toMatchObject({ quota_usage: 3 });
  });

  it("normalizes media insights", async () => {
    const { calls, fetchImpl } = capture({
      data: [{ name: "reach", period: "lifetime", title: "Reach", values: [{ value: 120 }] }],
    });
    const result = await run(
      { operation: "get_media_insights", params: { media_id: "178", metric: ["reach", "likes"] } },
      fetchImpl,
    );
    expect(calls[0]?.url).toContain("metric=reach%2Clikes");
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "insight", name: "reach" });
  });

  it("normalizes account insights with a total value", async () => {
    const { fetchImpl } = capture({
      data: [{ name: "accounts_engaged", period: "day", total_value: { value: 42 }, values: [] }],
    });
    const result = await run(
      { operation: "get_account_insights", params: { metric: "accounts_engaged", metric_type: "total_value" } },
      fetchImpl,
    );
    if (result.ok) expect(result.items[0]).toMatchObject({ name: "accounts_engaged", total_value: 42 });
  });
});

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

describe("instagram comments", () => {
  it("lists comments on a media item", async () => {
    const { calls, fetchImpl } = capture({
      data: [{ id: "179", text: "كم السعر", username: "customer", like_count: 1, hidden: false }],
      paging: { cursors: { after: "CUR" }, next: "https://graph.facebook.com/next" },
    });
    const result = await run({ operation: "list_media_comments", params: { media_id: "178" } }, fetchImpl);
    expect(calls[0]?.url).toContain("/178/comments");
    if (result.ok) {
      expect(result.items[0]).toMatchObject({ object: "comment", text: "كم السعر", hidden: false });
      expect(result.cursor).toBe("CUR");
    }
  });

  it("replies to a comment through the official replies edge", async () => {
    const { calls, fetchImpl } = capture({ id: "179001" });
    await run({ operation: "reply_to_comment", params: { comment_id: "179", message: "أهلاً" } }, fetchImpl);
    expect(calls[0]?.url).toContain("/179/replies");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ message: "أهلاً" });
  });

  it("hides and deletes a comment", async () => {
    const hide = capture({ success: true });
    await run({ operation: "hide_comment", params: { comment_id: "179", hide: true } }, hide.fetchImpl);
    expect(JSON.parse(String(hide.calls[0]?.init.body))).toEqual({ hide: true });

    const remove = capture({ success: true });
    const result = await run({ operation: "delete_comment", params: { comment_id: "179" } }, remove.fetchImpl);
    expect(remove.calls[0]?.init.method).toBe("DELETE");
    expect(result.ok).toBe(true);
  });

  it("requires a comment id before any request", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "reply_to_comment", params: { message: "hi" } }, fetchImpl);
    expect(result.ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

describe("instagram pagination", () => {
  it("follows the cursor only while a next link exists", async () => {
    const pages = [
      jsonResponse({ data: [{ id: "1" }], paging: { cursors: { after: "A" }, next: "https://graph/next" } }),
      jsonResponse({ data: [{ id: "2" }], paging: { cursors: { after: "B" } } }),
    ];
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      urls.push(String(url));
      return pages.shift()!;
    }) as unknown as typeof fetch;

    const result = await run({ operation: "list_media", maxPages: 5 }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(2);
      expect(result.pages).toBe(2);
      expect(result.cursor).toBeNull();
    }
    expect(urls[1]).toContain("after=A");
  });

  it("stops at the requested page budget", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ data: [{ id: "1" }], paging: { cursors: { after: "A" }, next: "https://graph/next" } }),
    ) as unknown as typeof fetch;
    const result = await run({ operation: "list_media", maxPages: 2 }, fetchImpl);
    if (result.ok) expect(result.pages).toBe(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

/* ------------------------------------------------------------------ */
/* Rate limits, retry and backoff                                      */
/* ------------------------------------------------------------------ */

describe("instagram rate limits and retries", () => {
  it("reads the official X-App-Usage quota header", async () => {
    const { fetchImpl } = capture(
      { id: IG_ID },
      { headers: { "x-app-usage": JSON.stringify({ call_count: 30, total_time: 10, total_cputime: 5 }) } },
    );
    const result = await run({ operation: "get_account" }, fetchImpl);
    if (result.ok) expect(result.rateLimit).toMatchObject({ limit: 100, remaining: 70 });
  });

  it("reads the business use case quota and the regain estimate", async () => {
    const { fetchImpl } = capture(
      { id: IG_ID },
      {
        headers: {
          "x-business-use-case-usage": JSON.stringify({
            [IG_ID]: [{ call_count: 90, estimated_time_to_regain_access: 2 }],
          }),
        },
      },
    );
    const result = await run({ operation: "get_account" }, fetchImpl);
    if (result.ok) expect(result.rateLimit).toMatchObject({ remaining: 10, retryAfterMs: 120_000 });
  });

  it("never fails a successful call because of a malformed quota header", async () => {
    const { fetchImpl } = capture({ id: IG_ID }, { headers: { "x-app-usage": "not-json" } });
    const result = await run({ operation: "get_account" }, fetchImpl);
    expect(result.ok).toBe(true);
  });

  it("retries a 429 and succeeds on the next attempt", async () => {
    const responses = [
      jsonResponse({ error: { message: "rate limited", code: 4 } }, { status: 429, headers: { "retry-after": "1" } }),
      jsonResponse({ id: IG_ID }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
    const result = await run({ operation: "get_account" }, fetchImpl);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
  });

  it("treats the throttling code 4 as retryable even on a 400", async () => {
    const responses = [
      jsonResponse({ error: { message: "Application request limit reached", code: 4 } }, { status: 400 }),
      jsonResponse({ id: IG_ID }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
    const result = await run({ operation: "get_account" }, fetchImpl);
    expect(result.ok).toBe(true);
  });

  it("gives up after the attempt budget on a persistent 500", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Unknown", code: 1 } }, { status: 500 }),
    ) as unknown as typeof fetch;
    const result = await run({ operation: "get_account" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("provider");
      expect(result.attempts).toBe(3);
    }
  });

  it("maps an aborted request to a timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("The operation was aborted", "AbortError");
    }) as unknown as typeof fetch;
    const result = await run({ operation: "get_account" }, fetchImpl, creds, { timeoutMs: 5 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("timeout");
  });
});

/* ------------------------------------------------------------------ */
/* Error normalization                                                 */
/* ------------------------------------------------------------------ */

describe("instagram error normalization", () => {
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
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ error: { message: "failure", code } }, { status }),
      ) as unknown as typeof fetch;
      const result = await run({ operation: "get_account" }, fetchImpl, creds, { maxAttempts: 1 });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(kind);
    });

  it("treats a 200 envelope that still carries an error as a failure", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Invalid parameter", code: 100 } }),
    ) as unknown as typeof fetch;
    const result = await run({ operation: "get_account" }, fetchImpl);
    expect(result.ok).toBe(false);
  });

  it("rejects an unknown operation without calling the provider", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await run({ operation: "buy_followers" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unsupported");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("flags a list response that is not a collection", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: { id: "1" } })) as unknown as typeof fetch;
    const result = await run({ operation: "list_media" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed_response");
  });

  it("flags an empty response body", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 })) as unknown as typeof fetch;
    const result = await run({ operation: "get_account" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed_response");
  });
});

/* ------------------------------------------------------------------ */
/* Idempotency                                                         */
/* ------------------------------------------------------------------ */

describe("instagram idempotency", () => {
  it("publishes through the container id, which Meta treats as the idempotent unit", async () => {
    const first = capture({ id: "17800000000000009" });
    const second = capture({ id: "17800000000000009" });
    await run({ operation: "publish_media", params: { creation_id: "1800000000000003" } }, first.fetchImpl);
    await run({ operation: "publish_media", params: { creation_id: "1800000000000003" } }, second.fetchImpl);
    expect(JSON.parse(String(first.calls[0]?.init.body))).toEqual(JSON.parse(String(second.calls[0]?.init.body)));
  });

  it("never invents an idempotency field Meta does not document for messaging", async () => {
    const { calls, fetchImpl } = capture({ recipient_id: "998", message_id: "mid" });
    await run(
      { operation: "send_message", params: { recipient_id: "998", message: "hi", idempotency_key: "exec-1" } },
      fetchImpl,
    );
    const body = String(calls[0]?.init.body);
    expect(body).not.toContain("exec-1");
    expect(body).not.toContain("idempotency");
    expect(UNSUPPORTED_OPERATIONS["idempotency_key"]).toBeTruthy();
  });
});

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

describe("instagram webhooks", () => {
  it("accepts a correctly signed delivery", () => {
    const raw = JSON.stringify(INBOUND_DM);
    const verification = verifyWebhook("instagram", verifierInput(raw, { "x-hub-signature-256": sign(raw) }));
    expect(verification.ok).toBe(true);
    expect(verification.eventType).toBe("message.received");
    expect(verification.eventId).toBe("aWdfZG1faXRlbTox");
  });

  it("rejects a tampered body", () => {
    const raw = JSON.stringify(INBOUND_DM);
    const signature = sign(raw);
    const tampered = raw.replace("مرحبا", "hacked");
    const verification = verifyWebhook("instagram", verifierInput(tampered, { "x-hub-signature-256": signature }));
    expect(verification.ok).toBe(false);
    expect(verification.reason).toBe("invalid_signature");
  });

  it("rejects a delivery signed with the wrong secret", () => {
    const raw = JSON.stringify(INBOUND_DM);
    const verification = verifyWebhook(
      "instagram",
      verifierInput(raw, { "x-hub-signature-256": sign(raw, "another-secret") }),
    );
    expect(verification.ok).toBe(false);
  });

  it("rejects a delivery without a signature header", () => {
    const raw = JSON.stringify(INBOUND_DM);
    expect(verifyWebhook("instagram", verifierInput(raw, {})).reason).toBe("invalid_signature");
  });

  it("reports a missing app secret instead of trusting the caller", () => {
    const raw = JSON.stringify(INBOUND_DM);
    const verification = verifyWebhook("instagram", {
      ...verifierInput(raw, { "x-hub-signature-256": sign(raw) }),
      secret: "",
    });
    expect(verification.ok).toBe(false);
    expect(verification.reason).toBe("missing_secret");
  });

  it("rejects a replayed delivery that falls outside the window", () => {
    const stale = {
      ...INBOUND_DM,
      entry: [{ ...INBOUND_DM.entry[0], time: Math.floor(Date.now() / 1000) - 7200 }],
    };
    const raw = JSON.stringify(stale);
    const verification = verifyWebhook("instagram", verifierInput(raw, { "x-hub-signature-256": sign(raw) }));
    expect(verification.ok).toBe(false);
    expect(verification.reason).toBe("replay");
  });

  it("derives a stable event id so a redelivery is deduplicated", () => {
    const raw = JSON.stringify(INBOUND_DM);
    const first = verifyWebhook("instagram", verifierInput(raw, { "x-hub-signature-256": sign(raw) }));
    const second = verifyWebhook("instagram", verifierInput(raw, { "x-hub-signature-256": sign(raw) }));
    expect(first.eventId).toBe(second.eventId);
  });

  it("derives a distinct, stable event id for comment events", () => {
    const raw = JSON.stringify(COMMENT_EVENT);
    const verification = verifyWebhook("instagram", verifierInput(raw, { "x-hub-signature-256": sign(raw) }));
    expect(verification.ok).toBe(true);
    expect(verification.eventType).toBe("comment.created");
    expect(verification.eventId).toContain("17900000000000001");
  });

  it("gives a reaction its own event id", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: IG_ID,
          time: Date.now(),
          messaging: [
            {
              sender: { id: "998" },
              recipient: { id: IG_ID },
              timestamp: Date.now(),
              reaction: { mid: "aWdfZG1faXRlbTox", action: "react", reaction: "love" },
            },
          ],
        },
      ],
    };
    const raw = JSON.stringify(payload);
    const verification = verifyWebhook("instagram", verifierInput(raw, { "x-hub-signature-256": sign(raw) }));
    expect(verification.ok).toBe(true);
    expect(verification.eventType).toBe("message.reaction");
    expect(verification.eventId).toContain("react");
  });

  it("resolves the verifier through the connector aliases", () => {
    const raw = JSON.stringify(INBOUND_DM);
    expect(verifyWebhook("instagram_business", verifierInput(raw, { "x-hub-signature-256": sign(raw) })).ok).toBe(true);
  });

  it("manages webhook subscriptions through the official edge", async () => {
    const list = capture({ data: [{ id: "app-1", subscribed_fields: ["messages", "comments"] }] });
    await run({ operation: "list_subscribed_apps" }, list.fetchImpl);
    expect(list.calls[0]?.url).toContain(`/${IG_ID}/subscribed_apps`);

    const subscribe = capture({ success: true });
    await run({ operation: "subscribe_app", params: { subscribed_fields: "messages,comments" } }, subscribe.fetchImpl);
    expect(JSON.parse(String(subscribe.calls[0]?.init.body))).toEqual({ subscribed_fields: "messages,comments" });

    const unsubscribe = capture({ success: true });
    await run({ operation: "unsubscribe_app" }, unsubscribe.fetchImpl);
    expect(unsubscribe.calls[0]?.init.method).toBe("DELETE");
  });
});

/* ------------------------------------------------------------------ */
/* Webhook normalization                                               */
/* ------------------------------------------------------------------ */

describe("instagram webhook normalization", () => {
  it("normalizes an inbound direct message", () => {
    const event = normalizeInstagramWebhookEvent(INBOUND_DM);
    expect(event.event).toBe("message.received");
    expect(event.account_id).toBe(IG_ID);
    expect(event.messages[0]).toMatchObject({
      object: "message",
      source: "instagram",
      direction: "inbound",
      from: "9988776655",
      to: IG_ID,
      text: "مرحبا",
      id: "aWdfZG1faXRlbTox",
    });
  });

  it("marks an echo of our own message as outbound", () => {
    const echo = normalizeInstagramMessage(
      {
        sender: { id: IG_ID },
        recipient: { id: "998" },
        timestamp: Date.now(),
        message: { mid: "mid.echo", text: "رد", is_echo: true },
      },
      { accountId: IG_ID },
    );
    expect(echo.direction).toBe("outbound");
    expect(echo.is_echo).toBe(true);
  });

  it("normalizes message attachments", () => {
    const message = normalizeInstagramMessage({
      sender: { id: "998" },
      recipient: { id: IG_ID },
      timestamp: Date.now(),
      message: { mid: "mid.att", attachments: [{ type: "image", payload: { url: "https://cdn/x.jpg" } }] },
    });
    expect(message.attachments[0]).toMatchObject({ type: "image", url: "https://cdn/x.jpg" });
  });

  it("normalizes a comment event into the neutral comment shape", () => {
    const event = normalizeInstagramWebhookEvent(COMMENT_EVENT);
    expect(event.event).toBe("comment.created");
    expect(event.comments[0]).toMatchObject({
      object: "comment",
      source: "instagram",
      id: "17900000000000001",
      text: "كم السعر؟",
      media_id: "17800000000000002",
      username: "customer",
    });
  });

  it("keeps every batched entry instead of dropping deliveries", () => {
    const batched = {
      object: "instagram",
      entry: [INBOUND_DM.entry[0], COMMENT_EVENT.entry[0]],
    };
    const event = normalizeInstagramWebhookEvent(batched);
    expect(event.messages).toHaveLength(1);
    expect(event.comments).toHaveLength(1);
  });

  it("tolerates an empty envelope without throwing", () => {
    const event = normalizeInstagramWebhookEvent({ object: "instagram", entry: [] });
    expect(event.messages).toEqual([]);
    expect(event.comments).toEqual([]);
    expect(event.event).toBeNull();
  });

  it("normalizes a standalone comment payload", () => {
    const comment = normalizeInstagramComment({
      id: "179",
      text: "شكراً",
      from: { id: "998", username: "customer" },
      media: { id: "178" },
      hidden: true,
      timestamp: "2026-02-01T10:00:00+0000",
    });
    expect(comment).toMatchObject({ id: "179", media_id: "178", hidden: true, from_id: "998" });
    expect(comment.timestamp).toMatch(/^2026-02-01T/);
  });
});

/* ------------------------------------------------------------------ */
/* Isolation, redaction and observability                              */
/* ------------------------------------------------------------------ */

describe("instagram isolation, redaction and tracing", () => {
  it("uses only the credentials it is handed: two workspaces never mix", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      seen.push(String((init?.headers as Record<string, string>)["authorization"]));
      return jsonResponse({ id: IG_ID });
    }) as unknown as typeof fetch;

    await run({ operation: "get_account" }, fetchImpl, { access_token: "token-a", instagram_account_id: IG_ID });
    await run({ operation: "get_account" }, fetchImpl, { access_token: "token-b", instagram_account_id: "17841400000000002" });
    expect(seen).toEqual(["Bearer token-a", "Bearer token-b"]);
  });

  it("targets the account id of the calling connection only", async () => {
    const { calls, fetchImpl } = capture({ id: "17841400000000002" });
    await run({ operation: "list_media" }, fetchImpl, {
      access_token: "token-b",
      instagram_account_id: "17841400000000002",
    });
    expect(calls[0]?.url).toContain("17841400000000002");
    expect(calls[0]?.url).not.toContain(IG_ID);
  });

  it("never echoes the access token in an error message", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: `Bad token ${creds.access_token}`, code: 190 } }, { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await run({ operation: "get_account" }, fetchImpl);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).not.toContain(creds.access_token);
      expect(JSON.stringify(result)).not.toContain("IGQV");
    }
  });

  it("carries the trace id on success and on failure", async () => {
    const ok = await run({ operation: "get_account" }, capture({ id: IG_ID }).fetchImpl);
    expect(ok.traceId).toBe(trace);
    const failing = vi.fn(async () => jsonResponse({ error: { code: 190 } }, { status: 401 })) as unknown as typeof fetch;
    expect((await run({ operation: "get_account" }, failing)).traceId).toBe(trace);
  });

  it("emits redacted observability breadcrumbs on retry", async () => {
    const events: { level: string; message: string }[] = [];
    const responses = [
      jsonResponse({ error: { message: "rate", code: 4 } }, { status: 429 }),
      jsonResponse({ id: IG_ID }),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!) as unknown as typeof fetch;
    await run({ operation: "get_account" }, fetchImpl, creds, {
      onEvent: (event) => events.push({ level: event.level, message: event.message }),
    });
    expect(events.some((event) => event.level === "warn")).toBe(true);
    expect(JSON.stringify(events)).not.toContain(creds.access_token);
  });
});
