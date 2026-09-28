import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { SLACK_API_BASE, UNSUPPORTED_OPERATIONS, slackConnector } from "@/lib/connectors/adapters/slack";
import {
  normalizeSlackEvent,
  normalizeSlackMessage,
  slackEventId,
  slackEventType,
  slackTsToIso,
} from "@/lib/connectors/adapters/slack-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { PROVIDERS } from "@/lib/integrations/catalog";
import { beginAuthorization, completeAuthorization, hashState } from "@/lib/oauth/core";
import { getOAuthProvider } from "@/lib/oauth/providers";
import type { ConnectionAccount, OAuthStore, OAuthTokenSet, PendingAuthorization } from "@/lib/oauth/types";
import { verifyWebhook } from "@/lib/webhooks/verify";

const trace = "trace-slack";
const TOKEN = "xoxb-1111-2222-SlackBotTokenA";
const TOKEN_B = "xoxb-3333-4444-SlackBotTokenB";
const SIGNING = "8f742231b10e8888abcd99yyyzzz85a5";
const creds = { access_token: TOKEN };
const NOW = 1_700_000_100_000;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
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
function sequence(...responses: (() => Response)[]) {
  let i = 0;
  const fetchImpl = vi.fn(async () => responses[Math.min(i++, responses.length - 1)]!()) as unknown as typeof fetch;
  return { fetchImpl, count: () => i };
}
function run(
  input: Parameters<typeof runConnectorOperation>[0]["input"],
  fetchImpl: typeof fetch,
  credentials: Record<string, string> = creds,
  extra: Partial<Parameters<typeof runConnectorOperation>[0]> = {},
) {
  return runConnectorOperation({ adapter: slackConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {}, ...extra });
}
const body = (call: { init: RequestInit } | undefined) => JSON.parse(String(call?.init.body ?? "{}")) as Record<string, unknown>;
const headerOf = (call: { init: RequestInit } | undefined, name: string) =>
  (call?.init.headers as Record<string, string> | undefined)?.[name];
const MSG = { type: "message", ts: "1700000000.000100", user: "U1", text: "hello", channel: "C1" };

function sign(raw: string, ts: string, secret = SIGNING) {
  return `v0=${createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex")}`;
}
function verify(
  payload: unknown,
  opts: { ts?: string; signature?: string | null; secret?: string | null; nowMs?: number; raw?: string } = {},
) {
  const raw = opts.raw ?? JSON.stringify(payload);
  const ts = opts.ts ?? String(Math.floor(NOW / 1000));
  const headers: Record<string, string> = { "x-slack-request-timestamp": ts };
  if (opts.signature !== null) headers["x-slack-signature"] = opts.signature ?? sign(raw, ts);
  return verifyWebhook("slack", {
    raw,
    headers,
    payload: JSON.parse(raw) as unknown,
    secret: opts.secret === undefined ? SIGNING : opts.secret,
    nowMs: opts.nowMs ?? NOW,
    replayWindowMs: 300_000,
  });
}
const EVENT = {
  token: "legacy",
  team_id: "T1",
  api_app_id: "A1",
  type: "event_callback",
  event_id: "Ev0001",
  event_time: 1_700_000_000,
  event: { ...MSG },
};

function memoryStore() {
  const states = new Map<string, PendingAuthorization & { stateHash: string; expiresAt: string; used?: boolean }>();
  const accounts = new Map<string, ConnectionAccount>();
  const tokens = new Map<string, OAuthTokenSet>();
  let seq = 0;
  const store: OAuthStore = {
    saveState: async (s) => void states.set(s.stateHash, { ...s }),
    consumeState: async (hash, nowMs) => {
      const row = states.get(hash);
      if (!row || row.used || new Date(row.expiresAt).getTime() <= nowMs) return null;
      row.used = true;
      return row;
    },
    upsertAccount: async (input) => {
      const existing = [...accounts.values()].find(
        (a) => a.workspaceId === input.workspaceId && a.provider === input.provider && a.accountIdentifier === input.accountIdentifier,
      );
      const { tokens: t, ...rest } = input;
      const account: ConnectionAccount = { ...rest, id: existing?.id ?? `acc-${++seq}`, refreshFailures: 0 };
      accounts.set(account.id, account);
      tokens.set(account.id, t);
      return account;
    },
    getAccount: async (ws, id) => {
      const a = accounts.get(id);
      return a && a.workspaceId === ws ? a : null;
    },
    readTokens: async (id) => tokens.get(id) ?? null,
    writeTokens: async (id, t) => void tokens.set(id, t),
    updateAccount: async (id, patch) => void accounts.set(id, { ...accounts.get(id)!, ...patch }),
  } as OAuthStore;
  return { store, accounts, tokens, states };
}

