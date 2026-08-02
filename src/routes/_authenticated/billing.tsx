import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { BillingStats } from "@/components/billing/billing-stats";
import { CreditEngine } from "@/components/billing/credit-engine";
import { InvoiceCenter } from "@/components/billing/invoice-center";
import { PaymentArchitecture } from "@/components/billing/payment-architecture";
import { SubscriptionCenter } from "@/components/billing/subscription-center";
import { UsageTracking } from "@/components/billing/usage-tracking";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  useBillingMutations,
  useCreditBalances,
  useCreditTransactions,
  useInvoices,
  usePaymentMethods,
  useSubscription,
  useUsageRecords,
} from "@/hooks/use-billing";
import { useWorkspaceRole } from "@/hooks/use-workspace-role";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Billing Center — ZYRONEX" },
      {
        name: "description",
        content:
          "Subscriptions, credit ledgers, metered usage, invoices and payment architecture for your workspace.",
      },
      { property: "og:title", content: "Billing Center — ZYRONEX" },
      {
        property: "og:description",
        content: "Plans, credits, usage tracking, invoices and spend controls.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BillingRoute,
});

function BillingRoute() {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { canManageBilling } = useWorkspaceRole(workspaceId);

  const { data: subscription = null, isFetched } = useSubscription(workspaceId);
  const { data: balances = [] } = useCreditBalances(workspaceId);
  const { data: transactions = [] } = useCreditTransactions(workspaceId);
  const { data: usage = [] } = useUsageRecords(workspaceId);
  const { data: invoices = [] } = useInvoices(workspaceId);
  const { data: methods = [] } = usePaymentMethods(workspaceId);
  const mutations = useBillingMutations(workspaceId);

  const [tab, setTab] = useState("subscription");

  // A workspace always needs its ledgers; provision them once for the owner/admin.
  const ensure = mutations.ensureSubscription;
  useEffect(() => {
    if (!workspaceId || !isFetched || subscription || !canManageBilling) return;
    if (ensure.isPending || ensure.isSuccess) return;
    ensure.mutate(activeWorkspace?.subscription_plan ?? "free");
  }, [workspaceId, isFetched, subscription, canManageBilling, ensure, activeWorkspace]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Billing Center")}
        description={t(
          "Subscription, credit ledgers, metered usage, invoices and the payment rails ZYRONEX will settle through.",
        )}
      />

      <BillingStats
        subscription={subscription}
        balances={balances}
        invoices={invoices}
        usage={usage}
      />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="subscription">{t("Subscription")}</TabsTrigger>
          <TabsTrigger value="credits">{t("Credits")}</TabsTrigger>
          <TabsTrigger value="usage">{t("Usage")}</TabsTrigger>
          <TabsTrigger value="invoices">{t("Invoices")}</TabsTrigger>
          <TabsTrigger value="payments">{t("Payments")}</TabsTrigger>
        </TabsList>

        <TabsContent value="subscription">
          <SubscriptionCenter
            workspaceId={workspaceId}
            subscription={subscription}
            canManage={canManageBilling}
          />
        </TabsContent>

        <TabsContent value="credits">
          <CreditEngine
            workspaceId={workspaceId}
            subscription={subscription}
            balances={balances}
            transactions={transactions}
            canManage={canManageBilling}
          />
        </TabsContent>

        <TabsContent value="usage">
          <UsageTracking usage={usage} currency={subscription?.currency ?? "USD"} />
        </TabsContent>

        <TabsContent value="invoices">
          <InvoiceCenter
            workspaceId={workspaceId}
            subscription={subscription}
            invoices={invoices}
            usage={usage}
            canManage={canManageBilling}
          />
        </TabsContent>

        <TabsContent value="payments">
          <PaymentArchitecture
            workspaceId={workspaceId}
            methods={methods}
            canManage={canManageBilling}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
