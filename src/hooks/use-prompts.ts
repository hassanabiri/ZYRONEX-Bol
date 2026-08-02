import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  modelConfigService,
  promptService,
  type ModelConfigInsert,
  type ModelConfigPatch,
  type Prompt,
  type PromptInsert,
  type PromptPatch,
  type PromptVersion,
} from "@/services/prompt-service";

export const promptKeys = {
  list: (workspaceId: string) => ["workspace", workspaceId, "prompts"] as const,
  versions: (promptId: string) => ["prompt", promptId, "versions"] as const,
  models: (workspaceId: string) => ["workspace", workspaceId, "model-configs"] as const,
};

export function usePrompts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: promptKeys.list(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => promptService.list(workspaceId!),
  });
}

export function usePromptVersions(promptId: string | undefined) {
  return useQuery({
    queryKey: promptKeys.versions(promptId ?? "none"),
    enabled: Boolean(promptId),
    queryFn: () => promptService.listVersions(promptId!),
  });
}

export function useModelConfigs(workspaceId: string | undefined) {
  return useQuery({
    queryKey: promptKeys.models(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => modelConfigService.list(workspaceId!),
  });
}

export function usePromptMutations(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "";

  const invalidate = (promptId?: string) => {
    queryClient.invalidateQueries({ queryKey: promptKeys.list(id) });
    if (promptId) queryClient.invalidateQueries({ queryKey: promptKeys.versions(promptId) });
  };

  return {
    createPrompt: useMutation({
      mutationFn: (input: PromptInsert) => promptService.create(id, input, user?.id),
      onSuccess: (data) => invalidate(data.id),
    }),
    updatePrompt: useMutation({
      mutationFn: (input: { promptId: string; patch: PromptPatch }) =>
        promptService.update(input.promptId, input.patch, user?.id),
      onSuccess: (data) => invalidate(data.id),
    }),
    deletePrompt: useMutation({
      mutationFn: (promptId: string) => promptService.remove(promptId),
      onSuccess: () => invalidate(),
    }),
    duplicatePrompt: useMutation({
      mutationFn: (prompt: Prompt) => promptService.duplicate(prompt, user?.id),
      onSuccess: () => invalidate(),
    }),
    restoreVersion: useMutation({
      mutationFn: (input: { prompt: Prompt; version: PromptVersion }) =>
        promptService.restoreVersion(input.prompt, input.version, user?.id),
      onSuccess: (data) => invalidate(data.id),
    }),
  };
}

export function useModelConfigMutations(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "";
  const invalidate = () => queryClient.invalidateQueries({ queryKey: promptKeys.models(id) });

  return {
    createConfig: useMutation({
      mutationFn: (input: ModelConfigInsert) => modelConfigService.create(id, input, user?.id),
      onSuccess: invalidate,
    }),
    updateConfig: useMutation({
      mutationFn: (input: { configId: string; patch: ModelConfigPatch }) =>
        modelConfigService.update(input.configId, input.patch),
      onSuccess: invalidate,
    }),
    deleteConfig: useMutation({
      mutationFn: (configId: string) => modelConfigService.remove(configId),
      onSuccess: invalidate,
    }),
  };
}
