import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  workerService,
  type Worker,
  type WorkerDefinition,
  type WorkerInsert,
  type WorkerPatch,
} from "@/services/worker-service";

export const workerKeys = {
  list: (workspaceId: string) => ["workspace", workspaceId, "workers"] as const,
  detail: (workerId: string) => ["worker", workerId] as const,
  notes: (workerId: string) => ["worker", workerId, "notes"] as const,
  activity: (workerId: string) => ["worker", workerId, "activity"] as const,
  versions: (workerId: string) => ["worker", workerId, "versions"] as const,
};

export function useWorkers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workerKeys.list(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => workerService.list(workspaceId!),
  });
}

export function useWorker(workerId: string | undefined) {
  return useQuery({
    queryKey: workerKeys.detail(workerId ?? "none"),
    enabled: Boolean(workerId),
    queryFn: () => workerService.get(workerId!),
  });
}

export function useWorkerNotes(workerId: string | undefined) {
  return useQuery({
    queryKey: workerKeys.notes(workerId ?? "none"),
    enabled: Boolean(workerId),
    queryFn: () => workerService.listNotes(workerId!),
  });
}

export function useWorkerActivity(workerId: string | undefined) {
  return useQuery({
    queryKey: workerKeys.activity(workerId ?? "none"),
    enabled: Boolean(workerId),
    queryFn: () => workerService.listActivity(workerId!),
  });
}

export function useWorkerVersions(workerId: string | undefined) {
  return useQuery({
    queryKey: workerKeys.versions(workerId ?? "none"),
    enabled: Boolean(workerId),
    queryFn: () => workerService.listVersions(workerId!),
  });
}

export function useWorkerMutations(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "";

  const invalidateList = () =>
    queryClient.invalidateQueries({ queryKey: workerKeys.list(id) });

  const invalidateWorker = (workerId: string) => {
    invalidateList();
    queryClient.invalidateQueries({ queryKey: workerKeys.detail(workerId) });
    queryClient.invalidateQueries({ queryKey: workerKeys.activity(workerId) });
  };

  const createWorker = useMutation({
    mutationFn: (input: WorkerInsert) => workerService.create(id, input, user?.id),
    onSuccess: invalidateList,
  });

  const updateWorker = useMutation({
    mutationFn: (input: { workerId: string; patch: WorkerPatch }) =>
      workerService.update(input.workerId, input.patch, user?.id),
    onSuccess: (_data, vars) => invalidateWorker(vars.workerId),
  });

  const deleteWorker = useMutation({
    mutationFn: (workerId: string) => workerService.remove(workerId),
    onSuccess: invalidateList,
  });

  const duplicateWorker = useMutation({
    mutationFn: (worker: Worker) => workerService.duplicate(worker, user?.id),
    onSuccess: invalidateList,
  });

  const importWorker = useMutation({
    mutationFn: (definition: Partial<WorkerDefinition> & { name: string }) =>
      workerService.importDefinition(id, definition, user?.id),
    onSuccess: invalidateList,
  });

  const addNote = useMutation({
    mutationFn: (input: { worker: Worker; body: string }) =>
      workerService.addNote(input.worker, input.body, user!.id),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: workerKeys.notes(vars.worker.id) });
      queryClient.invalidateQueries({ queryKey: workerKeys.activity(vars.worker.id) });
    },
  });

  const deleteNote = useMutation({
    mutationFn: (input: { workerId: string; noteId: string }) =>
      workerService.removeNote(input.noteId),
    onSuccess: (_data, vars) =>
      queryClient.invalidateQueries({ queryKey: workerKeys.notes(vars.workerId) }),
  });

  const createVersion = useMutation({
    mutationFn: (input: { worker: Worker; label?: string }) =>
      workerService.snapshot(input.worker, user?.id, input.label),
    onSuccess: (_data, vars) =>
      queryClient.invalidateQueries({ queryKey: workerKeys.versions(vars.worker.id) }),
  });

  return {
    createWorker,
    updateWorker,
    deleteWorker,
    duplicateWorker,
    importWorker,
    addNote,
    deleteNote,
    createVersion,
  };
}
