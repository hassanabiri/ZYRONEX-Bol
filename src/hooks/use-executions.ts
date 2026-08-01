import { useEffect, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { executionEngine, type RuntimeRequest } from "@/lib/execution/runtime";
import { activityService } from "@/services/activity-service";
import { executionService } from "@/services/execution-service";

export const executionKeys = {
  list: (workspaceId: string) => ["workspace", workspaceId, "executions"] as const,
  detail: (executionId: string) => ["execution", executionId] as const,
  steps: (executionId: string) => ["execution", executionId, "steps"] as const,
  activity: (workspaceId: string) => ["workspace", workspaceId, "activity"] as const,
};

/** Re-renders and refetches whenever the runtime engine changes state. */
export function useEngineSync(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const activeIds = useSyncExternalStore(
    (listener) => executionEngine.subscribe(listener),
    () => executionEngine.activeIds.join(","),
    () => "",
  );

  useEffect(() => {
    if (!workspaceId) return;
    queryClient.invalidateQueries({ queryKey: executionKeys.list(workspaceId) });
    queryClient.invalidateQueries({ queryKey: executionKeys.activity(workspaceId) });
  }, [activeIds, workspaceId, queryClient]);

  return activeIds ? activeIds.split(",").filter(Boolean) : [];
}

export function useExecutions(workspaceId: string | undefined) {
  return useQuery({
    queryKey: executionKeys.list(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => executionService.list(workspaceId!),
    refetchInterval: 4000,
  });
}

export function useExecution(executionId: string | undefined) {
  return useQuery({
    queryKey: executionKeys.detail(executionId ?? "none"),
    enabled: Boolean(executionId),
    queryFn: () => executionService.get(executionId!),
    refetchInterval: 2500,
  });
}

export function useExecutionSteps(executionId: string | undefined) {
  return useQuery({
    queryKey: executionKeys.steps(executionId ?? "none"),
    enabled: Boolean(executionId),
    queryFn: () => executionService.listSteps(executionId!),
    refetchInterval: 2500,
  });
}

export function useActivityLog(workspaceId: string | undefined) {
  return useQuery({
    queryKey: executionKeys.activity(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => activityService.list(workspaceId!),
  });
}

export function useRuntime(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: executionKeys.list(workspaceId ?? "none") });

  return {
    startExecution: useMutation({
      mutationFn: (request: Omit<RuntimeRequest, "workspaceId" | "actorId">) =>
        executionEngine.start({ ...request, workspaceId: workspaceId!, actorId: user?.id ?? null }),
      onSuccess: invalidate,
    }),
    cancelExecution: useMutation({
      mutationFn: async (executionId: string) => {
        if (!executionEngine.cancel(executionId)) {
          await executionService.update(executionId, {
            status: "cancelled",
            finished_at: new Date().toISOString(),
          });
        }
      },
      onSuccess: invalidate,
    }),
  };
}
