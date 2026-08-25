import { createHash, randomBytes, randomUUID } from "node:crypto";

import { redactString } from "@/lib/connectors/errors";
import {
  OAuthError,
  type ConnectionAccount,
  type OAuthClientCredentials,
  type OAuthProviderSpec,
  type OAuthStore,
  type OAuthTokenSet,
  type PendingAuthorization,
} from "@/lib/oauth/types";

/**
 * Provider-agnostic OAuth engine.
 *
 * Runs on the server only and is fully injectable (`store`, `fetchImpl`) so the
 * whole flow — authorize, callback, refresh, revoke — is testable without a
 * network or a database.
 */

const STATE_TTL_MS = 10 * 60 * 1000;
const REFRESH_LOCK_TTL_MS = 30_000;
/** Refresh a little before real expiry so in-flight calls never race it. */
const REFRESH_SKEW_MS = 60_000;
/** After this many consecutive failures we stop and ask for reauthorization. */
const MAX_REFRESH_FAILURES = 3;

export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** Builds the provider consent URL and persists the single-use state. */
export async function beginAuthorization(input: {
  store: OAuthStore;
  spec: OAuthProviderSpec;
  clientId: string;
  pending: Omit<PendingAuthorization, "codeVerifier" | "scopes"> & { scopes?: string[] };
  nowMs?: number;
}): Promise<{ authorizationUrl: string; state: string; expiresAt: string }> {
  const { store, spec, pending } = input;
  const nowMs = input.nowMs ?? Date.now();
  const state = base64url(randomBytes(32));
  const scopes = pending.scopes?.length ? pending.scopes : spec.scopes;
  const codeVerifier = spec.usePkce ? base64url(randomBytes(48)) : null;
  const expiresAt = new Date(nowMs + STATE_TTL_MS).toISOString();

  await store.saveState({
    ...pending,
    scopes,
    codeVerifier,
    stateHash: hashState(state),
    expiresAt,
  });

  const url = new URL(spec.authorizationUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", pending.redirectUri);
  // `state` is the CSRF binding: only a callback carrying this exact value can
  // consume the stored authorization.
  url.searchParams.set("state", state);
  if (scopes.length) url.searchParams.set("scope", scopes.join(spec.scopeSeparator ?? " "));
  if (codeVerifier) {
    url.searchParams.set("code_challenge", base64url(createHash("sha256").update(codeVerifier).digest()));
    url.searchParams.set("code_challenge_method", "S256");
  }
  for (const [key, value] of Object.entries(spec.authorizationParams ?? {})) url.searchParams.set(key, value);

  return { authorizationUrl: url.toString(), state, expiresAt };
}

function parseTokenResponse(spec: OAuthProviderSpec, payload: Record<string, unknown>, nowMs: number): OAuthTokenSet {
  const accessToken =
    typeof payload["access_token"] === "string"
      ? (payload["access_token"] as string)
      : typeof (payload["authed_user"] as { access_token?: string } | undefined)?.access_token === "string"
        ? ((payload["authed_user"] as { access_token: string }).access_token)
        : "";
  if (!accessToken) throw new OAuthError("token_exchange_failed", "Provider response did not contain an access token");

  const expiresIn = Number(payload["expires_in"] ?? spec.defaultExpiresInSeconds ?? 0);
  const scopeRaw = payload["scope"];
  const scopes =
    typeof scopeRaw === "string" && scopeRaw.trim()
      ? scopeRaw.split(/[\s,]+/).filter(Boolean)
      : Array.isArray(scopeRaw)
        ? (scopeRaw as string[])
        : spec.scopes;

  return {
    accessToken,
    refreshToken: typeof payload["refresh_token"] === "string" ? (payload["refresh_token"] as string) : undefined,
    tokenType: typeof payload["token_type"] === "string" ? (payload["token_type"] as string) : "Bearer",
    scopes,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(nowMs + expiresIn * 1000).toISOString() : null,
    ...(spec.credentialFields ? { extra: spec.credentialFields(payload) } : {}),
    raw: payload,
  };
}

async function postToken(input: {
  spec: OAuthProviderSpec;
  client: OAuthClientCredentials;
  body: Record<string, string>;
  fetchImpl: typeof fetch;
  kind: "token_exchange_failed" | "refresh_failed";
  nowMs: number;
}): Promise<OAuthTokenSet> {
  const { spec, client, body, fetchImpl } = input;
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  const form = new URLSearchParams(body);
  if (spec.clientAuth === "basic") {
    headers["authorization"] = `Basic ${Buffer.from(`${client.clientId}:${client.clientSecret}`).toString("base64")}`;
  } else {
    form.set("client_id", client.clientId);
    form.set("client_secret", client.clientSecret);
  }

  let response: Response;
  try {
    response = await fetchImpl(spec.tokenUrl, { method: "POST", headers, body: form.toString() });
  } catch (error) {
    throw new OAuthError(input.kind, `Could not reach the provider: ${redactString(String(error))}`, true);
  }

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new OAuthError(input.kind, "Provider returned a malformed token response");
  }

  if (!response.ok || payload["error"] || payload["ok"] === false) {
    const detail = String(payload["error_description"] ?? payload["error"] ?? response.status);
    // The message may echo provider text, so it is redacted before it can be
    // stored on the account or written to a log.
    throw new OAuthError(input.kind, redactString(`Provider rejected the request: ${detail}`), response.status >= 500);
  }
  return parseTokenResponse(spec, payload, input.nowMs);
}

