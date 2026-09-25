import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { MESSENGER_API_VERSION, UNSUPPORTED_OPERATIONS, messengerConnector } from "@/lib/connectors/adapters/messenger";
import {
  normalizeMessengerConversation,
  normalizeMessengerMessage,
  normalizeMessengerWebhookEvent,
} from "@/lib/connectors/adapters/messenger-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { PROVIDERS } from "@/lib/integrations/catalog";
import { getOAuthProvider } from "@/lib/oauth/providers";
import { verifyWebhook } from "@/lib/webhooks/verify";

/** Messenger connector — production test suite, same contract as every connector. */

const trace = "trace-messenger";
const PAGE_ID = "104000000000009";
const PSID = "2500000000000001";
const MID = "m_AbCdEf123456";
const CONV = "t_1000000000001";
const creds = { access_token: "EAAMSG_secret_page_token", page_id: PAGE_ID };
const APP_SECRET = "meta-messenger-app-secret";
const BASE = `https://graph.facebook.com/${MESSENGER_API_VERSION}`;

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
  return runConnectorOperation({ adapter: messengerConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {}, ...extra });
}

function capture(response: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request, requestInit?: RequestInit) => {
    calls.push({ url: String(url), init: requestInit ?? {} });
    return jsonResponse(response, init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function sequence(...responses: (() => Response)[]) {
  let i = 0;
  const fetchImpl = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]!()) as unknown as typeof fetch;
  return { fetchImpl, count: () => i };
}

const body = (call: { init: RequestInit } | undefined) => JSON.parse(String(call?.init.body ?? "{}")) as Record<string, unknown>;
const auth = (call: { init: RequestInit } | undefined) => new Headers(call?.init.headers).get("authorization");
const SENT = { recipient_id: PSID, message_id: "m_sent_1" };

