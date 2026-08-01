import { createFileRoute } from "@tanstack/react-router";
import { Building2, FileCheck, Scale, ShieldCheck, UserCheck } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/administration")({
  head: () => ({
    meta: [
      { title: "Administration Center — ZYRONEX" },
      { name: "description", content: "Organization-wide governance, compliance and platform administration." },
      { property: "og:title", content: "Administration Center — ZYRONEX" },
      { property: "og:description", content: "Organization-wide governance, compliance and platform administration." },
    ],
  }),
  component: AdministrationRoute,
});

function AdministrationRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "Organization", description: "Legal entity, domains and ownership.", icon: Building2 },
    { title: "Policies", description: "Data residency, retention and model policy.", icon: Scale },
    { title: "Compliance", description: "SOC2 evidence, DPAs and audit exports.", icon: FileCheck },
    { title: "Access Reviews", description: "Periodic entitlement certification.", icon: UserCheck },
  ];

  return (
    <ModulePage
      title="Administration Center"
      description="Organization-wide governance, compliance and platform administration."
      icon={ShieldCheck}
      capabilities={capabilities}
    />
  );
}
