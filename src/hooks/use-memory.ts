import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  memoryService,
  type MemoryEntry,
  type MemoryEntryPatch,
  type MemoryStore,
  type MemoryStoreInsert,
  type MemoryStorePatch,
} from "@/services/memory-service";

export const memoryKeys = {
  stores: (workspaceId: string) => ["workspace", workspaceId, "memory-stores"] as const,
  entries: (workspaceId: string, storeId?: string) =>
    ["workspace", workspaceId, "memory-entries", storeId ?? "all"] as const,
  events: (workspaceId: string) => ["workspace", workspaceId, "memory-events"] as const,
};

export function useMemoryStores(workspaceId: string | undefined) {
  return useQuery({
    queryKey: memoryKeys.stores(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => memoryService.listStores(workspaceId!),
  });
}

export function useMemoryEntries(workspaceId: string | undefined, storeId?: string) {
  return useQuery({
    queryKey: memoryKeys.entries(workspaceId ?? "none", storeId),
    enabled: Boolean(workspaceId),
    queryFn: () => memoryService.listEntries(workspaceId!, storeId),
  });
}

export function useMemoryEvents(workspaceId: string | undefined) {
  return useQuery({
    queryKey: memoryKeys.events(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => memoryService.listEvents(workspaceId!),
  });
}

export function useMemoryMutations(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "";

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: memoryKeys.stores(id) });
    queryClient.invalidateQueries({ queryKey: ["workspace", id, "memory-entries"] });
    queryClient.invalidateQueries({ queryKey: memoryKeys.events(id) });
  };

  return {
    createStore: useMutation({
      mutationFn: (input: MemoryStoreInsert) => memoryService.createStore(id, input, user?.id),
      onSuccess: invalidateAll,
    }),
    updateStore: useMutation({
      mutationFn: (input: { storeId: string; patch: MemoryStorePatch }) =>
        memoryService.updateStore(input.storeId, input.patch),
      onSuccess: invalidateAll,
    }),
    deleteStore: useMutation({
      mutationFn: (storeId: string) => memoryService.removeStore(storeId),
      onSuccess: invalidateAll,
    }),
    createEntry: useMutation({
      mutationFn: (input: {
        store: MemoryStore;
        key: string;
        content: string;
        importance: number;
        worker_id?: string | null;
      }) =>
        memoryService.createEntry(
          input.store,
          {
            key: input.key,
            content: input.content,
            importance: input.importance,
            worker_id: input.worker_id ?? null,
          },
          user?.id,
        ),
      onSuccess: invalidateAll,
    }),
    updateEntry: useMutation({
      mutationFn: (input: { entry: MemoryEntry; patch: MemoryEntryPatch }) =>
        memoryService.updateEntry(input.entry, input.patch, user?.id),
      onSuccess: invalidateAll,
    }),
    touchEntry: useMutation({
      mutationFn: (entry: MemoryEntry) => memoryService.touchEntry(entry, user?.id),
      onSuccess: invalidateAll,
    }),
    deleteEntry: useMutation({
      mutationFn: (entry: MemoryEntry) => memoryService.removeEntry(entry, user?.id),
      onSuccess: invalidateAll,
    }),
    expireStale: useMutation({
      mutationFn: () => memoryService.expireStale(id, user?.id),
      onSuccess: invalidateAll,
    }),
    compactStore: useMutation({
      mutationFn: (store: MemoryStore) => memoryService.compactStore(store, user?.id),
      onSuccess: invalidateAll,
    }),
    resetStore: useMutation({
      mutationFn: (store: MemoryStore) => memoryService.resetStore(store, user?.id),
      onSuccess: invalidateAll,
    }),
  };
}
