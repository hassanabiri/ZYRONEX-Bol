import { createFileRoute } from "@tanstack/react-router";
import { Building2, Layers, ScrollText, ShieldCheck, Users } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/workspace")({
  head: () => ({
    meta: [
      { title: "Workspace — ZYRONEX" },
      { name: "description", content: "Tenancy, membership, roles and workspace-level configuration for your organization." },
      { property: "og:title", content: "Workspace — ZYRONEX" },
      { property: "og:description", content: "Tenancy, membership, roles and workspace-level configuration for your organization." },
    ],
  }),
  component: WorkspaceRoute,
});

function WorkspaceRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "Members", description: "Invite people and manage seats across the workspace.", icon: Users },
    { title: "Roles & Access", description: "Owner, admin, member and viewer permission matrix.", icon: ShieldCheck },
    { title: "Environments", description: "Separate development, staging and production contexts.", icon: Layers },
    { title: "Audit Log", description: "Immutable record of every workspace-level change.", icon: ScrollText },
  ];

  return (
    <ModulePage
      title="Workspace"
      description="Tenancy, membership, roles and workspace-level configuration for your organization."
      icon={Building2}
      capabilities={capabilities}
    />
  );
}
