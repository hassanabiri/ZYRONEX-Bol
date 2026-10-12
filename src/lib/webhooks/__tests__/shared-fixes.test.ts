import { createHmac, generateKeyPairSync, sign, createSign } from "node:crypto";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { slackConnector } from "@/lib/connectors/adapters/slack";
import { telegramConnector } from "@/lib/connectors/adapters/telegram";
import { runConnectorOperation } from "@/lib/connectors/core";
import { handleWebhook } from "@/lib/webhooks/core";
import { __gmailOidcTesting, verifyGoogleOidcSignature, verifyWebhook, verifyWebhookAsync } from "@/lib/webhooks/verify";
import type { WebhookEndpointRecord, WebhookStore } from "@/lib/webhooks/types";

/** Simulation only — no real Microsoft, Slack, Discord or Google service is contacted. */

function endpoint(connector: string, secret: string | null): WebhookEndpointRecord {
  return { id: "ep-1", workspaceId: "ws-1", integrationId: null, workflowId: null, connector, enabled: true, events: [], secret, replayWindowSeconds: 300, maxAttempts: 3 };
}
function makeStore(ep: WebhookEndpointRecord) {
  const inserted: unknown[] = [];
  const executions: unknown[] = [];
  const store: WebhookStore = {
    findEndpoint: async (slug) => (slug === "s" ? ep : null),
    insertEvent: async (row) => (inserted.push(row), { duplicate: false, id: `e${inserted.length}` }),
    updateEvent: async () => {},
    recordDelivery: async () => {},
    startExecution: async (i) => (executions.push(i), { executionId: "x1" }),
  };
  return { store, inserted, executions };
}