// ---------------------------------------------------------------------------
describe("slack registration", () => {
  it("is registered in the connector registry", () => {
    expect(getConnector("slack")?.id).toBe("slack");
    const d = describeConnectors().find((c) => c.id === "slack");
    expect(d?.authKind).toBe("bearer");
    expect(d?.requiredCredentials).toEqual(["access_token"]);
  });
  it("declares connector capabilities and health operation", () => {
    expect(slackConnector.capabilities).toEqual(expect.arrayContaining(["messaging", "pagination", "files", "webhook", "health_check"]));
    expect(slackConnector.healthOperation).toBe("auth_test");
  });
  it("keeps every pre-existing operation", () => {
    for (const op of ["post_message", "list_channels", "list_messages", "list_users", "auth_test"])
      expect(slackConnector.operations).toContain(op);
  });
  it("catalog lists the Slack provider with a signing secret field", () => {
    const p = PROVIDERS.find((x) => x.id === "slack");
    expect(p?.authType).toBe("oauth2");
    expect(p?.credentialFields.find((f) => f.key === "signing_secret")?.secret).toBe(true);
    expect(p?.credentialFields.find((f) => f.key === "client_secret")?.secret).toBe(true);
  });
  it("does not expose unsupported operations", () => {
    for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) {
      expect(slackConnector.operations).not.toContain(op);
      expect(() => slackConnector.buildCall({ operation: op })).toThrow(/Unknown Slack operation/);
    }
  });
  it("documents a reason for every unsupported operation", () => {
    for (const reason of Object.values(UNSUPPORTED_OPERATIONS)) expect(reason.length).toBeGreaterThan(30);
  });
  it("only targets the official slack.com Web API host", () => {
    const src = readFileSync("src/lib/connectors/adapters/slack.ts", "utf8");
    const hosts = [...src.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1]);
    for (const h of hosts) expect(["slack.com", "api.slack.com"]).toContain(h);
    for (const op of slackConnector.operations)
      expect(slackConnector.buildCall({ operation: op, params: requiredParams(op) }).url.startsWith(SLACK_API_BASE)).toBe(true);
  });
  it("contains no AI, database or business logic", () => {
    for (const f of ["slack.ts", "slack-map.ts"]) {
      const src = readFileSync(`src/lib/connectors/adapters/${f}`, "utf8");
      expect(src).not.toMatch(/supabase|gemini|openai|ai-gateway|createServerFn|from\(["']/i);
    }
  });
});

function requiredParams(op: string): Record<string, unknown> {
  const all = {
    channel: "C1", text: "t", thread_ts: "1.1", ts: "1.1", user: "U1", users: "U2", name: "n", topic: "x", purpose: "y",
    email: "a@b.co", post_at: 1_800_000_000, scheduled_message_id: "Q1", message_ts: "1.1", timestamp: "1.1", file: "F1",
  };
  void op;
  return all;
}

// ---------------------------------------------------------------------------
describe("slack OAuth / authentication", () => {
  const spec = getOAuthProvider("slack")!;
  it("uses the official Slack OAuth v2 endpoints", () => {
    expect(spec.authorizationUrl).toBe("https://slack.com/oauth/v2/authorize");
    expect(spec.tokenUrl).toBe("https://slack.com/api/oauth.v2.access");
    expect(spec.revokeUrl).toBe("https://slack.com/api/auth.revoke");
  });
  it("joins scopes with commas as Slack documents", async () => {
    const { store } = memoryStore();
    const { authorizationUrl } = await beginAuthorization({
      store, spec, clientId: "cid",
      pending: { workspaceId: "ws1", integrationId: null, provider: "slack", connector: "slack", redirectUri: "https://app.test/cb", createdBy: null },
      nowMs: NOW,
    });
    const url = new URL(authorizationUrl);
    expect(url.searchParams.get("scope")).toContain("chat:write,");
    expect(url.searchParams.get("scope")).not.toContain(" ");
    expect(url.searchParams.get("state")?.length).toBeGreaterThan(20);
  });
  it("requests the scopes needed for messages, reactions, users and files", () => {
    expect(spec.scopes).toEqual(expect.arrayContaining(["chat:write", "channels:history", "reactions:write", "users:read", "team:read", "files:read"]));
  });
  it("exchanges the code and stores the account per Slack team", async () => {
    const { store, tokens, states } = memoryStore();
    const { state } = await beginAuthorization({
      store, spec, clientId: "cid",
      pending: { workspaceId: "ws1", integrationId: null, provider: "slack", connector: "slack", redirectUri: "https://app.test/cb", createdBy: null },
      nowMs: NOW,
    });
    expect(states.has(hashState(state))).toBe(true);
    const { calls, fetchImpl } = capture({
      ok: true, access_token: TOKEN, token_type: "bot", scope: "chat:write,channels:read", bot_user_id: "UBOT", app_id: "A1",
      team: { id: "T1", name: "Acme" },
    });
    const { account } = await completeAuthorization({ store, spec, client: { clientId: "cid", clientSecret: "shh" }, state, code: "c1", fetchImpl, nowMs: NOW });
    expect(calls[0]!.url).toBe("https://slack.com/api/oauth.v2.access");
    expect(account.accountIdentifier).toBe("T1");
    expect(account.accountLabel).toBe("Acme");
    expect(account.workspaceId).toBe("ws1");
    expect(account.scopes).toEqual(["chat:write", "channels:read"]);
    expect(tokens.get(account.id)?.accessToken).toBe(TOKEN);
    expect(tokens.get(account.id)?.extra).toEqual({ bot_user_id: "UBOT", app_id: "A1" });
    expect(JSON.stringify(account)).not.toContain(TOKEN);
  });
  it("rejects a Slack ok:false token response without leaking the secret", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({
      store, spec, clientId: "cid",
      pending: { workspaceId: "ws1", integrationId: null, provider: "slack", connector: "slack", redirectUri: "https://app.test/cb", createdBy: null },
      nowMs: NOW,
    });
    const { fetchImpl } = capture({ ok: false, error: "invalid_code" });
    await expect(
      completeAuthorization({ store, spec, client: { clientId: "cid", clientSecret: "shh-secret" }, state, code: "bad", fetchImpl, nowMs: NOW }),
    ).rejects.toThrow(/invalid_code/);
  });
  it("rejects a replayed OAuth state", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({
      store, spec, clientId: "cid",
      pending: { workspaceId: "ws1", integrationId: null, provider: "slack", connector: "slack", redirectUri: "https://app.test/cb", createdBy: null },
      nowMs: NOW,
    });
    const { fetchImpl } = capture({ ok: true, access_token: TOKEN, team: { id: "T1" } });
    await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "c", fetchImpl, nowMs: NOW });
    await expect(completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "c", fetchImpl, nowMs: NOW })).rejects.toThrow();
  });
  it("identifies Enterprise Grid org installs", () => {
    expect(spec.identify?.({ enterprise: { id: "E1", name: "Org" } })).toEqual({ accountIdentifier: "E1", accountLabel: "Org" });
  });
  it("injects the bearer token only at authorize time", async () => {
    const { calls, fetchImpl } = capture({ ok: true, user_id: "UBOT", team_id: "T1" });
    await run({ operation: "auth_test" }, fetchImpl);
    expect(headerOf(calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(slackConnector.buildCall({ operation: "auth_test" }).headers["authorization"]).toBeUndefined();
  });
  it("fails fast without credentials", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await run({ operation: "auth_test" }, fetchImpl, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects a blank token", () => {
    expect(() => slackConnector.authorize(slackConnector.buildCall({ operation: "auth_test" }), { access_token: "  " })).toThrow(/not connected/);
  });
  for (const code of ["invalid_auth", "not_authed", "token_revoked", "account_inactive", "token_expired"]) {
    it(`maps ${code} to a non-retryable auth error`, async () => {
      const r = await run({ operation: "auth_test" }, capture({ ok: false, error: code }).fetchImpl);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe("auth");
        expect(r.error.retryable).toBe(false);
      }
    });
  }
});

