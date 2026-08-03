import { createFileRoute } from "@tanstack/react-router";

import { DeveloperStats } from "@/components/developer/developer-stats";
import { EnvVarsPanel } from "@/components/developer/env-vars-panel";
import { OAuthClientsPanel } from "@/components/developer/oauth-clients-panel";
import { PluginManager } from "@/components/developer/plugin-manager";
import { ProjectsPanel } from "@/components/developer/projects-panel";
import { SdkPanel } from "@/components/developer/sdk-panel";
import { ApiManager } from "@/components/integrations/api-manager";
import { IntegrationLogs } from "@/components/integrations/integration-logs";
import { WebhookCenter } from "@/components/integrations/webhook-center";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDeveloperProjects, usePlugins } from "@/hooks/use-developer";
import { useIntegrations } from "@/hooks/use-integrations";
import { usePublishedProducts } from "@/hooks/use-marketplace";
import { useWorkspaceRole } from "@/hooks/use-workspace-role";
import { SDKS } from "@/lib/developer/catalog";
import { useI18n } from "@/lib/i18n";
import { API_SCOPES } from "@/lib/integrations/catalog";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/developer")({
  head: () => ({
    meta: [
      { title: "Developer Center — ZYRONEX" },
      {
        name: "description",
        content:
          "Projects, API keys, OAuth apps, SDKs, plugins, webhooks and request logs for building on ZYRONEX.",
      },
      { property: "og:title", content: "Developer Center — ZYRONEX" },
      {
        property: "og:description",
        content: "Build on the ZYRONEX API with scoped keys, OAuth apps, SDKs and plugins.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DeveloperRoute,
});

const ENDPOINTS = [
  { method: "GET", path: "/api/v1/workers", scope: "workers.read" },
  { method: "POST", path: "/api/v1/workers", scope: "workers.write" },
  { method: "GET", path: "/api/v1/workflows", scope: "workflows.read" },
  { method: "POST", path: "/api/v1/executions", scope: "executions.write" },
  { method: "GET", path: "/api/v1/executions/:id", scope: "executions.read" },
  { method: "GET", path: "/api/v1/knowledge/documents", scope: "knowledge.read" },
];

function DeveloperRoute() {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { canManageBilling: canManage } = useWorkspaceRole(workspaceId);
  const { data: integrations = [] } = useIntegrations(workspaceId);
  const { data: projects = [] } = useDeveloperProjects(workspaceId);
  const { data: plugins = [] } = usePlugins(workspaceId);
  const { data: products = [] } = usePublishedProducts(workspaceId);

  const published = products.filter((product) => product.status === "published");

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Developer Center")}
        description={t(
          "Projects, credentials, SDKs and plugins — everything needed to build on the ZYRONEX platform.",
        )}
      />

      <DeveloperStats
        projects={projects.length}
        plugins={plugins.length}
        sdks={SDKS.filter((sdk) => sdk.state === "ready").length}
        apiRequests={integrations.reduce((sum, item) => sum + (item.request_count ?? 0), 0)}
        revenueCents={products.reduce((sum, item) => sum + item.revenue_cents, 0)}
        publishedWorkers={published.filter((item) => item.category === "workers").length}
        publishedTemplates={published.filter((item) => item.category === "templates").length}
      />

      <Tabs defaultValue="projects" className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="projects">{t("Projects")}</TabsTrigger>
          <TabsTrigger value="keys">{t("API keys")}</TabsTrigger>
          <TabsTrigger value="apps">{t("Applications")}</TabsTrigger>
          <TabsTrigger value="env">{t("Environment")}</TabsTrigger>
          <TabsTrigger value="webhooks">{t("Webhooks")}</TabsTrigger>
          <TabsTrigger value="sdks">{t("SDKs & Docs")}</TabsTrigger>
          <TabsTrigger value="plugins">{t("Plugins")}</TabsTrigger>
          <TabsTrigger value="reference">{t("API reference")}</TabsTrigger>
          <TabsTrigger value="logs">{t("Logs")}</TabsTrigger>
        </TabsList>

        <TabsContent value="projects">
          <ProjectsPanel workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>

        <TabsContent value="keys">
          <ApiManager workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="apps">
          <OAuthClientsPanel workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>

        <TabsContent value="env">
          <EnvVarsPanel workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>

        <TabsContent value="webhooks">
          <WebhookCenter workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="sdks">
          <SdkPanel />
        </TabsContent>

        <TabsContent value="plugins">
          <PluginManager workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>

        <TabsContent value="reference" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Endpoints")}</CardTitle>
              <CardDescription>
                {t("All requests are workspace-scoped and authenticated with a bearer API key.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {ENDPOINTS.map((endpoint) => (
                <div
                  key={`${endpoint.method}-${endpoint.path}`}
                  className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 font-mono text-xs"
                >
                  <span className="font-semibold">{endpoint.method}</span>
                  <span className="flex-1">{endpoint.path}</span>
                  <span className="text-muted-foreground">{endpoint.scope}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Available scopes")}</CardTitle>
              <CardDescription>
                {t("Grant the narrowest set of scopes each integration needs.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 font-mono text-xs text-muted-foreground">
              {API_SCOPES.map((scope) => (
                <span key={scope} className="rounded-md border px-2 py-1">
                  {scope}
                </span>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <IntegrationLogs workspaceId={workspaceId} integrations={integrations} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
