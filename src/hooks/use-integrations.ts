import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  integrationService,
  type ApiKey,
  type Integration,
  type IntegrationInsert,
  type IntegrationPatch,
  type MarketplaceListing,
  type SyncRun,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "@/services/integration-service";

export const integrationKeys = {
  all: (workspaceId: string) => ["workspace", workspaceId, "integrations"] as const,
  logs: (workspaceId: string, integrationId?: string) =>
    ["workspace", workspaceId, "integration-logs", integrationId ?? "all"] as const,
  syncRuns: (workspaceId: string) => ["workspace", workspaceId, "sync-runs"] as const,
  webhooks: (workspaceId: string) => ["workspace", workspaceId, "webhooks"] as const,
  deliveries: (workspaceId: string) => ["workspace", workspaceId, "webhook-deliveries"] as const,
  apiKeys: (workspaceId: string) => ["workspace", workspaceId, "api-keys"] as const,
  listings: (workspaceId: string) => ["workspace", workspaceId, "marketplace-listings"] as const,
};

export function useIntegrations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.all(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => integrationService.list(workspaceId!),
  });
}

export function useIntegrationLogs(workspaceId: string | undefined, integrationId?: string) {
  return useQuery({
    queryKey: integrationKeys.logs(workspaceId ?? "none", integrationId),
    enabled: Boolean(workspaceId),
    queryFn: () => integrationService.listLogs(workspaceId!, integrationId),
  });
}

export function useSyncRuns(workspaceId: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.syncRuns(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => integrationService.listSyncRuns(workspaceId!),
  });
}

export function useWebhookEndpoints(workspaceId: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.webhooks(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => integrationService.listWebhooks(workspaceId!),
  });
}

export function useWebhookDeliveries(workspaceId: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.deliveries(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => integrationService.listDeliveries(workspaceId!),
  });
}

export function useApiKeys(workspaceId: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.apiKeys(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => integrationService.listApiKeys(workspaceId!),
  });
}

export function useMarketplaceListings(workspaceId: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.listings(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => integrationService.listListings(workspaceId!),
  });
}

export function useIntegrationMutations(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "";

  const invalidateConnections = () => {
    queryClient.invalidateQueries({ queryKey: integrationKeys.all(id) });
    queryClient.invalidateQueries({ queryKey: ["workspace", id, "integration-logs"] });
  };

  return {
    createIntegration: useMutation({
      mutationFn: (input: IntegrationInsert) => integrationService.create(id, input, user?.id),
      onSuccess: invalidateConnections,
    }),
    updateIntegration: useMutation({
      mutationFn: (input: { integration: Integration; patch: IntegrationPatch }) =>
        integrationService.update(input.integration, input.patch, user?.id),
      onSuccess: invalidateConnections,
    }),
    deleteIntegration: useMutation({
      mutationFn: (integration: Integration) => integrationService.remove(integration, user?.id),
      onSuccess: invalidateConnections,
    }),
    toggleIntegration: useMutation({
      mutationFn: (input: { integration: Integration; enabled: boolean }) =>
        integrationService.setEnabled(input.integration, input.enabled, user?.id),
      onSuccess: invalidateConnections,
    }),
    archiveIntegration: useMutation({
      mutationFn: (integration: Integration) => integrationService.archive(integration, user?.id),
      onSuccess: invalidateConnections,
    }),
    saveCredentials: useMutation({
      mutationFn: (input: { integrationId: string; values: Record<string, string> }) =>
        integrationService.saveCredentials(input.integrationId, input.values),
      onSuccess: invalidateConnections,
    }),
    revokeCredentials: useMutation({
      mutationFn: (integrationId: string) => integrationService.revokeCredentials(integrationId),
      onSuccess: invalidateConnections,
    }),
    verifyIntegration: useMutation({
      mutationFn: (integration: Integration) => integrationService.verify(integration),
      onSuccess: invalidateConnections,
    }),
    queueSync: useMutation({
      mutationFn: (input: { integration: Integration; mode?: SyncRun["mode"]; conflictStrategy?: string }) =>
        integrationService.queueSync(input.integration, {
          mode: input.mode,
          conflictStrategy: input.conflictStrategy,
          userId: user?.id,
        }),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: integrationKeys.syncRuns(id) });
        invalidateConnections();
      },
    }),
    cancelSync: useMutation({
      mutationFn: (run: SyncRun) => integrationService.cancelSync(run),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.syncRuns(id) }),
    }),
    retrySync: useMutation({
      mutationFn: (run: SyncRun) => integrationService.retrySync(run),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.syncRuns(id) }),
    }),
    createWebhook: useMutation({
      mutationFn: (input: {
        name: string;
        direction: WebhookEndpoint["direction"];
        url?: string | null;
        events: string[];
        integration_id?: string | null;
      }) => integrationService.createWebhook(id, input, user?.id),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.webhooks(id) }),
    }),
    updateWebhook: useMutation({
      mutationFn: (input: { endpointId: string; patch: Partial<WebhookEndpoint> }) =>
        integrationService.updateWebhook(input.endpointId, input.patch),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.webhooks(id) }),
    }),
    deleteWebhook: useMutation({
      mutationFn: (endpointId: string) => integrationService.removeWebhook(endpointId),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.webhooks(id) }),
    }),
    rotateWebhookSecret: useMutation({
      mutationFn: (endpointId: string) => integrationService.rotateWebhookSecret(endpointId),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.webhooks(id) }),
    }),
    retryDelivery: useMutation({
      mutationFn: (delivery: WebhookDelivery) => integrationService.retryDelivery(delivery),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.deliveries(id) }),
    }),
    createApiKey: useMutation({
      mutationFn: (input: {
        name: string;
        scopes: string[];
        environment: "production" | "sandbox";
        expiresAt: string | null;
      }) => integrationService.createApiKey({ workspaceId: id, ...input }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.apiKeys(id) }),
    }),
    rotateApiKey: useMutation({
      mutationFn: (key: ApiKey) => integrationService.rotateApiKey(key.id),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.apiKeys(id) }),
    }),
    revokeApiKey: useMutation({
      mutationFn: (key: ApiKey) => integrationService.revokeApiKey(key.id),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.apiKeys(id) }),
    }),
    deleteApiKey: useMutation({
      mutationFn: (key: ApiKey) => integrationService.deleteApiKey(key.id),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.apiKeys(id) }),
    }),
    createListing: useMutation({
      mutationFn: (input: {
        name: string;
        publisher: string;
        category: string;
        description?: string | null;
      }) => integrationService.createListing(id, input, user?.id),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.listings(id) }),
    }),
    updateListing: useMutation({
      mutationFn: (input: { id: string; patch: Partial<MarketplaceListing> }) =>
        integrationService.updateListing(input.id, input.patch),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.listings(id) }),
    }),
    deleteListing: useMutation({
      mutationFn: (listingId: string) => integrationService.removeListing(listingId),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: integrationKeys.listings(id) }),
    }),
    installListing: useMutation({
      mutationFn: (listing: MarketplaceListing) =>
        integrationService.installListing(listing, user?.id),
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: integrationKeys.listings(id) });
        invalidateConnections();
      },
    }),
  };
}
