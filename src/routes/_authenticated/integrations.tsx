import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { ConnectionsTable } from "@/components/integrations/connections-table";
import { ConnectionWizard } from "@/components/integrations/connection-wizard";
import { IntegrationLogs } from "@/components/integrations/integration-logs";
import { IntegrationStats } from "@/components/integrations/integration-stats";
import { MarketplacePanel } from "@/components/integrations/marketplace-panel";
import { ProviderCatalog } from "@/components/integrations/provider-catalog";
import { SyncEngine } from "@/components/integrations/sync-engine";
import { WebhookCenter } from "@/components/integrations/webhook-center";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIntegrations } from "@/hooks/use-integrations";
import { useI18n } from "@/lib/i18n";
import type { ProviderDefinition } from "@/lib/integrations/catalog";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({
    meta: [
      { title: "Integration Hub — ZYRONEX" },
      {
        name: "description",
        content:
          "Connect external services, manage credentials, webhooks, synchronization and integration logs.",
      },
      { property: "og:title", content: "Integration Hub — ZYRONEX" },
      {
        property: "og:description",
        content: "Connectors, credential vault, webhooks, sync engine and marketplace.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: IntegrationsRoute,
});

function IntegrationsRoute() {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { data: integrations = [], isLoading } = useIntegrations(workspaceId);

  const [tab, setTab] = useState("connections");
  const [provider, setProvider] = useState<ProviderDefinition | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Integration Hub")}
        description={t(
          "Every external connection ZYRONEX makes passes through this hub — credentials, health, synchronization and events.",
        )}
      />

      <IntegrationStats integrations={integrations} />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="connections">{t("Connections")}</TabsTrigger>
          <TabsTrigger value="catalog">{t("Catalog")}</TabsTrigger>
          <TabsTrigger value="sync">{t("Synchronization")}</TabsTrigger>
          <TabsTrigger value="webhooks">{t("Webhooks")}</TabsTrigger>
          <TabsTrigger value="logs">{t("Logs")}</TabsTrigger>
          <TabsTrigger value="marketplace">{t("Marketplace")}</TabsTrigger>
        </TabsList>

        <TabsContent value="connections">
          <ConnectionsTable
            workspaceId={workspaceId}
            integrations={integrations}
            loading={isLoading}
            onBrowseCatalog={() => setTab("catalog")}
          />
        </TabsContent>

        <TabsContent value="catalog">
          <ProviderCatalog
            integrations={integrations}
            onConnect={(item) => {
              setProvider(item);
              setWizardOpen(true);
            }}
          />
        </TabsContent>

        <TabsContent value="sync">
          <SyncEngine workspaceId={workspaceId} integrations={integrations} />
        </TabsContent>

        <TabsContent value="webhooks">
          <WebhookCenter workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="logs">
          <IntegrationLogs workspaceId={workspaceId} integrations={integrations} />
        </TabsContent>

        <TabsContent value="marketplace">
          <MarketplacePanel workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>

      <ConnectionWizard
        provider={provider}
        workspaceId={workspaceId}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCreated={() => setTab("connections")}
      />
    </div>
  );
}
