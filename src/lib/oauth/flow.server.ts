import { randomUUID } from "node:crypto";

import { redactString } from "@/lib/connectors/errors";
import { createSupabaseOAuthStore, loadClientCredentials } from "@/lib/oauth/accounts.server";
import { beginAuthorization, completeAuthorization, disconnectAccount, hashState } from "@/lib/oauth/core";
import { getOAuthProvider } from "@/lib/oauth/providers";
import { OAuthError, type ConnectionStatus } from "@/lib/oauth/types";

/**
 * Server orchestration for the unified OAuth flow.
 * Everything the browser ever receives from here is a provider URL or a status
 * string — never a token, a client secret or a code verifier.
 */

export function callbackUrl(origin: string, connector: string) {
  return new URL(`/api/public/oauth/callback/${connector}`, origin).toString();
}

/** Step 1 — authorize. Returns the provider consent URL for the caller to open. */
export async function startAuthorization(input: {
  workspaceId: string;
  connector: string;
  provider?: string;
  integrationId?: string | null;
  scopes?: string[];
  origin: string;
  userId: string;
}) {
  const spec = getOAuthProvider(input.connector);
  if (!spec) throw new OAuthError("unsupported", `"${input.connector}" does not support OAuth yet`);
  const provider = input.provider ?? input.connector;
  const client = await loadClientCredentials(input.workspaceId, provider, input.integrationId ?? null);

  const { authorizationUrl, expiresAt } = await beginAuthorization({
    store: createSupabaseOAuthStore(),
    spec,
    clientId: client.clientId,
    pending: {
      workspaceId: input.workspaceId,
      integrationId: input.integrationId ?? null,
      provider,
      connector: spec.connector,
      redirectUri: callbackUrl(input.origin, spec.connector),
      createdBy: input.userId,
      ...(input.scopes?.length ? { scopes: input.scopes } : {}),
    },
  });
  return { authorizationUrl, expiresAt };
}

export type CallbackOutcome = {
  ok: boolean;
  status: ConnectionStatus | "failed";
  accountId?: string;
  provider?: string;
  message: string;
};

/** Step 2 — callback. Validates state, exchanges the code, stores the account. */
export async function handleOAuthCallback(input: {
  connector: string;
  state: string | null;
  code: string | null;
  error: string | null;
}): Promise<CallbackOutcome> {
  const spec = getOAuthProvider(input.connector);
  if (!spec) return { ok: false, status: "failed", message: "Unknown connector" };
  if (input.error)
    return { ok: false, status: "failed", message: redactString(`Authorization was declined: ${input.error}`) };
  if (!input.state) return { ok: false, status: "failed", message: "This authorization link is no longer valid" };

  const store = createSupabaseOAuthStore();
  // Resolve the tenant from the stored state, never from the query string.
  const pending = await store.peekState?.(hashState(input.state), Date.now());
  if (!pending) return { ok: false, status: "failed", message: "This authorization link is no longer valid" };

  try {
    const client = await loadClientCredentials(pending.workspaceId, pending.provider, pending.integrationId);
    const { account } = await completeAuthorization({
      store,
      spec,
      client,
      state: input.state,
      code: input.code ?? "",
    });
    return {
      ok: true,
      status: "connected",
      accountId: account.id,
      provider: account.provider,
      message: `${spec.label} connected`,
    };
  } catch (error) {
    const message = error instanceof OAuthError ? error.message : redactString(String(error));
    return { ok: false, status: "failed", message };
  }
}

/** Step 3 — disconnect. Revokes at the provider when it supports revocation. */
export async function disconnectConnection(workspaceId: string, accountId: string) {
  const store = createSupabaseOAuthStore();
  const account = await store.getAccount(workspaceId, accountId);
  if (!account) throw new OAuthError("not_found", "Connection account not found in this workspace");
  const spec = getOAuthProvider(account.connector);
  const client = await loadClientCredentials(workspaceId, account.provider, account.integrationId).catch(() => undefined);
  return disconnectAccount({ store, spec, ...(client ? { client } : {}), account });
}

/** Forces a refresh and reports the resulting connection status. */
export async function verifyConnection(workspaceId: string, accountId: string) {
  const store = createSupabaseOAuthStore();
  const account = await store.getAccount(workspaceId, accountId);
  if (!account) throw new OAuthError("not_found", "Connection account not found in this workspace");
  const spec = getOAuthProvider(account.connector);
  if (!spec) throw new OAuthError("unsupported", `No OAuth provider registered for "${account.connector}"`);
  const client = await loadClientCredentials(workspaceId, account.provider, account.integrationId);
  const { ensureAccessToken } = await import("@/lib/oauth/core");
  try {
    const result = await ensureAccessToken({ store, spec, client, account, lockOwner: randomUUID() });
    await store.updateAccount(account.id, { lastVerifiedAt: new Date().toISOString(), lastError: null });
    return { status: "connected" as ConnectionStatus, refreshed: result.refreshed, message: "Connection is healthy" };
  } catch (error) {
    const fresh = await store.getAccount(workspaceId, accountId);
    return {
      status: (fresh?.status ?? "error") as ConnectionStatus,
      refreshed: false,
      message: error instanceof OAuthError ? error.message : redactString(String(error)),
    };
  }
}
