import { createFileRoute } from "@tanstack/react-router";
import { Brain, Database, Search, Timer, UserCog } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/memory")({
  head: () => ({
    meta: [
      { title: "Memory Center — ZYRONEX" },
      { name: "description", content: "Persistent short-term and long-term memory for agents, scoped per workspace and user." },
      { property: "og:title", content: "Memory Center — ZYRONEX" },
      { property: "og:description", content: "Persistent short-term and long-term memory for agents, scoped per workspace and user." },
    ],
  }),
  component: MemoryRoute,
});

function MemoryRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "Memory Stores", description: "Namespaced stores with configurable strategies.", icon: Database },
    { title: "Retention", description: "Expiry windows, summarization and compaction.", icon: Timer },
    { title: "Personalization", description: "Per-user memory scoping and consent controls.", icon: UserCog },
    { title: "Inspection", description: "Browse and audit what an agent remembers.", icon: Search },
  ];

  return (
    <ModulePage
      title="Memory Center"
      description="Persistent short-term and long-term memory for agents, scoped per workspace and user."
      icon={Brain}
      capabilities={capabilities}
    />
  );
}
