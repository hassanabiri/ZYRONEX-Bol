import { describe, expect, it, vi } from "vitest";

import { GMAIL_API_BASE, GMAIL_OPERATIONS, GMAIL_SCOPES, UNSUPPORTED_OPERATIONS, gmailConnector, gmailScopeFor } from "@/lib/connectors/adapters/gmail";
import {
  GMAIL_MAX_RAW_BYTES,
  buildMimeMessage,
  encodeHeader,
  fromBase64Url,
  normalizeGmailHistory,
  normalizeGmailMessage,
  parseGmailPush,
  toBase64Url,
} from "@/lib/connectors/adapters/gmail-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { assertCanExecute } from "@/lib/execution/guard.server";
import { beginAuthorization, completeAuthorization, ensureAccessToken, hashState } from "@/lib/oauth/core";
import { getOAuthProvider } from "@/lib/oauth/providers";
import type { ConnectionAccount, OAuthStore, OAuthTokenSet, PendingAuthorization } from "@/lib/oauth/types";
import { verifyWebhook } from "@/lib/webhooks/verify";

const trace = "trace-gmail";
const TOKEN = "ya29.a0GmailAccessTokenAAAA1111";
const TOKEN_B = "ya29.a0GmailAccessTokenBBBB2222";
const REFRESH = "1//0gRefreshTokenGmailXYZ";
const AUDIENCE = "zyronex-gmail-push-audience-7f3e";
const creds = { access_token: TOKEN };
const NOW = 1_700_000_100_000;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body === null ? "" : JSON.stringify(body), {
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
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    return responses[Math.min(i++, responses.length - 1)]!();
  }) as unknown as typeof fetch;
  return { fetchImpl, count: () => i, calls };
}
function run(
  input: Parameters<typeof runConnectorOperation>[0]["input"],
  fetchImpl: typeof fetch,
  credentials: Record<string, string> = creds,
  extra: Partial<Parameters<typeof runConnectorOperation>[0]> = {},
) {
  return runConnectorOperation({ adapter: gmailConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {}, ...extra });
}
const body = (call: { init: RequestInit } | undefined) => JSON.parse(String(call?.init.body ?? "{}")) as Record<string, unknown>;
const headerOf = (call: { init: RequestInit } | undefined, name: string) =>
  (call?.init.headers as Record<string, string> | undefined)?.[name];
const rawOf = (call: { init: RequestInit } | undefined) => fromBase64Url(String(body(call)["raw"]));
const gErr = (code: number, message: string, reason?: string, status?: string) => ({
  error: { code, message, ...(status ? { status } : {}), ...(reason ? { errors: [{ reason, message }] } : {}) },
});

const MESSAGE = {
  id: "18c1",
  threadId: "t18c1",
  labelIds: ["INBOX", "UNREAD"],
  snippet: "hello there",
  historyId: "9001",
  internalDate: "1700000000000",
  sizeEstimate: 1234,
  payload: {
    mimeType: "multipart/mixed",
    headers: [
      { name: "From", value: "Ali <ali@example.com>" },
      { name: "To", value: "me@example.com" },
      { name: "Subject", value: "Quote" },
      { name: "Message-ID", value: "<abc@mail.example.com>" },
      { name: "References", value: "<root@mail.example.com>" },
    ],
    parts: [
      {
        mimeType: "multipart/alternative",
        parts: [
          { partId: "0.0", mimeType: "text/plain", body: { data: toBase64Url("plain body") } },
          { partId: "0.1", mimeType: "text/html", body: { data: toBase64Url("<p>html body</p>") } },
        ],
      },
      { partId: "1", mimeType: "application/pdf", filename: "q.pdf", body: { attachmentId: "ATT1", size: 2048 } },
    ],
  },
};

function requiredParams(op: string): Record<string, unknown> {
  return {
    message_id: "m1", thread_id: "t1", label_id: "L1", draft_id: "d1", attachment_id: "a1", to: "x@example.com",
    in_reply_to: "<a@b>", original_raw: toBase64Url("Subject: hi\r\n\r\nbody"), query: "from:x", name: "N", ids: ["m1"],
    start_history_id: "1", topic_name: "projects/p/topics/t", add_label_ids: ["STARRED"], text: "t",
    ...(op ? {} : {}),
  };
}

