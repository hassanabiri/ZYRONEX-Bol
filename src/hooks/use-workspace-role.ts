import { useMemo } from "react";

import { useAuth } from "@/lib/auth";
import { useTeamMembers } from "@/hooks/use-workspace-data";
import type { MemberRole } from "@/services/types";

/**
 * Resolves the signed-in user's role inside the active workspace so the UI can
 * hide actions the RLS policies would reject anyway.
 */
export function useWorkspaceRole(workspaceId: string | undefined) {
  const { user } = useAuth();
  const { data: members = [], isLoading } = useTeamMembers(workspaceId);

  return useMemo(() => {
    const role = (members.find((member) => member.user_id === user?.id)?.role ?? null) as
      | MemberRole
      | null;
    return {
      role,
      isLoading,
      isOwner: role === "owner",
      canManageBilling: role === "owner" || role === "admin",
      canManageVoice: role === "owner" || role === "admin" || role === "member",
    };
  }, [members, user?.id, isLoading]);
}
