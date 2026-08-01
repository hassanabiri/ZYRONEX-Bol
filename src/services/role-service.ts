import { supabase } from "@/integrations/supabase/client";
import type { Permission, WorkspaceRole } from "@/services/types";

/** Permission modules used by the permission matrix, derived from the `module.action` key. */
export const PERMISSION_MODULES = [
  "workspace",
  "agents",
  "workflow",
  "voice",
  "knowledge",
  "billing",
  "developer",
  "administration",
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number];

export function permissionModule(key: string): string {
  return key.split(".")[0] ?? "workspace";
}

export type RoleWithPermissions = WorkspaceRole & { permissionKeys: string[] };

/** Database layer for the permission catalog and workspace-scoped custom roles. */
export const roleService = {
  async listPermissions(): Promise<Permission[]> {
    const { data, error } = await supabase.from("permissions").select("*").order("key");
    if (error) throw error;
    return data ?? [];
  },

  async listRoles(workspaceId: string): Promise<RoleWithPermissions[]> {
    const { data: roles, error } = await supabase
      .from("workspace_roles")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (!roles?.length) return [];

    const { data: grants, error: grantError } = await supabase
      .from("workspace_role_permissions")
      .select("workspace_role_id, permission_key")
      .eq("workspace_id", workspaceId);
    if (grantError) throw grantError;

    return roles.map((role) => ({
      ...role,
      permissionKeys: (grants ?? [])
        .filter((grant) => grant.workspace_role_id === role.id)
        .map((grant) => grant.permission_key),
    }));
  },

  async createRole(
    workspaceId: string,
    name: string,
    description: string | null,
    permissionKeys: string[] = [],
  ) {
    const { data, error } = await supabase
      .from("workspace_roles")
      .insert({ workspace_id: workspaceId, name: name.trim(), description })
      .select("*")
      .single();
    if (error) throw error;
    if (permissionKeys.length) await roleService.setPermissions(workspaceId, data.id, permissionKeys);
    return data;
  },

  async updateRole(roleId: string, patch: { name?: string; description?: string | null }) {
    const { error } = await supabase.from("workspace_roles").update(patch).eq("id", roleId);
    if (error) throw error;
  },

  async deleteRole(roleId: string) {
    const { error } = await supabase.from("workspace_roles").delete().eq("id", roleId);
    if (error) throw error;
  },

  /** Replaces the full permission set of a role. */
  async setPermissions(workspaceId: string, roleId: string, permissionKeys: string[]) {
    const { error: deleteError } = await supabase
      .from("workspace_role_permissions")
      .delete()
      .eq("workspace_role_id", roleId);
    if (deleteError) throw deleteError;
    if (!permissionKeys.length) return;
    const { error } = await supabase.from("workspace_role_permissions").insert(
      permissionKeys.map((permission_key) => ({
        workspace_id: workspaceId,
        workspace_role_id: roleId,
        permission_key,
      })),
    );
    if (error) throw error;
  },

  async cloneRole(workspaceId: string, source: RoleWithPermissions, name: string) {
    return roleService.createRole(workspaceId, name, source.description, source.permissionKeys);
  },
};
