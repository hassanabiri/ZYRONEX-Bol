import { supabase } from "@/integrations/supabase/client";
import type { Workspace, WorkspaceMember, WorkspaceSettings } from "@/services/types";

export type WorkspacePatch = Partial<
  Pick<Workspace, "name" | "logo" | "status" | "subscription_plan" | "slug">
>;

export type WorkspaceSettingsPatch = Partial<
  Pick<WorkspaceSettings, "domain" | "region" | "language" | "timezone" | "brand_color">
>;

/** Database layer for workspaces, membership and workspace settings. Tenant isolation is enforced by RLS. */
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

  async update(workspaceId: string, patch: WorkspacePatch) {
    const { data, error } = await supabase
      .from("workspaces")
      .update(patch)
      .eq("id", workspaceId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async remove(workspaceId: string) {
    const { error } = await supabase.from("workspaces").delete().eq("id", workspaceId);
    if (error) throw error;
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

  async getSettings(workspaceId: string): Promise<WorkspaceSettings | null> {
    const { data, error } = await supabase
      .from("workspace_settings")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async saveSettings(workspaceId: string, patch: WorkspaceSettingsPatch) {
    const { data, error } = await supabase
      .from("workspace_settings")
      .upsert({ workspace_id: workspaceId, ...patch }, { onConflict: "workspace_id" })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
};
