import { MoreHorizontal, Search, ShieldAlert, Trash2, UserPlus, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useInvitations,
  useTeamMembers,
  useWorkspaceMutations,
} from "@/hooks/use-workspace-data";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { MEMBER_ROLES } from "@/lib/workspace-options";
import type { MemberRole } from "@/services/types";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function TeamManagement({ workspaceId }: { workspaceId?: string }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const { data: members, isLoading } = useTeamMembers(workspaceId);
  const { data: invitations } = useInvitations(workspaceId);
  const mutations = useWorkspaceMutations(workspaceId);

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<MemberRole>("member");

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    return (members ?? []).filter((member) => {
      const name = (member.profile?.full_name ?? "").toLowerCase();
      const email = (member.profile?.email ?? "").toLowerCase();
      const matchesTerm = !term || name.includes(term) || email.includes(term);
      const matchesRole = roleFilter === "all" || member.role === roleFilter;
      const matchesStatus = statusFilter === "all" || member.status === statusFilter;
      return matchesTerm && matchesRole && matchesStatus;
    });
  }, [members, query, roleFilter, statusFilter]);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    try {
      await mutations.inviteMember.mutateAsync({ email: inviteEmail, role: inviteRole });
      toast.success(t("Invitation created"));
      setInviteEmail("");
      setInviteOpen(false);
    } catch (error) {
      toast.error(errorMessage(error, t("Could not create invitation")));
    }
  }

  async function run(promise: Promise<unknown>, success: string) {
    try {
      await promise;
      toast.success(t(success));
    } catch (error) {
      toast.error(errorMessage(error, t("Action failed")));
    }
  }

  return (
    <div className="space-y-4">
      <Card className="panel-shadow">
        <CardHeader className="flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">{t("Team Management")}</CardTitle>
            <CardDescription>{t("Invite people and control their access level.")}</CardDescription>
          </div>
          <Button onClick={() => setInviteOpen(true)} className="gap-2">
            <UserPlus className="size-4" /> {t("Invite Member")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("Search members…")}
                className="ps-9"
              />
            </div>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="sm:w-40">
                <SelectValue placeholder={t("Role")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All roles")}</SelectItem>
                {MEMBER_ROLES.map((role) => (
                  <SelectItem key={role} value={role} className="capitalize">
                    {t(role)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="sm:w-40">
                <SelectValue placeholder={t("Status")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("All statuses")}</SelectItem>
                <SelectItem value="active">{t("active")}</SelectItem>
                <SelectItem value="suspended">{t("suspended")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={Users}
              title="No team members found"
              description="Invite teammates to collaborate on agents, knowledge and workflows in this workspace."
              action={
                <Button onClick={() => setInviteOpen(true)} className="gap-2">
                  <UserPlus className="size-4" /> {t("Invite Member")}
                </Button>
              }
            />
          ) : (
            <div className="divide-y rounded-xl border">
              {filtered.map((member) => {
                const name = member.profile?.full_name || member.profile?.email || t("Member");
                const isSelf = member.user_id === user?.id;
                return (
                  <div
                    key={member.id}
                    className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-9">
                        {member.profile?.avatar_url && (
                          <AvatarImage src={member.profile.avatar_url} alt={name} />
                        )}
                        <AvatarFallback className="bg-surface text-[11px] font-semibold">
                          {name.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {name} {isSelf && <span className="text-muted-foreground">({t("you")})</span>}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {member.profile?.email ?? "—"}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-auto">
                      <Badge
                        variant={member.status === "active" ? "secondary" : "outline"}
                        className="capitalize"
                      >
                        {t(member.status)}
                      </Badge>
                      <Select
                        value={member.role}
                        onValueChange={(role) =>
                          run(
                            mutations.setMemberRole.mutateAsync({
                              memberId: member.id,
                              role: role as MemberRole,
                            }),
                            "Role updated",
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-32 capitalize">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {MEMBER_ROLES.map((role) => (
                            <SelectItem key={role} value={role} className="capitalize">
                              {t(role)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" aria-label={t("Member actions")}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuLabel>{t("Member actions")}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() =>
                              run(
                                mutations.setMemberStatus.mutateAsync({
                                  memberId: member.id,
                                  status: member.status === "active" ? "suspended" : "active",
                                }),
                                member.status === "active" ? "Member suspended" : "Member reactivated",
                              )
                            }
                          >
                            <ShieldAlert className="me-2 size-4" />
                            {member.status === "active" ? t("Suspend Member") : t("Reactivate Member")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onSelect={() =>
                              run(mutations.removeMember.mutateAsync(member.id), "Member removed")
                            }
                          >
                            <Trash2 className="me-2 size-4" /> {t("Remove Member")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="panel-shadow">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base">{t("Pending Invitations")}</CardTitle>
          <CardDescription>{t("Invitations waiting to be accepted.")}</CardDescription>
        </CardHeader>
        <CardContent>
          {invitations?.length ? (
            <div className="divide-y rounded-xl border">
              {invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between gap-3 p-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{invitation.email}</p>
                    <p className="text-xs capitalize text-muted-foreground">
                      {t(invitation.role)} · {t(invitation.status)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      run(mutations.revokeInvitation.mutateAsync(invitation.id), "Invitation revoked")
                    }
                  >
                    {t("Revoke")}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={UserPlus}
              compact
              title="No pending invitations"
              description="Invited teammates will appear here until they join the workspace."
            />
          )}
        </CardContent>
      </Card>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Invite Member")}</DialogTitle>
            <DialogDescription>
              {t("Send an invitation to join this workspace with a specific role.")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t("Email")}</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="teammate@company.com"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Role")}</Label>
              <Select value={inviteRole} onValueChange={(value) => setInviteRole(value as MemberRole)}>
                <SelectTrigger className="capitalize">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MEMBER_ROLES.filter((role) => role !== "owner").map((role) => (
                    <SelectItem key={role} value={role} className="capitalize">
                      {t(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={mutations.inviteMember.isPending}>
                {t("Send Invitation")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
