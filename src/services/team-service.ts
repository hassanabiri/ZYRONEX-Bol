import { supabase } from "@/integrations/supabase/client";
import type {
  MemberRole,
  Profile,
  TeamMember,
  WorkspaceInvitation,
} from "@/services/types";

export type MemberStatus = "active" | "suspended";

/** Database layer for workspace team members and pending invitations. */
export const teamService = {
  /**
   * Members enriched with their profile. `workspace_members.user_id` points at
   * auth.users, so profiles are resolved in a second read (RLS lets workspace
   * peers see each other's basic profile).
   */
  async listMembers(workspaceId: string): Promise<TeamMember[]> {
    const { data: members, error } = await supabase
      .from("workspace_members")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    if (!members?.length) return [];

    const { data: profiles, error: profileError } = await supabase
      .from("profiles")
      .select("id, email, full_name, avatar_url, last_login")
      .in("id", members.map((member) => member.user_id));
    if (profileError) throw profileError;

    const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
    return members.map((member) => ({
      ...member,
      profile: (byId.get(member.user_id) as Pick<
        Profile,
        "id" | "email" | "full_name" | "avatar_url" | "last_login"
      >) ?? null,
    }));
  },

  async setRole(memberId: string, role: MemberRole) {
    const { error } = await supabase.from("workspace_members").update({ role }).eq("id", memberId);
    if (error) throw error;
  },

  async setStatus(memberId: string, status: MemberStatus) {
    const { error } = await supabase
      .from("workspace_members")
      .update({ status })
      .eq("id", memberId);
    if (error) throw error;
  },

  async removeMember(memberId: string) {
    const { error } = await supabase.from("workspace_members").delete().eq("id", memberId);
    if (error) throw error;
  },

  async listInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
    const { data, error } = await supabase
      .from("workspace_invitations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async invite(workspaceId: string, email: string, role: MemberRole, invitedBy?: string) {
    const { error } = await supabase.from("workspace_invitations").upsert(
      {
        workspace_id: workspaceId,
        email: email.trim().toLowerCase(),
        role,
        status: "pending",
        invited_by: invitedBy ?? null,
      },
      { onConflict: "workspace_id,email" },
    );
    if (error) throw error;
  },

  async revokeInvitation(invitationId: string) {
    const { error } = await supabase
      .from("workspace_invitations")
      .delete()
      .eq("id", invitationId);
    if (error) throw error;
  },
};
