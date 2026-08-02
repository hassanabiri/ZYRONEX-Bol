import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  knowledgeService,
  type DocumentInsert,
  type DocumentPatch,
  type KnowledgeBase,
  type KnowledgeBaseDefinition,
  type KnowledgeBaseInsert,
  type KnowledgeBasePatch,
  type KnowledgeDocument,
} from "@/services/knowledge-service";

export const knowledgeKeys = {
  bases: (workspaceId: string) => ["workspace", workspaceId, "knowledge-bases"] as const,
  documents: (baseId: string) => ["knowledge-base", baseId, "documents"] as const,
  allDocuments: (workspaceId: string) => ["workspace", workspaceId, "documents"] as const,
  folders: (baseId: string) => ["knowledge-base", baseId, "folders"] as const,
  versions: (baseId: string) => ["knowledge-base", baseId, "versions"] as const,
  links: (workspaceId: string) => ["workspace", workspaceId, "worker-knowledge"] as const,
  search: (workspaceId: string, term: string, baseId?: string) =>
    ["workspace", workspaceId, "knowledge-search", term, baseId ?? "all"] as const,
};

export function useKnowledgeBases(workspaceId: string | undefined) {
  return useQuery({
    queryKey: knowledgeKeys.bases(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => knowledgeService.listBases(workspaceId!),
  });
}

export function useKnowledgeDocuments(baseId: string | undefined) {
  return useQuery({
    queryKey: knowledgeKeys.documents(baseId ?? "none"),
    enabled: Boolean(baseId),
    queryFn: () => knowledgeService.listDocuments(baseId!),
  });
}

export function useWorkspaceDocuments(workspaceId: string | undefined) {
  return useQuery({
    queryKey: knowledgeKeys.allDocuments(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => knowledgeService.listWorkspaceDocuments(workspaceId!),
  });
}

export function useKnowledgeFolders(baseId: string | undefined) {
  return useQuery({
    queryKey: knowledgeKeys.folders(baseId ?? "none"),
    enabled: Boolean(baseId),
    queryFn: () => knowledgeService.listFolders(baseId!),
  });
}

export function useKnowledgeVersions(baseId: string | undefined) {
  return useQuery({
    queryKey: knowledgeKeys.versions(baseId ?? "none"),
    enabled: Boolean(baseId),
    queryFn: () => knowledgeService.listBaseVersions(baseId!),
  });
}

export function useWorkerKnowledgeLinks(workspaceId: string | undefined) {
  return useQuery({
    queryKey: knowledgeKeys.links(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => knowledgeService.listWorkerLinks(workspaceId!),
  });
}

export function useKnowledgeSearch(workspaceId: string | undefined, term: string, baseId?: string) {
  const query = term.trim();
  return useQuery({
    queryKey: knowledgeKeys.search(workspaceId ?? "none", query, baseId),
    enabled: Boolean(workspaceId) && query.length > 1,
    queryFn: () => knowledgeService.search(workspaceId!, query, baseId),
  });
}

export function useKnowledgeMutations(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "";

  const invalidateBases = () =>
    queryClient.invalidateQueries({ queryKey: knowledgeKeys.bases(id) });
  const invalidateDocuments = (baseId: string) => {
    queryClient.invalidateQueries({ queryKey: knowledgeKeys.documents(baseId) });
    queryClient.invalidateQueries({ queryKey: knowledgeKeys.allDocuments(id) });
  };

  return {
    createBase: useMutation({
      mutationFn: (input: KnowledgeBaseInsert) => knowledgeService.createBase(id, input, user?.id),
      onSuccess: invalidateBases,
    }),
    updateBase: useMutation({
      mutationFn: (input: { baseId: string; patch: KnowledgeBasePatch }) =>
        knowledgeService.updateBase(input.baseId, input.patch, user?.id),
      onSuccess: invalidateBases,
    }),
    deleteBase: useMutation({
      mutationFn: (base: KnowledgeBase) => knowledgeService.removeBase(base, user?.id),
      onSuccess: invalidateBases,
    }),
    duplicateBase: useMutation({
      mutationFn: (base: KnowledgeBase) => knowledgeService.duplicateBase(base, user?.id),
      onSuccess: invalidateBases,
    }),
    importBase: useMutation({
      mutationFn: (definition: Partial<KnowledgeBaseDefinition> & { name: string }) =>
        knowledgeService.importBase(id, definition, user?.id),
      onSuccess: invalidateBases,
    }),
    snapshotBase: useMutation({
      mutationFn: (input: { base: KnowledgeBase; label?: string }) =>
        knowledgeService.snapshotBase(input.base, user?.id, input.label),
      onSuccess: (_data, vars) => {
        invalidateBases();
        queryClient.invalidateQueries({ queryKey: knowledgeKeys.versions(vars.base.id) });
      },
    }),
    createFolder: useMutation({
      mutationFn: (input: { base: KnowledgeBase; name: string; parentId?: string | null }) =>
        knowledgeService.createFolder(input.base, input.name, input.parentId),
      onSuccess: (_data, vars) =>
        queryClient.invalidateQueries({ queryKey: knowledgeKeys.folders(vars.base.id) }),
    }),
    deleteFolder: useMutation({
      mutationFn: (input: { baseId: string; folderId: string }) =>
        knowledgeService.removeFolder(input.folderId),
      onSuccess: (_data, vars) =>
        queryClient.invalidateQueries({ queryKey: knowledgeKeys.folders(vars.baseId) }),
    }),
    createDocument: useMutation({
      mutationFn: (input: DocumentInsert) => knowledgeService.createDocument(id, input, user?.id),
      onSuccess: (data) => invalidateDocuments(data.knowledge_base_id),
    }),
    updateDocument: useMutation({
      mutationFn: (input: { documentId: string; patch: DocumentPatch }) =>
        knowledgeService.updateDocument(input.documentId, input.patch),
      onSuccess: (data) => invalidateDocuments(data.knowledge_base_id),
    }),
    advanceDocument: useMutation({
      mutationFn: (document: KnowledgeDocument) => knowledgeService.advanceDocument(document),
      onSuccess: (data) => invalidateDocuments(data.knowledge_base_id),
    }),
    reindexDocument: useMutation({
      mutationFn: (document: KnowledgeDocument) => knowledgeService.reindexDocument(document),
      onSuccess: (data) => invalidateDocuments(data.knowledge_base_id),
    }),
    deleteDocument: useMutation({
      mutationFn: (document: KnowledgeDocument) => knowledgeService.removeDocument(document.id),
      onSuccess: (_data, vars) => invalidateDocuments(vars.knowledge_base_id),
    }),
    snapshotDocument: useMutation({
      mutationFn: (document: KnowledgeDocument) =>
        knowledgeService.snapshotDocument(document, user?.id),
      onSuccess: (_data, vars) => invalidateDocuments(vars.knowledge_base_id),
    }),
    assignWorker: useMutation({
      mutationFn: (input: { workerId: string; knowledgeBaseId: string; priority?: number }) =>
        knowledgeService.assignWorker({ workspaceId: id, ...input }),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.links(id) }),
    }),
    updateWorkerLink: useMutation({
      mutationFn: (input: { linkId: string; patch: { priority?: number; enabled?: boolean } }) =>
        knowledgeService.updateWorkerLink(input.linkId, input.patch),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.links(id) }),
    }),
    unassignWorker: useMutation({
      mutationFn: (linkId: string) => knowledgeService.unassignWorker(linkId),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.links(id) }),
    }),
  };
}
