import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { decryptCredentials, encryptCredentials, fingerprint } from "@/lib/integrations/crypto.server";
import { getOAuthProvider } from "@/lib/oauth/providers";
import {
  OAuthError,
  type ConnectionAccount,
  type ConnectionAccountView,
  type OAuthClientCredentials,
  type OAuthStore,
  type OAuthTokenSet,
  type PendingAuthorization,
} from "@/lib/oauth/types";

/**
 * Supabase-backed OAuth storage.
 *
 * Tokens, refresh tokens and client secrets only ever exist here as AES-256-GCM
 * ciphertext (existing vault, unchanged). Nothing in this module returns a
 * token to a caller that could forward it to the browser or to a log.
 */

type Client = SupabaseClient<Database>;

async function admin(): Promise<Client> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Client;
}

// The tables are newer than the generated types, so reads go through `any`-free
// row records and are mapped explicitly below.
type Row = Record<string, unknown>;

function toAccount(row: Row): ConnectionAccount {
  return {
    id: String(row["id"]),
    workspaceId: String(row["workspace_id"]),
    integrationId: (row["integration_id"] as string | null) ?? null,
    provider: String(row["provider"]),
    connector: String(row["connector"]),
    accountIdentifier: String(row["account_identifier"]),
    accountLabel: (row["account_label"] as string | null) ?? null,
    status: row["status"] as ConnectionAccount["status"],
    credentialRef: (row["credential_ref"] as string | null) ?? null,
    scopes: (row["scopes"] as string[] | null) ?? [],
    expiresAt: (row["expires_at"] as string | null) ?? null,
    lastVerifiedAt: (row["last_verified_at"] as string | null) ?? null,
    lastError: (row["last_error"] as string | null) ?? null,
    refreshFailures: Number(row["refresh_failures"] ?? 0),
  };
}

const ACCOUNTS = "connection_accounts" as never;
const CREDENTIALS = "connection_credentials" as never;
const STATES = "oauth_authorization_states" as never;

export function createSupabaseOAuthStore(): OAuthStore {
  return {
    async saveState(input) {
      const client = await admin();
      const { error } = await client.from(STATES).insert({
        state_hash: input.stateHash,
        workspace_id: input.workspaceId,
        integration_id: input.integrationId,
        provider: input.provider,
        connector: input.connector,
        redirect_uri: input.redirectUri,
        // The verifier is a one-shot value tied to a 10-minute state row.
        code_verifier: input.codeVerifier,
        scopes: input.scopes,
        expires_at: input.expiresAt,
        created_by: input.createdBy,
      } as never);
      if (error) throw error;
    },

    async consumeState(stateHash, nowMs) {
      const client = await admin();
      // Conditional update = atomic consume: a replayed callback matches zero
      // rows because `consumed_at` is already set.
      const { data, error } = await client
        .from(STATES)
        .update({ consumed_at: new Date(nowMs).toISOString() } as never)
        .eq("state_hash", stateHash)
        .is("consumed_at", null)
        .gt("expires_at", new Date(nowMs).toISOString())
        .select("*")
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const row = data as Row;
      return {
        workspaceId: String(row["workspace_id"]),
        integrationId: (row["integration_id"] as string | null) ?? null,
        provider: String(row["provider"]),
        connector: String(row["connector"]),
        redirectUri: String(row["redirect_uri"]),
        codeVerifier: (row["code_verifier"] as string | null) ?? null,
        scopes: (row["scopes"] as string[] | null) ?? [],
        createdBy: (row["created_by"] as string | null) ?? null,
      } satisfies PendingAuthorization;
    },

    async upsertAccount(input) {
      const client = await admin();
      const { data, error } = await client
        .from(ACCOUNTS)
        .upsert(
          {
            workspace_id: input.workspaceId,
            integration_id: input.integrationId,
            provider: input.provider,
            connector: input.connector,
            account_identifier: input.accountIdentifier,
            account_label: input.accountLabel,
            status: input.status,
            scopes: input.scopes,
            expires_at: input.expiresAt,
            last_verified_at: input.lastVerifiedAt,
            last_error: null,
            refresh_failures: 0,
          } as never,
          { onConflict: "workspace_id,provider,account_identifier" },
        )
        .select("*")
        .single();
      if (error) throw error;
      const account = toAccount(data as Row);
      await writeTokenRow(client, account, input.tokens);
      return account;
    },

    async getAccount(workspaceId, accountId) {
      const client = await admin();
      const { data, error } = await client
        .from(ACCOUNTS)
        .select("*")
        .eq("id", accountId)
        // Workspace isolation: an id from another tenant simply resolves to null.
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) throw error;
      return data ? toAccount(data as Row) : null;
    },

    async readTokens(accountId) {
      const client = await admin();
      const { data, error } = await client
        .from(CREDENTIALS)
        .select("ciphertext")
        .eq("account_id", accountId)
        .maybeSingle();
      if (error) throw error;
      const ciphertext = (data as { ciphertext?: string } | null)?.ciphertext;
      if (!ciphertext) return null;
      const values = decryptCredentials(ciphertext);
      if (!values["access_token"]) return null;
      return {
        accessToken: values["access_token"],
        refreshToken: values["refresh_token"] || undefined,
        tokenType: values["token_type"] || "Bearer",
        scopes: values["scopes"] ? values["scopes"].split(" ").filter(Boolean) : [],
        expiresAt: values["expires_at"] || null,
      };
    },

    async writeTokens(accountId, tokens) {
      const client = await admin();
      const { data } = await client.from(ACCOUNTS).select("workspace_id").eq("id", accountId).maybeSingle();
      const workspaceId = (data as { workspace_id?: string } | null)?.workspace_id;
      if (!workspaceId) throw new OAuthError("not_found", "Connection account not found");
      await writeTokenRow(client, { id: accountId, workspaceId } as ConnectionAccount, tokens);
    },

    async updateAccount(accountId, patch) {
      const client = await admin();
      const row: Row = {};
      if (patch.status !== undefined) row["status"] = patch.status;
      if (patch.expiresAt !== undefined) row["expires_at"] = patch.expiresAt;
      if (patch.scopes !== undefined) row["scopes"] = patch.scopes;
      if (patch.lastVerifiedAt !== undefined) row["last_verified_at"] = patch.lastVerifiedAt;
      if (patch.lastError !== undefined) row["last_error"] = patch.lastError;
      if (patch.refreshFailures !== undefined) row["refresh_failures"] = patch.refreshFailures;
      if (patch.accountLabel !== undefined) row["account_label"] = patch.accountLabel;
      if (Object.keys(row).length === 0) return;
      const { error } = await client.from(ACCOUNTS).update(row as never).eq("id", accountId);
      if (error) throw error;
    },

    async acquireRefreshLock(accountId, owner, ttlMs) {
      const client = await admin();
      const now = new Date();
      // Only one row can win: the filter requires the lock to be free or stale.
      const { data, error } = await client
        .from(ACCOUNTS)
        .update({
          refresh_lock_owner: owner,
          refresh_lock_expires_at: new Date(now.getTime() + ttlMs).toISOString(),
        } as never)
        .eq("id", accountId)
        .or(`refresh_lock_owner.is.null,refresh_lock_expires_at.lt.${now.toISOString()}`)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },

    async releaseRefreshLock(accountId, owner) {
      const client = await admin();
      await client
        .from(ACCOUNTS)
        .update({ refresh_lock_owner: null, refresh_lock_expires_at: null } as never)
        .eq("id", accountId)
        .eq("refresh_lock_owner", owner);
    },
  };
}

