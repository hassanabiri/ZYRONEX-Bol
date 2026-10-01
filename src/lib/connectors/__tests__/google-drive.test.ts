import { describe, expect, it, vi } from "vitest";

import {
  DRIVE_API_BASE,
  DRIVE_OPERATIONS,
  DRIVE_SCOPES,
  TEXT_EXPORT_MIME,
  UNSUPPORTED_OPERATIONS,
  buildDriveQuery,
  driveScopeFor,
  escapeQueryValue,
  googleDriveConnector,
} from "@/lib/connectors/adapters/google-drive";
import { DRIVE_FOLDER_MIME, WORKSPACE_MIME, normalizeDriveFile, parseDrivePushHeaders, workspaceKind } from "@/lib/connectors/adapters/google-drive-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact } from "@/lib/connectors/errors";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { assertCanExecute } from "@/lib/execution/guard.server";
import { beginAuthorization, completeAuthorization, ensureAccessToken, hashState } from "@/lib/oauth/core";
import { getOAuthProvider } from "@/lib/oauth/providers";
import type { ConnectionAccount, OAuthStore, OAuthTokenSet, PendingAuthorization } from "@/lib/oauth/types";
import { verifyWebhook } from "@/lib/webhooks/verify";

const trace = "trace-drive";
const TOKEN = "ya29.a0DriveAccessTokenAAAA1111";
const TOKEN_B = "ya29.a0DriveAccessTokenBBBB2222";
const REFRESH = "1//0gRefreshTokenDriveXYZ";
const CHANNEL_TOKEN = "drive-channel-token-9b1c";
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
  return runConnectorOperation({ adapter: googleDriveConnector, credentials, traceId: trace, input, fetchImpl, sleep: async () => {}, ...extra });
}
const body = (call: { init: RequestInit } | undefined) => JSON.parse(String(call?.init.body ?? "{}")) as Record<string, unknown>;
const headerOf = (call: { init: RequestInit } | undefined, name: string) => (call?.init.headers as Record<string, string> | undefined)?.[name];
const urlOf = (call: { url: string } | undefined) => new URL(call!.url);
const gErr = (code: number, message: string, reason?: string, status?: string) => ({
  error: { code, message, ...(status ? { status } : {}), ...(reason ? { errors: [{ reason, message }] } : {}) },
});
const build = (operation: string, params: Record<string, unknown> = {}, cursor?: string) =>
  googleDriveConnector.buildCall({ operation, params, ...(cursor ? { cursor } : {}) });

const FILE = {
  id: "f1", name: "Report.txt", mimeType: "text/plain", parents: ["root1"], size: "2048", trashed: false, starred: true,
  createdTime: "2026-01-01T00:00:00.000Z", modifiedTime: "2026-01-02T00:00:00.000Z", webViewLink: "https://drive.google.com/file/d/f1/view",
  md5Checksum: "abc", owners: [{ displayName: "Me", emailAddress: "me@example.com", permissionId: "p0", me: true }], version: "7",
};
const PERM = { id: "p1", type: "user", role: "reader", emailAddress: "a@example.com", displayName: "A" };

