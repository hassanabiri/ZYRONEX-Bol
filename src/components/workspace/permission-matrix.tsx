import { ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  usePermissions,
  useWorkspaceMutations,
  useWorkspaceRoles,
} from "@/hooks/use-workspace-data";
import { useI18n } from "@/lib/i18n";
import { permissionModule } from "@/services/role-service";

/** Permission matrix: permissions grouped by module, toggled per custom role. */
export function PermissionMatrix({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: roles, isLoading } = useWorkspaceRoles(workspaceId);
  const { data: permissions } = usePermissions();
  const mutations = useWorkspaceMutations(workspaceId);
  const [roleId, setRoleId] = useState<string | null>(null);

  useEffect(() => {
    if (!roles?.length) return;
    setRoleId((current) =>
      current && roles.some((role) => role.id === current) ? current : (roles[0]?.id ?? null),
    );
  }, [roles]);

  const activeRole = roles?.find((role) => role.id === roleId) ?? null;

  const grouped = (permissions ?? []).reduce<
    Record<string, { key: string; description: string | null }[]>
  >((accumulator, permission) => {
    const module = permissionModule(permission.key);
    accumulator[module] = [...(accumulator[module] ?? []), permission];
    return accumulator;
  }, {});

  async function toggle(key: string, enabled: boolean) {
    if (!activeRole) return;
    const next = enabled
      ? [...activeRole.permissionKeys, key]
      : activeRole.permissionKeys.filter((item) => item !== key);
    try {
      await mutations.setRolePermissions.mutateAsync({ roleId: activeRole.id, permissionKeys: next });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not update permission"));
    }
  }

  return (
    <Card className="panel-shadow">
      <CardHeader className="flex-col gap-4 space-y-0 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="text-base">{t("Permission Matrix")}</CardTitle>
          <CardDescription>{t("Enable or disable permissions per module.")}</CardDescription>
        </div>
        {roles?.length ? (
          <Select value={roleId ?? ""} onValueChange={(value) => setRoleId(value)}>
            <SelectTrigger className="sm:w-56">
              <SelectValue placeholder={t("Select role")} />
            </SelectTrigger>
            <SelectContent>
              {roles.map((role) => (
                <SelectItem key={role.id} value={role.id}>
                  {role.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : !activeRole ? (
          <EmptyState
            icon={ShieldCheck}
            title="No role selected"
            description="Create a role first, then assign module permissions to it here."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {Object.entries(grouped).map(([module, items]) => (
              <div key={module} className="rounded-xl border">
                <p className="border-b px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {t(module)}
                </p>
                <div className="divide-y">
                  {items.map((permission) => (
                    <div
                      key={permission.key}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm">{permission.description ?? permission.key}</p>
                        <p className="truncate font-mono text-[11px] text-muted-foreground">
                          {permission.key}
                        </p>
                      </div>
                      <Switch
                        checked={activeRole.permissionKeys.includes(permission.key)}
                        onCheckedChange={(checked) => toggle(permission.key, checked)}
                        aria-label={permission.key}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
