import { Copy, Pencil, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  usePermissions,
  useWorkspaceMutations,
  useWorkspaceRoles,
} from "@/hooks/use-workspace-data";
import { useI18n } from "@/lib/i18n";
import { permissionModule, type RoleWithPermissions } from "@/services/role-service";

type Draft = {
  id?: string;
  name: string;
  description: string;
  permissionKeys: string[];
};

const emptyDraft: Draft = { name: "", description: "", permissionKeys: [] };

export function RoleManagement({ workspaceId }: { workspaceId?: string }) {
  const { t } = useI18n();
  const { data: roles, isLoading } = useWorkspaceRoles(workspaceId);
  const { data: permissions } = usePermissions();
  const mutations = useWorkspaceMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const grouped = (permissions ?? []).reduce<Record<string, { key: string; description: string | null }[]>>(
    (accumulator, permission) => {
      const module = permissionModule(permission.key);
      accumulator[module] = [...(accumulator[module] ?? []), permission];
      return accumulator;
    },
    {},
  );

  function openCreate() {
    setDraft(emptyDraft);
    setOpen(true);
  }

  function openEdit(role: RoleWithPermissions) {
    setDraft({
      id: role.id,
      name: role.name,
      description: role.description ?? "",
      permissionKeys: role.permissionKeys,
    });
    setOpen(true);
  }

  function toggle(key: string, checked: boolean) {
    setDraft((current) => ({
      ...current,
      permissionKeys: checked
        ? [...current.permissionKeys, key]
        : current.permissionKeys.filter((item) => item !== key),
    }));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const payload = {
      name: draft.name,
      description: draft.description.trim() || null,
      permissionKeys: draft.permissionKeys,
    };
    try {
      if (draft.id) {
        await mutations.updateRole.mutateAsync({ roleId: draft.id, ...payload });
        toast.success(t("Role updated"));
      } else {
        await mutations.createRole.mutateAsync(payload);
        toast.success(t("Role created"));
      }
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not save role"));
    }
  }

  async function handleClone(role: RoleWithPermissions) {
    try {
      await mutations.cloneRole.mutateAsync({ source: role, name: `${role.name} copy` });
      toast.success(t("Role cloned"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not clone role"));
    }
  }

  async function handleDelete(role: RoleWithPermissions) {
    try {
      await mutations.deleteRole.mutateAsync(role.id);
      toast.success(t("Role deleted"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not delete role"));
    }
  }

  return (
    <Card className="panel-shadow">
      <CardHeader className="flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base">{t("Role Management")}</CardTitle>
          <CardDescription>
            {t("Define custom roles and the permissions attached to them.")}
          </CardDescription>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus className="size-4" /> {t("Create Role")}
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : roles?.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {roles.map((role) => (
              <div key={role.id} className="space-y-3 rounded-xl border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-semibold">{role.name}</p>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {role.description || t("No description")}
                    </p>
                  </div>
                  <Badge variant="outline">{role.permissionKeys.length}</Badge>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => openEdit(role)}>
                    <Pencil className="size-3.5" /> {t("Edit")}
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => handleClone(role)}>
                    <Copy className="size-3.5" /> {t("Clone")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-destructive hover:text-destructive"
                    onClick={() => handleDelete(role)}
                  >
                    <Trash2 className="size-3.5" /> {t("Delete")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={ShieldCheck}
            title="No custom roles yet"
            description="Create roles that bundle permissions for your team, then assign them to members."
            action={
              <Button onClick={openCreate} className="gap-2">
                <Plus className="size-4" /> {t("Create Role")}
              </Button>
            }
          />
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft.id ? t("Edit Role") : t("Create Role")}</DialogTitle>
            <DialogDescription>
              {t("Name the role and select the permissions it grants.")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="role-name">{t("Role name")}</Label>
              <Input
                id="role-name"
                required
                value={draft.name}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="Operations"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="role-description">{t("Description")}</Label>
              <Textarea
                id="role-description"
                rows={2}
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Permissions")}</Label>
              <ScrollArea className="h-64 rounded-lg border p-3">
                <div className="space-y-4">
                  {Object.entries(grouped).map(([module, items]) => (
                    <div key={module} className="space-y-2">
                      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                        {t(module)}
                      </p>
                      {items.map((permission) => (
                        <label
                          key={permission.key}
                          className="flex items-center gap-2 text-sm"
                          htmlFor={`perm-${permission.key}`}
                        >
                          <Checkbox
                            id={`perm-${permission.key}`}
                            checked={draft.permissionKeys.includes(permission.key)}
                            onCheckedChange={(checked) => toggle(permission.key, checked === true)}
                          />
                          <span>{permission.description ?? permission.key}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={mutations.createRole.isPending || mutations.updateRole.isPending}>
                {t("Save Role")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
