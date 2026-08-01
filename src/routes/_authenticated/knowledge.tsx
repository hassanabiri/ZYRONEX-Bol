import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, FolderOpen, Layers, Search, ShieldCheck } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/knowledge")({
  head: () => ({
    meta: [
      { title: "Knowledge Center — ZYRONEX" },
      { name: "description", content: "Ingest, index and govern the knowledge your agents are allowed to reason over." },
      { property: "og:title", content: "Knowledge Center — ZYRONEX" },
      { property: "og:description", content: "Ingest, index and govern the knowledge your agents are allowed to reason over." },
    ],
  }),
  component: KnowledgeRoute,
});

function KnowledgeRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "Sources", description: "Documents, sites and connected data repositories.", icon: FolderOpen },
    { title: "Indexing", description: "Chunking, embedding and refresh pipelines.", icon: Layers },
    { title: "Retrieval", description: "Hybrid search configuration and relevance tuning.", icon: Search },
    { title: "Governance", description: "Access scopes, redaction and retention policy.", icon: ShieldCheck },
  ];

  return (
    <ModulePage
      title="Knowledge Center"
      description="Ingest, index and govern the knowledge your agents are allowed to reason over."
      icon={BookOpen}
      capabilities={capabilities}
    />
  );
}
