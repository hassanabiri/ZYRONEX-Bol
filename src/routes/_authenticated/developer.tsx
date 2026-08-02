import { createFileRoute } from "@tanstack/react-router";

import { ApiManager } from "@/components/integrations/api-manager";
import { IntegrationLogs } from "@/components/integrations/integration-logs";
import { WebhookCenter } from "@/components/integrations/webhook-center";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useIntegrations } from "@/hooks/use-integrations";
import { useI18n } from "@/lib/i18n";
import { API_SCOPES } from "@/lib/integrations/catalog";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/developer")({
  head: () => ({
    meta: [
      { title: "Developer Center — ZYRONEX" },
      {
        name: "description",
        content: "API keys, scopes, webhooks and request logs for building on the ZYRONEX API.",
      },
      { property: "og:title", content: "Developer Center — ZYRONEX" },
      {
        property: "og:description",
        content: "Issue scoped API keys, manage webhooks and inspect platform API activity.",
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
  const { data: integrations = [] } = useIntegrations(workspaceId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Developer Center")}
        description={t(
          "Issue scoped API keys, wire webhooks and inspect every request made against the platform API.",
        )}
      />

      <Tabs defaultValue="keys" className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="keys">{t("API keys")}</TabsTrigger>
          <TabsTrigger value="webhooks">{t("Webhooks")}</TabsTrigger>
          <TabsTrigger value="reference">{t("API reference")}</TabsTrigger>
          <TabsTrigger value="logs">{t("Logs")}</TabsTrigger>
        </TabsList>

        <TabsContent value="keys">
          <ApiManager workspaceId={workspaceId} />
        </TabsContent>

        <TabsContent value="webhooks">
          <WebhookCenter workspaceId={workspaceId} />
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
