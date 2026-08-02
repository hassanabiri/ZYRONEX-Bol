import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  encryptCredentials,
  fingerprint,
  generateApiKey,
  hashApiKey,
  randomSecret,
} from "@/lib/integrations/crypto.server";

type Client = SupabaseClient<Database>;

const MANAGE_ROLES = ["owner", "admin"] as const;

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as Client;
}

/** Reads the integration through the caller's RLS view — proves workspace membership. */
async function loadIntegration(supabase: Client, integrationId: string) {
  const { data, error } = await supabase
    .from("integrations")
    .select("id, workspace_id, provider, name")
    .eq("id", integrationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Integration not found");
  return data;
}

async function assertManager(supabase: Client, workspaceId: string, userId: string) {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !MANAGE_ROLES.includes(data.role as (typeof MANAGE_ROLES)[number])) {
    throw new Error("You do not have permission to manage credentials in this workspace");
  }
}

export async function storeCredentials(
  supabase: Client,
  userId: string,
  integrationId: string,
  values: Record<string, string>,
) {
  const integration = await loadIntegration(supabase, integrationId);
  await assertManager(supabase, integration.workspace_id, userId);

  const admin = await adminClient();
  const print = fingerprint(values);
  const { error } = await admin.from("integration_credentials").upsert(
    {
      workspace_id: integration.workspace_id,
      integration_id: integrationId,
      ciphertext: encryptCredentials(values),
      fingerprint: print,
      rotated_at: new Date().toISOString(),
    },
    { onConflict: "integration_id" },
  );
  if (error) throw error;

  await admin
    .from("integrations")
    .update({
      credential_fingerprint: print,
      credential_updated_at: new Date().toISOString(),
      status: "pending",
      last_error: null,
    })
    .eq("id", integrationId);

  await admin.from("integration_logs").insert({
    workspace_id: integration.workspace_id,
    integration_id: integrationId,
    kind: "auth",
    message: "Credentials stored in the encrypted vault",
    actor_id: userId,
  });

  return { fingerprint: print };
}

export async function dropCredentials(supabase: Client, userId: string, integrationId: string) {
  const integration = await loadIntegration(supabase, integrationId);
  await assertManager(supabase, integration.workspace_id, userId);
  const admin = await adminClient();
  await admin.from("integration_credentials").delete().eq("integration_id", integrationId);
  await admin
    .from("integrations")
    .update({ credential_fingerprint: null, credential_updated_at: null, status: "disconnected", enabled: false })
    .eq("id", integrationId);
  await admin.from("integration_logs").insert({
    workspace_id: integration.workspace_id,
    integration_id: integrationId,
    kind: "auth",
    message: "Credentials revoked",
    actor_id: userId,
  });
  return { ok: true };
}

/**
 * Verification is a configuration check, not a provider call: it confirms the
 * vault holds credentials and that every required config field is present.
 * Provider transports arrive with their own connector implementations.
 */
export async function verifyConnection(
  supabase: Client,
  userId: string,
  integrationId: string,
  requiredConfigKeys: string[],
) {
  const integration = await loadIntegration(supabase, integrationId);
  await assertManager(supabase, integration.workspace_id, userId);
  const admin = await adminClient();

  const started = Date.now();
  const [{ data: credential }, { data: row }] = await Promise.all([
    admin.from("integration_credentials").select("id").eq("integration_id", integrationId).maybeSingle(),
    admin.from("integrations").select("config, expires_at").eq("id", integrationId).maybeSingle(),
  ]);

  const config = (row?.config ?? {}) as Record<string, unknown>;
  const missing = requiredConfigKeys.filter((key) => {
    const value = config[key];
    return value === undefined || value === null || String(value).trim() === "";
  });

  const expired = row?.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false;

  let status: Database["public"]["Enums"]["integration_status"] = "healthy";
  let message = "Connection verified";
  if (!credential) {
    status = "auth_error";
    message = "No credentials stored for this connection";
  } else if (missing.length > 0) {
    status = "warning";
    message = `Missing configuration: ${missing.join(", ")}`;
  } else if (expired) {
    status = "expired";
    message = "Stored credentials have expired";
  }

  const latency = Date.now() - started;
  await admin
    .from("integrations")
    .update({
      status,
      last_checked_at: new Date().toISOString(),
      last_error: status === "healthy" ? null : message,
      avg_latency_ms: latency,
    })
    .eq("id", integrationId);

  await admin.from("integration_logs").insert({
    workspace_id: integration.workspace_id,
    integration_id: integrationId,
    kind: status === "healthy" ? "connection" : "error",
    message,
    latency_ms: latency,
    actor_id: userId,
  });

  return { status, message, latencyMs: latency };
}

export async function issueApiKey(
  supabase: Client,
  userId: string,
  input: {
    workspaceId: string;
    name: string;
    scopes: string[];
    environment: string;
    expiresAt: string | null;
  },
) {
  await assertManager(supabase, input.workspaceId, userId);
  const admin = await adminClient();
  const { key, prefix } = generateApiKey(input.environment);
  const { data, error } = await admin
    .from("api_keys")
    .insert({
      workspace_id: input.workspaceId,
      name: input.name,
      prefix,
      key_hash: hashApiKey(key),
      scopes: input.scopes,
      environment: input.environment,
      expires_at: input.expiresAt,
      created_by: userId,
    })
    .select("*")
    .single();
  if (error) throw error;
  return { key, record: data };
}

export async function rotateApiKey(supabase: Client, userId: string, keyId: string) {
  const { data: existing, error } = await supabase
    .from("api_keys")
    .select("id, workspace_id, environment")
    .eq("id", keyId)
    .maybeSingle();
  if (error) throw error;
  if (!existing) throw new Error("API key not found");
  await assertManager(supabase, existing.workspace_id, userId);

  const admin = await adminClient();
  const { key, prefix } = generateApiKey(existing.environment);
  const { data, error: updateError } = await admin
    .from("api_keys")
    .update({ prefix, key_hash: hashApiKey(key), rotated_at: new Date().toISOString(), revoked_at: null })
    .eq("id", keyId)
    .select("*")
    .single();
  if (updateError) throw updateError;
  return { key, record: data };
}

export async function issueWebhookSecret(supabase: Client, userId: string, endpointId: string) {
  const { data: endpoint, error } = await supabase
    .from("webhook_endpoints")
    .select("id, workspace_id")
    .eq("id", endpointId)
    .maybeSingle();
  if (error) throw error;
  if (!endpoint) throw new Error("Webhook endpoint not found");
  await assertManager(supabase, endpoint.workspace_id, userId);

  const secret = randomSecret();
  const admin = await adminClient();
  const { error: updateError } = await admin
    .from("webhook_endpoints")
    .update({ signing_secret_hint: `${secret.slice(0, 6)}…${secret.slice(-4)}` })
    .eq("id", endpointId);
  if (updateError) throw updateError;
  return { secret };
}
