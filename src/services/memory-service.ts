import { supabase } from "@/integrations/supabase/client";
import type { Enums, Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { activityService } from "@/services/activity-service";

export type MemoryStore = Tables<"memory_stores">;
export type MemoryEntry = Tables<"memory_entries">;
export type MemoryEvent = Tables<"memory_events">;
export type MemoryLayer = Enums<"memory_layer">;
export type MemoryEventType = Enums<"memory_event_type">;

export type MemoryStoreInsert = Omit<TablesInsert<"memory_stores">, "workspace_id" | "created_by">;
export type MemoryStorePatch = TablesUpdate<"memory_stores">;
export type MemoryEntryInsert = Omit<TablesInsert<"memory_entries">, "workspace_id" | "created_by">;
export type MemoryEntryPatch = TablesUpdate<"memory_entries">;

export const MEMORY_LAYERS: { layer: MemoryLayer; label: string; description: string }[] = [
  {
    layer: "short_term",
    label: "Short-term",
    description: "Recent turns kept for the duration of an active conversation.",
  },
  {
    layer: "session",
    label: "Session",
    description: "Everything captured while a single session is open.",
  },
  {
    layer: "long_term",
    label: "Long-term",
    description: "Distilled facts promoted after summarization.",
  },
  {
    layer: "persistent",
    label: "Persistent",
    description: "Durable profile knowledge that never expires automatically.",
  },
];

export function layerLabel(layer: MemoryLayer) {
  return MEMORY_LAYERS.find((item) => item.layer === layer)?.label ?? layer;
}

/** Database layer for the Memory Engine. */
export const memoryService = {
  // Stores ---------------------------------------------------------------
  async listStores(workspaceId: string): Promise<MemoryStore[]> {
    const { data, error } = await supabase
      .from("memory_stores")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("priority", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createStore(
    workspaceId: string,
    input: MemoryStoreInsert,
    actorId?: string,
  ): Promise<MemoryStore> {
    const { data, error } = await supabase
      .from("memory_stores")
      .insert({ ...input, workspace_id: workspaceId, created_by: actorId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(workspaceId, {
      actor_id: actorId ?? null,
      entity_type: "memory_store",
      entity_id: data.id,
      action: "memory.store.created",
      detail: `Memory store "${data.name}" created`,
      result: "success",
    });
    return data;
  },

  async updateStore(storeId: string, patch: MemoryStorePatch): Promise<MemoryStore> {
    const { data, error } = await supabase
      .from("memory_stores")
      .update(patch)
      .eq("id", storeId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removeStore(storeId: string) {
    const { error } = await supabase.from("memory_stores").delete().eq("id", storeId);
    if (error) throw error;
  },

  // Entries --------------------------------------------------------------
  async listEntries(workspaceId: string, storeId?: string): Promise<MemoryEntry[]> {
    let query = supabase
      .from("memory_entries")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (storeId) query = query.eq("store_id", storeId);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  },

  async createEntry(
    store: MemoryStore,
    input: Pick<MemoryEntryInsert, "key" | "content" | "importance" | "worker_id">,
    actorId?: string,
  ): Promise<MemoryEntry> {
    const expiresAt =
      store.layer === "persistent"
        ? null
        : new Date(Date.now() + store.retention_days * 86_400_000).toISOString();
    const { data, error } = await supabase
      .from("memory_entries")
      .insert({
        ...input,
        store_id: store.id,
        workspace_id: store.workspace_id,
        worker_id: input.worker_id ?? store.worker_id,
        size_bytes: input.content?.length ?? 0,
        expires_at: expiresAt,
        created_by: actorId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    await memoryService.logEvent(store.workspace_id, {
      store_id: store.id,
      entry_id: data.id,
      worker_id: data.worker_id,
      event: "created",
      detail: `Memory "${data.key}" written`,
      actor_id: actorId ?? null,
    });
    return data;
  },

  async updateEntry(
    entry: MemoryEntry,
    patch: MemoryEntryPatch,
    actorId?: string,
  ): Promise<MemoryEntry> {
    const { data, error } = await supabase
      .from("memory_entries")
      .update({
        ...patch,
        write_count: entry.write_count + 1,
        size_bytes: typeof patch.content === "string" ? patch.content.length : entry.size_bytes,
      })
      .eq("id", entry.id)
      .select("*")
      .single();
    if (error) throw error;
    await memoryService.logEvent(entry.workspace_id, {
      store_id: entry.store_id,
      entry_id: entry.id,
      worker_id: entry.worker_id,
      event: patch.status === "archived" ? "archived" : "updated",
      detail: `Memory "${data.key}" updated`,
      actor_id: actorId ?? null,
    });
    return data;
  },

  /** Marks a memory as read by an agent — feeds the usage analytics. */
  async touchEntry(entry: MemoryEntry, actorId?: string) {
    const { error } = await supabase
      .from("memory_entries")
      .update({ read_count: entry.read_count + 1, last_used_at: new Date().toISOString() })
      .eq("id", entry.id);
    if (error) throw error;
    await memoryService.logEvent(entry.workspace_id, {
      store_id: entry.store_id,
      entry_id: entry.id,
      worker_id: entry.worker_id,
      event: "used",
      detail: `Memory "${entry.key}" recalled`,
      actor_id: actorId ?? null,
    });
  },

  async removeEntry(entry: MemoryEntry, actorId?: string) {
    const { error } = await supabase.from("memory_entries").delete().eq("id", entry.id);
    if (error) throw error;
    await memoryService.logEvent(entry.workspace_id, {
      store_id: entry.store_id,
      entry_id: null,
      worker_id: entry.worker_id,
      event: "deleted",
      detail: `Memory "${entry.key}" deleted`,
      actor_id: actorId ?? null,
    });
  },

  /** Expires every entry whose retention window has elapsed. */
  async expireStale(workspaceId: string, actorId?: string) {
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("memory_entries")
      .update({ status: "expired" })
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .not("expires_at", "is", null)
      .lt("expires_at", now)
      .select("id");
    if (error) throw error;
    if (data?.length) {
      await memoryService.logEvent(workspaceId, {
        store_id: null,
        entry_id: null,
        worker_id: null,
        event: "expired",
        detail: `${data.length} memories passed their retention window`,
        actor_id: actorId ?? null,
      });
    }
    return data?.length ?? 0;
  },

  /** Archives the oldest active entries beyond a store's configured size. */
  async compactStore(store: MemoryStore, actorId?: string) {
    const { data, error } = await supabase
      .from("memory_entries")
      .select("id")
      .eq("store_id", store.id)
      .eq("status", "active")
      .order("last_used_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    const overflow = (data ?? []).slice(0, Math.max(0, (data?.length ?? 0) - store.max_items));
    if (!overflow.length) return 0;
    const { error: archiveError } = await supabase
      .from("memory_entries")
      .update({ status: "archived" })
      .in(
        "id",
        overflow.map((row) => row.id),
      );
    if (archiveError) throw archiveError;
    await memoryService.logEvent(store.workspace_id, {
      store_id: store.id,
      entry_id: null,
      worker_id: store.worker_id,
      event: "summarized",
      detail: `${overflow.length} memories compacted out of "${store.name}"`,
      actor_id: actorId ?? null,
    });
    return overflow.length;
  },

  /** Clears every entry in a store. */
  async resetStore(store: MemoryStore, actorId?: string) {
    const { error } = await supabase.from("memory_entries").delete().eq("store_id", store.id);
    if (error) throw error;
    await memoryService.logEvent(store.workspace_id, {
      store_id: store.id,
      entry_id: null,
      worker_id: store.worker_id,
      event: "deleted",
      detail: `Store "${store.name}" reset`,
      actor_id: actorId ?? null,
    });
  },

  // Timeline -------------------------------------------------------------
  async listEvents(workspaceId: string, limit = 60): Promise<MemoryEvent[]> {
    const { data, error } = await supabase
      .from("memory_events")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  /** Best-effort — the timeline must never break a memory operation. */
  async logEvent(workspaceId: string, entry: Omit<TablesInsert<"memory_events">, "workspace_id">) {
    await supabase
      .from("memory_events")
      .insert({ ...entry, workspace_id: workspaceId })
      .then(undefined, () => undefined);
  },
};
