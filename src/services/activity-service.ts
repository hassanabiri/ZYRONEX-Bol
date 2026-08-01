import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert } from "@/integrations/supabase/types";

export type ActivityEntry = Tables<"activity_log">;
export type ActivityInsert = Omit<TablesInsert<"activity_log">, "workspace_id">;

/**
 * Central audit trail. Every engine action funnels through here so the
 * Activity Log module has a single source of truth.
 */
export const activityService = {
  async list(workspaceId: string, limit = 100): Promise<ActivityEntry[]> {
    const { data, error } = await supabase
      .from("activity_log")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  /** Best-effort: auditing must never break the primary mutation. */
  async log(workspaceId: string, entry: ActivityInsert) {
    await supabase
      .from("activity_log")
      .insert({ ...entry, workspace_id: workspaceId })
      .then(undefined, () => undefined);
  },
};
