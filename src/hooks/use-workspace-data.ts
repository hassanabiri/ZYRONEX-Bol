import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import { roleService, type RoleWithPermissions } from "@/services/role-service";
import { teamService, type MemberStatus } from "@/services/team-service";
import {
  workspaceService,
  type WorkspacePatch,
  type WorkspaceSettingsPatch,
} from "@/services/workspace-service";
import type { MemberRole } from "@/services/types";

/**
 * Query/mutation layer for everything scoped to a workspace.
 * Future modules (agents, knowledge, voice…) should follow the same key shape:
 * ["workspace", workspaceId, "<module>"].
 */
export const workspaceKeys = {
  settings: (id: string) => ["workspace", id, "settings"] as const,
  members: (id: string) => ["workspace", id, "members"] as const,
  invitations: (id: string) => ["workspace", id, "invitations"] as const,
  roles: (id: string) => ["workspace", id, "roles"] as const,
  permissions: () => ["permissions"] as const,
};

export function useWorkspaceSettings(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.settings(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => workspaceService.getSettings(workspaceId!),
  });
}

export function useTeamMembers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.members(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => teamService.listMembers(workspaceId!),
  });
}

export function useInvitations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.invitations(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => teamService.listInvitations(workspaceId!),
  });
}

export function useWorkspaceRoles(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.roles(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => roleService.listRoles(workspaceId!),
  });
}

export function usePermissions() {
  return useQuery({
    queryKey: workspaceKeys.permissions(),
    queryFn: () => roleService.listPermissions(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useWorkspaceMutations(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "";

  const invalidate = (keys: readonly unknown[]) =>
    queryClient.invalidateQueries({ queryKey: keys as unknown[] });

  const updateWorkspace = useMutation({
    mutationFn: (patch: WorkspacePatch) => workspaceService.update(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
  });

  const saveSettings = useMutation({
    mutationFn: (patch: WorkspaceSettingsPatch) => workspaceService.saveSettings(id, patch),
    onSuccess: () => invalidate(workspaceKeys.settings(id)),
  });

  const deleteWorkspace = useMutation({
    mutationFn: () => workspaceService.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspaces"] }),
  });

  const inviteMember = useMutation({
    mutationFn: (input: { email: string; role: MemberRole }) =>
      teamService.invite(id, input.email, input.role, user?.id),
    onSuccess: () => invalidate(workspaceKeys.invitations(id)),
  });

  const revokeInvitation = useMutation({
    mutationFn: (invitationId: string) => teamService.revokeInvitation(invitationId),
    onSuccess: () => invalidate(workspaceKeys.invitations(id)),
  });

  const setMemberRole = useMutation({
    mutationFn: (input: { memberId: string; role: MemberRole }) =>
      teamService.setRole(input.memberId, input.role),
    onSuccess: () => invalidate(workspaceKeys.members(id)),
  });

  const setMemberStatus = useMutation({
    mutationFn: (input: { memberId: string; status: MemberStatus }) =>
      teamService.setStatus(input.memberId, input.status),
    onSuccess: () => invalidate(workspaceKeys.members(id)),
  });

  const removeMember = useMutation({
    mutationFn: (memberId: string) => teamService.removeMember(memberId),
    onSuccess: () => invalidate(workspaceKeys.members(id)),
  });

  const createRole = useMutation({
    mutationFn: (input: { name: string; description: string | null; permissionKeys: string[] }) =>
      roleService.createRole(id, input.name, input.description, input.permissionKeys),
    onSuccess: () => invalidate(workspaceKeys.roles(id)),
  });

  const updateRole = useMutation({
    mutationFn: (input: {
      roleId: string;
      name: string;
      description: string | null;
      permissionKeys: string[];
    }) =>
      roleService
        .updateRole(input.roleId, { name: input.name, description: input.description })
        .then(() => roleService.setPermissions(id, input.roleId, input.permissionKeys)),
    onSuccess: () => invalidate(workspaceKeys.roles(id)),
  });

  const deleteRole = useMutation({
    mutationFn: (roleId: string) => roleService.deleteRole(roleId),
    onSuccess: () => invalidate(workspaceKeys.roles(id)),
  });

  const cloneRole = useMutation({
    mutationFn: (input: { source: RoleWithPermissions; name: string }) =>
      roleService.cloneRole(id, input.source, input.name),
    onSuccess: () => invalidate(workspaceKeys.roles(id)),
  });

  const setRolePermissions = useMutation({
    mutationFn: (input: { roleId: string; permissionKeys: string[] }) =>
      roleService.setPermissions(id, input.roleId, input.permissionKeys),
    onSuccess: () => invalidate(workspaceKeys.roles(id)),
  });

  return {
    updateWorkspace,
    saveSettings,
    deleteWorkspace,
    inviteMember,
    revokeInvitation,
    setMemberRole,
    setMemberStatus,
    removeMember,
    createRole,
    updateRole,
    deleteRole,
    cloneRole,
    setRolePermissions,
  };
}
