import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import type { WorkflowGraph } from "@/lib/execution/graph";
import {
  workflowService,
  type Workflow,
  type WorkflowDefinition,
  type WorkflowInsert,
  type WorkflowPatch,
  type WorkflowVersion,
} from "@/services/workflow-service";

export const workflowKeys = {
  list: (workspaceId: string) => ["workspace", workspaceId, "workflows"] as const,
  detail: (workflowId: string) => ["workflow", workflowId] as const,
  versions: (workflowId: string) => ["workflow", workflowId, "versions"] as const,
  workers: (workflowId: string) => ["workflow", workflowId, "workers"] as const,
};

export function useWorkflows(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.list(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => workflowService.list(workspaceId!),
  });
}

export function useWorkflow(workflowId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.detail(workflowId ?? "none"),
    enabled: Boolean(workflowId),
    queryFn: () => workflowService.get(workflowId!),
  });
}

export function useWorkflowVersions(workflowId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.versions(workflowId ?? "none"),
    enabled: Boolean(workflowId),
    queryFn: () => workflowService.listVersions(workflowId!),
  });
}

export function useWorkflowWorkers(workflowId: string | undefined) {
  return useQuery({
    queryKey: workflowKeys.workers(workflowId ?? "none"),
    enabled: Boolean(workflowId),
    queryFn: () => workflowService.listWorkers(workflowId!),
  });
}

export function useWorkflowMutations(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "";

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: workflowKeys.list(id) });
  const invalidateOne = (workflowId: string) => {
    invalidateList();
    queryClient.invalidateQueries({ queryKey: workflowKeys.detail(workflowId) });
    queryClient.invalidateQueries({ queryKey: workflowKeys.versions(workflowId) });
  };

  return {
    createWorkflow: useMutation({
      mutationFn: (input: WorkflowInsert) => workflowService.create(id, input, user?.id),
      onSuccess: invalidateList,
    }),
    updateWorkflow: useMutation({
      mutationFn: (input: { workflowId: string; patch: WorkflowPatch }) =>
        workflowService.update(input.workflowId, input.patch, user?.id),
      onSuccess: (_data, vars) => invalidateOne(vars.workflowId),
    }),
    saveGraph: useMutation({
      mutationFn: (input: { workflowId: string; graph: WorkflowGraph }) =>
        workflowService.saveGraph(input.workflowId, input.graph),
      onSuccess: (data) => queryClient.setQueryData(workflowKeys.detail(data.id), data),
    }),
    publishWorkflow: useMutation({
      mutationFn: (workflow: Workflow) => workflowService.publish(workflow, user?.id),
      onSuccess: (data) => invalidateOne(data.id),
    }),
    deleteWorkflow: useMutation({
      mutationFn: (workflow: Workflow) => workflowService.remove(workflow, user?.id),
      onSuccess: invalidateList,
    }),
    duplicateWorkflow: useMutation({
      mutationFn: (workflow: Workflow) => workflowService.duplicate(workflow, user?.id),
      onSuccess: invalidateList,
    }),
    importWorkflow: useMutation({
      mutationFn: (definition: Partial<WorkflowDefinition> & { name: string }) =>
        workflowService.importDefinition(id, definition, user?.id),
      onSuccess: invalidateList,
    }),
    snapshotWorkflow: useMutation({
      mutationFn: (input: { workflow: Workflow; label?: string }) =>
        workflowService.snapshot(input.workflow, user?.id, input.label),
      onSuccess: (_data, vars) => invalidateOne(vars.workflow.id),
    }),
    restoreVersion: useMutation({
      mutationFn: (input: { workflow: Workflow; version: WorkflowVersion }) =>
        workflowService.restoreVersion(input.workflow, input.version, user?.id),
      onSuccess: (data) => invalidateOne(data.id),
    }),
    assignWorker: useMutation({
      mutationFn: (input: { workflow: Workflow; workerId: string }) =>
        workflowService.assignWorker(input.workflow, input.workerId),
      onSuccess: (_data, vars) =>
        queryClient.invalidateQueries({ queryKey: workflowKeys.workers(vars.workflow.id) }),
    }),
    unassignWorker: useMutation({
      mutationFn: (input: { workflowId: string; workerId: string }) =>
        workflowService.unassignWorker(input.workflowId, input.workerId),
      onSuccess: (_data, vars) =>
        queryClient.invalidateQueries({ queryKey: workflowKeys.workers(vars.workflowId) }),
    }),
  };
}