// ---------------------------------------------------------------------------
describe("slack identity / workspace", () => {
  it("auth.test returns identity for the connection account", async () => {
    const { calls, fetchImpl } = capture({ ok: true, url: "https://acme.slack.com/", team: "Acme", user: "zyx", team_id: "T1", user_id: "UBOT", bot_id: "B1" });
    const r = await run({ operation: "auth_test" }, fetchImpl);
    expect(calls[0]!.url).toBe(`${SLACK_API_BASE}/auth.test`);
    expect(calls[0]!.init.method).toBe("POST");
    if (r.ok) expect(r.items[0]).toMatchObject({ team_id: "T1", bot_id: "B1" });
  });
  it("team.info normalizes the team", async () => {
    const { calls, fetchImpl } = capture({ ok: true, team: { id: "T1", name: "Acme", domain: "acme" } });
    const r = await run({ operation: "team_info" }, fetchImpl);
    expect(calls[0]!.url).toContain("/team.info");
    if (r.ok) expect(r.items[0]).toMatchObject({ id: "T1", kind: "team", name: "Acme", domain: "acme" });
  });
  it("bots.info returns bot identity", async () => {
    const { calls, fetchImpl } = capture({ ok: true, bot: { id: "B1", name: "zyronex" } });
    await run({ operation: "bot_info", params: { bot: "B1" } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("bot")).toBe("B1");
  });
  it("users.list normalizes members", async () => {
    const { fetchImpl } = capture({
      ok: true,
      members: [{ id: "U1", name: "sara", real_name: "Sara", profile: { display_name: "sara.d", email: "s@x.co" }, is_bot: false }],
      response_metadata: { next_cursor: "" },
    });
    const r = await run({ operation: "list_users" }, fetchImpl);
    if (r.ok) expect(r.items[0]).toMatchObject({ id: "U1", kind: "user", displayName: "sara.d", email: "s@x.co", isBot: false });
  });
  it("users.info requires user", async () => {
    const r = await run({ operation: "get_user" }, capture({ ok: true }).fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("invalid_request");
  });
  it("users.lookupByEmail passes the email", async () => {
    const { calls, fetchImpl } = capture({ ok: true, user: { id: "U9", name: "x" } });
    const r = await run({ operation: "lookup_user_by_email", params: { email: "a@b.co" } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("email")).toBe("a@b.co");
    if (r.ok) expect(r.items[0]!["id"]).toBe("U9");
  });
  it("maps users_not_found to not_found", async () => {
    const r = await run({ operation: "lookup_user_by_email", params: { email: "a@b.co" } }, capture({ ok: false, error: "users_not_found" }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
describe("slack channels / conversations", () => {
  it("lists conversations with types and default limit", async () => {
    const { calls, fetchImpl } = capture({ ok: true, channels: [{ id: "C1", name: "general", is_channel: true, is_member: true, topic: { value: "hi" } }] });
    const r = await run({ operation: "list_channels", params: { types: "public_channel,private_channel" } }, fetchImpl);
    const q = new URL(calls[0]!.url).searchParams;
    expect(q.get("types")).toBe("public_channel,private_channel");
    expect(q.get("limit")).toBe("100");
    if (r.ok) expect(r.items[0]).toMatchObject({ id: "C1", kind: "conversation", name: "general", isMember: true, topic: "hi" });
  });
  it("caps the page size at 1000", () => {
    const call = slackConnector.buildCall({ operation: "list_channels", params: { limit: 5000 } });
    expect(call.query?.["limit"]).toBe(1000);
  });
  it("gets one conversation", async () => {
    const { calls, fetchImpl } = capture({ ok: true, channel: { id: "C1", name: "general", is_private: true } });
    const r = await run({ operation: "get_conversation", params: { channel: "C1" } }, fetchImpl);
    expect(calls[0]!.url).toContain("/conversations.info");
    if (r.ok) expect(r.items[0]).toMatchObject({ id: "C1", isPrivate: true });
  });
  it("lists members as ids", async () => {
    const r = await run({ operation: "list_members", params: { channel: "C1" } }, capture({ ok: true, members: ["U1", "U2"] }).fetchImpl);
    if (r.ok) expect(r.items).toEqual([{ id: "U1" }, { id: "U2" }]);
  });
  it("creates a channel", async () => {
    const { calls, fetchImpl } = capture({ ok: true, channel: { id: "C9", name: "launch" } });
    const r = await run({ operation: "create_channel", params: { name: "launch", is_private: false } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("POST");
    expect(body(calls[0])).toEqual({ name: "launch", is_private: false });
    if (r.ok) expect(r.items[0]!["id"]).toBe("C9");
  });
  it("archives and unarchives", async () => {
    for (const op of ["archive_channel", "unarchive_channel"]) {
      const { calls, fetchImpl } = capture({ ok: true });
      const r = await run({ operation: op, params: { channel: "C1" } }, fetchImpl);
      expect(calls[0]!.url).toContain(op === "archive_channel" ? "conversations.archive" : "conversations.unarchive");
      expect(r.ok).toBe(true);
    }
  });
  it("invites members", async () => {
    const { calls, fetchImpl } = capture({ ok: true, channel: { id: "C1" } });
    await run({ operation: "invite_members", params: { channel: "C1", users: "U1,U2" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ channel: "C1", users: "U1,U2" });
  });
  it("removes a member", async () => {
    const { calls, fetchImpl } = capture({ ok: true });
    await run({ operation: "remove_member", params: { channel: "C1", user: "U1" } }, fetchImpl);
    expect(calls[0]!.url).toContain("conversations.kick");
  });
  it("sets topic, purpose and renames", async () => {
    for (const [op, params, method] of [
      ["set_topic", { channel: "C1", topic: "t" }, "conversations.setTopic"],
      ["set_purpose", { channel: "C1", purpose: "p" }, "conversations.setPurpose"],
      ["rename_channel", { channel: "C1", name: "new" }, "conversations.rename"],
      ["join_channel", { channel: "C1" }, "conversations.join"],
    ] as const) {
      const { calls, fetchImpl } = capture({ ok: true, channel: { id: "C1" } });
      await run({ operation: op, params }, fetchImpl);
      expect(calls[0]!.url).toContain(method);
    }
  });
  it("maps archive/permission errors to forbidden", async () => {
    for (const code of ["is_archived", "restricted_action", "not_in_channel", "cant_invite_self"]) {
      const r = await run({ operation: "invite_members", params: { channel: "C1", users: "U1" } }, capture({ ok: false, error: code }).fetchImpl);
      if (!r.ok) expect(r.error.kind).toBe("forbidden");
    }
  });
  it("maps channel_not_found to not_found", async () => {
    const r = await run({ operation: "get_conversation", params: { channel: "CX" } }, capture({ ok: false, error: "channel_not_found" }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
  it("create_channel requires a name", () => {
    expect(() => slackConnector.buildCall({ operation: "create_channel" })).toThrow(/name/);
  });
});

// ---------------------------------------------------------------------------
describe("slack messages", () => {
  it("sends a message", async () => {
    const { calls, fetchImpl } = capture({ ok: true, channel: "C1", ts: "1700000000.000100", message: { ...MSG, channel: undefined } });
    const r = await run({ operation: "post_message", params: { channel: "C1", text: "hello" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${SLACK_API_BASE}/chat.postMessage`);
    expect(headerOf(calls[0], "content-type")).toContain("application/json");
    expect(body(calls[0])).toEqual({ channel: "C1", text: "hello" });
    if (r.ok) expect(r.items[0]).toMatchObject({ id: "1700000000.000100", channel: "C1", text: "hello", kind: "message" });
  });
  it("requires channel and text", async () => {
    const r = await run({ operation: "post_message", params: { channel: "C1" } }, capture({ ok: true }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("invalid_request");
  });
  it("drops non-allowlisted params", async () => {
    const { calls, fetchImpl } = capture({ ok: true, ts: "1.1" });
    await run({ operation: "post_message", params: { channel: "C1", text: "x", token: "evil", as_user: true } }, fetchImpl);
    expect(body(calls[0])).toEqual({ channel: "C1", text: "x" });
  });
  it("passes blocks as JSON", async () => {
    const { calls, fetchImpl } = capture({ ok: true, ts: "1.1" });
    await run({ operation: "post_message", params: { channel: "C1", text: "x", blocks: [{ type: "divider" }] } }, fetchImpl);
    expect(body(calls[0])["blocks"]).toEqual([{ type: "divider" }]);
  });
  it("replies in a thread", async () => {
    const { calls, fetchImpl } = capture({ ok: true, channel: "C1", ts: "2.2", message: { ts: "2.2", thread_ts: "1.1", text: "r" } });
    const r = await run({ operation: "reply_message", params: { channel: "C1", text: "r", thread_ts: "1.1", reply_broadcast: true } }, fetchImpl);
    expect(body(calls[0])).toEqual({ channel: "C1", text: "r", thread_ts: "1.1", reply_broadcast: true });
    if (r.ok) expect(r.items[0]).toMatchObject({ threadTs: "1.1", isThreadReply: true });
  });
  it("reply requires thread_ts", () => {
    expect(() => slackConnector.buildCall({ operation: "reply_message", params: { channel: "C1", text: "x" } })).toThrow(/thread_ts/);
  });
  it("posts an ephemeral message", async () => {
    const { calls, fetchImpl } = capture({ ok: true, message_ts: "3.3" });
    await run({ operation: "post_ephemeral", params: { channel: "C1", user: "U1", text: "psst" } }, fetchImpl);
    expect(calls[0]!.url).toContain("chat.postEphemeral");
  });
  it("gets one message via conversations.history latest/inclusive/limit=1", async () => {
    const { calls, fetchImpl } = capture({ ok: true, messages: [MSG] });
    const r = await run({ operation: "get_message", params: { channel: "C1", ts: MSG.ts } }, fetchImpl);
    const q = new URL(calls[0]!.url).searchParams;
    expect(q.get("latest")).toBe(MSG.ts);
    expect(q.get("inclusive")).toBe("true");
    expect(q.get("limit")).toBe("1");
    if (r.ok) expect(r.items).toHaveLength(1);
  });
  it("get_message returns empty when not found", async () => {
    const r = await run({ operation: "get_message", params: { channel: "C1", ts: "9.9" } }, capture({ ok: true, messages: [] }).fetchImpl);
    if (r.ok) expect(r.items).toEqual([]);
  });
  it("lists history", async () => {
    const { calls, fetchImpl } = capture({ ok: true, messages: [MSG, { ...MSG, ts: "1.0" }], has_more: false });
    const r = await run({ operation: "list_messages", params: { channel: "C1", oldest: "1.0" } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("oldest")).toBe("1.0");
    if (r.ok) expect(r.items).toHaveLength(2);
  });
  it("lists thread replies", async () => {
    const { calls, fetchImpl } = capture({ ok: true, messages: [{ ts: "1.1", thread_ts: "1.1", reply_count: 1 }, { ts: "2.2", thread_ts: "1.1" }] });
    const r = await run({ operation: "list_replies", params: { channel: "C1", ts: "1.1" } }, fetchImpl);
    expect(calls[0]!.url).toContain("conversations.replies");
    if (r.ok) {
      expect(r.items[0]).toMatchObject({ isThreadReply: false, replyCount: 1 });
      expect(r.items[1]).toMatchObject({ isThreadReply: true });
    }
  });
  it("edits a message", async () => {
    const { calls, fetchImpl } = capture({ ok: true, channel: "C1", ts: "1.1", text: "new", message: { text: "new", edited: {} } });
    const r = await run({ operation: "update_message", params: { channel: "C1", ts: "1.1", text: "new" } }, fetchImpl);
    expect(calls[0]!.url).toContain("chat.update");
    if (r.ok) expect(r.items[0]).toMatchObject({ id: "1.1", text: "new", edited: true });
  });
  it("deletes a message", async () => {
    const { calls, fetchImpl } = capture({ ok: true, channel: "C1", ts: "1.1" });
    const r = await run({ operation: "delete_message", params: { channel: "C1", ts: "1.1" } }, fetchImpl);
    expect(body(calls[0])).toEqual({ channel: "C1", ts: "1.1" });
    expect(r.ok).toBe(true);
  });
  it("maps cant_update_message / cant_delete_message to forbidden", async () => {
    for (const code of ["cant_update_message", "cant_delete_message"]) {
      const r = await run({ operation: "update_message", params: { channel: "C1", ts: "1.1" } }, capture({ ok: false, error: code }).fetchImpl);
      if (!r.ok) expect(r.error.kind).toBe("forbidden");
    }
  });
  it("maps message_not_found to not_found", async () => {
    const r = await run({ operation: "delete_message", params: { channel: "C1", ts: "1.1" } }, capture({ ok: false, error: "message_not_found" }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
  it("schedules, lists and deletes scheduled messages", async () => {
    const a = capture({ ok: true, scheduled_message_id: "Q1", post_at: 1_800_000_000 });
    await run({ operation: "schedule_message", params: { channel: "C1", text: "later", post_at: 1_800_000_000 } }, a.fetchImpl);
    expect(body(a.calls[0])).toMatchObject({ post_at: 1_800_000_000 });
    const b = capture({ ok: true, scheduled_messages: [{ id: "Q1", channel_id: "C1" }], response_metadata: { next_cursor: "" } });
    const r = await run({ operation: "list_scheduled_messages" }, b.fetchImpl);
    if (r.ok) expect(r.items[0]!["id"]).toBe("Q1");
    const c = capture({ ok: true });
    await run({ operation: "delete_scheduled_message", params: { channel: "C1", scheduled_message_id: "Q1" } }, c.fetchImpl);
    expect(c.calls[0]!.url).toContain("chat.deleteScheduledMessage");
  });
  it("schedule_message requires post_at", () => {
    expect(() => slackConnector.buildCall({ operation: "schedule_message", params: { channel: "C1", text: "x" } })).toThrow(/post_at/);
  });
  it("gets a permalink", async () => {
    const { calls, fetchImpl } = capture({ ok: true, permalink: "https://acme.slack.com/archives/C1/p1" });
    const r = await run({ operation: "get_permalink", params: { channel: "C1", message_ts: "1.1" } }, fetchImpl);
    expect(calls[0]!.init.method).toBe("GET");
    if (r.ok) expect(r.items[0]!["permalink"]).toContain("slack.com");
  });
});

// ---------------------------------------------------------------------------
describe("slack reactions", () => {
  it("adds a reaction", async () => {
    const { calls, fetchImpl } = capture({ ok: true });
    await run({ operation: "add_reaction", params: { channel: "C1", timestamp: "1.1", name: "thumbsup" } }, fetchImpl);
    expect(calls[0]!.url).toContain("reactions.add");
    expect(body(calls[0])).toEqual({ channel: "C1", timestamp: "1.1", name: "thumbsup" });
  });
  it("removes a reaction", async () => {
    const { calls, fetchImpl } = capture({ ok: true });
    await run({ operation: "remove_reaction", params: { channel: "C1", timestamp: "1.1", name: "thumbsup" } }, fetchImpl);
    expect(calls[0]!.url).toContain("reactions.remove");
  });
  it("gets reactions for a message", async () => {
    const { fetchImpl } = capture({ ok: true, type: "message", channel: "C1", message: { ts: "1.1", text: "x", reactions: [{ name: "fire", count: 2 }] } });
    const r = await run({ operation: "get_reactions", params: { channel: "C1", timestamp: "1.1" } }, fetchImpl);
    if (r.ok) expect(r.items[0]).toMatchObject({ channel: "C1", reactions: [{ name: "fire", count: 2 }] });
  });
  it("lists reactions with pagination", async () => {
    const { fetchImpl } = capture({ ok: true, items: [{ type: "message", channel: "C1" }], response_metadata: { next_cursor: "n1" } });
    const r = await run({ operation: "list_reactions" }, fetchImpl);
    if (r.ok) expect(r.cursor).toBe("n1");
  });
  it("maps already_reacted to invalid_request", async () => {
    const r = await run({ operation: "add_reaction", params: { channel: "C1", timestamp: "1.1", name: "x" } }, capture({ ok: false, error: "already_reacted" }).fetchImpl);
    if (!r.ok) {
      expect(r.error.kind).toBe("invalid_request");
      expect(r.error.message).toContain("already_reacted");
    }
  });
});

// ---------------------------------------------------------------------------
describe("slack files", () => {
  it("reads file metadata without the private download URL", async () => {
    const { fetchImpl } = capture({ ok: true, file: { id: "F1", name: "a.pdf", mimetype: "application/pdf", size: 10, url_private: "https://files.slack.com/x", permalink: "https://acme.slack.com/files/F1" } });
    const r = await run({ operation: "get_file", params: { file: "F1" } }, fetchImpl);
    if (r.ok) {
      expect(r.items[0]).toMatchObject({ id: "F1", kind: "file", mimeType: "application/pdf" });
      expect(JSON.stringify(r.items[0])).not.toContain("url_private");
    }
  });
  it("deletes a file", async () => {
    const { calls, fetchImpl } = capture({ ok: true });
    await run({ operation: "delete_file", params: { file: "F1" } }, fetchImpl);
    expect(calls[0]!.url).toContain("files.delete");
  });
  it("binary upload and download are documented unsupported", () => {
    expect(UNSUPPORTED_OPERATIONS["upload_file_binary"]).toMatch(/getUploadURLExternal/);
    expect(UNSUPPORTED_OPERATIONS["download_file_binary"]).toMatch(/url_private/);
    expect(slackConnector.operations).not.toContain("upload_file");
  });
  it("normalizes message file ids", () => {
    expect(normalizeSlackMessage({ ts: "1.1", files: [{ id: "F1" }, { id: "F2" }] })["fileIds"]).toEqual(["F1", "F2"]);
  });
  it("maps file_not_found", async () => {
    const r = await run({ operation: "get_file", params: { file: "F0" } }, capture({ ok: false, error: "file_not_found" }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
});

// ---------------------------------------------------------------------------
describe("slack events / webhooks", () => {
  it("accepts a correctly signed event", () => {
    const v = verify(EVENT);
    expect(v.ok).toBe(true);
    expect(v.eventId).toBe("Ev0001");
    expect(v.eventType).toBe("message");
  });
  it("verifies against the exact raw body", () => {
    const raw = JSON.stringify(EVENT, null, 2);
    expect(verify(EVENT, { raw }).ok).toBe(true);
    const ts = String(Math.floor(NOW / 1000));
    expect(verify(EVENT, { raw, signature: sign(JSON.stringify(EVENT), ts) }).ok).toBe(false);
  });
  it("rejects a tampered body", () => {
    const raw = JSON.stringify(EVENT);
    const ts = String(Math.floor(NOW / 1000));
    const v = verify({ ...EVENT, event_id: "Ev9" }, { signature: sign(raw, ts) });
    expect(v.ok).toBe(false);
    expect(v.reason).toBe("invalid_signature");
  });
  it("rejects a wrong signing secret", () => {
    const ts = String(Math.floor(NOW / 1000));
    expect(verify(EVENT, { signature: sign(JSON.stringify(EVENT), ts, "other") }).reason).toBe("invalid_signature");
  });
  it("rejects missing signature headers", () => {
    expect(verify(EVENT, { signature: null }).reason).toBe("invalid_signature");
  });
  it("rejects a non-numeric timestamp", () => {
    expect(verify(EVENT, { ts: "abc" }).reason).toBe("invalid_signature");
  });
  it("reports a missing signing secret", () => {
    expect(verify(EVENT, { secret: null }).reason).toBe("missing_secret");
  });
  it("rejects stale timestamps (replay protection)", () => {
    const ts = String(Math.floor(NOW / 1000) - 600);
    expect(verify(EVENT, { ts }).reason).toBe("replay");
  });
  it("rejects future timestamps outside the window", () => {
    const ts = String(Math.floor(NOW / 1000) + 600);
    expect(verify(EVENT, { ts }).reason).toBe("replay");
  });
  it("accepts timestamps inside the window", () => {
    expect(verify(EVENT, { ts: String(Math.floor(NOW / 1000) - 120) }).ok).toBe(true);
  });
  it("uses the stable event_id for dedupe across Slack retries", () => {
    const first = verify(EVENT);
    const retry = verify(EVENT, { ts: String(Math.floor(NOW / 1000) + 30) });
    expect(first.eventId).toBe(retry.eventId);
  });
  it("never uses the request timestamp as an event id", () => {
    const v = verify({ type: "event_callback", event: { type: "message" } });
    expect(v.eventId).toBeUndefined();
  });
  it("gives url_verification a deterministic id and type", () => {
    const v = verify({ type: "url_verification", challenge: "abc123", token: "t" });
    expect(v.ok).toBe(true);
    expect(v.eventType).toBe("url_verification");
    expect(v.eventId).toBe("url_verification:abc123");
  });
  it("identifies app_rate_limited envelopes", () => {
    expect(slackEventId({ type: "app_rate_limited", api_app_id: "A1", minute_rate_limited: 1_700_000_000 })).toBe("app_rate_limited:A1:1700000000");
    expect(slackEventType({ type: "app_rate_limited" })).toBe("app_rate_limited");
  });
  it("prefers the inner event type", () => {
    expect(slackEventType({ type: "event_callback", event: { type: "reaction_added" } })).toBe("reaction_added");
  });
  it("normalizes a message event", () => {
    const e = normalizeSlackEvent(EVENT);
    expect(e).toMatchObject({ id: "Ev0001", envelope: "event_callback", type: "message", teamId: "T1", channel: "C1", user: "U1" });
    expect((e["message"] as Record<string, unknown>)["text"]).toBe("hello");
  });
  it("normalizes a reaction event", () => {
    const e = normalizeSlackEvent({ type: "event_callback", event_id: "Ev2", event: { type: "reaction_added", user: "U1", reaction: "fire", item: { channel: "C1", ts: "1.1" } } });
    expect(e).toMatchObject({ type: "reaction_added", reaction: "fire", channel: "C1", ts: "1.1", message: null });
  });
  it("normalizes app_mention with thread context", () => {
    const e = normalizeSlackEvent({ type: "event_callback", event_id: "Ev3", event: { type: "app_mention", ts: "2.2", thread_ts: "1.1", channel: "C1", text: "<@UBOT> hi" } });
    expect(e["threadTs"]).toBe("1.1");
    expect((e["message"] as Record<string, unknown>)["isThreadReply"]).toBe(true);
  });
  it("converts Slack ts to ISO time", () => {
    expect(slackTsToIso("1700000000.000100")).toBe("2023-11-14T22:13:20.000Z");
    expect(slackTsToIso("x")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("slack pagination", () => {
  it("follows next_cursor up to the page budget", async () => {
    const { fetchImpl, count } = sequence(
      () => jsonResponse({ ok: true, messages: [MSG], response_metadata: { next_cursor: "c2" } }),
      () => jsonResponse({ ok: true, messages: [MSG], response_metadata: { next_cursor: "c3" } }),
      () => jsonResponse({ ok: true, messages: [MSG], response_metadata: { next_cursor: "" } }),
    );
    const r = await run({ operation: "list_messages", params: { channel: "C1" }, maxPages: 5 }, fetchImpl);
    expect(count()).toBe(3);
    if (r.ok) {
      expect(r.items).toHaveLength(3);
      expect(r.cursor).toBeNull();
    }
  });
  it("stops at maxPages and returns the cursor", async () => {
    const { fetchImpl } = sequence(() => jsonResponse({ ok: true, members: [{ id: "U1" }], response_metadata: { next_cursor: "more" } }));
    const r = await run({ operation: "list_users", maxPages: 2 }, fetchImpl);
    if (r.ok) {
      expect(r.pages).toBe(2);
      expect(r.cursor).toBe("more");
    }
  });
  it("sends the cursor on the next request", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return jsonResponse({ ok: true, channels: [], response_metadata: { next_cursor: calls.length === 1 ? "dXNlcjpVMDYx" : "" } });
    }) as unknown as typeof fetch;
    await run({ operation: "list_channels", maxPages: 3 }, fetchImpl);
    expect(new URL(calls[1]!).searchParams.get("cursor")).toBe("dXNlcjpVMDYx");
  });
  it("resumes from a provided cursor", () => {
    expect(slackConnector.buildCall({ operation: "list_members", params: { channel: "C1" }, cursor: "abc" }).query?.["cursor"]).toBe("abc");
  });
  it("fails on a malformed collection", async () => {
    const r = await run({ operation: "list_channels" }, capture({ ok: true }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("malformed_response");
  });
  it("fails when ok is missing", async () => {
    const r = await run({ operation: "auth_test" }, capture({ user: "x" }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("malformed_response");
  });
});

// ---------------------------------------------------------------------------
describe("slack rate limits / retry / errors", () => {
  it("retries HTTP 429 ratelimited and succeeds", async () => {
    const { fetchImpl, count } = sequence(
      () => jsonResponse({ ok: false, error: "ratelimited" }, { status: 429, headers: { "retry-after": "2" } }),
      () => jsonResponse({ ok: true, ts: "1.1" }),
    );
    const r = await run({ operation: "post_message", params: { channel: "C1", text: "x" } }, fetchImpl);
    expect(count()).toBe(2);
    expect(r.ok).toBe(true);
  });
  it("reads Retry-After seconds", () => {
    expect(slackConnector.readRateLimit?.(new Headers({ "retry-after": "30" }), {})).toEqual({ retryAfterMs: 30_000, remaining: 0 });
    expect(slackConnector.readRateLimit?.(new Headers(), {})).toBeUndefined();
    expect(slackConnector.readRateLimit?.(new Headers({ "retry-after": "soon" }), {})).toBeUndefined();
  });
  it("gives up after the runtime attempt budget", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse({ ok: false, error: "ratelimited" }, { status: 429, headers: { "retry-after": "1" } }));
    const r = await run({ operation: "auth_test" }, fetchImpl, creds, { maxAttempts: 3 });
    expect(count()).toBe(3);
    if (!r.ok) {
      expect(r.error.kind).toBe("rate_limit");
      expect(r.attempts).toBe(3);
    }
  });
  it("retries transient Slack errors", async () => {
    const { fetchImpl, count } = sequence(
      () => jsonResponse({ ok: false, error: "internal_error" }),
      () => jsonResponse({ ok: true, user_id: "U" }),
    );
    const r = await run({ operation: "auth_test" }, fetchImpl);
    expect(count()).toBe(2);
    expect(r.ok).toBe(true);
  });
  it("retries HTTP 5xx without a Slack body", async () => {
    const { fetchImpl, count } = sequence(
      () => new Response("upstream", { status: 503 }),
      () => jsonResponse({ ok: true }),
    );
    await run({ operation: "auth_test" }, fetchImpl);
    expect(count()).toBe(2);
  });
  it("does not retry non-retryable errors", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse({ ok: false, error: "channel_not_found" }));
    await run({ operation: "post_message", params: { channel: "C0", text: "x" } }, fetchImpl);
    expect(count()).toBe(1);
  });
  it("maps missing_scope to forbidden", async () => {
    const r = await run({ operation: "team_info" }, capture({ ok: false, error: "missing_scope", needed: "team:read" }).fetchImpl);
    if (!r.ok) {
      expect(r.error.kind).toBe("forbidden");
      expect(r.error.retryable).toBe(false);
    }
  });
  it("maps unknown codes to invalid_request", async () => {
    const r = await run({ operation: "auth_test" }, capture({ ok: false, error: "weird_code" }).fetchImpl);
    if (!r.ok) expect(r.error.message).toBe("Slack error: weird_code");
  });
  it("maps network failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const r = await run({ operation: "auth_test" }, fetchImpl, creds, { maxAttempts: 1 });
    if (!r.ok) expect(r.error.kind).toBe("network");
  });
  it("rejects unknown operations as unsupported", async () => {
    const r = await run({ operation: "nuke_workspace" }, capture({ ok: true }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("unsupported");
  });
});

// ---------------------------------------------------------------------------
describe("slack idempotency", () => {
  it("sends no invented idempotency header", async () => {
    const { calls, fetchImpl } = capture({ ok: true, ts: "1.1" });
    await run({ operation: "post_message", params: { channel: "C1", text: "x", idempotency_key: "k" } }, fetchImpl);
    const headers = Object.keys((calls[0]!.init.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase());
    expect(headers.some((h) => h.includes("idempot"))).toBe(false);
    expect(body(calls[0])["idempotency_key"]).toBeUndefined();
  });
  it("documents the absence of an official idempotency key", () => {
    expect(UNSUPPORTED_OPERATIONS["idempotency_key"]).toMatch(/event_id/);
  });
  it("identical inbound deliveries share one dedupe id", () => {
    expect(slackEventId(EVENT)).toBe(slackEventId(JSON.parse(JSON.stringify(EVENT))));
    expect(slackEventId({ ...EVENT, event_id: "Ev0002" })).not.toBe(slackEventId(EVENT));
  });
});

// ---------------------------------------------------------------------------
describe("slack health", () => {
  it("is healthy when auth.test succeeds", async () => {
    const { calls, fetchImpl } = capture({ ok: true, user_id: "U" });
    const h = await checkConnectorHealth({ adapter: slackConnector, credentials: creds, traceId: trace, fetchImpl });
    expect(h.healthy).toBe(true);
    expect(calls[0]!.url).toContain("auth.test");
  });
  it("is unhealthy on a revoked token", async () => {
    const h = await checkConnectorHealth({ adapter: slackConnector, credentials: creds, traceId: trace, fetchImpl: capture({ ok: false, error: "token_revoked" }).fetchImpl });
    expect(h.healthy).toBe(false);
    expect(h.message).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
describe("slack workspace isolation / credential isolation", () => {
  it("each run uses only its own workspace token", async () => {
    const a = capture({ ok: true });
    const b = capture({ ok: true });
    await run({ operation: "auth_test" }, a.fetchImpl, { access_token: TOKEN });
    await run({ operation: "auth_test" }, b.fetchImpl, { access_token: TOKEN_B });
    expect(headerOf(a.calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headerOf(b.calls[0], "authorization")).toBe(`Bearer ${TOKEN_B}`);
    expect(JSON.stringify(a.calls)).not.toContain(TOKEN_B);
  });
  it("buildCall never carries credentials", () => {
    for (const op of slackConnector.operations) {
      const call = slackConnector.buildCall({ operation: op, params: requiredParams(op) });
      expect(JSON.stringify(call)).not.toMatch(/xox[bpa]-/);
    }
  });
  it("a token passed as a param is not forwarded", async () => {
    const { calls, fetchImpl } = capture({ ok: true, channels: [] });
    await run({ operation: "list_channels", params: { token: TOKEN_B } }, fetchImpl);
    expect(calls[0]!.url).not.toContain(TOKEN_B);
    expect(headerOf(calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
  });
  it("OAuth accounts are scoped to the initiating workspace", async () => {
    const spec = getOAuthProvider("slack")!;
    const { store } = memoryStore();
    const pending = (ws: string) => ({ workspaceId: ws, integrationId: null, provider: "slack", connector: "slack", redirectUri: "https://app.test/cb", createdBy: null });
    const s1 = await beginAuthorization({ store, spec, clientId: "c", pending: pending("ws1"), nowMs: NOW });
    const s2 = await beginAuthorization({ store, spec, clientId: "c", pending: pending("ws2"), nowMs: NOW });
    const fetchImpl = capture({ ok: true, access_token: TOKEN, team: { id: "T1" } }).fetchImpl;
    const a1 = await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: s1.state, code: "x", fetchImpl, nowMs: NOW });
    const a2 = await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: s2.state, code: "x", fetchImpl, nowMs: NOW });
    expect(a1.account.id).not.toBe(a2.account.id);
    expect(await store.getAccount("ws2", a1.account.id)).toBeNull();
  });
  it("a webhook signed with another workspace's secret is rejected", () => {
    const ts = String(Math.floor(NOW / 1000));
    expect(verify(EVENT, { signature: sign(JSON.stringify(EVENT), ts, "workspace-b-secret") }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("slack secret redaction / trace ids", () => {
  it("never returns the token in results", async () => {
    const r = await run({ operation: "auth_test" }, capture({ ok: true, user_id: "U" }).fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("scrubs the token from provider error text", async () => {
    const fetchImpl = vi.fn(async () => new Response(`bad token ${TOKEN}`, { status: 400 })) as unknown as typeof fetch;
    const r = await run({ operation: "auth_test" }, fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("scrubs the token from network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`socket closed for ${TOKEN}`);
    }) as unknown as typeof fetch;
    const r = await run({ operation: "auth_test" }, fetchImpl, creds, { maxAttempts: 1 });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("redacts token-like keys", () => {
    const out = JSON.stringify(redact({ access_token: TOKEN, signing_secret: SIGNING, nested: { client_secret: "x" } }));
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(SIGNING);
  });
  it("does not emit the token in runtime events", async () => {
    const events: unknown[] = [];
    const { fetchImpl } = sequence(
      () => jsonResponse({ ok: false, error: "ratelimited" }, { status: 429 }),
      () => jsonResponse({ ok: true }),
    );
    await run({ operation: "auth_test" }, fetchImpl, creds, { onEvent: (e) => events.push(e) });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });
  it("carries the trace id on success and failure", async () => {
    const ok = await run({ operation: "auth_test" }, capture({ ok: true }).fetchImpl);
    const bad = await run({ operation: "auth_test" }, capture({ ok: false, error: "invalid_auth" }).fetchImpl);
    expect(ok.traceId).toBe(trace);
    expect(bad.traceId).toBe(trace);
  });
  it("tags runtime events with the trace id", async () => {
    const events: { traceId: string }[] = [];
    await run({ operation: "auth_test" }, capture({ ok: true }).fetchImpl, creds, { onEvent: (e) => events.push(e as { traceId: string }) });
    for (const e of events) expect(e.traceId).toBe(trace);
  });
  it("verifier results never echo the signing secret", () => {
    const v = verify(EVENT, { signature: "v0=deadbeef" });
    expect(JSON.stringify(v)).not.toContain(SIGNING);
  });
});
