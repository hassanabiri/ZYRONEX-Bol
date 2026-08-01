import { createFileRoute } from "@tanstack/react-router";
import { Plug, Puzzle, RefreshCw, Webhook, Wrench } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/integrations")({
  head: () => ({
    meta: [
      { title: "Integration Center — ZYRONEX" },
      { name: "description", content: "Connect ZYRONEX to the systems your business already runs on." },
      { property: "og:title", content: "Integration Center — ZYRONEX" },
      { property: "og:description", content: "Connect ZYRONEX to the systems your business already runs on." },
    ],
  }),
  component: IntegrationsRoute,
});

function IntegrationsRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "Connectors", description: "First-party connectors and their credentials.", icon: Puzzle },
    { title: "Webhooks", description: "Inbound and outbound event delivery.", icon: Webhook },
    { title: "Tool Catalog", description: "Expose external actions as agent tools.", icon: Wrench },
    { title: "Sync Status", description: "Health and throughput of every connection.", icon: RefreshCw },
  ];

  return (
    <ModulePage
      title="Integration Center"
      description="Connect ZYRONEX to the systems your business already runs on."
      icon={Plug}
      capabilities={capabilities}
    />
  );
}
