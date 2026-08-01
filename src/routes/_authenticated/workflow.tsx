import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, GitBranch, ListChecks, Workflow, Zap } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/workflow")({
  head: () => ({
    meta: [
      { title: "Workflow Center — ZYRONEX" },
      { name: "description", content: "Orchestrate multi-step, multi-agent processes with triggers, branching and retries." },
      { property: "og:title", content: "Workflow Center — ZYRONEX" },
      { property: "og:description", content: "Orchestrate multi-step, multi-agent processes with triggers, branching and retries." },
    ],
  }),
  component: WorkflowRoute,
});

function WorkflowRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "Flow Designer", description: "Compose deterministic and agentic steps visually.", icon: GitBranch },
    { title: "Triggers", description: "Schedules, webhooks and event-driven activation.", icon: Zap },
    { title: "Runs", description: "Execution history with step-level inspection.", icon: ListChecks },
    { title: "Error Handling", description: "Retries, fallbacks and dead-letter routing.", icon: AlertTriangle },
  ];

  return (
    <ModulePage
      title="Workflow Center"
      description="Orchestrate multi-step, multi-agent processes with triggers, branching and retries."
      icon={Workflow}
      capabilities={capabilities}
    />
  );
}
