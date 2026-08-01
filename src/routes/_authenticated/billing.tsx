import { createFileRoute } from "@tanstack/react-router";
import { BadgeCheck, BarChart3, CreditCard, ReceiptText, ShieldAlert } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({
    meta: [
      { title: "Billing Center — ZYRONEX" },
      { name: "description", content: "Plans, usage-based consumption, invoices and spend controls." },
      { property: "og:title", content: "Billing Center — ZYRONEX" },
      { property: "og:description", content: "Plans, usage-based consumption, invoices and spend controls." },
    ],
  }),
  component: BillingRoute,
});

function BillingRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "Plan", description: "Current subscription tier and entitlements.", icon: BadgeCheck },
    { title: "Usage", description: "Metered consumption across every module.", icon: BarChart3 },
    { title: "Invoices", description: "Billing history and downloadable receipts.", icon: ReceiptText },
    { title: "Cost Controls", description: "Budgets, alerts and hard spend limits.", icon: ShieldAlert },
  ];

  return (
    <ModulePage
      title="Billing Center"
      description="Plans, usage-based consumption, invoices and spend controls."
      icon={CreditCard}
      capabilities={capabilities}
    />
  );
}