function jwt(claims: Record<string, unknown>) {
  const b = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "RS256", typ: "JWT" })}.${b(claims)}.sig`;
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
  workspaceId: ws, integrationId: null, provider: "google_drive_api", connector: "google_drive_api", redirectUri: "https://app.test/cb", createdBy: null,
});
async function connect(ws = "ws1", sub = "1001") {
  const spec = getOAuthProvider("google_drive_api")!;
  const mem = memoryStore();
  const { state } = await beginAuthorization({ store: mem.store, spec, clientId: "cid", pending: pending(ws), nowMs: NOW });
  const { fetchImpl } = capture({
    access_token: TOKEN, refresh_token: REFRESH, expires_in: 3599, token_type: "Bearer",
    scope: `openid email ${DRIVE_SCOPES.file}`, id_token: jwt({ sub, email: "me@example.com" }),
  });
  const { account } = await completeAuthorization({ store: mem.store, spec, client: { clientId: "cid", clientSecret: "shh" }, state, code: "c1", fetchImpl, nowMs: NOW });
  return { ...mem, spec, account, state };
}

function push(overrides: Record<string, string | null> = {}) {
  const base: Record<string, string> = {
    "x-goog-channel-id": "chan-1",
    "x-goog-channel-token": CHANNEL_TOKEN,
    "x-goog-resource-id": "res-1",
    "x-goog-resource-state": "change",
    "x-goog-resource-uri": `${DRIVE_API_BASE}/changes?pageToken=5`,
    "x-goog-message-number": "42",
    "x-goog-channel-expiration": new Date(NOW + 3600_000).toUTCString(),
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) delete base[k];
    else base[k] = v;
  }
  return base;
}
const verifyPush = (headers: Record<string, string>, opts: { secret?: string | null; nowMs?: number } = {}) =>
  verifyWebhook("google_drive_api", {
    raw: "",
    headers,
    payload: {},
    secret: opts.secret === undefined ? CHANNEL_TOKEN : opts.secret,
    nowMs: opts.nowMs ?? NOW,
    replayWindowMs: 300_000,
  });

// ---------------------------------------------------------------------------
describe("drive registration", () => {
  it("is registered under google_drive_api", () => {
    expect(getConnector("google_drive_api")?.id).toBe("google_drive_api");
    const d = describeConnectors().find((c) => c.id === "google_drive_api");
    expect(d?.authKind).toBe("oauth2");
    expect(d?.requiredCredentials).toEqual(["access_token"]);
  });
  it("leaves the generic google adapter and google_drive alias untouched", () => {
    expect(getConnector("google")?.id).toBe("google");
    expect(getConnector("google_drive")?.id).toBe("google");
    expect(getOAuthProvider("google_drive")?.connector).toBe("google");
  });
  it("leaves Gmail untouched", () => {
    expect(getConnector("google_mail")?.id).toBe("google_mail");
    expect(getConnector("gmail")?.id).toBe("google");
  });
  it("declares files, webhook and health capabilities", () => {
    expect(googleDriveConnector.capabilities).toEqual(expect.arrayContaining(["files", "webhook", "health_check", "pagination", "search"]));
    expect(googleDriveConnector.healthOperation).toBe("get_about");
  });
  it("exposes no unsupported operation as a runnable operation", () => {
    for (const op of Object.keys(UNSUPPORTED_OPERATIONS)) expect(DRIVE_OPERATIONS).not.toContain(op);
  });
  it("every operation maps to a documented scope", () => {
    for (const op of DRIVE_OPERATIONS) expect(Object.values(DRIVE_SCOPES)).toContain(driveScopeFor(op));
  });
  it("returns undefined scope for unknown operations", () => expect(driveScopeFor("nope")).toBeUndefined());
});

// ---------------------------------------------------------------------------
describe("drive OAuth", () => {
  const spec = getOAuthProvider("google_drive_api")!;
  it("uses the official Google endpoints with PKCE", () => {
    expect(spec.authorizationUrl).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(spec.tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(spec.revokeUrl).toBe("https://oauth2.googleapis.com/revoke");
    expect(spec.usePkce).toBe(true);
    expect(spec.refreshable).toBe(true);
  });
  it("requests offline access, PKCE S256 and a strong state", async () => {
    const { store } = memoryStore();
    const { authorizationUrl } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    const url = new URL(authorizationUrl);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")?.length).toBeGreaterThan(20);
    expect(url.searchParams.get("state")?.length).toBeGreaterThan(20);
  });
  it("defaults to least privilege (no full drive, no drive.readonly)", () => {
    expect(spec.scopes).toContain(DRIVE_SCOPES.metadata_readonly);
    expect(spec.scopes).toContain(DRIVE_SCOPES.file);
    expect(spec.scopes).not.toContain(DRIVE_SCOPES.full);
    expect(spec.scopes).not.toContain(DRIVE_SCOPES.readonly);
  });
  it("can request broader scopes explicitly per connection", async () => {
    const { store } = memoryStore();
    const { authorizationUrl } = await beginAuthorization({
      store, spec, clientId: "cid", pending: { ...pending(), scopes: [...spec.scopes, DRIVE_SCOPES.full] }, nowMs: NOW,
    });
    expect(new URL(authorizationUrl).searchParams.get("scope")).toContain(DRIVE_SCOPES.full);
  });
  it("stores only the hashed state", async () => {
    const { store, states } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    expect(states.has(hashState(state))).toBe(true);
    expect(states.has(state)).toBe(false);
  });
  it("creates a connection account keyed by the Google subject", async () => {
    const { account, tokens } = await connect();
    expect(account.accountIdentifier).toBe("1001");
    expect(account.accountLabel).toBe("me@example.com");
    expect(account.workspaceId).toBe("ws1");
    expect(tokens.get(account.id)?.accessToken).toBe(TOKEN);
    expect(tokens.get(account.id)?.refreshToken).toBe(REFRESH);
    expect(account.expiresAt).not.toBeNull();
  });
  it("never exposes tokens on the account projection", async () => {
    const { account } = await connect();
    expect(JSON.stringify(account)).not.toContain(TOKEN);
    expect(JSON.stringify(account)).not.toContain(REFRESH);
  });
  it("identifies by email when no id_token is returned", () => {
    expect(spec.identify?.({ email: "x@example.com" })).toEqual({ accountIdentifier: "x@example.com", accountLabel: "x@example.com" });
  });
  it("returns no identity for an empty token", () => expect(spec.identify?.({})).toEqual({}));
  it("rejects a replayed state", async () => {
    const { store, spec: s, state } = await connect();
    const { fetchImpl } = capture({ access_token: TOKEN });
    await expect(completeAuthorization({ store, spec: s, client: { clientId: "c", clientSecret: "s" }, state, code: "c", fetchImpl, nowMs: NOW })).rejects.toThrow();
  });
  it("rejects a forged state", async () => {
    const { store } = memoryStore();
    await expect(
      completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: "forged", code: "c", fetchImpl: capture({}).fetchImpl, nowMs: NOW }),
    ).rejects.toThrow();
  });
  it("rejects an expired state", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    await expect(
      completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "c", fetchImpl: capture({ access_token: TOKEN }).fetchImpl, nowMs: NOW + 24 * 3600_000 }),
    ).rejects.toThrow();
  });
  it("sends the PKCE verifier on code exchange", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    const { calls, fetchImpl } = capture({ access_token: TOKEN, id_token: jwt({ sub: "1" }) });
    await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "c", fetchImpl, nowMs: NOW });
    expect(String(calls[0]!.init.body)).toContain("code_verifier=");
  });
  it("fails token exchange without leaking the client secret", async () => {
    const { store } = memoryStore();
    const { state } = await beginAuthorization({ store, spec, clientId: "cid", pending: pending(), nowMs: NOW });
    const err = await completeAuthorization({
      store, spec, client: { clientId: "c", clientSecret: "super-secret-value" }, state, code: "bad", fetchImpl: capture({ error: "invalid_grant" }, { status: 400 }).fetchImpl, nowMs: NOW,
    }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error).message)).not.toContain("super-secret-value");
  });
});

describe("drive token refresh / expiration", () => {
  it("returns the stored token while fresh", async () => {
    const { store, spec, account } = await connect();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW });
    expect(r.refreshed).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refreshes an expired token and keeps the original refresh token", async () => {
    const { store, spec, account, tokens } = await connect();
    const { calls, fetchImpl } = capture({ access_token: TOKEN_B, expires_in: 3599 });
    const r = await ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW + 2 * 3600_000 });
    expect(r.refreshed).toBe(true);
    expect(r.token).toBe(TOKEN_B);
    expect(String(calls[0]!.init.body)).toContain("grant_type=refresh_token");
    expect(tokens.get(account.id)?.refreshToken).toBe(REFRESH);
  });
  it("marks the connection when the refresh token is revoked", async () => {
    const { store, spec, account, accounts } = await connect();
    const { fetchImpl } = capture({ error: "invalid_grant" }, { status: 400 });
    await expect(ensureAccessToken({ store, spec, client: { clientId: "c", clientSecret: "s" }, account, fetchImpl, nowMs: NOW + 2 * 3600_000 })).rejects.toThrow();
    expect(accounts.get(account.id)?.status).not.toBe("connected");
  });
});

// ---------------------------------------------------------------------------
describe("drive identity / about", () => {
  const ABOUT = {
    user: { displayName: "Me", emailAddress: "me@example.com", permissionId: "p0", me: true },
    storageQuota: { limit: "16106127360", usage: "1000", usageInDrive: "800", usageInDriveTrash: "10" },
    canCreateDrives: true,
  };
  it("calls about.get with explicit fields", async () => {
    const { calls, fetchImpl } = capture(ABOUT);
    await run({ operation: "get_about" }, fetchImpl);
    expect(urlOf(calls[0]).pathname).toBe("/drive/v3/about");
    expect(urlOf(calls[0]).searchParams.get("fields")).toBe("user,storageQuota,canCreateDrives");
  });
  it("normalizes user and storage quota", async () => {
    const r = await run({ operation: "get_about" }, capture(ABOUT).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({
      email: "me@example.com",
      storage: { limit: 16106127360, usage: 1000, usage_in_drive: 800, usage_in_trash: 10 },
      can_create_drives: true,
    });
  });
  it("handles unlimited quota (no limit)", async () => {
    const r = await run({ operation: "get_about" }, capture({ ...ABOUT, storageQuota: { usage: "5" } }).fetchImpl);
    expect(r.ok && (r.items[0] as { storage: { limit: unknown } }).storage.limit).toBeNull();
  });
  it("is healthy when about loads", async () => {
    const h = await checkConnectorHealth({ adapter: googleDriveConnector, credentials: creds, traceId: trace, fetchImpl: capture(ABOUT).fetchImpl });
    expect(h.healthy).toBe(true);
  });
  it("is unhealthy on a revoked token without leaking it", async () => {
    const h = await checkConnectorHealth({ adapter: googleDriveConnector, credentials: creds, traceId: trace, fetchImpl: capture(gErr(401, `bad ${TOKEN}`), { status: 401 }).fetchImpl });
    expect(h.healthy).toBe(false);
    expect(h.message).not.toContain(TOKEN);
  });
  it("fails before any call when not connected", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await run({ operation: "get_about" }, fetchImpl, { access_token: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("drive files", () => {
  it("lists My Drive files by default, excluding trash", () => {
    const u = new URL(build("list_files").url);
    expect(u.pathname).toBe("/drive/v3/files");
    expect(u.searchParams.get("corpora")).toBe("user");
    expect(u.searchParams.get("q")).toBe("trashed = false");
    expect(u.searchParams.get("supportsAllDrives")).toBe("true");
    expect(u.searchParams.get("pageSize")).toBe("100");
    expect(u.searchParams.get("fields")).toContain("nextPageToken");
  });
  it("normalizes listed files", async () => {
    const r = await run({ operation: "list_files" }, capture({ files: [FILE] }).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "f1", name: "Report.txt", size: 2048, parents: ["root1"], location: "my_drive", starred: true, is_folder: false });
  });
  it("passes order_by", () => expect(new URL(build("list_files", { order_by: "modifiedTime desc" }).url).searchParams.get("orderBy")).toBe("modifiedTime desc"));
  it("can include trashed files", () => expect(new URL(build("list_files", { include_trashed: true }).url).searchParams.get("q")).toBeNull());
  it("gets file metadata with all-drive support", () => {
    const c = build("get_file", { file_id: "f/1" });
    const u = new URL(c.url);
    expect(u.pathname).toBe("/drive/v3/files/f%2F1");
    expect(u.searchParams.get("supportsAllDrives")).toBe("true");
    expect(c.method).toBe("GET");
  });
  it("requires file_id for get", () => expect(() => build("get_file")).toThrow(/file_id/));
  it("creates a metadata-only file in a parent", () => {
    const c = build("create_file", { name: "notes.txt", mime_type: "text/plain", parent_id: "fold1", description: "d" });
    expect(c.method).toBe("POST");
    expect(c.body).toEqual({ name: "notes.txt", mimeType: "text/plain", parents: ["fold1"], description: "d" });
  });
  it("rejects inline content upload on create as UNSUPPORTED", () => expect(() => build("create_file", { name: "x", content: "abc" })).toThrow(/UNSUPPORTED_OPERATION/));
  it("updates metadata with PATCH", () => {
    const c = build("update_file", { file_id: "f1", name: "New", starred: false });
    expect(c.method).toBe("PATCH");
    expect(c.body).toEqual({ name: "New", starred: false });
  });
  it("rejects empty updates", () => expect(() => build("update_file", { file_id: "f1" })).toThrow(/at least one/));
  it("rejects content replacement on update as UNSUPPORTED", () => expect(() => build("update_file", { file_id: "f1", content_base64: "AA==" })).toThrow(/UNSUPPORTED_OPERATION/));
  it("trashes via trashed=true", () => expect(build("trash_file", { file_id: "f1" }).body).toEqual({ trashed: true }));
  it("untrashes via trashed=false", () => expect(build("untrash_file", { file_id: "f1" }).body).toEqual({ trashed: false }));
  it("deletes permanently with DELETE", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const r = await run({ operation: "delete_file", params: { file_id: "f1" } }, fetchImpl);
    expect(r.ok && r.items[0]).toEqual({ ok: true, operation: "delete_file" });
  });
  it("copies a file with a new name and parent", () => {
    const c = build("copy_file", { file_id: "f1", name: "Copy", parent_id: "p2" });
    expect(new URL(c.url).pathname).toBe("/drive/v3/files/f1/copy");
    expect(c.body).toEqual({ name: "Copy", parents: ["p2"] });
  });
  it("moves with addParents/removeParents", () => {
    const u = new URL(build("move_file", { file_id: "f1", new_parent_id: "p2", old_parent_id: "p1" }).url);
    expect(u.searchParams.get("addParents")).toBe("p2");
    expect(u.searchParams.get("removeParents")).toBe("p1");
  });
  it("move requires new_parent_id", () => expect(() => build("move_file", { file_id: "f1" })).toThrow(/new_parent_id/));
  it("returns the created file id for runtime idempotency records", async () => {
    const r = await run({ operation: "create_file", params: { name: "n" } }, capture({ ...FILE, id: "new1" }).fetchImpl);
    expect(r.ok && r.items[0]).toMatchObject({ id: "new1" });
  });
  it("sends JSON content-type on writes", () => expect(build("trash_file", { file_id: "f" }).headers["content-type"]).toContain("application/json"));
});

// ---------------------------------------------------------------------------
describe("drive search (official q)", () => {
  it("builds name equality", () => expect(buildDriveQuery({ name: "a" })).toBe("name = 'a' and trashed = false"));
  it("builds name contains", () => expect(buildDriveQuery({ name_contains: "rep" })).toContain("name contains 'rep'"));
  it("builds mimeType", () => expect(buildDriveQuery({ mime_type: "application/pdf" })).toContain("mimeType = 'application/pdf'"));
  it("builds parents", () => expect(buildDriveQuery({ parent_id: "p1" })).toContain("'p1' in parents"));
  it("builds owners", () => expect(buildDriveQuery({ owner: "me@example.com" })).toContain("'me@example.com' in owners"));
  it("builds fullText", () => expect(buildDriveQuery({ full_text: "budget" })).toContain("fullText contains 'budget'"));
  it("builds modifiedTime range", () => {
    const q = buildDriveQuery({ modified_after: "2026-01-01T00:00:00Z", modified_before: "2026-02-01T00:00:00Z" })!;
    expect(q).toContain("modifiedTime > '2026-01-01T00:00:00.000Z'");
    expect(q).toContain("modifiedTime < '2026-02-01T00:00:00.000Z'");
  });
  it("rejects invalid timestamps", () => expect(() => buildDriveQuery({ modified_after: "yesterday" })).toThrow(/RFC 3339/));
  it("filters trashed explicitly", () => expect(buildDriveQuery({ trashed: true })).toBe("trashed = true"));
  it("escapes quotes and backslashes", () => {
    expect(escapeQueryValue("O'Brien\\x")).toBe("O\\'Brien\\\\x");
    expect(buildDriveQuery({ name: "O'Brien" })).toContain("name = 'O\\'Brien'");
  });
  it("wraps a raw query and combines filters", () => expect(buildDriveQuery({ query: "starred = true", mime_type: "text/plain" })).toBe("(starred = true) and mimeType = 'text/plain' and trashed = false"));
  it("search_files requires a filter", () => expect(() => build("search_files")).toThrow(/at least one filter/));
  it("search_files sends q", async () => {
    const { calls, fetchImpl } = capture({ files: [FILE] });
    const r = await run({ operation: "search_files", params: { full_text: "report" } }, fetchImpl);
    expect(urlOf(calls[0]).searchParams.get("q")).toContain("fullText contains 'report'");
    expect(r.ok && r.items).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe("drive folders", () => {
  it("creates a folder with the official folder MIME", () => {
    const c = build("create_folder", { name: "Docs", parent_id: "root" });
    expect(c.body).toEqual({ name: "Docs", mimeType: DRIVE_FOLDER_MIME, parents: ["root"] });
  });
  it("lists folders only", () => expect(new URL(build("list_folders").url).searchParams.get("q")).toContain(`mimeType = '${DRIVE_FOLDER_MIME}'`));
  it("lists folder children", () => expect(new URL(build("list_folder_children", { folder_id: "F1" }).url).searchParams.get("q")).toContain("'F1' in parents"));
  it("children requires folder_id", () => expect(() => build("list_folder_children")).toThrow(/folder_id/));
  it("gets a folder", () => expect(new URL(build("get_folder", { folder_id: "F1" }).url).pathname).toBe("/drive/v3/files/F1"));
  it("renames a folder", () => expect(build("rename_folder", { folder_id: "F1", name: "New" }).body).toEqual({ name: "New" }));
  it("rename requires name", () => expect(() => build("rename_folder", { folder_id: "F1" })).toThrow(/name/));
  it("moves a folder", () => expect(new URL(build("move_folder", { folder_id: "F1", new_parent_id: "P" }).url).searchParams.get("addParents")).toBe("P"));
  it("trashes a folder", () => expect(build("trash_folder", { folder_id: "F1" }).body).toEqual({ trashed: true }));
  it("deletes a folder", () => expect(build("delete_folder", { folder_id: "F1" }).method).toBe("DELETE"));
  it("normalizes folders", () => expect(normalizeDriveFile({ id: "F", mimeType: DRIVE_FOLDER_MIME })).toMatchObject({ is_folder: true, workspace_type: null }));
});

// ---------------------------------------------------------------------------
describe("drive Google Workspace files", () => {
  for (const [kind, mime] of Object.entries(WORKSPACE_MIME)) {
    it(`recognises ${kind} metadata`, () => {
      expect(workspaceKind(mime)).toBe(kind);
      expect(normalizeDriveFile({ id: "x", mimeType: mime })).toMatchObject({ workspace_type: kind, is_folder: false });
    });
  }
  for (const kind of ["document", "spreadsheet", "presentation", "form"])
    it(`creates an empty ${kind} via Drive metadata`, () => {
      expect(build("create_workspace_file", { name: "N", workspace_type: kind }).body).toMatchObject({ mimeType: WORKSPACE_MIME[kind as keyof typeof WORKSPACE_MIME] });
    });
  it("rejects unknown workspace types", () => expect(() => build("create_workspace_file", { name: "N", workspace_type: "video" })).toThrow(/workspace_type/));
  it("plain files are not workspace files", () => expect(workspaceKind("text/plain")).toBeNull());
  it("content editing is documented as unsupported", () => expect(UNSUPPORTED_OPERATIONS["edit_document_content"]).toMatch(/Docs\/Sheets\/Slides/));
});

// ---------------------------------------------------------------------------
describe("drive download / export", () => {
  it("exports a Doc to text/plain", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (u: string | URL | Request) => {
      calls.push(String(u));
      return new Response("Hello doc", { status: 200, headers: { "content-type": "text/plain" } });
    }) as unknown as typeof fetch;
    const r = await run({ operation: "export_file", params: { file_id: "d1", export_mime_type: "text/plain" } }, fetchImpl);
    expect(new URL(calls[0]!).pathname).toBe("/drive/v3/files/d1/export");
    expect(new URL(calls[0]!).searchParams.get("mimeType")).toBe("text/plain");
    expect(r.ok && r.items[0]).toEqual({ content: "Hello doc" });
  });
  it("exports a Sheet to CSV", () => expect(new URL(build("export_file", { file_id: "s1", export_mime_type: "text/csv" }).url).searchParams.get("mimeType")).toBe("text/csv"));
  for (const mime of ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png"])
    it(`rejects binary export ${mime}`, () => expect(() => build("export_file", { file_id: "d", export_mime_type: mime })).toThrow(/UNSUPPORTED_OPERATION/));
  it("only allows text export MIME types", () => expect(TEXT_EXPORT_MIME.every((m) => m.startsWith("text/") || m.includes("svg") || m.includes("json"))).toBe(true));
  it("export uses the readonly scope", () => expect(driveScopeFor("export_file")).toBe(DRIVE_SCOPES.readonly));
  for (const op of ["download_file", "upload_file_content", "resumable_upload", "update_file_content"])
    it(`${op} is UNSUPPORTED`, () => expect(() => build(op)).toThrow(/UNSUPPORTED_OPERATION/));
});

// ---------------------------------------------------------------------------
describe("drive permissions", () => {
  it("lists permissions with pagination fields", async () => {
    const { calls, fetchImpl } = capture({ permissions: [PERM], nextPageToken: "n2" });
    const r = await run({ operation: "list_permissions", params: { file_id: "f1" } }, fetchImpl);
    expect(urlOf(calls[0]).pathname).toBe("/drive/v3/files/f1/permissions");
    expect(urlOf(calls[0]).searchParams.get("pageSize")).toBe("100");
    expect(r.ok && r.items[0]).toMatchObject({ id: "p1", role: "reader", email: "a@example.com" });
    expect(r.ok && r.cursor).toBe("n2");
  });
  it("caps permissions pageSize at 100", () => expect(new URL(build("list_permissions", { file_id: "f", limit: 999 }).url).searchParams.get("pageSize")).toBe("100"));
  it("gets a permission", () => expect(new URL(build("get_permission", { file_id: "f", permission_id: "p" }).url).pathname).toBe("/drive/v3/files/f/permissions/p"));
  it("creates a user permission", () => {
    const c = build("create_permission", { file_id: "f", type: "user", role: "writer", email: "b@example.com", send_notification_email: false });
    expect(c.body).toEqual({ type: "user", role: "writer", emailAddress: "b@example.com" });
    expect(new URL(c.url).searchParams.get("sendNotificationEmail")).toBe("false");
  });
  it("creates a domain permission", () => expect(build("create_permission", { file_id: "f", type: "domain", role: "reader", domain: "x.com" }).body).toMatchObject({ domain: "x.com" }));
  it("creates an anyone permission", () => expect(build("create_permission", { file_id: "f", type: "anyone", role: "reader", allow_file_discovery: false }).body).toMatchObject({ type: "anyone", allowFileDiscovery: false }));
  it("requires email for user permissions", () => expect(() => build("create_permission", { file_id: "f", type: "user", role: "reader" })).toThrow(/email/));
  it("requires domain for domain permissions", () => expect(() => build("create_permission", { file_id: "f", type: "domain", role: "reader" })).toThrow(/domain/));
  it("rejects unknown roles", () => expect(() => build("create_permission", { file_id: "f", type: "anyone", role: "god" })).toThrow(/role/));
  it("rejects unknown types", () => expect(() => build("create_permission", { file_id: "f", type: "world", role: "reader" })).toThrow(/type/));
  it("passes transferOwnership only when asked", () => {
    expect(new URL(build("update_permission", { file_id: "f", permission_id: "p", role: "owner", transfer_ownership: true }).url).searchParams.get("transferOwnership")).toBe("true");
    expect(new URL(build("update_permission", { file_id: "f", permission_id: "p", role: "reader" }).url).searchParams.get("transferOwnership")).toBeNull();
  });
  it("updates a role", () => expect(build("update_permission", { file_id: "f", permission_id: "p", role: "commenter" }).body).toEqual({ role: "commenter" }));
  it("rejects empty permission updates", () => expect(() => build("update_permission", { file_id: "f", permission_id: "p" })).toThrow(/role/));
  it("deletes a permission", () => expect(build("delete_permission", { file_id: "f", permission_id: "p" }).method).toBe("DELETE"));
  it("surfaces sharing policy denial as forbidden without retry", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr(403, "Sharing outside domain is not allowed", "cannotShareTeamDriveWithNonGoogleAccounts"), { status: 403 }));
    const r = await run({ operation: "create_permission", params: { file_id: "f", type: "anyone", role: "reader" } }, fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("forbidden");
    expect(count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("drive shared drives", () => {
  it("lists shared drives", async () => {
    const { calls, fetchImpl } = capture({ drives: [{ id: "D1", name: "Team" }], nextPageToken: "x" });
    const r = await run({ operation: "list_shared_drives" }, fetchImpl);
    expect(urlOf(calls[0]).pathname).toBe("/drive/v3/drives");
    expect(r.ok && r.items[0]).toMatchObject({ id: "D1", name: "Team", location: "shared_drive" });
  });
  it("caps drives pageSize at 100", () => expect(new URL(build("list_shared_drives", { limit: 500 }).url).searchParams.get("pageSize")).toBe("100"));
  it("gets a shared drive", () => expect(new URL(build("get_shared_drive", { drive_id: "D1" }).url).pathname).toBe("/drive/v3/drives/D1"));
  it("lists files inside one shared drive", () => {
    const u = new URL(build("list_files", { drive_id: "D1" }).url);
    expect(u.searchParams.get("corpora")).toBe("drive");
    expect(u.searchParams.get("driveId")).toBe("D1");
    expect(u.searchParams.get("includeItemsFromAllDrives")).toBe("true");
  });
  it("lists across all drives on request", () => expect(new URL(build("list_files", { corpora: "allDrives" }).url).searchParams.get("corpora")).toBe("allDrives"));
  it("distinguishes My Drive from shared drive files", () => {
    expect(normalizeDriveFile({ id: "a" })["location"]).toBe("my_drive");
    expect(normalizeDriveFile({ id: "b", driveId: "D1" })["location"]).toBe("shared_drive");
  });
  it("creates files inside a shared drive folder with supportsAllDrives", () => expect(new URL(build("create_file", { name: "n", parent_id: "D1" }).url).searchParams.get("supportsAllDrives")).toBe("true"));
  it("domain admin access is unsupported", () => expect(UNSUPPORTED_OPERATIONS["shared_drive_admin_access"]).toBeDefined());
});

// ---------------------------------------------------------------------------
describe("drive changes / incremental sync", () => {
  it("gets the start page token", async () => {
    const r = await run({ operation: "get_start_page_token" }, capture({ startPageToken: "100" }).fetchImpl);
    expect(r.ok && r.items[0]).toEqual({ start_page_token: "100" });
  });
  it("scopes the start token to a shared drive", () => expect(new URL(build("get_start_page_token", { drive_id: "D1" }).url).searchParams.get("driveId")).toBe("D1"));
  it("fails on a missing startPageToken", async () => {
    const r = await run({ operation: "get_start_page_token" }, capture({}).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("malformed_response");
  });
  it("lists changes from the saved page token", () => expect(new URL(build("list_changes", { page_token: "100" }).url).searchParams.get("pageToken")).toBe("100"));
  it("requires page_token", () => expect(() => build("list_changes")).toThrow(/page_token/));
  it("follows nextPageToken over the saved token", () => expect(new URL(build("list_changes", { page_token: "100" }, "200").url).searchParams.get("pageToken")).toBe("200"));
  it("normalizes changes and emits the newStartPageToken", async () => {
    const r = await run(
      { operation: "list_changes", params: { page_token: "100" } },
      capture({ changes: [{ changeType: "file", fileId: "f1", removed: false, time: "t", file: FILE }, { changeType: "file", fileId: "f2", removed: true }], newStartPageToken: "150" }).fetchImpl,
    );
    expect(r.ok && r.items).toHaveLength(3);
    expect(r.ok && r.items[0]).toMatchObject({ file_id: "f1", removed: false, file: { id: "f1" } });
    expect(r.ok && r.items[1]).toMatchObject({ file_id: "f2", removed: true, file: null });
    expect(r.ok && r.items[2]).toEqual({ type: "sync_state", new_start_page_token: "150" });
  });
  it("follows multiple change pages and keeps incremental state", async () => {
    const { fetchImpl, calls } = sequence(
      () => jsonResponse({ changes: [{ fileId: "a" }], nextPageToken: "p2" }),
      () => jsonResponse({ changes: [{ fileId: "b" }], newStartPageToken: "999" }),
    );
    const r = await run({ operation: "list_changes", params: { page_token: "1" }, maxPages: 5 }, fetchImpl);
    expect(calls).toHaveLength(2);
    expect(new URL(calls[1]!).searchParams.get("pageToken")).toBe("p2");
    expect(r.ok && r.items.at(-1)).toEqual({ type: "sync_state", new_start_page_token: "999" });
  });
  it("can exclude removed items", () => expect(new URL(build("list_changes", { page_token: "1", include_removed: false }).url).searchParams.get("includeRemoved")).toBe("false"));
});

// ---------------------------------------------------------------------------
describe("drive watch / push notifications", () => {
  it("watches changes with an official web_hook channel", () => {
    const c = build("watch_changes", { page_token: "5", channel_id: "chan-1", address: "https://app.test/api/public/webhooks/abc", channel_token: CHANNEL_TOKEN, expiration_ms: NOW + 3600_000 });
    expect(new URL(c.url).pathname).toBe("/drive/v3/changes/watch");
    expect(new URL(c.url).searchParams.get("pageToken")).toBe("5");
    expect(c.body).toEqual({ id: "chan-1", type: "web_hook", address: "https://app.test/api/public/webhooks/abc", token: CHANNEL_TOKEN, expiration: String(NOW + 3600_000) });
  });
  it("requires an HTTPS address", () => expect(() => build("watch_changes", { page_token: "5", channel_id: "c", address: "http://x" })).toThrow(/HTTPS/));
  it("watches a single file", () => expect(new URL(build("watch_file", { file_id: "f1", channel_id: "c", address: "https://x" }).url).pathname).toBe("/drive/v3/files/f1/watch"));
  it("normalizes the channel (id, resourceId, expiration)", async () => {
    const r = await run(
      { operation: "watch_changes", params: { page_token: "5", channel_id: "chan-1", address: "https://x" } },
      capture({ kind: "api#channel", id: "chan-1", resourceId: "res-1", resourceUri: "u", expiration: String(NOW + 1000) }).fetchImpl,
    );
    expect(r.ok && r.items[0]).toMatchObject({ channel_id: "chan-1", resource_id: "res-1", expiration_ms: NOW + 1000, expiration: new Date(NOW + 1000).toISOString() });
  });
  it("stops a channel", () => expect(build("stop_channel", { channel_id: "c", resource_id: "r" }).body).toEqual({ id: "c", resourceId: "r" }));
  it("stop requires resource_id", () => expect(() => build("stop_channel", { channel_id: "c" })).toThrow(/resource_id/));
  it("parses official X-Goog headers", () => {
    expect(parseDrivePushHeaders(push())).toMatchObject({ channelId: "chan-1", resourceId: "res-1", resourceState: "change", messageNumber: "42" });
  });
  it("parses headers case-insensitively", () => expect(parseDrivePushHeaders({ "X-Goog-Channel-ID": "C" }).channelId).toBe("C"));
  it("accepts a valid notification", () => {
    const v = verifyPush(push());
    expect(v.ok).toBe(true);
    expect(v.eventId).toBe("drive:chan-1:42");
    expect(v.eventType).toBe("drive.change");
  });
  it("accepts the initial sync message", () => expect(verifyPush(push({ "x-goog-resource-state": "sync", "x-goog-message-number": "1" })).ok).toBe(true));
  for (const state of ["add", "remove", "update", "trash", "untrash"])
    it(`accepts file resource state ${state}`, () => expect(verifyPush(push({ "x-goog-resource-state": state })).eventType).toBe(`drive.${state}`));
  it("rejects a wrong channel token", () => expect(verifyPush(push({ "x-goog-channel-token": "nope" })).reason).toBe("invalid_signature"));
  it("rejects a missing channel token", () => expect(verifyPush(push({ "x-goog-channel-token": null })).reason).toBe("invalid_signature"));
  it("rejects when no secret is configured", () => expect(verifyPush(push(), { secret: null }).reason).toBe("missing_secret"));
  it("rejects missing official headers", () => expect(verifyPush(push({ "x-goog-message-number": null })).reason).toBe("malformed_payload"));
  it("rejects unknown resource states", () => expect(verifyPush(push({ "x-goog-resource-state": "explode" })).reason).toBe("unsupported_event"));
  it("rejects notifications for an expired channel (replay)", () =>
    expect(verifyPush(push({ "x-goog-channel-expiration": new Date(NOW - 3600_000).toUTCString() })).reason).toBe("replay"));
  it("dedupes on channel id + message number", () => {
    expect(verifyPush(push()).eventId).toBe(verifyPush(push()).eventId);
    expect(verifyPush(push({ "x-goog-message-number": "43" })).eventId).not.toBe(verifyPush(push()).eventId);
  });
  it("different channels never collide", () => expect(verifyPush(push({ "x-goog-channel-id": "chan-2" })).eventId).toBe("drive:chan-2:42"));
  it("never echoes the channel token", () => expect(JSON.stringify(verifyPush(push({ "x-goog-channel-token": "nope" })))).not.toContain(CHANNEL_TOKEN));
  it("documents that pushes carry no file data", () => expect(UNSUPPORTED_OPERATIONS["push_payload_contains_file"]).toMatch(/empty body/));
});

// ---------------------------------------------------------------------------
describe("drive pagination", () => {
  it("passes nextPageToken as pageToken", () => expect(new URL(build("list_files", {}, "tok2").url).searchParams.get("pageToken")).toBe("tok2"));
  it("returns a null cursor on the last page", async () => {
    const r = await run({ operation: "list_files" }, capture({ files: [] }).fetchImpl);
    expect(r.ok && r.cursor).toBeNull();
  });
  it("follows pages up to maxPages", async () => {
    const { fetchImpl, calls } = sequence(
      () => jsonResponse({ files: [FILE], nextPageToken: "a" }),
      () => jsonResponse({ files: [FILE], nextPageToken: "b" }),
      () => jsonResponse({ files: [FILE] }),
    );
    const r = await run({ operation: "list_files", maxPages: 2 }, fetchImpl);
    expect(calls).toHaveLength(2);
    expect(r.ok && r.cursor).toBe("b");
  });
  it("clamps pageSize to 1..1000", () => {
    expect(new URL(build("list_files", { limit: 5000 }).url).searchParams.get("pageSize")).toBe("1000");
    expect(new URL(build("list_files", { limit: 0 }).url).searchParams.get("pageSize")).toBe("100");
  });
  it("rejects a non-list collection", async () => {
    const r = await run({ operation: "list_files" }, capture({ files: "x" }).fetchImpl);
    if (!r.ok) expect(r.error.kind).toBe("malformed_response");
  });
});

// ---------------------------------------------------------------------------
describe("drive rate limits / retry / errors", () => {
  it("retries 429 and succeeds", async () => {
    const { fetchImpl, count } = sequence(
      () => jsonResponse(gErr(429, "Too many", undefined, "RESOURCE_EXHAUSTED"), { status: 429, headers: { "retry-after": "2" } }),
      () => jsonResponse({ files: [] }),
    );
    const r = await run({ operation: "list_files" }, fetchImpl);
    expect(r.ok).toBe(true);
    expect(count()).toBe(2);
  });
  for (const reason of ["rateLimitExceeded", "userRateLimitExceeded", "sharingRateLimitExceeded"])
    it(`maps 403 ${reason} to a retryable rate_limit`, () => {
      expect(googleDriveConnector.mapError?.(403, gErr(403, "slow", reason))).toMatchObject({ kind: "rate_limit", retryable: true });
    });
  it("retries 403 rateLimitExceeded", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr(403, "slow", "userRateLimitExceeded"), { status: 403 }), () => jsonResponse({ files: [] }));
    expect((await run({ operation: "list_files" }, fetchImpl)).ok).toBe(true);
    expect(count()).toBe(2);
  });
  it("reads Retry-After seconds", () => expect(googleDriveConnector.readRateLimit?.(new Headers({ "retry-after": "3" }), null)).toEqual({ retryAfterMs: 3000, remaining: 0 }));
  it("reads Retry-After dates", () => {
    const info = googleDriveConnector.readRateLimit?.(new Headers({ "retry-after": new Date(Date.now() + 10_000).toUTCString() }), null);
    expect(info?.retryAfterMs).toBeGreaterThan(0);
  });
  it("returns undefined without Retry-After", () => expect(googleDriveConnector.readRateLimit?.(new Headers(), null)).toBeUndefined());
  it("gives up after max attempts on persistent 429", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr(429, "slow"), { status: 429 }));
    const r = await run({ operation: "list_files" }, fetchImpl, creds, { maxAttempts: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("rate_limit");
    expect(count()).toBe(3);
  });
  it("retries 5xx", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr(503, "down"), { status: 503 }), () => jsonResponse({ files: [] }));
    expect((await run({ operation: "list_files" }, fetchImpl)).ok).toBe(true);
    expect(count()).toBe(2);
  });
  it("retries network failures", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => {
      if (n++ === 0) throw new Error("ECONNRESET");
      return jsonResponse({ files: [] });
    }) as unknown as typeof fetch;
    expect((await run({ operation: "list_files" }, fetchImpl)).ok).toBe(true);
  });
  it("maps 401 to auth", () => expect(googleDriveConnector.mapError?.(401, gErr(401, "x"))).toMatchObject({ kind: "auth", retryable: false }));
  it("maps insufficientPermissions to forbidden", () => expect(googleDriveConnector.mapError?.(403, gErr(403, "x", "insufficientPermissions"))?.message).toMatch(/scope/));
  it("maps insufficientFilePermissions to forbidden", () => expect(googleDriveConnector.mapError?.(403, gErr(403, "x", "insufficientFilePermissions"))?.kind).toBe("forbidden"));
  it("maps 404 to not_found", () => expect(googleDriveConnector.mapError?.(404, gErr(404, "File not found"))?.kind).toBe("not_found"));
  it("maps 400 to invalid_request", () => expect(googleDriveConnector.mapError?.(400, gErr(400, "Invalid Value"))?.kind).toBe("invalid_request"));
  it("maps 500 to retryable provider", () => expect(googleDriveConnector.mapError?.(500, {})).toMatchObject({ kind: "provider", retryable: true }));
  it("ignores 2xx", () => expect(googleDriveConnector.mapError?.(200, gErr(200, "x"))).toBeNull());
  it("does not retry 404", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr(404, "nf"), { status: 404 }));
    await run({ operation: "get_file", params: { file_id: "x" } }, fetchImpl);
    expect(count()).toBe(1);
  });
  it("unknown operations fail as unsupported", () => expect(() => build("hack_drive")).toThrow(/Unknown Google Drive operation/));
  it("normalize rejects unknown operations", () => expect(() => googleDriveConnector.normalize("nope", {}, 200)).toThrow());
  it("rejects non-JSON bodies for JSON operations", () => expect(() => googleDriveConnector.normalize("get_file", "oops", 200)).toThrow(/non-JSON/));
});

// ---------------------------------------------------------------------------
describe("drive idempotency", () => {
  it("sends no invented idempotency header or field", async () => {
    const { calls, fetchImpl } = capture(FILE);
    await run({ operation: "create_file", params: { name: "n", idempotency_key: "k1" } }, fetchImpl);
    const headers = Object.keys((calls[0]!.init.headers ?? {}) as Record<string, string>).map((h) => h.toLowerCase());
    expect(headers.some((h) => h.includes("idempot"))).toBe(false);
    expect(JSON.stringify(body(calls[0]))).not.toContain("k1");
  });
  it("documents that Drive has no idempotency header", () => expect(UNSUPPORTED_OPERATIONS["idempotency_key"]).toMatch(/no idempotency/));
  it("does not retry non-retryable write failures (no duplicate files)", async () => {
    const { fetchImpl, count } = sequence(() => jsonResponse(gErr(400, "bad"), { status: 400 }));
    await run({ operation: "create_file", params: { name: "n" } }, fetchImpl);
    expect(count()).toBe(1);
  });
  it("uses the caller-provided channel id (official channel idempotency)", () => expect(build("watch_file", { file_id: "f", channel_id: "fixed-id", address: "https://x" }).body).toMatchObject({ id: "fixed-id" }));
  it("unsupported operations fail as unsupported without network", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await run({ operation: "download_file" }, fetchImpl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("unsupported");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe("drive workspace isolation / credential isolation / RBAC", () => {
  it("each run uses only its own account token", async () => {
    const a = capture({ files: [] });
    const b = capture({ files: [] });
    await run({ operation: "list_files" }, a.fetchImpl, { access_token: TOKEN });
    await run({ operation: "list_files" }, b.fetchImpl, { access_token: TOKEN_B });
    expect(headerOf(a.calls[0], "authorization")).toBe(`Bearer ${TOKEN}`);
    expect(headerOf(b.calls[0], "authorization")).toBe(`Bearer ${TOKEN_B}`);
  });
  it("OAuth accounts are scoped to the initiating workspace", async () => {
    const spec = getOAuthProvider("google_drive_api")!;
    const { store } = memoryStore();
    const s1 = await beginAuthorization({ store, spec, clientId: "c", pending: pending("ws1"), nowMs: NOW });
    const s2 = await beginAuthorization({ store, spec, clientId: "c", pending: pending("ws2"), nowMs: NOW });
    const fetchImpl = capture({ access_token: TOKEN, id_token: jwt({ sub: "1", email: "me@example.com" }) }).fetchImpl;
    const a1 = await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: s1.state, code: "x", fetchImpl, nowMs: NOW });
    const a2 = await completeAuthorization({ store, spec, client: { clientId: "c", clientSecret: "s" }, state: s2.state, code: "x", fetchImpl, nowMs: NOW });
    expect(a1.account.id).not.toBe(a2.account.id);
    expect(await store.getAccount("ws2", a1.account.id)).toBeNull();
  });
  it("two Google accounts in one workspace stay separate", async () => {
    const spec = getOAuthProvider("google_drive_api")!;
    const { store } = memoryStore();
    const ids: string[] = [];
    for (const sub of ["A", "B"]) {
      const { state } = await beginAuthorization({ store, spec, clientId: "c", pending: pending("ws1"), nowMs: NOW });
      const { account } = await completeAuthorization({
        store, spec, client: { clientId: "c", clientSecret: "s" }, state, code: "x", fetchImpl: capture({ access_token: TOKEN, id_token: jwt({ sub }) }).fetchImpl, nowMs: NOW,
      });
      ids.push(account.id);
    }
    expect(ids[0]).not.toBe(ids[1]);
  });
  function rbacClient(role: string | null) {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: role ? { role } : null, error: null }) };
    return { from: () => chain } as unknown as Parameters<typeof assertCanExecute>[0];
  }
  for (const role of ["owner", "admin", "member"])
    it(`RBAC allows ${role}`, async () => expect(assertCanExecute(rbacClient(role), "ws1", "u1")).resolves.toBe(role));
  for (const role of ["viewer", null])
    it(`RBAC blocks ${role ?? "non-members"}`, async () => expect(assertCanExecute(rbacClient(role), "ws1", "u1")).rejects.toThrow(/permission/));
});

// ---------------------------------------------------------------------------
describe("drive secret redaction / trace ids", () => {
  it("never returns the token in results", async () => expect(JSON.stringify(await run({ operation: "list_files" }, capture({ files: [] }).fetchImpl))).not.toContain(TOKEN));
  it("scrubs the token from provider errors", async () =>
    expect(JSON.stringify(await run({ operation: "list_files" }, capture(gErr(400, `bad ${TOKEN}`), { status: 400 }).fetchImpl))).not.toContain(TOKEN));
  it("scrubs the token from network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`socket closed ${TOKEN}`);
    }) as unknown as typeof fetch;
    expect(JSON.stringify(await run({ operation: "list_files" }, fetchImpl, creds, { maxAttempts: 1 }))).not.toContain(TOKEN);
  });
  it("redacts token-like keys", () => {
    const out = JSON.stringify(redact({ access_token: TOKEN, refresh_token: REFRESH }));
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain(REFRESH);
  });
  it("does not emit the token in runtime events and keeps the trace id", async () => {
    const events: unknown[] = [];
    const { fetchImpl } = sequence(() => jsonResponse(gErr(429, "slow"), { status: 429 }), () => jsonResponse({ files: [] }));
    await run({ operation: "list_files" }, fetchImpl, creds, { onEvent: (e) => events.push(e) });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain(TOKEN);
    expect(events.every((e) => (e as { traceId: string }).traceId === trace)).toBe(true);
  });
  it("carries the trace id on success and failure", async () => {
    expect((await run({ operation: "list_files" }, capture({ files: [] }).fetchImpl)).traceId).toBe(trace);
    expect((await run({ operation: "get_file", params: { file_id: "x" } }, capture(gErr(404, "nf"), { status: 404 }).fetchImpl)).traceId).toBe(trace);
  });
});
