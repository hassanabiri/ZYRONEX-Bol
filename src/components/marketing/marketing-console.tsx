import { Megaphone } from "lucide-react";

import { BrandMemoryPanel } from "@/components/marketing/brand-memory-panel";
import { BudgetBoard } from "@/components/marketing/budget-board";
import { CmoPanel } from "@/components/marketing/cmo-panel";
import { CreativeStudio } from "@/components/marketing/creative-studio";
import { GovernancePanel } from "@/components/marketing/governance-panel";
import { PerformancePanel } from "@/components/marketing/performance-panel";
import { StrategyPanel } from "@/components/marketing/strategy-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceRole } from "@/hooks/use-workspace-role";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import type { Worker } from "@/services/worker-service";

/**
 * Marketing capability of an AI worker. It is not a standalone module: it runs
 * inside the worker lifecycle and uses the platform's central permissions,
 * billing credits, approvals, audit trail and specialised workers.
 */
export function MarketingConsole({ worker }: { worker: Worker }) {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { canManageBilling: canManage } = useWorkspaceRole(workspaceId);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Megaphone className="size-4" />
            {t("AI Marketing Manager")}
          </CardTitle>
          <CardDescription>
            {t(
              "This worker plans, coordinates and measures marketing. Execution is delegated to the specialised workers and central services of the workspace — credits, approvals and audit all run through the platform.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {t("Credits and invoices are managed in the Billing Center. Permissions follow your workspace roles.")}
        </CardContent>
      </Card>

      <Tabs defaultValue="strategy" className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="strategy">{t("Strategy")}</TabsTrigger>
          <TabsTrigger value="campaigns">{t("Campaigns & Budget")}</TabsTrigger>
          <TabsTrigger value="creative">{t("Creative Studio")}</TabsTrigger>
          <TabsTrigger value="performance">{t("Performance")}</TabsTrigger>
          <TabsTrigger value="advisor">{t("Advisor")}</TabsTrigger>
          <TabsTrigger value="governance">{t("Governance")}</TabsTrigger>
          <TabsTrigger value="brand">{t("Brand Memory")}</TabsTrigger>
        </TabsList>

        <TabsContent value="strategy">
          <StrategyPanel workspaceId={workspaceId} workerId={worker.id} canManage={canManage} />
        </TabsContent>
        <TabsContent value="campaigns">
          <BudgetBoard workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>
        <TabsContent value="creative">
          <CreativeStudio workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="performance">
          <PerformancePanel workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>
        <TabsContent value="advisor">
          <CmoPanel workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>
        <TabsContent value="governance">
          <GovernancePanel workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>
        <TabsContent value="brand">
          <BrandMemoryPanel workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