// ---------------------------------------------------------------------------
describe("Microsoft Graph validationToken", () => {
  const ep = endpoint("microsoft_graph", "client-state");
  it("echoes the decoded token as text/plain 200 without persisting", async () => {
    const { store, inserted, executions } = makeStore(ep);
    const res = await handleWebhook({ slug: "s", rawBody: "", headers: {}, query: { validationToken: "Validation: Testing client application reachability <x>" }, store });
    expect(res.status).toBe(200);
    expect(res.raw).toEqual({ contentType: "text/plain; charset=utf-8", body: "Validation: Testing client application reachability <x>" });
    expect(inserted).toHaveLength(0);
    expect(executions).toHaveLength(0);
  });
  it("Teams uses the same handshake", async () => {
    const { store } = makeStore(endpoint("microsoft_teams", "cs"));
    const res = await handleWebhook({ slug: "s", rawBody: "", headers: {}, query: { validationToken: "abc" }, store });
    expect(res.raw?.body).toBe("abc");
  });
  it("rejects an empty token", () => expect(verifyWebhook("microsoft_graph", { raw: "", headers: {}, payload: {}, secret: "cs", nowMs: 0, replayWindowMs: 1, query: { validationToken: "" } }).ok).toBe(false));
  it("rejects an oversized token", () => expect(verifyWebhook("microsoft_graph", { raw: "", headers: {}, payload: {}, secret: "cs", nowMs: 0, replayWindowMs: 1, query: { validationToken: "a".repeat(3000) } }).ok).toBe(false));
  it("unknown endpoints never echo", async () => {
    const { store } = makeStore(ep);
    const res = await handleWebhook({ slug: "nope", rawBody: "", headers: {}, query: { validationToken: "abc" }, store });
    expect(res.status).toBe(404);
    expect(res.raw).toBeUndefined();
  });
  it("notifications without a token keep the clientState check", async () => {
    const { store } = makeStore(ep);
    const body = JSON.stringify({ value: [{ subscriptionId: "s1", clientState: "wrong", changeType: "created", resource: "me/messages('1')" }] });
    const res = await handleWebhook({ slug: "s", rawBody: body, headers: {}, query: {}, store });
    expect(res.status).toBe(401);
  });
  it("valid notifications keep the normal JSON 202 reply", async () => {
    const { store, inserted } = makeStore(ep);
    const body = JSON.stringify({ value: [{ subscriptionId: "s1", clientState: "client-state", changeType: "created", resource: "me/messages('1')", resourceData: { id: "1" } }] });
    const res = await handleWebhook({ slug: "s", rawBody: body, headers: {}, store });
    expect(res.status).toBe(202);
    expect(res.raw).toBeUndefined();
    expect(inserted).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("Slack url_verification", () => {
  const SECRET = "slack-signing";
  const now = 1_790_000_000;
  const signed = (raw: string, secret = SECRET) => ({
    "x-slack-request-timestamp": String(now),
    "x-slack-signature": `v0=${createHmac("sha256", secret).update(`v0:${now}:${raw}`).digest("hex")}`,
  });
  const raw = JSON.stringify({ token: "t", challenge: "3eZbrw1aBm2", type: "url_verification" });
  it("replies 200 with the challenge for a signed request, without persisting", async () => {
    const { store, inserted } = makeStore(endpoint("slack", SECRET));
    const res = await handleWebhook({ slug: "s", rawBody: raw, headers: signed(raw), store, nowMs: now * 1000 });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.raw!.body!)).toEqual({ challenge: "3eZbrw1aBm2" });
    expect(inserted).toHaveLength(0);
  });
  it("never echoes the challenge for a bad signature", async () => {
    const { store } = makeStore(endpoint("slack", SECRET));
    const res = await handleWebhook({ slug: "s", rawBody: raw, headers: signed(raw, "other"), store, nowMs: now * 1000 });
    expect(res.status).toBe(401);
    expect(res.raw).toBeUndefined();
  });
  it("regular events are unchanged", async () => {
    const { store, inserted } = makeStore(endpoint("slack", SECRET));
    const ev = JSON.stringify({ type: "event_callback", event_id: "Ev1", event: { type: "message" } });
    const res = await handleWebhook({ slug: "s", rawBody: ev, headers: signed(ev), store, nowMs: now * 1000 });
    expect(res.status).toBe(202);
    expect(res.raw).toBeUndefined();
    expect(inserted).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("Discord PING / webhook events", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const KEY = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("hex");
  const NOW_S = 1_790_000_000;
  const headers = (raw: string, key = privateKey) => ({ "x-signature-ed25519": sign(null, Buffer.from(String(NOW_S) + raw), key).toString("hex"), "x-signature-timestamp": String(NOW_S) });
  const run = async (payload: unknown, key = privateKey) => {
    const ctx = makeStore(endpoint("discord", KEY));
    const raw = JSON.stringify(payload);
    const res = await handleWebhook({ slug: "s", rawBody: raw, headers: headers(raw, key), store: ctx.store, nowMs: NOW_S * 1000 });
    return { res, ...ctx };
  };
  it("interaction PING → 200 {type:1}, nothing persisted", async () => {
    const { res, inserted } = await run({ id: "1", application_id: "2", type: 1, token: "tok", version: 1 });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.raw!.body!)).toEqual({ type: 1 });
    expect(inserted).toHaveLength(0);
  });
  it("invalid signature on PING → 401", async () => {
    const other = generateKeyPairSync("ed25519").privateKey;
    const { res } = await run({ id: "1", application_id: "2", type: 1, token: "tok", version: 1 }, other);
    expect(res.status).toBe(401);
  });
  it("webhook-event PING (type 0) → 204 empty", async () => {
    const { res, inserted } = await run({ version: 1, application_id: "2", type: 0 });
    expect(res.status).toBe(204);
    expect(res.raw?.body).toBeUndefined();
    expect(inserted).toHaveLength(0);
  });
  it("webhook events → 204 and are still processed", async () => {
    const { res, inserted, executions } = await run({ version: 1, application_id: "2", type: 1, event: { type: "APPLICATION_AUTHORIZED", timestamp: "2026-09-27T10:00:00.000Z", data: {} } });
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
    expect(executions).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("Gmail Pub/Sub OIDC signature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, string>), kid: "k1", alg: "RS256", use: "sig" };
  const NOW = Date.parse("2026-10-01T10:00:00Z");
  const AUD = "https://zyronex.example/push-audience";
  const jwt = (claims: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: typeof privateKey } = {}) => {
    const h = Buffer.from(JSON.stringify({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" })).toString("base64url");
    const p = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const s = createSign("RSA-SHA256").update(`${h}.${p}`).sign(opts.key ?? privateKey).toString("base64url");
    return `Bearer ${h}.${p}.${s}`;
  };
  const claims = { aud: AUD, iss: "https://accounts.google.com", exp: NOW / 1000 + 600, email: "push@proj.iam.gserviceaccount.com", email_verified: true };
  const envelope = { message: { data: Buffer.from(JSON.stringify({ emailAddress: "a@b.com", historyId: "9" })).toString("base64"), messageId: "m1", publishTime: new Date(NOW - 1000).toISOString() }, subscription: "projects/p/subscriptions/s" };
  const input = (auth: string) => ({ raw: JSON.stringify(envelope), headers: { authorization: auth }, payload: envelope, secret: AUD, nowMs: NOW, replayWindowMs: 300_000 });
  const fetcher = vi.fn(async () => [jwk]);
  beforeEach(() => {
    fetcher.mockClear();
    __gmailOidcTesting.setCertsFetcher(fetcher);
  });

  it("accepts a correctly signed token", async () => expect((await verifyWebhookAsync("google_mail", input(jwt(claims)))).ok).toBe(true));
  it("rejects a forged signature with valid claims", async () => {
    const forger = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const r = await verifyWebhookAsync("google_mail", input(jwt(claims, { key: forger })));
    expect(r).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("the sync check alone still passes a forged token (why the async step is required)", () => {
    const forger = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    expect(verifyWebhook("google_mail", input(jwt(claims, { key: forger }))).ok).toBe(true);
  });
  it("rejects an unknown key id after refreshing keys", async () => {
    const r = await verifyWebhookAsync("google_mail", input(jwt(claims, { kid: "zzz" })));
    expect(r.ok).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("rejects non-RS256 tokens", async () => expect((await verifyGoogleOidcSignature(jwt(claims, { alg: "HS256" }), NOW)).ok).toBe(false));
  it("rejects unverified email", async () => expect((await verifyWebhookAsync("google_mail", input(jwt({ ...claims, email_verified: false })))).ok).toBe(false));
  it("rejects when Google keys are unavailable", async () => {
    __gmailOidcTesting.setCertsFetcher(async () => {
      throw new Error("down");
    });
    expect((await verifyWebhookAsync("google_mail", input(jwt(claims)))).message).toMatch(/unavailable/);
  });
  it("caches keys between deliveries", async () => {
    await verifyWebhookAsync("google_mail", input(jwt(claims)));
    await verifyWebhookAsync("google_mail", input(jwt(claims)));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("wrong audience still fails before any key fetch", async () => {
    expect((await verifyWebhookAsync("google_mail", input(jwt({ ...claims, aud: "other" })))).ok).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("ingress rejects a forged Gmail push", async () => {
    const forger = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
    const { store, inserted } = makeStore(endpoint("google_mail", AUD));
    const res = await handleWebhook({ slug: "s", rawBody: JSON.stringify(envelope), headers: { authorization: jwt(claims, { key: forger }) }, store, nowMs: NOW });
    expect(res.status).toBe(401);
    expect(inserted).toHaveLength(0);
  });
  it("other connectors are not affected by the async step", async () => {
    const secret = "s";
    const raw = JSON.stringify({ id: "e1", type: "x" });
    const t = Math.floor(NOW / 1000);
    const sig = createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
    const r = await verifyWebhookAsync("http", { raw, headers: { "x-zyronex-signature": `t=${t},v1=${sig}` }, payload: JSON.parse(raw), secret, nowMs: NOW, replayWindowMs: 300_000 });
    expect(r.ok).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("runtime honours Retry-After from the failed 429 response", () => {
  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  it("waits the provider's Retry-After (Slack header)", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async () => (n++ === 0 ? json({ ok: false, error: "ratelimited" }, 429, { "retry-after": "3" }) : json({ ok: true, ts: "1" }))) as unknown as typeof fetch;
    const r = await runConnectorOperation({ adapter: slackConnector, credentials: { access_token: "xoxb" }, traceId: "t", input: { operation: "post_message", params: { channel: "C1", text: "hi" } }, fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    expect(r.ok).toBe(true);
    expect(sleeps).toEqual([3000]);
  });
  it("caps the wait at the runtime ceiling (8s)", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async () => (n++ === 0 ? json({ ok: false, error: "ratelimited" }, 429, { "retry-after": "120" }) : json({ ok: true }))) as unknown as typeof fetch;
    await runConnectorOperation({ adapter: slackConnector, credentials: { access_token: "xoxb" }, traceId: "t", input: { operation: "post_message", params: { channel: "C1", text: "hi" } }, fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps).toEqual([8000]);
  });
  it("honours Telegram retry_after in the body", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async () =>
      n++ === 0 ? json({ ok: false, error_code: 429, description: "Too Many Requests: retry after 2", parameters: { retry_after: 2 } }, 429) : json({ ok: true, result: { id: 1, is_bot: true, first_name: "b", username: "b" } }),
    ) as unknown as typeof fetch;
    const r = await runConnectorOperation({ adapter: telegramConnector, credentials: { access_token: "123:abc" }, traceId: "t", input: { operation: "get_me" }, fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    expect(r.ok).toBe(true);
    expect(sleeps).toEqual([2000]);
  });
  it("keeps the attempt limit", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (n++, json({ ok: false, error: "ratelimited" }, 429, { "retry-after": "1" }))) as unknown as typeof fetch;
    const r = await runConnectorOperation({ adapter: slackConnector, credentials: { access_token: "xoxb" }, traceId: "t", input: { operation: "post_message", params: { channel: "C1", text: "hi" } }, fetchImpl, sleep: async () => {}, maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect(n).toBe(3);
  });
  it("non-rate-limit failures still use exponential backoff", async () => {
    const sleeps: number[] = [];
    let n = 0;
    const fetchImpl = vi.fn(async () => (n++ === 0 ? json({}, 503, { "retry-after": "5" }) : json({ ok: true, ts: "1" }))) as unknown as typeof fetch;
    await runConnectorOperation({ adapter: slackConnector, credentials: { access_token: "xoxb" }, traceId: "t", input: { operation: "post_message", params: { channel: "C1", text: "hi" } }, fetchImpl, sleep: async (ms) => void sleeps.push(ms) });
    expect(sleeps[0]).toBeLessThan(1000);
  });
});
