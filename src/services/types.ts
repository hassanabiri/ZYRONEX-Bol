import type { Tables } from "@/integrations/supabase/types";

export type Profile = Tables<"profiles">;
export type Workspace = Tables<"workspaces">;
export type WorkspaceMember = Tables<"workspace_members">;
export type Role = Tables<"roles">;
export type Permission = Tables<"permissions">;

export type WorkspaceRole = WorkspaceMember["role"];
