import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import type { RuntimeRequest } from "@/lib/execution/contracts";
import {
  cancelExecution as cancelExecutionFn,
  dispatchQueue as dispatchQueueFn,
  startExecution as startExecutionFn,
} from "@/lib/execution/runtime.functions";
import { activityService } from "@/services/activity-service";
import { executionService, TERMINAL_STATUSES } from "@/services/execution-service";

export const executionKeys = {
  list: (workspaceId: string) => ["workspace", workspaceId, "executions"] as const,
  detail: (executionId: string) => ["execution", executionId] as const,
  steps: (executionId: string) => ["execution", executionId, "steps"] as const,
  activity: (workspaceId: string) => ["workspace", workspaceId, "activity"] as const,
};

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

/**
 * Keeps the server queue moving while runs are in flight and refreshes the
 * views. The runtime itself lives on the server — this only ticks it.
 */
export function useEngineSync(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const dispatch = useServerFn(dispatchQueueFn);
  const { data: executions = [] } = useExecutions(workspaceId);
  const [ticking, setTicking] = useState(false);

  const activeIds = useMemo(
    () =>
      executions
        .filter((item) => !TERMINAL_STATUSES.includes(item.status))
        .map((item) => item.id),
    [executions],
  );
  const activeKey = activeIds.join(",");

  useEffect(() => {
    if (!workspaceId || !activeKey || ticking) return;
    let cancelled = false;

    const tick = async () => {
      setTicking(true);
      try {
        await dispatch({ data: { workspaceId, max: 3, budgetMs: 15000 } });
      } catch {
        // The dispatcher is best-effort; the next tick retries.
      } finally {
        if (!cancelled) setTicking(false);
        queryClient.invalidateQueries({ queryKey: executionKeys.list(workspaceId) });
        queryClient.invalidateQueries({ queryKey: executionKeys.activity(workspaceId) });
      }
    };

    void tick();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, activeKey]);

  return activeIds;
}

export function useRuntime(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const start = useServerFn(startExecutionFn);
  const cancel = useServerFn(cancelExecutionFn);
  const dispatch = useServerFn(dispatchQueueFn);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: executionKeys.list(workspaceId ?? "none") });
    queryClient.invalidateQueries({ queryKey: executionKeys.activity(workspaceId ?? "none") });
  };

  return {
    startExecution: useMutation({
      mutationFn: async (
        request: Omit<RuntimeRequest, "workspaceId" | "actorId"> & { idempotencyKey?: string },
      ) => {
        const result = await start({
          data: {
            workspaceId: workspaceId!,
            workflowId: request.workflowId,
            workflowVersion: request.workflowVersion,
            workflowName: request.workflowName,
            graph: request.graph as never,
            workerId: request.workerId ?? null,
            workerName: request.workerName ?? null,
            priority: request.priority ?? 5,
            maxAttempts: request.maxAttempts ?? 1,
            timeoutSeconds: request.timeoutSeconds ?? 300,
            concurrencyLimit: request.concurrencyLimit ?? 1,
            trigger: request.trigger ?? "manual",
            idempotencyKey: request.idempotencyKey ?? null,
          },
        });
        // Kick the queue immediately so the run starts without waiting a tick.
        void dispatch({ data: { workspaceId: workspaceId!, max: 3, budgetMs: 15000 } }).then(
          invalidate,
          () => undefined,
        );
        return result;
      },
      onSuccess: invalidate,
    }),
    cancelExecution: useMutation({
      mutationFn: (executionId: string) =>
        cancel({ data: { workspaceId: workspaceId!, executionId } }),
      onSuccess: invalidate,
    }),
  };
}
