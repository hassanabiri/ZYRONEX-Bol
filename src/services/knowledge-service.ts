import { supabase } from "@/integrations/supabase/client";
import type { Enums, Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { activityService } from "@/services/activity-service";

export type KnowledgeBase = Tables<"knowledge_bases">;
export type KnowledgeFolder = Tables<"knowledge_folders">;
export type KnowledgeDocument = Tables<"knowledge_documents">;
export type KnowledgeBaseVersion = Tables<"knowledge_base_versions">;
export type KnowledgeDocumentVersion = Tables<"knowledge_document_versions">;
export type WorkerKnowledge = Tables<"worker_knowledge">;

export type DocumentStatus = Enums<"document_status">;
export type KnowledgeSource = Enums<"knowledge_source">;

export type KnowledgeBaseInsert = Omit<
  TablesInsert<"knowledge_bases">,
  "workspace_id" | "created_by"
>;
export type KnowledgeBasePatch = TablesUpdate<"knowledge_bases">;
export type DocumentInsert = Omit<
  TablesInsert<"knowledge_documents">,
  "workspace_id" | "created_by"
>;
export type DocumentPatch = TablesUpdate<"knowledge_documents">;

/** Ordered ingestion stages — the pipeline surface renders these in order. */
export const PIPELINE_STAGES: DocumentStatus[] = [
  "uploaded",
  "scanning",
  "extracting",
  "cleaning",
  "chunking",
  "embedding_ready",
  "indexed",
  "available",
];

export const KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  "pdf",
  "word",
  "excel",
  "csv",
  "txt",
  "markdown",
  "website",
  "faq",
  "manual",
  "database",
  "api",
  "cloud_storage",
  "notion",
  "google_drive",
];

export const KNOWLEDGE_CATEGORIES = [
  "general",
  "product",
  "support",
  "sales",
  "engineering",
  "legal",
  "hr",
  "finance",
];

const KB_EXPORT_FIELDS = ["name", "description", "category", "tags", "status"] as const;
export type KnowledgeBaseDefinition = Pick<KnowledgeBase, (typeof KB_EXPORT_FIELDS)[number]>;

export function toKnowledgeDefinition(base: KnowledgeBase): KnowledgeBaseDefinition {
  return {
    name: base.name,
    description: base.description,
    category: base.category,
    tags: base.tags,
    status: base.status,
  };
}

/**
 * Database layer for the Knowledge Engine. Tenant isolation is enforced by
 * RLS; every query is still scoped by workspace_id for correctness.
 */
