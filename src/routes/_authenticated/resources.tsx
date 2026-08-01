import { createFileRoute } from "@tanstack/react-router";
import { Cpu, Gauge, HardDrive, Server, Sparkles } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/resources")({
  head: () => ({
    meta: [
      { title: "Resource Center — ZYRONEX" },
      { name: "description", content: "Compute, model capacity, rate limits and quotas allocated to this workspace." },
      { property: "og:title", content: "Resource Center — ZYRONEX" },
      { property: "og:description", content: "Compute, model capacity, rate limits and quotas allocated to this workspace." },
    ],
  }),
  component: ResourcesRoute,
});

function ResourcesRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "Compute Pools", description: "Dedicated and shared execution capacity.", icon: Cpu },
    { title: "Model Access", description: "Enabled providers and per-model limits.", icon: Sparkles },
    { title: "Quotas", description: "Concurrency, throughput and spend ceilings.", icon: Gauge },
    { title: "Storage", description: "Artifacts, files and vector storage usage.", icon: HardDrive },
  ];

  return (
    <ModulePage
      title="Resource Center"
      description="Compute, model capacity, rate limits and quotas allocated to this workspace."
      icon={Server}
      capabilities={capabilities}
    />
  );
}