/** Validates the callback state and exchanges the code for tokens. */
export async function completeAuthorization(input: {
  store: OAuthStore;
  spec: OAuthProviderSpec;
  client: OAuthClientCredentials;
  state: string;
  code: string;
  fetchImpl?: typeof fetch;
  nowMs?: number;
}): Promise<{ account: ConnectionAccount; pending: PendingAuthorization }> {
  const nowMs = input.nowMs ?? Date.now();
  if (!input.state) throw new OAuthError("invalid_state", "Missing state parameter");

  const pending = await input.store.consumeState(hashState(input.state), nowMs);
  // One stored state, consumed atomically: an unknown, expired or already-used
  // state is indistinguishable to the caller and never reaches token exchange.
  if (!pending) throw new OAuthError("invalid_state", "This authorization link is no longer valid");
  if (!input.code) throw new OAuthError("provider_denied", "Provider did not return an authorization code");

  const tokens = await postToken({
    spec: input.spec,
    client: input.client,
    fetchImpl: input.fetchImpl ?? fetch,
    kind: "token_exchange_failed",
    nowMs,
    body: {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: pending.redirectUri,
      ...(pending.codeVerifier ? { code_verifier: pending.codeVerifier } : {}),
    },
  });

  const identity = input.spec.identify?.(tokens.raw ?? {}) ?? {};
  const account = await input.store.upsertAccount({
    workspaceId: pending.workspaceId,
    integrationId: pending.integrationId,
    provider: pending.provider,
    connector: pending.connector,
    // Multiple accounts of the same provider coexist because the identifier is
    // part of the account key.
    accountIdentifier: identity.accountIdentifier ?? `${pending.provider}:${randomUUID().slice(0, 8)}`,
    accountLabel: identity.accountLabel ?? null,
    status: "connected",
    credentialRef: null,
    scopes: tokens.scopes,
    expiresAt: tokens.expiresAt,
    lastVerifiedAt: new Date(nowMs).toISOString(),
    lastError: null,
    tokens,
  });

  return { account, pending };
}

export function isExpired(account: Pick<ConnectionAccount, "expiresAt">, nowMs: number): boolean {
  if (!account.expiresAt) return false;
  return new Date(account.expiresAt).getTime() - REFRESH_SKEW_MS <= nowMs;
}

/** Statuses that must never trigger another automatic provider call. */
const TERMINAL: ReadonlySet<ConnectionAccount["status"]> = new Set(["revoked", "disconnected", "reauth_required"]);

/**
 * Returns a usable access token, refreshing when needed.
 *
 * Concurrency: the refresh is guarded by a store lock, so two workflows hitting
 * an expired account produce exactly one refresh call; the loser waits and then
 * reads the token the winner wrote.
 */