export const knowledgeService = {
  // Knowledge bases -----------------------------------------------------
  async listBases(workspaceId: string): Promise<KnowledgeBase[]> {
    const { data, error } = await supabase
      .from("knowledge_bases")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async getBase(baseId: string): Promise<KnowledgeBase | null> {
    const { data, error } = await supabase
      .from("knowledge_bases")
      .select("*")
      .eq("id", baseId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async createBase(
    workspaceId: string,
    input: KnowledgeBaseInsert,
    actorId?: string,
  ): Promise<KnowledgeBase> {
    const { data, error } = await supabase
      .from("knowledge_bases")
      .insert({ ...input, workspace_id: workspaceId, created_by: actorId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(workspaceId, {
      actor_id: actorId ?? null,
      entity_type: "knowledge_base",
      entity_id: data.id,
      action: "knowledge.created",
      detail: `Knowledge base "${data.name}" created`,
      result: "success",
    });
    return data;
  },

  async updateBase(
    baseId: string,
    patch: KnowledgeBasePatch,
    actorId?: string,
  ): Promise<KnowledgeBase> {
    const { data, error } = await supabase
      .from("knowledge_bases")
      .update(patch)
      .eq("id", baseId)
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(data.workspace_id, {
      actor_id: actorId ?? null,
      entity_type: "knowledge_base",
      entity_id: data.id,
      action: patch.status ? `knowledge.${patch.status}` : "knowledge.updated",
      detail: `Knowledge base "${data.name}" updated`,
      result: "success",
    });
    return data;
  },

  async removeBase(base: KnowledgeBase, actorId?: string) {
    const { error } = await supabase.from("knowledge_bases").delete().eq("id", base.id);
    if (error) throw error;
    await activityService.log(base.workspace_id, {
      actor_id: actorId ?? null,
      entity_type: "knowledge_base",
      entity_id: base.id,
      action: "knowledge.deleted",
      detail: `Knowledge base "${base.name}" deleted`,
      result: "success",
    });
  },

  async duplicateBase(base: KnowledgeBase, actorId?: string): Promise<KnowledgeBase> {
    const copy = await knowledgeService.createBase(
      base.workspace_id,
      { ...toKnowledgeDefinition(base), name: `${base.name} (copy)`, status: "draft" },
      actorId,
    );
    const documents = await knowledgeService.listDocuments(base.id);
    for (const doc of documents) {
      await knowledgeService.createDocument(
        base.workspace_id,
        {
          knowledge_base_id: copy.id,
          name: doc.name,
          description: doc.description,
          source: doc.source,
          source_url: doc.source_url,
          content: doc.content,
          tags: doc.tags,
          size_bytes: doc.size_bytes,
          status: "uploaded",
        },
        actorId,
      );
    }
    return copy;
  },

  async importBase(
    workspaceId: string,
    definition: Partial<KnowledgeBaseDefinition> & { name: string },
    actorId?: string,
  ) {
    return knowledgeService.createBase(
      workspaceId,
      { ...definition, status: "draft" },
      actorId,
    );
  },

  // Versions ------------------------------------------------------------
  async listBaseVersions(baseId: string): Promise<KnowledgeBaseVersion[]> {
    const { data, error } = await supabase
      .from("knowledge_base_versions")
      .select("*")
      .eq("knowledge_base_id", baseId)
      .order("version", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async snapshotBase(base: KnowledgeBase, actorId?: string, label?: string) {
    const versions = await knowledgeService.listBaseVersions(base.id).catch(() => []);
    const next = (versions[0]?.version ?? 0) + 1;
    const { error } = await supabase.from("knowledge_base_versions").insert({
      workspace_id: base.workspace_id,
      knowledge_base_id: base.id,
      version: next,
      label: label ?? `Version ${next}`,
      snapshot: JSON.parse(JSON.stringify(toKnowledgeDefinition(base))),
      created_by: actorId ?? null,
    });
    if (error) throw error;
    await supabase.from("knowledge_bases").update({ version: next }).eq("id", base.id);
  },

  // Folders --------------------------------------------------------------
  async listFolders(baseId: string): Promise<KnowledgeFolder[]> {
    const { data, error } = await supabase
      .from("knowledge_folders")
      .select("*")
      .eq("knowledge_base_id", baseId)
      .order("name");
    if (error) throw error;
    return data ?? [];
  },

  async createFolder(base: KnowledgeBase, name: string, parentId?: string | null) {
    const { data, error } = await supabase
      .from("knowledge_folders")
      .insert({
        workspace_id: base.workspace_id,
        knowledge_base_id: base.id,
        parent_id: parentId ?? null,
        name,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removeFolder(folderId: string) {
    const { error } = await supabase.from("knowledge_folders").delete().eq("id", folderId);
    if (error) throw error;
  },

  // Documents ------------------------------------------------------------
  async listDocuments(baseId: string): Promise<KnowledgeDocument[]> {
    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("knowledge_base_id", baseId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listWorkspaceDocuments(workspaceId: string): Promise<KnowledgeDocument[]> {
    const { data, error } = await supabase
      .from("knowledge_documents")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createDocument(
    workspaceId: string,
    input: DocumentInsert,
    actorId?: string,
  ): Promise<KnowledgeDocument> {
    const { data, error } = await supabase
      .from("knowledge_documents")
      .insert({
        ...input,
        workspace_id: workspaceId,
        created_by: actorId ?? null,
        token_estimate: input.content ? Math.ceil(input.content.length / 4) : 0,
      })
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(workspaceId, {
      actor_id: actorId ?? null,
      entity_type: "knowledge_document",
      entity_id: data.id,
      action: "document.created",
      detail: `Document "${data.name}" added`,
      result: "success",
    });
    return data;
  },

  async updateDocument(documentId: string, patch: DocumentPatch): Promise<KnowledgeDocument> {
    const { data, error } = await supabase
      .from("knowledge_documents")
      .update(patch)
      .eq("id", documentId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removeDocument(documentId: string) {
    const { error } = await supabase.from("knowledge_documents").delete().eq("id", documentId);
    if (error) throw error;
  },

  /**
   * Advances a document one stage through the ingestion pipeline. The
   * transport (extraction, embedding) is not implemented yet — this records
   * the deterministic state machine the pipeline workers will drive.
   */
  async advanceDocument(document: KnowledgeDocument): Promise<KnowledgeDocument> {
    const index = PIPELINE_STAGES.indexOf(document.status);
    const next: DocumentStatus =
      PIPELINE_STAGES[Math.min(index + 1, PIPELINE_STAGES.length - 1)] ?? "available";
    const chunkSize = 1200;
    const chunks = document.content
      ? Math.max(1, Math.ceil(document.content.length / chunkSize))
      : document.chunk_count;
    return knowledgeService.updateDocument(document.id, {
      status: next,
      error: null,
      chunk_count: next === "chunking" || next === "embedding_ready" ? chunks : document.chunk_count,
      indexed_at: next === "available" ? new Date().toISOString() : document.indexed_at,
    });
  },

  async reindexDocument(document: KnowledgeDocument) {
    return knowledgeService.updateDocument(document.id, {
      status: "reindex",
      chunk_count: 0,
      indexed_at: null,
      error: null,
    });
  },

  async listDocumentVersions(documentId: string): Promise<KnowledgeDocumentVersion[]> {
    const { data, error } = await supabase
      .from("knowledge_document_versions")
      .select("*")
      .eq("document_id", documentId)
      .order("version", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async snapshotDocument(document: KnowledgeDocument, actorId?: string, label?: string) {
    const versions = await knowledgeService.listDocumentVersions(document.id).catch(() => []);
    const next = (versions[0]?.version ?? 0) + 1;
    const { error } = await supabase.from("knowledge_document_versions").insert({
      workspace_id: document.workspace_id,
      document_id: document.id,
      version: next,
      label: label ?? `Version ${next}`,
      snapshot: JSON.parse(
        JSON.stringify({
          name: document.name,
          description: document.description,
          content: document.content,
          tags: document.tags,
          source: document.source,
        }),
      ),
      created_by: actorId ?? null,
    });
    if (error) throw error;
    await knowledgeService.updateDocument(document.id, { version: next });
  },

  // Worker assignment ----------------------------------------------------
  async listWorkerLinks(workspaceId: string): Promise<WorkerKnowledge[]> {
    const { data, error } = await supabase
      .from("worker_knowledge")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("priority", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async assignWorker(input: {
    workspaceId: string;
    workerId: string;
    knowledgeBaseId: string;
    priority?: number;
  }) {
    const { error } = await supabase.from("worker_knowledge").upsert(
      {
        workspace_id: input.workspaceId,
        worker_id: input.workerId,
        knowledge_base_id: input.knowledgeBaseId,
        priority: input.priority ?? 1,
      },
      { onConflict: "worker_id,knowledge_base_id" },
    );
    if (error) throw error;
  },

  async updateWorkerLink(linkId: string, patch: TablesUpdate<"worker_knowledge">) {
    const { error } = await supabase.from("worker_knowledge").update(patch).eq("id", linkId);
    if (error) throw error;
  },

  async unassignWorker(linkId: string) {
    const { error } = await supabase.from("worker_knowledge").delete().eq("id", linkId);
    if (error) throw error;
  },

  // Search ---------------------------------------------------------------
  /** Keyword search across document titles and extracted text. */
  async search(workspaceId: string, term: string, baseId?: string) {
    const pattern = `%${term.replace(/[%_]/g, "")}%`;
    let query = supabase
      .from("knowledge_documents")
      .select("*")
      .eq("workspace_id", workspaceId)
      .or(`name.ilike.${pattern},content.ilike.${pattern},description.ilike.${pattern}`)
      .limit(30);
    if (baseId) query = query.eq("knowledge_base_id", baseId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },
};