async function writeTokenRow(client: Client, account: Pick<ConnectionAccount, "id" | "workspaceId">, tokens: OAuthTokenSet) {
  const payload: Record<string, string> = {
    access_token: tokens.accessToken,
    ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
    ...(tokens.tokenType ? { token_type: tokens.tokenType } : {}),
    ...(tokens.scopes.length ? { scopes: tokens.scopes.join(" ") } : {}),
    ...(tokens.expiresAt ? { expires_at: tokens.expiresAt } : {}),
  };
  const { error } = await client.from(CREDENTIALS).upsert(
    {
      account_id: account.id,
      workspace_id: account.workspaceId,
      ciphertext: encryptCredentials(payload),
      fingerprint: fingerprint(payload),
      rotated_at: new Date().toISOString(),
    } as never,
    { onConflict: "account_id" },
  );
  if (error) throw error;
}

/**
 * Resolves the OAuth client credentials for a provider.
 * Per-workspace values live in the existing integration vault; a platform-wide
 * fallback comes from server env. Neither is ever returned to a caller.
 */
export async function loadClientCredentials(
  workspaceId: string,
  provider: string,
  integrationId?: string | null,
): Promise<OAuthClientCredentials> {
  if (integrationId) {
    const client = await admin();
    const { data } = await client
      .from("integration_credentials")
      .select("ciphertext")
      .eq("integration_id", integrationId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    const ciphertext = (data as { ciphertext?: string } | null)?.ciphertext;
    if (ciphertext) {
      try {
        const values = decryptCredentials(ciphertext);
        if (values["client_id"] && values["client_secret"])
          return { clientId: values["client_id"], clientSecret: values["client_secret"] };
      } catch {
        throw new OAuthError("unsupported", "Stored OAuth client credentials could not be read");
      }
    }
  }

  const envKey = provider.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  const clientId = process.env[`OAUTH_${envKey}_CLIENT_ID`];
  const clientSecret = process.env[`OAUTH_${envKey}_CLIENT_SECRET`];
  if (!clientId || !clientSecret)
    throw new OAuthError("unsupported", `No OAuth application is configured for "${provider}"`);
  return { clientId, clientSecret };
}

/** Client-safe list for the Integration Center. Never includes credentials. */
export async function listConnectionAccountsFor(workspaceId: string): Promise<ConnectionAccountView[]> {
  const client = await admin();
  const { data, error } = await client
    .from(ACCOUNTS)
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  const accounts = ((data as Row[] | null) ?? []).map(toAccount);
  const store = createSupabaseOAuthStore();
  return Promise.all(
    accounts.map(async ({ credentialRef: _ref, ...account }) => {
      const tokens = await store.readTokens(account.id).catch(() => null);
      return { ...account, hasRefreshToken: Boolean(tokens?.refreshToken) } satisfies ConnectionAccountView;
    }),
  );
}

/**
 * Returns a valid access token for a workspace connection, refreshing when
 * needed. This is the single entry point connectors use — they never see the
 * refresh token, the client secret, or the vault.
 */
export async function getAccessTokenForAccount(workspaceId: string, accountId: string): Promise<string> {
  const store = createSupabaseOAuthStore();
  const account = await store.getAccount(workspaceId, accountId);
  if (!account) throw new OAuthError("not_found", "Connection account not found in this workspace");
  const spec = getOAuthProvider(account.connector);
  if (!spec) throw new OAuthError("unsupported", `No OAuth provider registered for "${account.connector}"`);
  const client = await loadClientCredentials(workspaceId, account.provider, account.integrationId);
  const { ensureAccessToken } = await import("@/lib/oauth/core");
  const result = await ensureAccessToken({ store, spec, client, account });
  return result.token;
}
