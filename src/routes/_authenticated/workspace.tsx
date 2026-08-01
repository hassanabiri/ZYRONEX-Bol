import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { PermissionMatrix } from "@/components/workspace/permission-matrix";
import { RoleManagement } from "@/components/workspace/role-management";
import { TeamManagement } from "@/components/workspace/team-management";
import { WorkspaceSettingsForm } from "@/components/workspace/workspace-settings-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/workspace")({
  head: () => ({
    meta: [
      { title: "Workspace Management — ZYRONEX" },
      {
        name: "description",
        content:
          "Manage workspace settings, team members, custom roles and the permission matrix for your tenant.",
      },
      { property: "og:title", content: "Workspace Management — ZYRONEX" },
      {
        property: "og:description",
        content: "Settings, team, roles and permissions for your workspace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { activeWorkspace, refresh } = useWorkspace();

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Workspace Management")}
        description={t(
          "Tenancy, membership, roles and workspace-level configuration for your organization.",
        )}
      />

      <Tabs defaultValue="settings" className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
          <TabsTrigger value="settings">{t("Settings")}</TabsTrigger>
          <TabsTrigger value="team">{t("Team")}</TabsTrigger>
          <TabsTrigger value="roles">{t("Roles")}</TabsTrigger>
          <TabsTrigger value="permissions">{t("Permissions")}</TabsTrigger>
        </TabsList>

        <TabsContent value="settings">
          <WorkspaceSettingsForm
            workspace={activeWorkspace}
            onDeleted={() => {
              refresh();
              navigate({ to: "/dashboard", replace: true });
            }}
          />
        </TabsContent>
        <TabsContent value="team">
          <TeamManagement workspaceId={activeWorkspace?.id} />
        </TabsContent>
        <TabsContent value="roles">
          <RoleManagement workspaceId={activeWorkspace?.id} />
        </TabsContent>
        <TabsContent value="permissions">
          <PermissionMatrix workspaceId={activeWorkspace?.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