export async function ensureAccessToken(input: {
  store: OAuthStore;
  spec: OAuthProviderSpec;
  client: OAuthClientCredentials;
  account: ConnectionAccount;
  fetchImpl?: typeof fetch;
  nowMs?: number;
  lockOwner?: string;
  waitMs?: number;
}): Promise<{ token: string; account: ConnectionAccount; refreshed: boolean }> {
  const nowMs = input.nowMs ?? Date.now();
  const { store, account } = input;

  if (TERMINAL.has(account.status))
    throw new OAuthError(
      account.status === "revoked" ? "revoked" : "refresh_failed",
      `Connection "${account.accountIdentifier}" needs to be reconnected`,
    );

  const tokens = await store.readTokens(account.id);
  if (!tokens) throw new OAuthError("not_found", "No stored credentials for this connection");
  if (!isExpired(account, nowMs)) return { token: tokens.accessToken, account, refreshed: false };

  if (!tokens.refreshToken || input.spec.refreshable === false) {
    await store.updateAccount(account.id, { status: "reauth_required", lastError: "Access token expired" });
    throw new OAuthError("refresh_failed", "This connection expired and must be reconnected");
  }

  const owner = input.lockOwner ?? randomUUID();
  const locked = await store.acquireRefreshLock(account.id, owner, REFRESH_LOCK_TTL_MS);
  if (!locked) {
    // Another refresh is in flight for this exact account: reuse its result.
    const fresh = await store.readTokens(account.id);
    if (fresh && fresh.accessToken !== tokens.accessToken)
      return { token: fresh.accessToken, account, refreshed: false };
    throw new OAuthError("refresh_failed", "A refresh is already running for this connection", true);
  }

  try {
    const next = await postToken({
      spec: input.spec,
      client: input.client,
      fetchImpl: input.fetchImpl ?? fetch,
      kind: "refresh_failed",
      nowMs,
      body: { grant_type: "refresh_token", refresh_token: tokens.refreshToken },
    });
    // Providers commonly omit the refresh token on rotation — keep the old one.
    const mergedExtra = { ...(tokens.extra ?? {}), ...(next.extra ?? {}) };
    const merged: OAuthTokenSet = {
      ...next,
      refreshToken: next.refreshToken ?? tokens.refreshToken,
      ...(Object.keys(mergedExtra).length ? { extra: mergedExtra } : {}),
    };
    await store.writeTokens(account.id, merged);
    await store.updateAccount(account.id, {
      status: "connected",
      expiresAt: merged.expiresAt,
      scopes: merged.scopes,
      lastVerifiedAt: new Date(nowMs).toISOString(),
      lastError: null,
      refreshFailures: 0,
    });
    return {
      token: merged.accessToken,
      account: { ...account, status: "connected", expiresAt: merged.expiresAt, refreshFailures: 0 },
      refreshed: true,
    };
  } catch (error) {
    const failures = account.refreshFailures + 1;
    const message = error instanceof OAuthError ? error.message : redactString(String(error));
    const retryable = error instanceof OAuthError ? error.retryable : false;
    // No infinite retry loop: a non-retryable failure, or too many in a row,
    // parks the account in `reauth_required` until a human reconnects.
    const status: ConnectionAccount["status"] = !retryable || failures >= MAX_REFRESH_FAILURES ? "reauth_required" : "expired";
    await store.updateAccount(account.id, { status, lastError: message, refreshFailures: failures });
    throw error instanceof OAuthError ? error : new OAuthError("refresh_failed", message);
  } finally {
    await store.releaseRefreshLock(account.id, owner);
  }
}

/** Revokes at the provider when supported, then always disconnects locally. */
export async function disconnectAccount(input: {
  store: OAuthStore;
  spec: OAuthProviderSpec | undefined;
  client?: OAuthClientCredentials;
  account: ConnectionAccount;
  fetchImpl?: typeof fetch;
}): Promise<{ revokedAtProvider: boolean }> {
  const { store, spec, account } = input;
  let revokedAtProvider = false;
  const tokens = await store.readTokens(account.id).catch(() => null);

  if (spec?.revokeUrl && tokens) {
    const fetchImpl = input.fetchImpl ?? fetch;
    try {
      const body = new URLSearchParams({ token: tokens.refreshToken ?? tokens.accessToken });
      if (input.client) {
        body.set("client_id", input.client.clientId);
        body.set("client_secret", input.client.clientSecret);
      }
      const res = await fetchImpl(spec.revokeUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      revokedAtProvider = res.ok;
    } catch {
      // A provider that refuses revocation must not block local disconnection.
      revokedAtProvider = false;
    }
  }

  await store.writeTokens(account.id, { accessToken: "", scopes: [], expiresAt: null });
  await store.updateAccount(account.id, {
    status: "disconnected",
    expiresAt: null,
    lastError: null,
    refreshFailures: 0,
  });
  return { revokedAtProvider };
}

/** Marks a connection the provider rejected (401/invalid_grant at call time). */
export async function markConnectionRevoked(store: OAuthStore, account: ConnectionAccount, reason: string) {
  await store.updateAccount(account.id, { status: "revoked", lastError: redactString(reason) });
}

export const oauthInternals = { STATE_TTL_MS, REFRESH_LOCK_TTL_MS, REFRESH_SKEW_MS, MAX_REFRESH_FAILURES };
