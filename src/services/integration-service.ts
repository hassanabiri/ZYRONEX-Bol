import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import {
  createApiKey,
  generateWebhookSecret,
  revokeIntegrationCredentials,
  rotateApiKeyFn,
  saveIntegrationCredentials,
  verifyIntegrationConnection,
} from "@/lib/integrations.functions";
import { getProvider, type ProviderDefinition } from "@/lib/integrations/catalog";
import { activityService } from "@/services/activity-service";

export type Integration = Tables<"integrations">;
export type IntegrationLog = Tables<"integration_logs">;
export type SyncRun = Tables<"integration_sync_runs">;
export type WebhookEndpoint = Tables<"webhook_endpoints">;
export type WebhookDelivery = Tables<"webhook_deliveries">;
export type ApiKey = Tables<"api_keys">;
export type MarketplaceListing = Tables<"marketplace_listings">;

export type IntegrationInsert = Omit<TablesInsert<"integrations">, "workspace_id" | "created_by">;
export type IntegrationPatch = TablesUpdate<"integrations">;

function requiredConfigKeys(provider: ProviderDefinition | undefined) {
  return (provider?.configFields ?? []).filter((field) => !field.optional).map((field) => field.key);
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * Integration Hub data layer. Every external connection is represented by a
 * row here — nothing in the platform talks to a provider outside this module.
 */
export const integrationService = {
  async list(workspaceId: string): Promise<Integration[]> {
    const { data, error } = await supabase
      .from("integrations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async create(workspaceId: string, input: IntegrationInsert, userId?: string) {
    const { data, error } = await supabase
      .from("integrations")
      .insert({ ...input, workspace_id: workspaceId, created_by: userId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(workspaceId, {
      entity_type: "integration",
      entity_id: data.id,
      action: "integration.created",
      detail: data.name,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async update(integration: Integration, patch: IntegrationPatch, userId?: string) {
    const { data, error } = await supabase
      .from("integrations")
      .update(patch)
      .eq("id", integration.id)
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(integration.workspace_id, {
      entity_type: "integration",
      entity_id: integration.id,
      action: "integration.updated",
      detail: integration.name,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async remove(integration: Integration, userId?: string) {
    const { error } = await supabase.from("integrations").delete().eq("id", integration.id);
    if (error) throw error;
    await activityService.log(integration.workspace_id, {
      entity_type: "integration",
      entity_id: integration.id,
      action: "integration.deleted",
      detail: integration.name,
      result: "success",
      actor_id: userId ?? null,
    });
  },

  saveCredentials(integrationId: string, values: Record<string, string>) {
    return saveIntegrationCredentials({ data: { integrationId, values } });
  },

  revokeCredentials(integrationId: string) {
    return revokeIntegrationCredentials({ data: { integrationId } });
  },

  verify(integration: Integration) {
    return verifyIntegrationConnection({
      data: {
        integrationId: integration.id,
        requiredConfigKeys: requiredConfigKeys(getProvider(integration.provider)),
      },
    });
  },

  async setEnabled(integration: Integration, enabled: boolean, userId?: string) {
    return integrationService.update(
      integration,
      { enabled, status: enabled ? integration.status : "paused" },
      userId,
    );
  },

  async archive(integration: Integration, userId?: string) {
    return integrationService.update(integration, { status: "archived", enabled: false }, userId);
  },

  // ---------------------------------------------------------------- logs
  async listLogs(workspaceId: string, integrationId?: string, limit = 150): Promise<IntegrationLog[]> {
    let query = supabase
      .from("integration_logs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (integrationId) query = query.eq("integration_id", integrationId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  // ------------------------------------------------------------ sync engine
  async listSyncRuns(workspaceId: string, limit = 100): Promise<SyncRun[]> {
    const { data, error } = await supabase
      .from("integration_sync_runs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  /** Enqueues a sync run. A background worker picks queued rows up. */
  async queueSync(
    integration: Integration,
    input: {
      mode?: SyncRun["mode"] | undefined;
      conflictStrategy?: string | undefined;
      userId?: string | undefined;
    } = {},
  ) {
    const { data, error } = await supabase
      .from("integration_sync_runs")
      .insert({
        workspace_id: integration.workspace_id,
        integration_id: integration.id,
        mode: input.mode ?? integration.sync_mode,
        conflict_strategy: input.conflictStrategy ?? "source_wins",
        max_attempts: 3,
        created_by: input.userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    await supabase.from("integration_logs").insert({
      workspace_id: integration.workspace_id,
      integration_id: integration.id,
      kind: "sync",
      message: `Sync queued (${data.mode})`,
      actor_id: input.userId ?? null,
    });
    return data;
  },

  async cancelSync(run: SyncRun) {
    const { data, error } = await supabase
      .from("integration_sync_runs")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("id", run.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async retrySync(run: SyncRun) {
    const { data, error } = await supabase
      .from("integration_sync_runs")
      .update({ status: "queued", attempt: run.attempt + 1, error: null, finished_at: null })
      .eq("id", run.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  // -------------------------------------------------------------- webhooks
  async listWebhooks(workspaceId: string): Promise<WebhookEndpoint[]> {
    const { data, error } = await supabase
      .from("webhook_endpoints")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createWebhook(
    workspaceId: string,
    input: {
      name: string;
      direction: WebhookEndpoint["direction"];
      url?: string | null;
      events: string[];
      integration_id?: string | null;
    },
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("webhook_endpoints")
      .insert({
        workspace_id: workspaceId,
        name: input.name,
        direction: input.direction,
        url: input.url ?? null,
        events: input.events,
        integration_id: input.integration_id ?? null,
        slug: `${slugify(input.name)}-${Math.random().toString(36).slice(2, 7)}`,
        created_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async updateWebhook(endpointId: string, patch: TablesUpdate<"webhook_endpoints">) {
    const { data, error } = await supabase
      .from("webhook_endpoints")
      .update(patch)
      .eq("id", endpointId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removeWebhook(endpointId: string) {
    const { error } = await supabase.from("webhook_endpoints").delete().eq("id", endpointId);
    if (error) throw error;
  },

  rotateWebhookSecret(endpointId: string) {
    return generateWebhookSecret({ data: { endpointId } });
  },

  async listDeliveries(workspaceId: string, limit = 100): Promise<WebhookDelivery[]> {
    const { data, error } = await supabase
      .from("webhook_deliveries")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  async retryDelivery(delivery: WebhookDelivery) {
    const { data, error } = await supabase
      .from("webhook_deliveries")
      .insert({
        workspace_id: delivery.workspace_id,
        endpoint_id: delivery.endpoint_id,
        event: delivery.event,
        direction: delivery.direction,
        attempt: delivery.attempt + 1,
        payload: delivery.payload,
        success: false,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  // ------------------------------------------------------------- api keys
  async listApiKeys(workspaceId: string): Promise<ApiKey[]> {
    const { data, error } = await supabase
      .from("api_keys")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  createApiKey(input: {
    workspaceId: string;
    name: string;
    scopes: string[];
    environment: "production" | "sandbox";
    expiresAt: string | null;
  }) {
    return createApiKey({ data: input });
  },

  rotateApiKey(keyId: string) {
    return rotateApiKeyFn({ data: { keyId } });
  },

  async revokeApiKey(keyId: string) {
    const { data, error } = await supabase
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", keyId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async deleteApiKey(keyId: string) {
    const { error } = await supabase.from("api_keys").delete().eq("id", keyId);
    if (error) throw error;
  },

  // ---------------------------------------------------------- marketplace
  async listListings(workspaceId: string): Promise<MarketplaceListing[]> {
    const { data, error } = await supabase
      .from("marketplace_listings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createListing(
    workspaceId: string,
    input: { name: string; publisher: string; category: string; description?: string | null },
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("marketplace_listings")
      .insert({
        workspace_id: workspaceId,
        name: input.name,
        publisher: input.publisher,
        category: input.category,
        description: input.description ?? null,
        slug: `${slugify(input.name)}-${Math.random().toString(36).slice(2, 6)}`,
        created_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async updateListing(id: string, patch: TablesUpdate<"marketplace_listings">) {
    const { data, error } = await supabase
      .from("marketplace_listings")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removeListing(id: string) {
    const { error } = await supabase.from("marketplace_listings").delete().eq("id", id);
    if (error) throw error;
  },

  /** One-click install: materialises a connection from a listing manifest. */
  async installListing(listing: MarketplaceListing, userId?: string) {
    const manifest = (listing.manifest ?? {}) as { provider?: string; category?: string };
    const created = await integrationService.create(
      listing.workspace_id,
      {
        provider: manifest.provider ?? "custom_connector",
        category: manifest.category ?? listing.category,
        name: listing.name,
        description: listing.description,
        auth_type: "custom",
      },
      userId,
    );
    await supabase
      .from("marketplace_listings")
      .update({ install_count: listing.install_count + 1 })
      .eq("id", listing.id);
    return created;
  },
};
