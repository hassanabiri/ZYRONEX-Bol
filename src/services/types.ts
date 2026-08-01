import type { Tables } from "@/integrations/supabase/types";

export type Profile = Tables<"profiles">;
export type Workspace = Tables<"workspaces">;
export type WorkspaceMember = Tables<"workspace_members">;
export type Role = Tables<"roles">;
export type Permission = Tables<"permissions">;
export type WorkspaceSettings = Tables<"workspace_settings">;
export type WorkspaceInvitation = Tables<"workspace_invitations">;
export type WorkspaceRole = Tables<"workspace_roles">;
export type WorkspaceRolePermission = Tables<"workspace_role_permissions">;

export type MemberRole = WorkspaceMember["role"];

/** A membership row enriched with the teammate's profile (visible to workspace peers). */
export type TeamMember = WorkspaceMember & {
  profile: Pick<Profile, "id" | "email" | "full_name" | "avatar_url" | "last_login"> | null;
};