function event(messaging: Record<string, unknown>, ts = Date.now()) {
  return { object: "page", entry: [{ id: PAGE_ID, time: ts, messaging: [{ sender: { id: PSID }, recipient: { id: PAGE_ID }, timestamp: ts, ...messaging }] }] };
}
const sign = (raw: string, secret = APP_SECRET) => `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
function verifySigned(payload: unknown, opts: { secret?: string; header?: string | null; nowMs?: number } = {}) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = {};
  if (opts.header !== null) headers["x-hub-signature-256"] = opts.header ?? sign(raw);
  return verifyWebhook("messenger", {
    raw,
    headers,
    payload: JSON.parse(raw) as unknown,
    secret: opts.secret ?? APP_SECRET,
    nowMs: opts.nowMs ?? Date.now(),
    replayWindowMs: 300_000,
  });
}

/* Registry & contract */
describe("messenger registration", () => {
  it("is registered under its id and aliases", () => {
    for (const id of ["messenger", "facebook_messenger", "messenger_platform"]) expect(getConnector(id)?.id).toBe("messenger");
  });
  it("keeps Facebook Pages a separate connector", () => {
    expect(getConnector("facebook_pages")?.id).toBe("facebook_pages");
    expect(getConnector("facebook_pages")?.operations).not.toContain("send_message");
  });
  it("exposes capabilities without credentials", () => {
    const d = describeConnectors().find((e) => e.id === "messenger");
    expect(d).toMatchObject({ label: "Messenger", authKind: "bearer" });
    expect(d?.requiredCredentials).toEqual(["access_token", "page_id"]);
    expect(d?.capabilities).toContain("messaging");
    expect(JSON.stringify(d)).not.toMatch(/EAA/);
  });
  it("declares the official operations", () => {
    expect(messengerConnector.operations).toEqual(
      expect.arrayContaining([
        "get_page", "send_message", "send_reply", "send_attachment", "send_sender_action", "upload_attachment",
        "list_conversations", "get_conversation", "list_conversation_messages", "get_message", "get_user_profile",
        "get_messenger_profile", "set_messenger_profile", "delete_messenger_profile",
        "list_subscribed_apps", "subscribe_app", "unsubscribe_app",
      ]),
    );
  });
  it("documents unsupported operations and never exposes them", () => {
    expect(Object.keys(UNSUPPORTED_OPERATIONS).length).toBeGreaterThanOrEqual(6);
    for (const [op, reason] of Object.entries(UNSUPPORTED_OPERATIONS)) {
      expect(reason.length).toBeGreaterThan(20);
      expect(messengerConnector.operations).not.toContain(op);
      expect(() => messengerConnector.buildCall({ operation: op })).toThrow(/Unknown Messenger operation/);
    }
  });
  it("contains no AI, business, CRM or database logic", () => {
    for (const f of ["messenger.ts", "messenger-map.ts"]) {
      const src = readFileSync(`src/lib/connectors/adapters/${f}`, "utf8");
      expect(src.replace(/\/\*\*[\s\S]*?\*\//g, "")).not.toMatch(/supabase|workspace|openai|gemini|agent|crm/i);
    }
  });
});

/* OAuth / auth / permissions */
describe("messenger oauth and permissions", () => {
  const spec = getOAuthProvider("messenger");
  it("uses the official Facebook Login dialog and token endpoints", () => {
    expect(spec?.authorizationUrl).toBe(`https://www.facebook.com/${MESSENGER_API_VERSION}/dialog/oauth`);
    expect(spec?.tokenUrl).toBe(`https://graph.facebook.com/${MESSENGER_API_VERSION}/oauth/access_token`);
  });
  it("requests pages_messaging and the page scopes Messenger needs", () => {
    expect(spec?.scopes).toEqual(expect.arrayContaining(["pages_messaging", "pages_show_list", "pages_manage_metadata"]));
    expect(spec?.scopeSeparator).toBe(",");
  });
  it("is not refreshable — long-lived Meta tokens are re-authorized", () => {
    expect(spec?.refreshable).toBe(false);
    expect(spec?.defaultExpiresInSeconds).toBe(60 * 24 * 60 * 60);
  });
  it("keeps the exchanged user token apart from the page token", () => {
    expect(spec?.credentialFields?.({ access_token: "EAAUSER" })).toEqual({ user_access_token: "EAAUSER" });
  });
  it("identifies the connection account by page id", () => {
    expect(spec?.identify?.({ page_id: PAGE_ID })).toMatchObject({ accountIdentifier: PAGE_ID });
  });
  it("resolves aliases to the same spec", () => {
    expect(getOAuthProvider("facebook_messenger")?.connector).toBe("messenger");
  });
  it("catalog lists official scopes and secret credential fields", () => {
    const p = PROVIDERS.find((x) => x.id === "messenger");
    expect(p?.scopes).toContain("pages_messaging");
    const secret = p?.credentialFields.filter((f) => f.secret).map((f) => f.key);
    expect(secret).toEqual(expect.arrayContaining(["access_token", "app_secret", "verify_token"]));
  });
  it("fails fast without an access token", async () => {
    const { fetchImpl } = capture(SENT);
    const r = await run({ operation: "get_page" }, fetchImpl, { page_id: PAGE_ID });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("fails fast without a valid page id", async () => {
    const { fetchImpl } = capture(SENT);
    const r = await run({ operation: "get_page" }, fetchImpl, { access_token: "x", page_id: "abc" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("auth");
  });
  it("sends the page token as a bearer header, never in the URL", async () => {
    const { calls, fetchImpl } = capture({ id: PAGE_ID, name: "Store" });
    await run({ operation: "get_page" }, fetchImpl);
    expect(auth(calls[0])).toBe(`Bearer ${creds.access_token}`);
    expect(calls[0]?.url).not.toContain(creds.access_token);
    expect(calls[0]?.url.startsWith(`${BASE}/${PAGE_ID}`)).toBe(true);
  });
  it("maps a permission error (code 10 / 200) to forbidden", async () => {
    const { fetchImpl } = capture({ error: { message: "Requires pages_messaging permission", type: "OAuthException", code: 10 } }, { status: 403 });
    const r = await run({ operation: "send_message", params: { recipient_id: PSID, text: "hi" } }, fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("forbidden");
      expect(r.error.retryable).toBe(false);
    }
  });
  it("maps an expired token (code 190) to auth", async () => {
    const { fetchImpl } = capture({ error: { message: "Error validating access token", type: "OAuthException", code: 190 } }, { status: 401 });
    const r = await run({ operation: "get_page" }, fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("auth");
    expect(r.ok).toBe(false);
  });
});

/* Send API */
describe("messenger send message", () => {
  it("sends text with RESPONSE messaging type by default", async () => {
    const { calls, fetchImpl } = capture(SENT);
    const r = await run({ operation: "send_message", params: { recipient_id: PSID, text: "مرحبا" } }, fetchImpl);
    expect(r.ok).toBe(true);
    expect(calls[0]?.url.split("?")[0]).toBe(`${BASE}/${PAGE_ID}/messages`);
    expect(calls[0]?.init.method).toBe("POST");
    expect(body(calls[0])).toEqual({ recipient: { id: PSID }, messaging_type: "RESPONSE", message: { text: "مرحبا" } });
  });
  it("normalizes the send result", async () => {
    const { fetchImpl } = capture(SENT);
    const r = await run({ operation: "send_message", params: { recipient_id: PSID, text: "x" } }, fetchImpl);
    if (r.ok) expect(r.items[0]).toMatchObject({ object: "send_result", source: "messenger", recipient_id: PSID, message_id: "m_sent_1" });
  });
  it("supports official message tags outside the window", async () => {
    const { calls, fetchImpl } = capture(SENT);
    await run({ operation: "send_message", params: { recipient_id: PSID, text: "x", messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" } }, fetchImpl);
    expect(body(calls[0])).toMatchObject({ messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
  });
  it("rejects MESSAGE_TAG without an official tag", async () => {
    const { fetchImpl } = capture(SENT);
    const r = await run({ operation: "send_message", params: { recipient_id: PSID, text: "x", messaging_type: "MESSAGE_TAG", tag: "PROMO" } }, fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("invalid_request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects unknown messaging types", async () => {
    const { fetchImpl } = capture(SENT);
    const r = await run({ operation: "send_message", params: { recipient_id: PSID, text: "x", messaging_type: "BLAST" } }, fetchImpl);
    expect(r.ok).toBe(false);
  });
  it("requires recipient and text", async () => {
    const { fetchImpl } = capture(SENT);
    expect((await run({ operation: "send_message", params: { text: "x" } }, fetchImpl)).ok).toBe(false);
    expect((await run({ operation: "send_message", params: { recipient_id: PSID } }, fetchImpl)).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("passes quick replies and metadata through", async () => {
    const { calls, fetchImpl } = capture(SENT);
    const qr = [{ content_type: "text", title: "نعم", payload: "YES" }];
    await run({ operation: "send_message", params: { recipient_id: PSID, text: "x", quick_replies: qr, metadata: "exec-1" } }, fetchImpl);
    expect(body(calls[0])["message"]).toEqual({ text: "x", quick_replies: qr, metadata: "exec-1" });
  });
  it("sends sender actions", async () => {
    const { calls, fetchImpl } = capture({ recipient_id: PSID });
    await run({ operation: "send_sender_action", params: { recipient_id: PSID, sender_action: "mark_seen" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ recipient: { id: PSID }, sender_action: "mark_seen" });
  });
  it("rejects unknown sender actions", async () => {
    const { fetchImpl } = capture(SENT);
    expect((await run({ operation: "send_sender_action", params: { recipient_id: PSID, sender_action: "wave" } }, fetchImpl)).ok).toBe(false);
  });
});

describe("messenger replies", () => {
  it("replies with the official reply_to.mid", async () => {
    const { calls, fetchImpl } = capture(SENT);
    const r = await run({ operation: "send_reply", params: { recipient_id: PSID, reply_to_mid: MID, text: "نعم" } }, fetchImpl);
    expect(r.ok).toBe(true);
    expect(body(calls[0])).toMatchObject({ reply_to: { mid: MID }, message: { text: "نعم" } });
  });
  it("requires reply_to_mid", async () => {
    const { fetchImpl } = capture(SENT);
    const r = await run({ operation: "send_reply", params: { recipient_id: PSID, text: "x" } }, fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("invalid_request");
  });
});

describe("messenger attachments", () => {
  it("sends an image by https url", async () => {
    const { calls, fetchImpl } = capture(SENT);
    await run({ operation: "send_attachment", params: { recipient_id: PSID, attachment_type: "image", url: "https://cdn.example.com/a.jpg" } }, fetchImpl);
    expect(body(calls[0])["message"]).toEqual({ attachment: { type: "image", payload: { url: "https://cdn.example.com/a.jpg" } } });
  });
  it("sends a reusable attachment by attachment_id", async () => {
    const { calls, fetchImpl } = capture(SENT);
    await run({ operation: "send_attachment", params: { recipient_id: PSID, attachment_type: "file", attachment_id: "999" } }, fetchImpl);
    expect(body(calls[0])["message"]).toEqual({ attachment: { type: "file", payload: { attachment_id: "999" } } });
  });
  it("sends template attachments", async () => {
    const { calls, fetchImpl } = capture(SENT);
    const tp = { template_type: "button", text: "اختر", buttons: [] };
    await run({ operation: "send_attachment", params: { recipient_id: PSID, attachment_type: "template", template_payload: tp } }, fetchImpl);
    expect(body(calls[0])["message"]).toEqual({ attachment: { type: "template", payload: tp } });
  });
  it("rejects non-https media and unknown types", async () => {
    const { fetchImpl } = capture(SENT);
    expect((await run({ operation: "send_attachment", params: { recipient_id: PSID, attachment_type: "image", url: "http://x" } }, fetchImpl)).ok).toBe(false);
    expect((await run({ operation: "send_attachment", params: { recipient_id: PSID, attachment_type: "sticker", url: "https://x" } }, fetchImpl)).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("uploads reusable attachments via the Attachment Upload API", async () => {
    const { calls, fetchImpl } = capture({ attachment_id: "1857777774821032" });
    const r = await run({ operation: "upload_attachment", params: { attachment_type: "video", url: "https://cdn.example.com/v.mp4" } }, fetchImpl);
    expect(calls[0]?.url.split("?")[0]).toBe(`${BASE}/${PAGE_ID}/message_attachments`);
    expect(body(calls[0])).toEqual({ message: { attachment: { type: "video", payload: { url: "https://cdn.example.com/v.mp4", is_reusable: true } } } });
    if (r.ok) expect(r.items[0]).toMatchObject({ attachment_id: "1857777774821032" });
  });
  it("documents binary upload as unsupported", () => {
    expect(UNSUPPORTED_OPERATIONS["upload_media_binary"]).toMatch(/url/);
  });
});

/* Conversations */
describe("messenger conversations", () => {
  it("lists conversations with platform=messenger", async () => {
    const { calls, fetchImpl } = capture({ data: [{ id: CONV, message_count: 3, unread_count: 1, participants: { data: [{ id: PSID }, { id: PAGE_ID }] }, updated_time: "2026-09-01T10:00:00+0000" }] });
    const r = await run({ operation: "list_conversations" }, fetchImpl);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe(`/${MESSENGER_API_VERSION}/${PAGE_ID}/conversations`);
    expect(url.searchParams.get("platform")).toBe("messenger");
    expect(url.searchParams.get("fields")).toContain("participants");
    if (r.ok) expect(r.items[0]).toMatchObject({ object: "conversation", id: CONV, participant_ids: [PSID, PAGE_ID], unread_count: 1 });
  });
  it("filters conversations by user_id (PSID)", async () => {
    const { calls, fetchImpl } = capture({ data: [] });
    await run({ operation: "list_conversations", params: { user_id: PSID } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("user_id")).toBe(PSID);
  });
  it("gets one conversation", async () => {
    const { calls, fetchImpl } = capture({ id: CONV });
    await run({ operation: "get_conversation", params: { conversation_id: CONV } }, fetchImpl);
    expect(new URL(calls[0]!.url).pathname).toBe(`/${MESSENGER_API_VERSION}/${CONV}`);
  });
  it("lists messages in a conversation", async () => {
    const { fetchImpl } = capture({ data: [{ id: MID, message: "hi", from: { id: PSID }, to: { data: [{ id: PAGE_ID }] }, created_time: "2026-09-01T10:00:00+0000" }] });
    const r = await run({ operation: "list_conversation_messages", params: { conversation_id: CONV } }, fetchImpl);
    if (r.ok) expect(r.items[0]).toMatchObject({ object: "message", id: MID, text: "hi", from_id: PSID, to_ids: [PAGE_ID] });
  });
  it("gets one message", async () => {
    const { calls, fetchImpl } = capture({ id: MID, message: "x" });
    await run({ operation: "get_message", params: { message_id: MID } }, fetchImpl);
    expect(new URL(calls[0]!.url).pathname).toBe(`/${MESSENGER_API_VERSION}/${MID}`);
  });
  it("rejects unsafe ids (path injection)", async () => {
    const { fetchImpl } = capture({});
    for (const bad of ["../me", "t_1/../x", "", "abc"])
      expect((await run({ operation: "get_conversation", params: { conversation_id: bad } }, fetchImpl)).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("reads the user profile by PSID", async () => {
    const { calls, fetchImpl } = capture({ id: PSID, first_name: "Sara", last_name: "A", profile_pic: "https://p" });
    const r = await run({ operation: "get_user_profile", params: { psid: PSID } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("fields")).toBe("first_name,last_name,profile_pic");
    if (r.ok) expect(r.items[0]).toMatchObject({ object: "user_profile", psid: PSID, first_name: "Sara" });
  });
  it("documents that PSID is the only identifier", () => {
    expect(UNSUPPORTED_OPERATIONS["lookup_user_by_phone_or_email"]).toMatch(/PSID/);
  });
});

/* Messenger profile & subscriptions */
describe("messenger profile and subscriptions", () => {
  it("reads messenger_profile fields", async () => {
    const { calls, fetchImpl } = capture({ data: [{ greeting: [] }] });
    await run({ operation: "get_messenger_profile", params: { fields: ["greeting", "get_started"] } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("fields")).toBe("greeting,get_started");
  });
  it("sets messenger_profile with only documented fields", async () => {
    const { calls, fetchImpl } = capture({ result: "success" });
    await run({ operation: "set_messenger_profile", params: { greeting: [{ locale: "default", text: "أهلًا" }], hack: 1 } }, fetchImpl);
    expect(body(calls[0])).toEqual({ greeting: [{ locale: "default", text: "أهلًا" }] });
  });
  it("deletes messenger_profile fields", async () => {
    const { calls, fetchImpl } = capture({ result: "success" });
    await run({ operation: "delete_messenger_profile", params: { fields: "greeting" } }, fetchImpl);
    expect(calls[0]?.init.method).toBe("DELETE");
    expect(body(calls[0])).toEqual({ fields: ["greeting"] });
  });
  it("subscribes the app to messaging webhook fields", async () => {
    const { calls, fetchImpl } = capture({ success: true });
    await run({ operation: "subscribe_app", params: { subscribed_fields: ["messages", "message_deliveries", "message_reads", "messaging_postbacks"] } }, fetchImpl);
    expect(body(calls[0])).toEqual({ subscribed_fields: "messages,message_deliveries,message_reads,messaging_postbacks" });
  });
  it("lists and removes subscriptions", async () => {
    const a = capture({ data: [{ id: "app" }] });
    expect((await run({ operation: "list_subscribed_apps" }, a.fetchImpl)).ok).toBe(true);
    const b = capture({ success: true });
    await run({ operation: "unsubscribe_app" }, b.fetchImpl);
    expect(b.calls[0]?.init.method).toBe("DELETE");
  });
});

/* Pagination */
describe("messenger pagination", () => {
  it("follows Graph cursors up to maxPages", async () => {
    const { fetchImpl, count } = sequence(
      () => jsonResponse({ data: [{ id: "t_aaa1" }], paging: { cursors: { after: "c1" }, next: "https://next" } }),
      () => jsonResponse({ data: [{ id: "t_aaa2" }], paging: { cursors: { after: "c2" } } }),
    );
    const r = await run({ operation: "list_conversations", maxPages: 5 }, fetchImpl);
    expect(count()).toBe(2);
    if (r.ok) {
      expect(r.items).toHaveLength(2);
      expect(r.cursor).toBeNull();
    }
  });
  it("returns the next cursor when the budget stops early", async () => {
    const { fetchImpl } = capture({ data: [{ id: "t_aaa1" }], paging: { cursors: { after: "c1" }, next: "https://next" } });
    const r = await run({ operation: "list_conversations", maxPages: 1 }, fetchImpl);
    if (r.ok) expect(r.cursor).toBe("c1");
  });
  it("sends the incoming cursor as after", async () => {
    const { calls, fetchImpl } = capture({ data: [] });
    await run({ operation: "list_conversations", cursor: "abc" }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("after")).toBe("abc");
  });
  it("honours a custom limit", async () => {
    const { calls, fetchImpl } = capture({ data: [] });
    await run({ operation: "list_conversation_messages", params: { conversation_id: CONV, limit: 10 } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("limit")).toBe("10");
  });
});

/* Rate limits / retry / errors */
describe("messenger rate limits and retry", () => {
  it("retries 429 honouring Retry-After", async () => {
    const { fetchImpl, count } = sequence(
      () => jsonResponse({ error: { message: "Too many", code: 613 } }, { status: 429, headers: { "retry-after": "1" } }),
      () => jsonResponse(SENT),
    );
    const r = await run({ operation: "send_message", params: { recipient_id: PSID, text: "x" } }, fetchImpl);
    expect(count()).toBe(2);
    expect(r.ok).toBe(true);
  });
  it("retries transient 5xx", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse({ error: { message: "x", code: 2 } }, { status: 503 }), () => jsonResponse(SENT));
    expect((await run({ operation: "send_message", params: { recipient_id: PSID, text: "x" } }, fetchImpl)).ok).toBe(true);
    expect(count()).toBe(2);
  });
  it("does not retry 4xx validation errors", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse({ error: { message: "Invalid parameter", code: 100 } }, { status: 400 }));
    const r = await run({ operation: "send_message", params: { recipient_id: PSID, text: "x" } }, fetchImpl);
    expect(count()).toBe(1);
    expect(r.ok).toBe(false);
  });
  it("reads Meta usage headers as rate-limit info", () => {
    const h = new Headers({ "x-app-usage": JSON.stringify({ call_count: 95, total_time: 10, total_cputime: 10 }) });
    expect(messengerConnector.readRateLimit?.(h, {})).toBeDefined();
  });
  it("reads X-Page-Usage", () => {
    const h = new Headers({ "x-page-usage": JSON.stringify({ call_count: 50, total_time: 1, total_cputime: 1 }) });
    expect(messengerConnector.readRateLimit?.(h, {})).toBeDefined();
  });
});

describe("messenger error normalization", () => {
  it("rewrites the Meta error message under the Messenger label", () => {
    const m = messengerConnector.mapError?.(403, { error: { message: "nope", code: 10 } });
    expect(m?.message).not.toMatch(/^Facebook Pages|^Instagram/);
  });
  it("rejects empty bodies as malformed", async () => {
    const { fetchImpl } = capture({});
    const r = await run({ operation: "get_page" }, fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("malformed_response");
    expect(r.ok).toBe(false);
  });
  it("rejects list responses without data", async () => {
    const { fetchImpl } = capture({ foo: 1 });
    const r = await run({ operation: "list_conversations" }, fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("malformed_response");
    expect(r.ok).toBe(false);
  });
  it("rejects unknown operations as unsupported", async () => {
    const r = await run({ operation: "nope" }, capture({}).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("unsupported");
    expect(r.ok).toBe(false);
  });
  it("classifies network failures", async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    const r = await run({ operation: "get_page" }, fetchImpl);
    expect(r.ok).toBe(false);
  });
});

/* Health */
describe("messenger health", () => {
  it("is healthy when the page node answers", async () => {
    const { calls, fetchImpl } = capture({ id: PAGE_ID, name: "Store" });
    const h = await checkConnectorHealth({ adapter: messengerConnector, credentials: creds, traceId: trace, fetchImpl });
    expect(h.healthy).toBe(true);
    expect(calls[0]?.url).toContain(`/${PAGE_ID}`);
  });
  it("is unhealthy on an invalid token", async () => {
    const { fetchImpl } = capture({ error: { message: "bad", code: 190 } }, { status: 401 });
    const h = await checkConnectorHealth({ adapter: messengerConnector, credentials: creds, traceId: trace, fetchImpl });
    expect(h.healthy).toBe(false);
  });
});

/* Webhooks */
describe("messenger webhooks — signature", () => {
  const payload = event({ message: { mid: MID, text: "hi" } });
  it("accepts a valid X-Hub-Signature-256", () => {
    const v = verifySigned(payload);
    expect(v.ok).toBe(true);
    expect(v.eventType).toBe("message.received");
  });
  it("rejects a tampered signature", () => {
    expect(verifySigned(payload, { header: sign("other") })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("rejects a missing signature", () => {
    expect(verifySigned(payload, { header: null })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("rejects a signature made with another app secret", () => {
    const raw = JSON.stringify(payload);
    expect(verifySigned(payload, { header: sign(raw, "other-secret") }).ok).toBe(false);
  });
  it("reports a missing app secret", () => {
    expect(verifySigned(payload, { secret: "" })).toMatchObject({ ok: false, reason: "missing_secret" });
  });
  it("resolves via aliases", () => {
    const raw = JSON.stringify(payload);
    const v = verifyWebhook("facebook_messenger", { raw, headers: { "x-hub-signature-256": sign(raw) }, payload, secret: APP_SECRET, nowMs: Date.now(), replayWindowMs: 300_000 });
    expect(v.ok).toBe(true);
  });
});

describe("messenger webhooks — replay protection", () => {
  it("rejects events outside the window", () => {
    const old = event({ message: { mid: MID, text: "x" } }, Date.now() - 3_600_000);
    expect(verifySigned(old)).toMatchObject({ ok: false, reason: "replay" });
  });
  it("accepts events inside the window and reports timestampMs", () => {
    const ts = Date.now() - 1000;
    const v = verifySigned(event({ message: { mid: MID, text: "x" } }, ts));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.timestampMs).toBe(ts);
  });
  it("rejects future-dated events", () => {
    expect(verifySigned(event({ message: { mid: MID } }, Date.now() + 3_600_000)).ok).toBe(false);
  });
});

describe("messenger webhooks — event types and dedupe", () => {
  it("message ids are stable across redeliveries", () => {
    const p = event({ message: { mid: MID, text: "x" } });
    expect(verifySigned(p).eventId).toBe(verifySigned(p).eventId);
    expect(verifySigned(p).eventId).toBe(`message.received:${MID}`);
  });
  it("distinct messages have distinct ids", () => {
    expect(verifySigned(event({ message: { mid: "m_one111" } })).eventId).not.toBe(verifySigned(event({ message: { mid: "m_two222" } })).eventId);
  });
  it("echoes are typed separately from inbound messages", () => {
    const v = verifySigned(event({ message: { mid: MID, is_echo: true, text: "x" } }));
    expect(v.eventType).toBe("message.echo");
    expect(v.eventId).toBe(`message.echo:${MID}`);
  });
  it("delivery events dedupe by mids + watermark", () => {
    const v = verifySigned(event({ delivery: { mids: [MID], watermark: 1760000000000 } }));
    expect(v.eventType).toBe("message.delivered");
    expect(v.eventId).toBe(`message.delivered:${PSID}:${MID}:1760000000000`);
  });
  it("read events dedupe by watermark", () => {
    const v = verifySigned(event({ read: { watermark: 1760000000001 } }));
    expect(v.eventType).toBe("message.read");
    expect(v.eventId).toBe(`message.read:${PSID}:1760000000001`);
  });
  it("reactions include the action so react/unreact differ", () => {
    const a = verifySigned(event({ reaction: { mid: MID, action: "react", reaction: "love" } }));
    const b = verifySigned(event({ reaction: { mid: MID, action: "unreact", reaction: "love" } }));
    expect(a.eventType).toBe("message.reaction");
    expect(a.eventId).not.toBe(b.eventId);
  });
  it("postbacks use the official mid", () => {
    const v = verifySigned(event({ postback: { mid: "m_pb1234", payload: "GET_STARTED", title: "Start" } }));
    expect(v).toMatchObject({ eventType: "postback", eventId: "postback:m_pb1234" });
  });
  it("referral events fall back to page + sender + timestamp", () => {
    const ts = Date.now();
    const v = verifySigned(event({ referral: { ref: "ad", source: "ADS" } }, ts));
    expect(v.eventType).toBe("referral");
    expect(v.eventId).toBe(`referral:${PAGE_ID}:${PSID}:${ts}`);
  });
});

describe("messenger webhooks — normalization", () => {
  it("normalizes an inbound message with attachments and reply context", () => {
    const [e] = normalizeMessengerWebhookEvent(
      event({ message: { mid: MID, text: "صورة", reply_to: { mid: "m_prev111" }, attachments: [{ type: "image", payload: { url: "https://x/a.jpg" } }] } }, 1760000000000),
    );
    expect(e).toMatchObject({
      event: "message.received", page_id: PAGE_ID, sender_id: PSID, recipient_id: PAGE_ID, message_id: MID,
      text: "صورة", reply_to_id: "m_prev111", attachments: [{ type: "image", url: "https://x/a.jpg" }],
      occurred_at: new Date(1760000000000).toISOString(),
    });
  });
  it("flattens batched entries", () => {
    const a = event({ message: { mid: "m_a1111" } });
    const b = event({ read: { watermark: 1 } });
    const events = normalizeMessengerWebhookEvent({ object: "page", entry: [...a.entry, ...b.entry] });
    expect(events.map((e) => e.event)).toEqual(["message.received", "message.read"]);
  });
  it("normalizes deliveries, postbacks and reactions", () => {
    expect(normalizeMessengerWebhookEvent(event({ delivery: { mids: [MID], watermark: 5 } }))[0]).toMatchObject({ message_ids: [MID], watermark: "5" });
    expect(normalizeMessengerWebhookEvent(event({ postback: { mid: "m_p1234", payload: "BUY" } }))[0]).toMatchObject({ postback_payload: "BUY" });
    expect(normalizeMessengerWebhookEvent(event({ reaction: { mid: MID, reaction: "love", action: "react" } }))[0]).toMatchObject({ reaction: "love", message_id: MID });
  });
  it("tolerates malformed payloads", () => {
    expect(normalizeMessengerWebhookEvent(null)).toEqual([]);
    expect(normalizeMessengerWebhookEvent({ entry: "x" })).toEqual([]);
    expect(normalizeMessengerMessage(undefined)).toMatchObject({ id: null, attachments: [] });
    expect(normalizeMessengerConversation(42)).toMatchObject({ id: null, participant_ids: [] });
  });
});

/* Idempotency */
describe("messenger idempotency", () => {
  it("never invents an undocumented idempotency header or field", async () => {
    const { calls, fetchImpl } = capture(SENT);
    await run({ operation: "send_message", params: { recipient_id: PSID, text: "x", idempotency_key: "k-1" } }, fetchImpl, creds, { idempotencyKey: "k-1" } as never);
    expect(JSON.stringify(calls[0]?.init.headers)).not.toMatch(/idempotency/i);
    expect(JSON.stringify(body(calls[0]))).not.toMatch(/idempotency/i);
  });
  it("lets ZYRONEX carry its execution key in the official metadata field", async () => {
    const { calls, fetchImpl } = capture(SENT);
    await run({ operation: "send_message", params: { recipient_id: PSID, text: "x", metadata: "zx-exec-42" } }, fetchImpl);
    expect((body(calls[0])["message"] as Record<string, unknown>)["metadata"]).toBe("zx-exec-42");
  });
  it("documents the missing official idempotency header", () => {
    expect(UNSUPPORTED_OPERATIONS["idempotency_key"]).toMatch(/idempotency/i);
  });
  it("webhook dedupe keys come only from official identifiers", () => {
    const v = verifySigned(event({ message: { mid: MID } }));
    expect(v.eventId).toContain(MID);
  });
});

/* Isolation, redaction, tracing */
describe("messenger isolation, redaction and tracing", () => {
  it("never mixes two workspaces' tokens or pages", async () => {
    const a = capture(SENT);
    const b = capture(SENT);
    await run({ operation: "send_message", params: { recipient_id: PSID, text: "a" } }, a.fetchImpl, { access_token: "EAA_A", page_id: "111110000" });
    await run({ operation: "send_message", params: { recipient_id: PSID, text: "b" } }, b.fetchImpl, { access_token: "EAA_B", page_id: "222220000" });
    expect(auth(a.calls[0])).toBe("Bearer EAA_A");
    expect(a.calls[0]?.url).toContain("111110000");
    expect(auth(b.calls[0])).toBe("Bearer EAA_B");
    expect(b.calls[0]?.url).toContain("222220000");
  });
  it("ignores page ids smuggled through params", async () => {
    const { calls, fetchImpl } = capture(SENT);
    await run({ operation: "send_message", params: { recipient_id: PSID, text: "x", page_id: "999990000" } }, fetchImpl);
    expect(calls[0]?.url).toContain(PAGE_ID);
    expect(calls[0]?.url).not.toContain("999990000");
  });
  it("never leaks the token into results", async () => {
    const { fetchImpl } = capture(SENT);
    const r = await run({ operation: "send_message", params: { recipient_id: PSID, text: "x" } }, fetchImpl);
    expect(JSON.stringify(r)).not.toContain(creds.access_token);
  });
  it("scrubs the token from provider error messages", async () => {
    const { fetchImpl } = capture({ error: { message: `bad token ${creds.access_token}`, code: 190 } }, { status: 401 });
    const r = await run({ operation: "get_page" }, fetchImpl);
    expect(JSON.stringify(r)).not.toContain(creds.access_token);
  });
  it("never leaks the app secret through webhook verification", () => {
    expect(JSON.stringify(verifySigned(event({ message: { mid: MID } }), { header: "sha256=bad" }))).not.toContain(APP_SECRET);
  });
  it("carries the trace id on success and failure", async () => {
    const ok = await run({ operation: "get_page" }, capture({ id: PAGE_ID }).fetchImpl);
    const fail = await run({ operation: "nope" }, capture({}).fetchImpl);
    expect(ok.traceId).toBe(trace);
    expect(fail.traceId).toBe(trace);
  });
  it("emits trace-tagged runtime events", async () => {
    const events: { traceId: string; connector: string }[] = [];
    await run({ operation: "get_page" }, capture({ id: PAGE_ID }).fetchImpl, creds, { onEvent: (e: { traceId: string; connector: string }) => events.push(e) } as never);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.traceId === trace && e.connector === "messenger")).toBe(true);
  });
});
