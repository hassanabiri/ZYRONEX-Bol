import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  developerService,
  type DeveloperProjectInsert,
  type Plugin,
} from "@/services/developer-service";
import type { TablesUpdate } from "@/integrations/supabase/types";

export const developerKeys = {
  projects: (workspaceId: string) => ["workspace", workspaceId, "developer-projects"] as const,
  oauthClients: (workspaceId: string) => ["workspace", workspaceId, "oauth-clients"] as const,
  envVars: (workspaceId: string) => ["workspace", workspaceId, "env-vars"] as const,
  plugins: (workspaceId: string) => ["workspace", workspaceId, "plugins"] as const,
};

export function useDeveloperProjects(workspaceId: string | undefined) {
  return useQuery({
    queryKey: developerKeys.projects(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => developerService.listProjects(workspaceId!),
  });
}

export function useOAuthClients(workspaceId: string | undefined) {
  return useQuery({
    queryKey: developerKeys.oauthClients(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => developerService.listOAuthClients(workspaceId!),
  });
}

export function useEnvironmentVariables(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: developerKeys.envVars(workspaceId ?? "none"),
    enabled: Boolean(workspaceId) && enabled,
    queryFn: () => developerService.listEnvVars(workspaceId!),
  });
}

export function usePlugins(workspaceId: string | undefined) {
  return useQuery({
    queryKey: developerKeys.plugins(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => developerService.listPlugins(workspaceId!),
  });
}

export function useDeveloperMutations(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "";
  const invalidate = (key: readonly unknown[]) =>
    queryClient.invalidateQueries({ queryKey: key });

  return {
    createProject: useMutation({
      mutationFn: (input: DeveloperProjectInsert) =>
        developerService.createProject(id, input, user?.id),
      onSuccess: () => invalidate(developerKeys.projects(id)),
    }),
    updateProject: useMutation({
      mutationFn: (input: { id: string; patch: TablesUpdate<"developer_projects"> }) =>
        developerService.updateProject(input.id, input.patch),
      onSuccess: () => invalidate(developerKeys.projects(id)),
    }),
    deleteProject: useMutation({
      mutationFn: (projectId: string) => developerService.removeProject(projectId),
      onSuccess: () => invalidate(developerKeys.projects(id)),
    }),
    createOAuthClient: useMutation({
      mutationFn: (input: {
        name: string;
        projectId?: string | null;
        redirectUris: string[];
        scopes: string[];
        grantTypes: string[];
      }) => developerService.createOAuthClient(id, input, user?.id),
      onSuccess: () => invalidate(developerKeys.oauthClients(id)),
    }),
    rotateOAuthSecret: useMutation({
      mutationFn: (clientId: string) => developerService.rotateOAuthSecret(clientId),
      onSuccess: () => invalidate(developerKeys.oauthClients(id)),
    }),
    updateOAuthClient: useMutation({
      mutationFn: (input: { id: string; patch: TablesUpdate<"oauth_clients"> }) =>
        developerService.updateOAuthClient(input.id, input.patch),
      onSuccess: () => invalidate(developerKeys.oauthClients(id)),
    }),
    deleteOAuthClient: useMutation({
      mutationFn: (clientId: string) => developerService.removeOAuthClient(clientId),
      onSuccess: () => invalidate(developerKeys.oauthClients(id)),
    }),
    saveEnvVar: useMutation({
      mutationFn: (input: {
        key: string;
        value: string;
        isSecret: boolean;
        environment: string;
        projectId?: string | null;
      }) => developerService.upsertEnvVar(id, input, user?.id),
      onSuccess: () => invalidate(developerKeys.envVars(id)),
    }),
    deleteEnvVar: useMutation({
      mutationFn: (varId: string) => developerService.removeEnvVar(varId),
      onSuccess: () => invalidate(developerKeys.envVars(id)),
    }),
    installPlugin: useMutation({
      mutationFn: (input: {
        name: string;
        publisher: string;
        description?: string | null;
        version?: string;
        permissions: string[];
        dependencies: string[];
      }) => developerService.installPlugin(id, input, user?.id),
      onSuccess: () => invalidate(developerKeys.plugins(id)),
    }),
    setPluginStatus: useMutation({
      mutationFn: (input: { plugin: Plugin; status: Plugin["status"] }) =>
        developerService.setPluginStatus(input.plugin, input.status, user?.id),
      onSuccess: () => invalidate(developerKeys.plugins(id)),
    }),
    updatePlugin: useMutation({
      mutationFn: (plugin: Plugin) => developerService.updatePlugin(plugin),
      onSuccess: () => invalidate(developerKeys.plugins(id)),
    }),
    deletePlugin: useMutation({
      mutationFn: (pluginId: string) => developerService.removePlugin(pluginId),
      onSuccess: () => invalidate(developerKeys.plugins(id)),
    }),
  };
}