function jwt(claims: Record<string, unknown>) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "RS256", typ: "JWT" })}.${b(claims)}.sig`;
}
function pushEnvelope(overrides: { messageId?: string; publishTime?: string; data?: unknown } = {}) {
  return {
    message: {
      data: Buffer.from(JSON.stringify(overrides.data ?? { emailAddress: "me@example.com", historyId: 9001 })).toString("base64"),
      messageId: overrides.messageId ?? "2070443601311540",
      publishTime: overrides.publishTime ?? new Date(NOW - 5_000).toISOString(),
    },
    subscription: "projects/p/subscriptions/gmail-push",
  };
}
function verifyPush(
  payload: unknown,
  opts: { claims?: Record<string, unknown>; auth?: string | null; secret?: string | null; nowMs?: number } = {},
) {
  const claims = opts.claims ?? { aud: AUDIENCE, iss: "https://accounts.google.com", exp: Math.floor(NOW / 1000) + 600, email: "push@p.iam.gserviceaccount.com" };
  const headers: Record<string, string> = {};
  if (opts.auth !== null) headers["authorization"] = opts.auth ?? `Bearer ${jwt(claims)}`;
  return verifyWebhook("google_mail", {
    raw: JSON.stringify(payload),
    headers,
    payload,
    secret: opts.secret === undefined ? AUDIENCE : opts.secret,
    nowMs: opts.nowMs ?? NOW,
    replayWindowMs: 300_000,
  });
}

function memoryStore() {
  const states = new Map<string, PendingAuthorization & { stateHash: string; expiresAt: string; used?: boolean }>();
  const accounts = new Map<string, ConnectionAccount>();
  const tokens = new Map<string, OAuthTokenSet>();
  let seq = 0;
  const store = {
    saveState: async (s: PendingAuthorization & { stateHash: string; expiresAt: string }) => void states.set(s.stateHash, { ...s }),
    consumeState: async (hash: string, nowMs: number) => {
      const row = states.get(hash);
      if (!row || row.used || new Date(row.expiresAt).getTime() <= nowMs) return null;
      row.used = true;
      return row;
    },
    upsertAccount: async (input: Omit<ConnectionAccount, "id" | "refreshFailures"> & { tokens: OAuthTokenSet }) => {
      const existing = [...accounts.values()].find(
        (a) => a.workspaceId === input.workspaceId && a.provider === input.provider && a.accountIdentifier === input.accountIdentifier,
      );
      const { tokens: t, ...rest } = input;
      const account: ConnectionAccount = { ...rest, id: existing?.id ?? `acc-${++seq}`, refreshFailures: 0 } as ConnectionAccount;
      accounts.set(account.id, account);
      tokens.set(account.id, t);
      return account;
    },
    getAccount: async (ws: string, id: string) => {
      const a = accounts.get(id);
      return a && a.workspaceId === ws ? a : null;
    },
    readTokens: async (id: string) => tokens.get(id) ?? null,
    writeTokens: async (id: string, t: OAuthTokenSet) => void tokens.set(id, t),
    updateAccount: async (id: string, patch: Partial<ConnectionAccount>) => void accounts.set(id, { ...accounts.get(id)!, ...patch }),
    acquireRefreshLock: async () => true,
    releaseRefreshLock: async () => {},
  } as unknown as OAuthStore;
  return { store, accounts, tokens, states };
}
const pending = (ws = "ws1") => ({
  workspaceId: ws, integrationId: null, provider: "google_mail", connector: "google_mail", redirectUri: "https://app.test/cb", createdBy: null,
});
async function connect(ws = "ws1", tokenBody: Record<string, unknown> = {}) {
  const spec = getOAuthProvider("google_mail")!;
  const mem = memoryStore();
  const { state } = await beginAuthorization({ store: mem.store, spec, clientId: "cid", pending: pending(ws), nowMs: NOW });
  const { fetchImpl } = capture({
    access_token: TOKEN, refresh_token: REFRESH, expires_in: 3599, token_type: "Bearer",
    scope: `openid email ${GMAIL_SCOPES.modify}`, email: "me@example.com", ...tokenBody,
  });
  const { account } = await completeAuthorization({ store: mem.store, spec, client: { clientId: "cid", clientSecret: "shh" }, state, code: "c1", fetchImpl, nowMs: NOW });
  return { ...mem, spec, account, state };
}

// ---------------------------------------------------------------------------
describe("gmail registration", () => {
  it("is registered under google_mail", () => {
    expect(getConnector("google_mail")?.id).toBe("google_mail");
    const d = describeConnectors().find((c) => c.id === "google_mail");
    expect(d?.authKind).toBe("oauth2");
    expect(d?.requiredCredentials).toEqual(["access_token"]);
  });
  it("leaves the existing google adapter and gmail alias untouched", () => {
    expect(getConnector("google")?.id).toBe("google");
    expect(getConnector("gmail")?.id).toBe("google");
    expect(getOAuthProvider("gmail")?.connector).toBe("google");
  });
  it("declares capabilities and a health operation", () => {
    expect(gmailConnector.capabilities).toEqual(expect.arrayContaining(["messaging", "search", "pagination", "webhook", "health_check"]));
    expect(gmailConnector.healthOperation).toBe("get_profile");
  });
  it("exposes the full official surface", () => {
    for (const op of [
      "get_profile", "list_messages", "search_messages", "get_message", "send_message", "reply_message", "forward_message",
      "modify_message", "trash_message", "untrash_message", "delete_message", "batch_modify_messages", "batch_delete_messages",
      "get_attachment", "list_threads", "get_thread", "modify_thread", "trash_thread", "untrash_thread", "delete_thread",
      "list_labels", "get_label", "create_label", "update_label", "delete_label", "list_drafts", "get_draft", "create_draft",
      "update_draft", "delete_draft", "send_draft", "list_history", "watch_mailbox", "stop_watch",
    ])
      expect(GMAIL_OPERATIONS).toContain(op);
  });
  it("targets the official Gmail v1 host only", () => {
    for (const op of GMAIL_OPERATIONS) expect(gmailConnector.buildCall({ operation: op, params: requiredParams(op) }).url.startsWith(GMAIL_API_BASE)).toBe(true);
  });
  it("rejects unknown operations", () => {
    expect(() => gmailConnector.buildCall({ operation: "nope" })).toThrow(/Unknown Gmail operation/);
  });
});

// ---------------------------------------------------------------------------
describe("gmail OAuth / authorization / state", () => {
  const spec = getOAuthProvider("google_mail")!;
  it("uses Google's official OAuth endpoints with PKCE", () => {
    expect(spec.authorizationUrl).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(spec.tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(spec.revokeUrl).toBe("https://oauth2.googleapis.com/revoke");
    expect(spec.usePkce).toBe(true);
  });
  it("requests offline access so a refresh token is issued", async () => {
    const { store } = memoryStore();
    const { authorizationUrl } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    const url = new URL(authorizationUrl);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")?.length).toBeGreaterThan(20);
  });
  it("defaults to least-privilege scopes (no full mailbox scope)", () => {
    expect(spec.scopes).toContain(GMAIL_SCOPES.modify);
    expect(spec.scopes).not.toContain(GMAIL_SCOPES.full);
  });
  it("can request the full scope explicitly per connection", async () => {
    const { store } = memoryStore();
    const { authorizationUrl } = await beginAuthorization({
      store, spec, clientId: "cid", pending: { ...pending(), scopes: [...spec.scopes, GMAIL_SCOPES.full] }, nowMs: NOW,
    });
    expect(new URL(authorizationUrl).searchParams.get("scope")).toContain("https://mail.google.com/");
  });
  it("stores only the hashed state", async () => {
    const { store, states } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    expect(states.has(hashState(state))).toBe(true);
    expect(states.has(state)).toBe(false);
  });
  it("exchanges the code and creates a connection account per mailbox", async () => {
    const { account, tokens } = await connect();
    expect(account.accountIdentifier).toBe("me@example.com");
    expect(account.workspaceId).toBe("ws1");
    expect(account.scopes).toContain(GMAIL_SCOPES.modify);
    expect(tokens.get(account.id)?.accessToken).toBe(TOKEN);
    expect(tokens.get(account.id)?.refreshToken).toBe(REFRESH);
    expect(account.expiresAt).not.toBeNull();
  });
  it("never exposes tokens on the account projection", async () => {
    const { account } = await connect();
    expect(JSON.stringify(account)).not.toContain(TOKEN);
    expect(JSON.stringify(account)).not.toContain(REFRESH);
  });
  it("identifies the account from the id_token when email is absent", () => {
    const idToken = jwt({ email: "idt@example.com", sub: "123" });
    expect(spec.identify?.({ id_token: idToken })).toEqual({ accountIdentifier: "idt@example.com", accountLabel: "idt@example.com" });
  });
  it("falls back to the subject id", () => {
    expect(spec.identify?.({ id_token: jwt({ sub: "999" }) })).toEqual({ accountIdentifier: "999", accountLabel: "999" });
  });
  it("rejects a replayed state", async () => {
    const { store, spec: s, state } = await connect();
    const { fetchImpl } = capture({ access_token: TOKEN, email: "me@example.com" });
    await expect(completeAuthorization({ store, spec: s, client: { clientId: "c", clientSecret: "s" }, state, code: "c", fetchImpl, nowMs: NOW })).rejects.toThrow();
  });
  it("rejects an unknown state", async () => {
    const { store } = memoryStore();
    const { fetchImpl } = capture({ access_token: TOKEN });
    await expect(completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: "forged", code: "c", fetchImpl, nowMs: NOW })).rejects.toThrow();
  });
  it("rejects an expired state", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    const { fetchImpl } = capture({ access_token: TOKEN });
    await expect(
      completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "c", fetchImpl, nowMs: NOW + 24 * 3600_000 }),
    ).rejects.toThrow();
  });
  it("fails token exchange without leaking the client secret", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    const { fetchImpl } = capture({ error: "invalid_grant" }, { status: 400 });
    const err = await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "super-secret-value" }, state, code: "bad", fetchImpl, nowMs: NOW }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain("super-secret-value");
  });
});

// ---------------------------------------------------------------------------
describe("gmail token refresh", () => {
  it("returns the stored token while it is fresh", async () => {
    const { store, spec, account } = await connect();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW });
    expect(r.token).toBe(TOKEN);
    expect(r.refreshed).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refreshes an expired token with the refresh token", async () => {
    const { store, spec, account, tokens } = await connect();
    const { calls, fetchImpl } = capture({ access_token: TOKEN_B, expires_in: 3599, token_type: "Bearer" });
    const r = await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW + 2 * 3600_000 });
    expect(r.refreshed).toBe(true);
    expect(r.token).toBe(TOKEN_B);
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(String(calls[0]!.init.body)).toContain("grant_type=refresh_token");
    // Google omits refresh_token on refresh; the original one must be kept.
    expect(tokens.get(account.id)?.refreshToken).toBe(REFRESH);
  });
  it("marks the connection when the refresh token is revoked", async () => {
    const { store, spec, account, accounts } = await connect();
    const { fetchImpl } = capture({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });
    await expect(
      ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW + 2 * 3600_000 }),
    ).rejects.toThrow();
    expect(accounts.get(account.id)?.status).not.toBe("connected");
  });
});

// ---------------------------------------------------------------------------
describe("gmail identity / profile", () => {
  it("reads the profile", async () => {
    const { calls, fetchImpl } = capture({ emailAddress: "me@example.com", messagesTotal: 10, threadsTotal: 5, historyId: "77" });
    const r = await run({ operation: "get_profile" }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GMAIL_API_BASE}/profile`);
    expect(r.ok && r.items[0]).toMatchObject({ email_address: "me@example.com", history_id: "77", messages_total: 10 });
  });
  it("injects the bearer token only at authorize time", async () => {
    const { calls, fetchImpl } = capture({ emailAddress: "me@example.com" });
    await run({ operation: "get_profile" }, fetchImpl);
    expect(headerOf(calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(gmailConnector.buildCall({ operation: "get_profile" }).headers["authorization"]).toBeUndefined();
  });
  it("fails fast without credentials", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await run({ operation: "get_profile" }, fetchImpl, {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("rejects a blank token", () => {
    expect(() => gmailConnector.authorize(gmailConnector.buildCall({ operation: "get_profile" }), { access_token: " " })).toThrow(/not connected/);
  });
});

// ---------------------------------------------------------------------------
describe("gmail messages: get/list", () => {
  it("lists messages with maxResults", async () => {
    const { calls, fetchImpl } = capture({ messages: [{ id: "m1", threadId: "t1" }], resultSizeEstimate: 1 });
    const r = await run({ operation: "list_messages", params: { limit: 10 } }, fetchImpl);
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/gmail/v1/users/me/messages");
    expect(url.searchParams.get("maxResults")).toBe("10");
    expect(r.ok && r.items[0]).toMatchObject({ id: "m1", thread_id: "t1" });
  });
  it("caps maxResults at 500", () => {
    const url = new URL(gmailConnector.buildCall({ operation: "list_messages", params: { limit: 9999 } }).url);
    expect(url.searchParams.get("maxResults")).toBe("500");
  });
  it("repeats labelIds as Gmail documents", () => {
    const url = new URL(gmailConnector.buildCall({ operation: "list_messages", params: { label_ids: ["INBOX", "UNREAD"] } }).url);
    expect(url.searchParams.getAll("labelIds")).toEqual(["INBOX", "UNREAD"]);
  });
  it("passes includeSpamTrash", () => {
    const url = new URL(gmailConnector.buildCall({ operation: "list_messages", params: { include_spam_trash: true } }).url);
    expect(url.searchParams.get("includeSpamTrash")).toBe("true");
  });
  it("handles an empty mailbox", async () => {
    const r = await run({ operation: "list_messages" }, capture({ resultSizeEstimate: 0 }).fetchImpl);
    expect(r.ok && r.items).toEqual([]);
  });
  it("gets a message and normalizes headers, bodies and attachments", async () => {
    const { calls, fetchImpl } = capture(MESSAGE);
    const r = await run({ operation: "get_message", params: { message_id: "18c1", format: "full" } }, fetchImpl);
    expect(calls[0]!.url).toContain("/messages/18c1?format=full");
    const m = r.ok ? r.items[0]! : {};
    expect(m).toMatchObject({
      id: "18c1", thread_id: "t18c1", subject: "Quote", from: "Ali <ali@example.com>", text: "plain body", html: "<p>html body</p>",
      message_id_header: "<abc@mail.example.com>", references: "<root@mail.example.com>", history_id: "9001",
    });
    expect(m["internal_date"]).toBe(new Date(1700000000000).toISOString());
    expect(m["attachments"]).toEqual([{ part_id: "1", filename: "q.pdf", mime_type: "application/pdf", size: 2048, attachment_id: "ATT1" }]);
  });
  it("requests metadata headers with repeated params", () => {
    const url = new URL(gmailConnector.buildCall({ operation: "get_message", params: { message_id: "m", format: "metadata", metadata_headers: ["From", "Subject"] } }).url);
    expect(url.searchParams.getAll("metadataHeaders")).toEqual(["From", "Subject"]);
  });
  it("preserves raw format output", () => {
    expect(normalizeGmailMessage({ id: "m", raw: "UmF3" })["raw"]).toBe("UmF3");
  });
  it("url-encodes message ids", () => {
    expect(gmailConnector.buildCall({ operation: "get_message", params: { message_id: "a/b" } }).url).toContain("/messages/a%2Fb");
  });
  it("requires message_id", () => {
    expect(() => gmailConnector.buildCall({ operation: "get_message", params: {} })).toThrow(/message_id/);
  });
});

// ---------------------------------------------------------------------------
describe("gmail send", () => {
  it("sends plain text through the official raw field", async () => {
    const { calls, fetchImpl } = capture({ id: "s1", threadId: "t9", labelIds: ["SENT"] });
    const r = await run({ operation: "send_message", params: { to: "a@example.com", subject: "Hi", text: "Hello" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GMAIL_API_BASE}/messages/send`);
    expect(calls[0]!.init.method).toBe("POST");
    const raw = rawOf(calls[0]);
    expect(raw).toContain("To: a@example.com");
    expect(raw).toContain("Subject: Hi");
    expect(raw).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(raw).toContain(Buffer.from("Hello").toString("base64"));
    expect(r.ok && r.items[0]).toMatchObject({ id: "s1", thread_id: "t9" });
  });
  it("encodes raw as base64url without padding", async () => {
    const { calls, fetchImpl } = capture({ id: "s" });
    await run({ operation: "send_message", params: { to: "a@example.com", text: "?>?>~~" } }, fetchImpl);
    expect(String(body(calls[0])["raw"])).toMatch(/^[A-Za-z0-9_-]+$/);
  });
  it("builds multipart/alternative for text + HTML", () => {
    const mime = buildMimeMessage({ to: "a@x", text: "t", html: "<b>h</b>" });
    expect(mime).toContain("multipart/alternative");
    expect(mime).toContain("text/plain");
    expect(mime).toContain("text/html");
  });
  it("sends HTML-only bodies", () => {
    expect(buildMimeMessage({ to: "a@x", html: "<b>h</b>" })).toContain("Content-Type: text/html");
  });
  it("supports To / Cc / Bcc lists", () => {
    const mime = buildMimeMessage({ to: ["a@x", "b@x"], cc: "c@x, d@x", bcc: ["e@x"], text: "t" });
    expect(mime).toContain("To: a@x, b@x");
    expect(mime).toContain("Cc: c@x, d@x");
    expect(mime).toContain("Bcc: e@x");
  });
  it("adds custom headers but never overrides reserved ones", () => {
    const mime = buildMimeMessage({ to: "a@x", text: "t", headers: { "X-Trace": "abc", "Content-Type": "evil" } });
    expect(mime).toContain("X-Trace: abc");
    expect(mime).not.toContain("evil");
  });
  it("RFC 2047-encodes Arabic subjects", () => {
    expect(encodeHeader("مرحبا")).toMatch(/^=\?UTF-8\?B\?/);
    expect(buildMimeMessage({ to: "a@x", subject: "عرض سعر", text: "t" })).toContain("Subject: =?UTF-8?B?");
  });
  it("rejects header injection", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await run({ operation: "send_message", params: { to: "a@x\r\nBcc: evil@x", text: "t" } }, fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("invalid_request");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("requires a recipient", () => {
    expect(() => gmailConnector.buildCall({ operation: "send_message", params: { text: "t" } })).toThrow(/to/);
  });
  it("passes threadId when sending into a thread", () => {
    const call = gmailConnector.buildCall({ operation: "send_message", params: { to: "a@x", text: "t", thread_id: "T1" } });
    expect((call.body as Record<string, unknown>)["threadId"]).toBe("T1");
  });
});

// ---------------------------------------------------------------------------
describe("gmail reply / threading", () => {
  const params = { to: "ali@example.com", thread_id: "t18c1", in_reply_to: "<abc@mail.example.com>", references: "<root@mail.example.com>", subject: "Quote", text: "Thanks" };
  it("sends into the same thread with In-Reply-To and References", async () => {
    const { calls, fetchImpl } = capture({ id: "r1", threadId: "t18c1" });
    await run({ operation: "reply_message", params }, fetchImpl);
    expect(body(calls[0])["threadId"]).toBe("t18c1");
    const raw = rawOf(calls[0]);
    expect(raw).toContain("In-Reply-To: <abc@mail.example.com>");
    expect(raw).toContain("References: <root@mail.example.com> <abc@mail.example.com>");
  });
  it("prefixes Re: once", () => {
    const a = fromBase64Url(String((gmailConnector.buildCall({ operation: "reply_message", params }).body as Record<string, unknown>)["raw"]));
    expect(a).toContain("Subject: Re: Quote");
    const b = fromBase64Url(String((gmailConnector.buildCall({ operation: "reply_message", params: { ...params, subject: "RE: Quote" } }).body as Record<string, unknown>)["raw"]));
    expect(b).toContain("Subject: RE: Quote");
    expect(b).not.toContain("Re: RE:");
  });
  it("does not duplicate the parent id in References", () => {
    const raw = fromBase64Url(String((gmailConnector.buildCall({ operation: "reply_message", params: { ...params, references: ["<abc@mail.example.com>"] } }).body as Record<string, unknown>)["raw"]));
    expect(raw.match(/<abc@mail\.example\.com>/g)?.length).toBe(2); // In-Reply-To + References once
  });
  for (const key of ["to", "thread_id", "in_reply_to"]) {
    it(`requires ${key}`, () => {
      const p: Record<string, unknown> = { ...params };
      delete p[key];
      expect(() => gmailConnector.buildCall({ operation: "reply_message", params: p })).toThrow(new RegExp(key));
    });
  }
});

// ---------------------------------------------------------------------------
describe("gmail forward", () => {
  const original = toBase64Url("From: a@x\r\nSubject: Report\r\n\r\nbody");
  it("sends a new message with the original attached as message/rfc822", async () => {
    const { calls, fetchImpl } = capture({ id: "f1", threadId: "tf" });
    await run({ operation: "forward_message", params: { to: "boss@example.com", subject: "Report", text: "FYI", original_raw: original } }, fetchImpl);
    const raw = rawOf(calls[0]);
    expect(raw).toContain("Subject: Fwd: Report");
    expect(raw).toContain("Content-Type: message/rfc822");
    expect(raw).toContain("multipart/mixed");
  });
  it("does not attach the forward to the original thread", () => {
    const call = gmailConnector.buildCall({ operation: "forward_message", params: { to: "b@x", original_raw: original, thread_id: "T" } });
    expect((call.body as Record<string, unknown>)["threadId"]).toBeUndefined();
  });
  it("requires original_raw", () => {
    expect(() => gmailConnector.buildCall({ operation: "forward_message", params: { to: "b@x" } })).toThrow(/original_raw/);
  });
});

// ---------------------------------------------------------------------------
describe("gmail modify / trash / delete / batch", () => {
  it("modifies labels", async () => {
    const { calls, fetchImpl } = capture({ id: "m1", labelIds: ["STARRED"] });
    await run({ operation: "modify_message", params: { message_id: "m1", add_label_ids: ["STARRED"], remove_label_ids: ["UNREAD"] } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GMAIL_API_BASE}/messages/m1/modify`);
    expect(body(calls[0])).toEqual({ addLabelIds: ["STARRED"], removeLabelIds: ["UNREAD"] });
  });
  it("requires a label change", () => {
    expect(() => gmailConnector.buildCall({ operation: "modify_message", params: { message_id: "m1" } })).toThrow(/label_ids/);
  });
  it("trashes and untrashes", async () => {
    const a = capture({ id: "m1", labelIds: ["TRASH"] });
    await run({ operation: "trash_message", params: { message_id: "m1" } }, a.fetchImpl);
    expect(a.calls[0]!.url).toBe(`${GMAIL_API_BASE}/messages/m1/trash`);
    const b = capture({ id: "m1" });
    await run({ operation: "untrash_message", params: { message_id: "m1" } }, b.fetchImpl);
    expect(b.calls[0]!.url).toBe(`${GMAIL_API_BASE}/messages/m1/untrash`);
  });
  it("deletes permanently with an empty 204 response", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const r = await run({ operation: "delete_message", params: { message_id: "m1" } }, fetchImpl);
    expect(r.ok).toBe(true);
    expect(r.ok && r.items[0]).toMatchObject({ ok: true });
  });
  it("permanent delete maps to the full mailbox scope", () => {
    expect(gmailScopeFor("delete_message")).toBe(GMAIL_SCOPES.full);
    expect(gmailScopeFor("batch_delete_messages")).toBe(GMAIL_SCOPES.full);
    expect(gmailScopeFor("trash_message")).toBe(GMAIL_SCOPES.modify);
  });
  it("reports a missing full scope as forbidden", async () => {
    const r = await run(
      { operation: "delete_message", params: { message_id: "m1" } },
      capture(gErr(403, "Request had insufficient authentication scopes.", "insufficientPermissions", "PERMISSION_DENIED"), { status: 403 }).fetchImpl,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "forbidden", retryable: false });
  });
  it("batch-modifies via the official JSON method", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const r = await run({ operation: "batch_modify_messages", params: { ids: ["a", "b"], add_label_ids: ["L1"] } }, fetchImpl);
    expect(r.ok).toBe(true);
    const call = gmailConnector.buildCall({ operation: "batch_modify_messages", params: { ids: ["a", "b"], remove_label_ids: ["UNREAD"] } });
    expect(call.url).toBe(`${GMAIL_API_BASE}/messages/batchModify`);
    expect(call.body).toEqual({ ids: ["a", "b"], removeLabelIds: ["UNREAD"] });
  });
  it("batch-deletes", () => {
    const call = gmailConnector.buildCall({ operation: "batch_delete_messages", params: { ids: ["a"] } });
    expect(call.url).toBe(`${GMAIL_API_BASE}/messages/batchDelete`);
    expect(call.body).toEqual({ ids: ["a"] });
  });
  it("caps batches at 1000 ids", () => {
    expect(() => gmailConnector.buildCall({ operation: "batch_delete_messages", params: { ids: Array.from({ length: 1001 }, (_, i) => String(i)) } })).toThrow(/1–1000/);
  });
});

// ---------------------------------------------------------------------------
describe("gmail threads", () => {
  it("lists threads", async () => {
    const { calls, fetchImpl } = capture({ threads: [{ id: "t1", snippet: "s", historyId: "1" }] });
    const r = await run({ operation: "list_threads", params: { query: "is:unread" } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("q")).toBe("is:unread");
    expect(r.ok && r.items[0]).toMatchObject({ id: "t1", snippet: "s" });
  });
  it("gets a thread with its normalized messages", async () => {
    const r = await run({ operation: "get_thread", params: { thread_id: "t18c1" } }, capture({ id: "t18c1", historyId: "5", messages: [MESSAGE, MESSAGE] }).fetchImpl);
    const t = r.ok ? r.items[0]! : {};
    expect(t["message_count"]).toBe(2);
    expect((t["messages"] as Record<string, unknown>[])[0]!["subject"]).toBe("Quote");
  });
  it("modifies, trashes, untrashes and deletes threads", () => {
    expect(gmailConnector.buildCall({ operation: "modify_thread", params: { thread_id: "t", add_label_ids: ["X"] } }).url).toBe(`${GMAIL_API_BASE}/threads/t/modify`);
    expect(gmailConnector.buildCall({ operation: "trash_thread", params: { thread_id: "t" } }).url).toBe(`${GMAIL_API_BASE}/threads/t/trash`);
    expect(gmailConnector.buildCall({ operation: "untrash_thread", params: { thread_id: "t" } }).url).toBe(`${GMAIL_API_BASE}/threads/t/untrash`);
    const del = gmailConnector.buildCall({ operation: "delete_thread", params: { thread_id: "t" } });
    expect(del.method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
describe("gmail labels", () => {
  it("lists labels", async () => {
    const r = await run({ operation: "list_labels" }, capture({ labels: [{ id: "INBOX", name: "INBOX", type: "system" }, { id: "L1", name: "VIP", type: "user" }] }).fetchImpl);
    expect(r.ok && r.items.map((l) => l["name"])).toEqual(["INBOX", "VIP"]);
  });
  it("gets a label with counters", async () => {
    const r = await run({ operation: "get_label", params: { label_id: "L1" } }, capture({ id: "L1", name: "VIP", messagesUnread: 3 }).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "L1", messages_unread: 3 });
  });
  it("creates a label with camelCase fields", () => {
    const call = gmailConnector.buildCall({ operation: "create_label", params: { name: "VIP", label_list_visibility: "labelShow", message_list_visibility: "show" } });
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ name: "VIP", labelListVisibility: "labelShow", messageListVisibility: "show" });
  });
  it("updates with PATCH and deletes", () => {
    expect(gmailConnector.buildCall({ operation: "update_label", params: { label_id: "L1", name: "X" } }).method).toBe("PATCH");
    expect(gmailConnector.buildCall({ operation: "delete_label", params: { label_id: "L1" } }).method).toBe("DELETE");
  });
  it("requires a name to create", () => {
    expect(() => gmailConnector.buildCall({ operation: "create_label", params: {} })).toThrow(/name/);
  });
});

// ---------------------------------------------------------------------------
describe("gmail drafts", () => {
  it("creates a draft wrapping a raw message", () => {
    const call = gmailConnector.buildCall({ operation: "create_draft", params: { to: "a@x", subject: "D", text: "t" } });
    const msg = (call.body as { message: Record<string, unknown> }).message;
    expect(fromBase64Url(String(msg["raw"]))).toContain("Subject: D");
  });
  it("updates a draft with PUT and its id", () => {
    const call = gmailConnector.buildCall({ operation: "update_draft", params: { draft_id: "d1", to: "a@x", text: "v2" } });
    expect(call.method).toBe("PUT");
    expect((call.body as Record<string, unknown>)["id"]).toBe("d1");
  });
  it("lists, gets and normalizes drafts", async () => {
    const r = await run({ operation: "list_drafts" }, capture({ drafts: [{ id: "d1", message: { id: "m1", threadId: "t1" } }] }).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "d1", message: { id: "m1", thread_id: "t1" } });
    const g = await run({ operation: "get_draft", params: { draft_id: "d1" } }, capture({ id: "d1", message: MESSAGE }).fetchImpl);
    expect(g.ok && (g.items[0]!["message"] as Record<string, unknown>)["subject"]).toBe("Quote");
  });
  it("sends a draft by id", async () => {
    const { calls, fetchImpl } = capture({ id: "m9", threadId: "t9", labelIds: ["SENT"] });
    const r = await run({ operation: "send_draft", params: { draft_id: "d1" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GMAIL_API_BASE}/drafts/send`);
    expect(body(calls[0])).toEqual({ id: "d1" });
    expect(r.ok && r.items[0]).toMatchObject({ id: "m9" });
  });
  it("deletes a draft", () => {
    expect(gmailConnector.buildCall({ operation: "delete_draft", params: { draft_id: "d1" } }).method).toBe("DELETE");
  });
});

// ---------------------------------------------------------------------------
describe("gmail attachments", () => {
  it("attaches base64 files in multipart/mixed", () => {
    const mime = buildMimeMessage({ to: "a@x", text: "t", attachments: [{ filename: "a.txt", mime_type: "text/plain", content_base64: Buffer.from("hello").toString("base64") }] });
    expect(mime).toContain('Content-Disposition: attachment; filename="a.txt"');
    expect(mime).toContain(Buffer.from("hello").toString("base64"));
  });
  it("accepts base64url attachment content", () => {
    expect(() => buildMimeMessage({ to: "a@x", attachments: [{ filename: "a", content_base64: toBase64Url("??>>") }] })).not.toThrow();
  });
  it("rejects invalid base64", () => {
    expect(() => buildMimeMessage({ to: "a@x", attachments: [{ filename: "a", content_base64: "not base64 !!" }] })).toThrow(/base64/);
  });
  it("rejects attachments without a filename", () => {
    expect(() => buildMimeMessage({ to: "a@x", attachments: [{ filename: "", content_base64: "AA==" }] })).toThrow(/filename/);
  });
  it("enforces the 5 MB JSON raw limit", async () => {
    const big = Buffer.alloc(GMAIL_MAX_RAW_BYTES).toString("base64");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await run({ operation: "send_message", params: { to: "a@x", attachments: [{ filename: "big.bin", content_base64: big }] } }, fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toMatch(/5242880/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("downloads attachment data through the official JSON endpoint", async () => {
    const { calls, fetchImpl } = capture({ attachmentId: "ATT1", size: 5, data: toBase64Url("hello") });
    const r = await run({ operation: "get_attachment", params: { message_id: "m1", attachment_id: "ATT1" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GMAIL_API_BASE}/messages/m1/attachments/ATT1`);
    expect(r.ok && fromBase64Url(String(r.items[0]!["data"]))).toBe("hello");
  });
  it("documents binary upload/download limits", () => {
    expect(UNSUPPORTED_OPERATIONS["media_upload_send"]).toMatch(/multipart|resumable/);
    expect(UNSUPPORTED_OPERATIONS["attachment_binary_download"]).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe("gmail search", () => {
  it("uses Gmail query syntax via q", async () => {
    const { calls, fetchImpl } = capture({ messages: [] });
    await run({ operation: "search_messages", params: { query: "from:ali@example.com has:attachment newer_than:7d" } }, fetchImpl);
    expect(new URL(calls[0]!.url).searchParams.get("q")).toBe("from:ali@example.com has:attachment newer_than:7d");
  });
  it("requires a query", () => {
    expect(() => gmailConnector.buildCall({ operation: "search_messages", params: {} })).toThrow(/query/);
  });
  it("searches drafts too", () => {
    expect(new URL(gmailConnector.buildCall({ operation: "list_drafts", params: { query: "subject:x" } }).url).searchParams.get("q")).toBe("subject:x");
  });
});

// ---------------------------------------------------------------------------
describe("gmail history / changes / watch", () => {
  it("lists history from a startHistoryId", async () => {
    const { calls, fetchImpl } = capture({
      history: [{ id: "9002", messages: [{ id: "m2" }], messagesAdded: [{ message: { id: "m2", threadId: "t2" } }] }],
      historyId: "9002",
    });
    const r = await run({ operation: "list_history", params: { start_history_id: "9001", history_types: ["messageAdded", "labelAdded"] } }, fetchImpl);
    const url = new URL(calls[0]!.url);
    expect(url.searchParams.get("startHistoryId")).toBe("9001");
    expect(url.searchParams.getAll("historyTypes")).toEqual(["messageAdded", "labelAdded"]);
    expect(r.ok && r.items[0]).toMatchObject({ id: "9002", messages_added: ["m2"] });
  });
  it("requires start_history_id", () => {
    expect(() => gmailConnector.buildCall({ operation: "list_history", params: {} })).toThrow(/start_history_id/);
  });
  it("normalizes deleted and label changes", () => {
    expect(normalizeGmailHistory({ id: "1", messagesDeleted: [{ message: { id: "x" } }], labelsRemoved: [{ message: { id: "y" } }] })).toMatchObject({
      messages_deleted: ["x"], labels_removed: ["y"],
    });
  });
  it("maps an expired startHistoryId (404) to not_found so a full sync can start", async () => {
    const r = await run({ operation: "list_history", params: { start_history_id: "1" } }, capture(gErr(404, "Requested entity was not found.", "notFound"), { status: 404 }).fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
  it("registers a Pub/Sub watch", async () => {
    const { calls, fetchImpl } = capture({ historyId: "9001", expiration: "1700604800000" });
    const r = await run({ operation: "watch_mailbox", params: { topic_name: "projects/p/topics/gmail", label_ids: ["INBOX"], label_filter_behavior: "include" } }, fetchImpl);
    expect(calls[0]!.url).toBe(`${GMAIL_API_BASE}/watch`);
    expect(body(calls[0])).toEqual({ topicName: "projects/p/topics/gmail", labelIds: ["INBOX"], labelFilterBehavior: "include" });
    expect(r.ok && r.items[0]).toMatchObject({ historyId: "9001" });
  });
  it("stops a watch", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    expect((await run({ operation: "stop_watch" }, fetchImpl)).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("gmail push notifications (Pub/Sub)", () => {
  it("accepts a valid push with the configured audience", () => {
    const v = verifyPush(pushEnvelope());
    expect(v.ok).toBe(true);
    expect(v.eventId).toBe("pubsub:2070443601311540");
    expect(v.eventType).toBe("gmail.mailbox_changed");
  });
  it("parses the change signal only (no message content)", () => {
    const p = parseGmailPush(pushEnvelope());
    expect(p).toMatchObject({ emailAddress: "me@example.com", historyId: "9001" });
    expect(Object.keys(p)).not.toContain("payload");
    expect(UNSUPPORTED_OPERATIONS["push_payload_contains_message"]).toMatch(/historyId/);
  });
  it("rejects a missing authorization token", () => {
    expect(verifyPush(pushEnvelope(), { auth: null })).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("rejects a wrong audience (another workspace)", () => {
    expect(verifyPush(pushEnvelope(), { secret: "workspace-b-audience" }).ok).toBe(false);
  });
  it("rejects a non-Google issuer", () => {
    const v = verifyPush(pushEnvelope(), { claims: { aud: AUDIENCE, iss: "https://evil.example", exp: Math.floor(NOW / 1000) + 60 } });
    expect(v).toMatchObject({ ok: false, reason: "invalid_signature" });
  });
  it("rejects an expired token", () => {
    const v = verifyPush(pushEnvelope(), { claims: { aud: AUDIENCE, iss: "accounts.google.com", exp: Math.floor(NOW / 1000) - 1 } });
    expect(v.ok).toBe(false);
  });
  it("rejects a garbage token", () => {
    expect(verifyPush(pushEnvelope(), { auth: "Bearer not-a-jwt" }).ok).toBe(false);
  });
  it("requires a configured audience", () => {
    expect(verifyPush(pushEnvelope(), { secret: null })).toMatchObject({ ok: false, reason: "missing_secret" });
  });
  it("rejects stale deliveries outside the replay window", () => {
    expect(verifyPush(pushEnvelope({ publishTime: new Date(NOW - 3_600_000).toISOString() }))).toMatchObject({ ok: false, reason: "replay" });
  });
  it("rejects malformed envelopes", () => {
    expect(verifyPush({ foo: 1 })).toMatchObject({ ok: false, reason: "malformed_payload" });
    expect(verifyPush(pushEnvelope({ data: { nothing: true } }))).toMatchObject({ ok: false, reason: "malformed_payload" });
  });
  it("redelivery of the same Pub/Sub message keeps one dedupe id", () => {
    expect(verifyPush(pushEnvelope()).eventId).toBe(verifyPush(pushEnvelope()).eventId);
    expect(verifyPush(pushEnvelope({ messageId: "other" })).eventId).not.toBe(verifyPush(pushEnvelope()).eventId);
  });
  it("never returns the audience secret", () => {
    expect(JSON.stringify(verifyPush(pushEnvelope()))).not.toContain(AUDIENCE);
    expect(JSON.stringify(verifyPush(pushEnvelope(), { secret: "x" }))).not.toContain(AUDIENCE);
  });
  it("documents OIDC signature verification as a limitation", () => {
    expect(UNSUPPORTED_OPERATIONS["pubsub_oidc_signature_verification"]).toMatch(/JWKS/);
  });
});

// ---------------------------------------------------------------------------
describe("gmail pagination", () => {
  it("follows nextPageToken across pages", async () => {
    const { fetchImpl, calls } = sequence(
      () => jsonResponse({ messages: [{ id: "a" }], nextPageToken: "p2" }),
      () => jsonResponse({ messages: [{ id: "b" }] }),
    );
    const r = await run({ operation: "list_messages", maxPages: 5 }, fetchImpl);
    expect(r.ok && r.items.map((i) => i["id"])).toEqual(["a", "b"]);
    expect(r.ok && r.pages).toBe(2);
    expect(new URL(calls[1]!).searchParams.get("pageToken")).toBe("p2");
  });
  it("returns the cursor when the page budget ends", async () => {
    const r = await run({ operation: "list_threads", maxPages: 1 }, capture({ threads: [{ id: "t" }], nextPageToken: "next" }).fetchImpl);
    expect(r.ok && r.cursor).toBe("next");
  });
  it("resumes from a given cursor", () => {
    expect(new URL(gmailConnector.buildCall({ operation: "list_drafts", cursor: "c3" }).url).searchParams.get("pageToken")).toBe("c3");
  });
  it("paginates history", async () => {
    const r = await run({ operation: "list_history", params: { start_history_id: "1" } }, capture({ history: [{ id: "2" }], nextPageToken: "h2" }).fetchImpl);
    expect(r.ok && r.cursor).toBe("h2");
  });
  it("labels are not paginated", () => {
    const url = new URL(gmailConnector.buildCall({ operation: "list_labels" }).url);
    expect(url.searchParams.get("maxResults")).toBeNull();
  });
  it("rejects a non-list collection as malformed", async () => {
    const r = await run({ operation: "list_messages" }, capture({ messages: "oops" }).fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("malformed_response");
  });
});

// ---------------------------------------------------------------------------
describe("gmail rate limits / retry / errors", () => {
  for (const reason of ["rateLimitExceeded", "userRateLimitExceeded"]) {
    it(`maps 403 ${reason} to retryable rate_limit`, async () => {
      const { fetchImpl, count } = sequence(
        () => jsonResponse(gErr(403, "Rate Limit Exceeded", reason), { status: 403 }),
        () => jsonResponse({ emailAddress: "me@example.com" }),
      );
      const r = await run({ operation: "get_profile" }, fetchImpl);
      expect(r.ok).toBe(true);
      expect(count()).toBe(2);
    });
  }
  it("retries 429 with backoff and honours Retry-After when it succeeds later", async () => {
    const delays: number[] = [];
    const { fetchImpl } = sequence(
      () => jsonResponse(gErr(429, "Too many requests", undefined, "RESOURCE_EXHAUSTED"), { status: 429, headers: { "retry-after": "2" } }),
      () => jsonResponse({ emailAddress: "me@example.com" }),
    );
    const r = await run({ operation: "get_profile" }, fetchImpl, creds, { sleep: async (ms) => void delays.push(ms) });
    expect(r.ok).toBe(true);
    expect(delays.length).toBe(1);
  });
  it("reads Retry-After seconds", () => {
    expect(gmailConnector.readRateLimit?.(new Headers({ "retry-after": "3" }), null)).toEqual({ retryAfterMs: 3000, remaining: 0 });
  });
  it("reads Retry-After HTTP dates", () => {
    const info = gmailConnector.readRateLimit?.(new Headers({ "retry-after": new Date(Date.now() + 10_000).toUTCString() }), null);
    expect(info?.retryAfterMs).toBeGreaterThan(0);
  });
  it("gives up after max attempts", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr(429, "slow down"), { status: 429 }));
    const r = await run({ operation: "get_profile" }, fetchImpl, creds, { maxAttempts: 3 });
    expect(r.ok).toBe(false);
    expect(count()).toBe(3);
    if (!r.ok) expect(r.error.kind).toBe("rate_limit");
  });
  it("retries 5xx backend errors", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr(503, "Backend Error", "backendError"), { status: 503 }), () => jsonResponse({ emailAddress: "x" }));
    expect((await run({ operation: "get_profile" }, fetchImpl)).ok).toBe(true);
    expect(count()).toBe(2);
  });
  it("maps 401 to non-retryable auth", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr(401, "Invalid Credentials", "authError"), { status: 401 }));
    const r = await run({ operation: "get_profile" }, fetchImpl);
    expect(count()).toBe(1);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "auth", retryable: false });
  });
  it("maps 403 permission errors to forbidden", async () => {
    const r = await run({ operation: "list_labels" }, capture(gErr(403, "Insufficient Permission", "insufficientPermissions"), { status: 403 }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("forbidden");
  });
  it("maps 404 to not_found", async () => {
    const r = await run({ operation: "get_message", params: { message_id: "x" } }, capture(gErr(404, "Not Found", "notFound"), { status: 404 }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("not_found");
  });
  it("maps 400 to invalid_request", async () => {
    const r = await run({ operation: "send_message", params: { to: "bad", text: "t" } }, capture(gErr(400, "Invalid To header", "invalidArgument"), { status: 400 }).fetchImpl);
    if (!r.ok) expect(r.error).toMatchObject({ kind: "invalid_request", retryable: false });
  });
  it("maps network failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    const r = await run({ operation: "get_profile" }, fetchImpl, creds, { maxAttempts: 1 });
    if (!r.ok) expect(r.error.kind).toBe("network");
  });
  it("does not treat 2xx bodies as errors", () => {
    expect(gmailConnector.mapError?.(200, { error: { message: "x" } })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("gmail idempotency", () => {
  it("sends no invented idempotency header or field", async () => {
    const { calls, fetchImpl } = capture({ id: "s1" });
    await run({ operation: "send_message", params: { to: "a@x", text: "t", idempotency_key: "k1" } }, fetchImpl);
    const headers = Object.keys((calls[0]!.init.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase());
    expect(headers.some((h) => h.includes("idempot"))).toBe(false);
    expect(JSON.stringify(body(calls[0]))).not.toContain("k1");
  });
  it("documents that Gmail has no official send idempotency", () => {
    expect(UNSUPPORTED_OPERATIONS["idempotency_key"]).toMatch(/no idempotency/);
  });
  it("returns Gmail ids so the runtime can record the outcome", async () => {
    const r = await run({ operation: "send_message", params: { to: "a@x", text: "t" } }, capture({ id: "s1", threadId: "t1" }).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "s1", thread_id: "t1" });
  });
  it("does not retry non-retryable send failures (no duplicate sends)", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr(400, "bad"), { status: 400 }));
    await run({ operation: "send_message", params: { to: "a@x", text: "t" } }, fetchImpl);
    expect(count()).toBe(1);
  });
  it("unsupported operations fail as unsupported", async () => {
    const r = await run({ operation: "media_upload_send" }, vi.fn() as unknown as typeof fetch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("unsupported");
    expect(() => gmailConnector.buildCall({ operation: "http_batch_endpoint" })).toThrow(/UNSUPPORTED_OPERATION/);
  });
});

// ---------------------------------------------------------------------------
describe("gmail health", () => {
  it("is healthy when the profile loads", async () => {
    const { calls, fetchImpl } = capture({ emailAddress: "me@example.com" });
    const h = await checkConnectorHealth({ adapter: gmailConnector, credentials: creds, traceId: trace, fetchImpl });
    expect(h.healthy).toBe(true);
    expect(calls[0]!.url).toBe(`${GMAIL_API_BASE}/profile`);
  });
  it("is unhealthy on a revoked token without leaking it", async () => {
    const h = await checkConnectorHealth({ adapter: gmailConnector, credentials: creds, traceId: trace, fetchImpl: capture(gErr(401, `bad ${TOKEN}`), { status: 401 }).fetchImpl });
    expect(h.healthy).toBe(false);
    expect(h.message).not.toContain(TOKEN);
  });
});

// ---------------------------------------------------------------------------
describe("gmail workspace isolation / credential isolation / RBAC", () => {
  it("each run uses only its own mailbox token", async () => {
    const a = capture({ emailAddress: "a" });
    const b = capture({ emailAddress: "b" });
    await run({ operation: "get_profile" }, a.fetchImpl, { access_token: TOKEN });
    await run({ operation: "get_profile" }, b.fetchImpl, { access_token: TOKEN_B });
    expect(headerOf(a.calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headerOf(b.calls[0], "authorization")).toBe(`Bearer ${TOKEN_B}`);
    expect(JSON.stringify(a.calls)).not.toContain(TOKEN_B);
  });
  it("buildCall never carries credentials", () => {
    for (const op of GMAIL_OPERATIONS) expect(JSON.stringify(gmailConnector.buildCall({ operation: op, params: requiredParams(op) }))).not.toContain("ya29.");
  });
  it("a token passed as a param is not forwarded", async () => {
    const { calls, fetchImpl } = capture({ messages: [] });
    await run({ operation: "list_messages", params: { access_token: TOKEN_B, token: TOKEN_B } }, fetchImpl);
    expect(calls[0]!.url).not.toContain(TOKEN_B);
    expect(headerOf(calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
  });
  it("OAuth accounts are scoped to the initiating workspace", async () => {
    const spec = getOAuthProvider("google_mail")!;
    const { store } = memoryStore();
    const s1 = await beginAuthorization({ store, spec, clientId: "c", pending: pending("ws1"), nowMs: NOW });
    const s2 = await beginAuthorization({ store, spec, clientId: "c", pending: pending("ws2"), nowMs: NOW });
    const fetchImpl = capture({ access_token: TOKEN, email: "me@example.com" }).fetchImpl;
    const a1 = await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: s1.state, code: "x", fetchImpl, nowMs: NOW });
    const a2 = await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: s2.state, code: "x", fetchImpl, nowMs: NOW });
    expect(a1.account.id).not.toBe(a2.account.id);
    expect(await store.getAccount("ws2", a1.account.id)).toBeNull();
    expect(await store.getAccount("ws1", a1.account.id)).not.toBeNull();
  });
  function rbacClient(role: string | null) {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: role ? { role } : null, error: null }),
    };
    return { from: () => chain } as unknown as Parameters<typeof assertCanExecute>[0];
  }
  for (const role of ["owner", "admin", "member"])
    it(`RBAC allows ${role} to execute Gmail operations`, async () => {
      await expect(assertCanExecute(rbacClient(role), "ws1", "u1")).resolves.toBe(role);
    });
  for (const role of ["viewer", null])
    it(`RBAC blocks ${role ?? "non-members"}`, async () => {
      await expect(assertCanExecute(rbacClient(role), "ws1", "u1")).rejects.toThrow(/permission/);
    });
});

// ---------------------------------------------------------------------------
describe("gmail secret redaction / trace ids", () => {
  it("never returns the token in results", async () => {
    const r = await run({ operation: "get_profile" }, capture({ emailAddress: "x" }).fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("scrubs the token from provider error text", async () => {
    const r = await run({ operation: "get_profile" }, capture(gErr(400, `bad token ${TOKEN}`), { status: 400 }).fetchImpl);
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("scrubs the token from non-JSON error bodies", async () => {
    const fetchImpl = vi.fn(async () => new Response(`denied ${TOKEN}`, { status: 418 })) as unknown as typeof fetch;
    expect(JSON.stringify(await run({ operation: "get_profile" }, fetchImpl))).not.toContain(TOKEN);
  });
  it("scrubs the token from network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`socket closed for ${TOKEN}`);
    }) as unknown as typeof fetch;
    expect(JSON.stringify(await run({ operation: "get_profile" }, fetchImpl, creds, { maxAttempts: 1 }))).not.toContain(TOKEN);
  });
  it("redacts token-like keys", () => {
    const out = JSON.stringify(redact({ access_token: TOKEN, refresh_token: REFRESH, nested: { client_secret: "x" } }));
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(REFRESH);
  });
  it("does not emit the token in runtime events", async () => {
    const events: unknown[] = [];
    const { fetchImpl } = sequence(() => jsonResponse(gErr(429, "slow"), { status: 429 }), () => jsonResponse({ emailAddress: "x" }));
    await run({ operation: "get_profile" }, fetchImpl, creds, { onEvent: (e) => events.push(e) });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    expect(events.every((e) => (e as { traceId: string }).traceId === trace)).toBe(true);
  });
  it("carries the trace id on success and failure", async () => {
    const ok = await run({ operation: "get_profile" }, capture({ emailAddress: "x" }).fetchImpl);
    const bad = await run({ operation: "get_profile" }, capture(gErr(404, "nf"), { status: 404 }).fetchImpl);
    expect(ok.traceId).toBe(trace);
    expect(bad.traceId).toBe(trace);
  });
});
