import { createFileRoute } from "@tanstack/react-router";

import { BrandMemoryPanel } from "@/components/marketing/brand-memory-panel";
import { BudgetBoard } from "@/components/marketing/budget-board";
import { CmoPanel } from "@/components/marketing/cmo-panel";
import { CreativeStudio } from "@/components/marketing/creative-studio";
import { CreditWallet } from "@/components/marketing/credit-wallet";
import { GovernancePanel } from "@/components/marketing/governance-panel";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWorkspaceRole } from "@/hooks/use-workspace-role";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/marketing")({
  head: () => ({
    meta: [
      { title: "Marketing Command Center — ZYRONEX" },
      {
        name: "description",
        content:
          "Orchestrate campaigns, creative production, credits, budgets and marketing governance from one command center.",
      },
      { property: "og:title", content: "Marketing Command Center — ZYRONEX" },
      {
        property: "og:description",
        content: "Campaigns, creative studio, credit wallet, AI CMO advisor and marketing governance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MarketingRoute,
});

function MarketingRoute() {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { canManageBilling: canManage } = useWorkspaceRole(workspaceId);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Marketing Command Center")}
        description={t(
          "One place to brief creative work, steer budgets and credits, and keep every marketing action governed. Execution is delegated to your specialised AI workers.",
        )}
      />

      <Tabs defaultValue="cmo" className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="cmo">{t("AI CMO")}</TabsTrigger>
          <TabsTrigger value="creative">{t("Creative Studio")}</TabsTrigger>
          <TabsTrigger value="wallet">{t("Credit Wallet")}</TabsTrigger>
          <TabsTrigger value="budget">{t("Campaigns & Budget")}</TabsTrigger>
          <TabsTrigger value="governance">{t("Governance")}</TabsTrigger>
          <TabsTrigger value="brand">{t("Brand Memory")}</TabsTrigger>
        </TabsList>

        <TabsContent value="cmo">
          <CmoPanel workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>
        <TabsContent value="creative">
          <CreativeStudio workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="wallet">
          <CreditWallet workspaceId={workspaceId} canManage={canManage} />
        </TabsContent>
        <TabsContent value="budget">
          <BudgetBoard workspaceId={workspaceId} canManage={canManage} />
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
