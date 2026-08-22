import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { ConnectorError } from "@/lib/connectors/errors";
import { decryptCredentials } from "@/lib/integrations/crypto.server";

/**
 * Credential resolution for connectors.
 *
 * Reuses the existing AES-256-GCM vault as-is. Decrypted values exist only
 * inside a server handler's memory for the duration of one call: they are never
 * returned to the browser, never logged, and never written to execution steps.
 */

type Admin = SupabaseClient<Database>;

async function admin(): Promise<Admin> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Admin;
}

/** Canonical credential keys so adapters do not care how a field was labelled. */
const ALIASES: Record<string, string> = {
  token: "access_token",
  bot_token: "access_token",
  oauth_token: "access_token",
  bearer: "bearer_token",
  key: "api_key",
  apikey: "api_key",
  secret: "client_secret",
};

function canonicalize(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const normalized = key.trim().toLowerCase();
    out[normalized] = value;
    const alias = ALIASES[normalized];
    if (alias && !out[alias]) out[alias] = value;
  }
  return out;
}

export type ResolvedIntegration = {
  id: string;
  workspaceId: string;
  provider: string;
  name: string;
  config: Record<string, unknown>;
  credentials: Record<string, string>;
};

/**
 * Loads an integration and its decrypted credentials.
 * `workspaceId` is always applied as a filter, so a workflow can never reach a
 * connection belonging to another tenant even if an id leaks into a graph.
 */
export async function resolveIntegrationCredentials(
  workspaceId: string,
  selector: { integrationId?: string; provider?: string },
): Promise<ResolvedIntegration> {
  const client = await admin();
  let query = client
    .from("integrations")
    .select("id, workspace_id, provider, name, config, enabled")
    .eq("workspace_id", workspaceId);

  if (selector.integrationId) query = query.eq("id", selector.integrationId);
  else if (selector.provider) query = query.eq("provider", selector.provider);
  else throw new ConnectorError("invalid_request", "An integration id or provider is required", { retryable: false });

  const { data, error } = await query.limit(1).maybeSingle();
  if (error) throw new ConnectorError("provider", `Could not load the integration: ${error.message}`);
  if (!data) throw new ConnectorError("not_found", "Integration is not connected in this workspace", { retryable: false });

  const { data: credentialRow, error: credentialError } = await client
    .from("integration_credentials")
    .select("ciphertext")
    .eq("integration_id", data.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (credentialError)
    throw new ConnectorError("provider", `Could not read the credential vault: ${credentialError.message}`);

  let credentials: Record<string, string> = {};
  if (credentialRow?.ciphertext) {
    try {
      credentials = canonicalize(decryptCredentials(credentialRow.ciphertext));
    } catch {
      throw new ConnectorError("auth", "Stored credentials could not be decrypted", { retryable: false });
    }
  }

  // A connected OAuth account always wins over a manually pasted token: the
  // access token is refreshed on demand and never leaves this module.
  try {
    const { data: account } = await client
      .from("connection_accounts" as never)
      .select("id, status")
      .eq("workspace_id", workspaceId)
      .eq("integration_id", data.id)
      .in("status", ["connected", "expired"])
      .limit(1)
      .maybeSingle();
    const accountId = (account as { id?: string } | null)?.id;
    if (accountId) {
      const { getAccessTokenForAccount } = await import("@/lib/oauth/accounts.server");
      credentials["access_token"] = await getAccessTokenForAccount(workspaceId, accountId);
    }
  } catch (error) {
    if (error instanceof ConnectorError) throw error;
    throw new ConnectorError("auth", "The connected account needs to be reauthorized", { retryable: false });
  }

  return {
    id: data.id,
    workspaceId,
    provider: data.provider,
    name: data.name,
    config: (data.config ?? {}) as Record<string, unknown>,
    credentials,
  };
}
