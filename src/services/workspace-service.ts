import { supabase } from "@/integrations/supabase/client";
import type { Workspace, WorkspaceMember } from "@/services/types";

/** Database layer for workspaces and membership. Tenant isolation is enforced by RLS. */
export const workspaceService = {
  async list(): Promise<Workspace[]> {
    const { data, error } = await supabase
      .from("workspaces")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async get(workspaceId: string): Promise<Workspace | null> {
    const { data, error } = await supabase
      .from("workspaces")
      .select("*")
      .eq("id", workspaceId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Creates the workspace and the owner membership atomically. */
  async create(name: string, slug?: string): Promise<string> {
    const { data, error } = await supabase.rpc("create_workspace", {
      _name: name,
      _slug: slug ?? "",
    });
    if (error) throw error;
    return data as string;
  },

  async update(workspaceId: string, patch: Partial<Pick<Workspace, "name" | "logo" | "status" | "subscription_plan">>) {
    const { data, error } = await supabase
      .from("workspaces")
      .update(patch)
      .eq("id", workspaceId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
    const { data, error } = await supabase
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },
};
