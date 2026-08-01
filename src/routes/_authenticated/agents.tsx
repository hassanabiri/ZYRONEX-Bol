import { createFileRoute } from "@tanstack/react-router";
import { Bot, Boxes, Gauge, Rocket, SlidersHorizontal } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/agents")({
  head: () => ({
    meta: [
      { title: "Agent Center — ZYRONEX" },
      { name: "description", content: "Design, version, deploy and supervise the AI agents running in this workspace." },
      { property: "og:title", content: "Agent Center — ZYRONEX" },
      { property: "og:description", content: "Design, version, deploy and supervise the AI agents running in this workspace." },
    ],
  }),
  component: AgentsRoute,
});

function AgentsRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "Agent Registry", description: "Catalog of every agent definition and its version history.", icon: Boxes },
    { title: "Runtime Profiles", description: "Model, tool and guardrail configuration per agent.", icon: SlidersHorizontal },
    { title: "Deployments", description: "Promote agents across environments with rollback.", icon: Rocket },
    { title: "Observability", description: "Traces, latency and failure analysis per run.", icon: Gauge },
  ];

  return (
    <ModulePage
      title="Agent Center"
      description="Design, version, deploy and supervise the AI agents running in this workspace."
      icon={Bot}
      capabilities={capabilities}
    />
  );
}
