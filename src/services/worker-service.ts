import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type Worker = Tables<"ai_workers">;
export type WorkerNote = Tables<"worker_notes">;
export type WorkerActivity = Tables<"worker_activity">;
export type WorkerVersion = Tables<"worker_versions">;

export type WorkerInsert = Omit<TablesInsert<"ai_workers">, "workspace_id" | "created_by">;
export type WorkerPatch = TablesUpdate<"ai_workers">;

/** Fields that make up an exported / imported worker definition. */
export const WORKER_EXPORT_FIELDS = [
  "name",
  "description",
  "avatar_url",
  "color",
  "icon",
  "type",
  "purpose",
  "provider",
  "model",
  "language",
  "timezone",
  "region",
  "tags",
] as const;

export type WorkerDefinition = Pick<Worker, (typeof WORKER_EXPORT_FIELDS)[number]>;

export function toDefinition(worker: Worker): WorkerDefinition {
  return WORKER_EXPORT_FIELDS.reduce((acc, key) => {
    // @ts-expect-error narrow copy across a heterogeneous key union
    acc[key] = worker[key];
    return acc;
  }, {} as WorkerDefinition);
}

/**
 * Database layer for AI Workers. Tenant isolation is enforced by RLS —
 * every query is still scoped by workspace_id for correctness and indexing.
 */
export const workerService = {
  async list(workspaceId: string): Promise<Worker[]> {
    const { data, error } = await supabase
      .from("ai_workers")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async get(workerId: string): Promise<Worker | null> {
    const { data, error } = await supabase
      .from("ai_workers")
      .select("*")
      .eq("id", workerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(workspaceId: string, input: WorkerInsert, actorId?: string): Promise<Worker> {
    const { data, error } = await supabase
      .from("ai_workers")
      .insert({ ...input, workspace_id: workspaceId, created_by: actorId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    await workerService.log(data, actorId, "created", `Worker "${data.name}" created`);
    await workerService.snapshot(data, actorId, "Initial version");
    return data;
  },

  async update(workerId: string, patch: WorkerPatch, actorId?: string): Promise<Worker> {
    const { data, error } = await supabase
      .from("ai_workers")
      .update(patch)
      .eq("id", workerId)
      .select("*")
      .single();
    if (error) throw error;
    const action = patch.status ? `status.${patch.status}` : "updated";
    await workerService.log(data, actorId, action, `Worker "${data.name}" updated`);
    return data;
  },

  async remove(workerId: string) {
    const { error } = await supabase.from("ai_workers").delete().eq("id", workerId);
    if (error) throw error;
  },

  async duplicate(worker: Worker, actorId?: string): Promise<Worker> {
    return workerService.create(
      worker.workspace_id,
      { ...toDefinition(worker), name: `${worker.name} (copy)`, status: "draft" },
      actorId,
    );
  },

  async importDefinition(
    workspaceId: string,
    definition: Partial<WorkerDefinition> & { name: string },
    actorId?: string,
  ): Promise<Worker> {
    return workerService.create(workspaceId, { ...definition, status: "draft" }, actorId);
  },

  // Notes ---------------------------------------------------------------
  async listNotes(workerId: string): Promise<WorkerNote[]> {
    const { data, error } = await supabase
      .from("worker_notes")
      .select("*")
      .eq("worker_id", workerId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async addNote(worker: Worker, body: string, actorId: string) {
    const { error } = await supabase.from("worker_notes").insert({
      worker_id: worker.id,
      workspace_id: worker.workspace_id,
      author_id: actorId,
      body,
    });
    if (error) throw error;
    await workerService.log(worker, actorId, "note.added", "Internal note added");
  },

  async removeNote(noteId: string) {
    const { error } = await supabase.from("worker_notes").delete().eq("id", noteId);
    if (error) throw error;
  },

  // Activity ------------------------------------------------------------
  async listActivity(workerId: string): Promise<WorkerActivity[]> {
    const { data, error } = await supabase
      .from("worker_activity")
      .select("*")
      .eq("worker_id", workerId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  /** Best-effort timeline entry — never blocks the primary mutation. */
  async log(worker: Worker, actorId: string | undefined, action: string, detail?: string) {
    await supabase
      .from("worker_activity")
      .insert({
        worker_id: worker.id,
        workspace_id: worker.workspace_id,
        actor_id: actorId ?? null,
        action,
        detail: detail ?? null,
      })
      .then(undefined, () => undefined);
  },

  // Versions ------------------------------------------------------------
  async listVersions(workerId: string): Promise<WorkerVersion[]> {
    const { data, error } = await supabase
      .from("worker_versions")
      .select("*")
      .eq("worker_id", workerId)
      .order("version", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async snapshot(worker: Worker, actorId: string | undefined, label?: string) {
    const versions = await workerService.listVersions(worker.id).catch(() => []);
    const next = (versions[0]?.version ?? 0) + 1;
    const { error } = await supabase.from("worker_versions").insert({
      worker_id: worker.id,
      workspace_id: worker.workspace_id,
      version: next,
      label: label ?? `Version ${next}`,
      snapshot: JSON.parse(JSON.stringify(toDefinition(worker))),
      created_by: actorId ?? null,
    });
    if (error) throw error;
  },
};
