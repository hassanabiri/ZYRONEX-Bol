import { createFileRoute } from "@tanstack/react-router";

import { InstallsPanel } from "@/components/marketplace/installs-panel";
import { MarketplaceBrowser } from "@/components/marketplace/marketplace-browser";
import { PublisherPanel } from "@/components/marketplace/publisher-panel";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceRole } from "@/hooks/use-workspace-role";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/marketplace")({
  head: () => ({
    meta: [
      { title: "AI Marketplace — ZYRONEX" },
      {
        name: "description",
        content:
          "Browse, install and publish AI workers, workflows, knowledge packs and plugins across ZYRONEX workspaces.",
      },
      { property: "og:title", content: "AI Marketplace — ZYRONEX" },
      {
        property: "og:description",
        content: "Discover and publish AI workers, workflows and packs in the ZYRONEX marketplace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketplaceRoute,
});

function MarketplaceRoute() {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { canManageBilling: canManage } = useWorkspaceRole(workspaceId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("AI Marketplace")}
        description={t(
          "Discover verified workers, workflows and packs — install them into this workspace or publish your own.",
        )}
      />

      <Tabs defaultValue="browse" className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="browse">{t("Browse")}</TabsTrigger>
          <TabsTrigger value="installed">{t("Installed")}</TabsTrigger>
          <TabsTrigger value="publish">{t("Publishing")}</TabsTrigger>
        </TabsList>

        <TabsContent value="browse">
          <MarketplaceBrowser workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="installed">
          <InstallsPanel workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="publish">
          <PublisherPanel workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
