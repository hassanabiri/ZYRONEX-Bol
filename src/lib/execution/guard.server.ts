import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

/** Roles allowed to run or cancel workflows — mirrors the existing RBAC model. */
const EXECUTE_ROLES = ["owner", "admin", "member"] as const;

/**
 * Proves the caller belongs to the workspace with an execution-capable role.
 * The read goes through the caller's own RLS view, so membership cannot be
 * spoofed by passing a foreign workspace id.
 */
export async function assertCanExecute(supabase: Client, workspaceId: string, userId: string) {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !EXECUTE_ROLES.includes(data.role as (typeof EXECUTE_ROLES)[number]))
    throw new Error("You do not have permission to run workflows in this workspace");
  return data.role;
}

/** Prevents cross-workspace execution access even for valid members. */
export async function assertExecutionInWorkspace(
  supabase: Client,
  executionId: string,
  workspaceId: string,
) {
  const { data, error } = await supabase
    .from("executions")
    .select("id, workspace_id")
    .eq("id", executionId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.workspace_id !== workspaceId) throw new Error("Execution not found");
  return data.id;
}
