import { createFileRoute } from "@tanstack/react-router";
import { Code2, FileCode, KeyRound, Package, Terminal } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/developer")({
  head: () => ({
    meta: [
      { title: "Developer Center — ZYRONEX" },
      { name: "description", content: "API keys, SDKs, webhooks and everything needed to build on the platform." },
      { property: "og:title", content: "Developer Center — ZYRONEX" },
      { property: "og:description", content: "API keys, SDKs, webhooks and everything needed to build on the platform." },
    ],
  }),
  component: DeveloperRoute,
});

function DeveloperRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "API Keys", description: "Scoped keys with rotation and revocation.", icon: KeyRound },
    { title: "SDKs", description: "Typed clients for TypeScript and Python.", icon: Package },
    { title: "API Reference", description: "Endpoints, schemas and error contracts.", icon: FileCode },
    { title: "Logs", description: "Request-level traces for platform API calls.", icon: Terminal },
  ];

  return (
    <ModulePage
      title="Developer Center"
      description="API keys, SDKs, webhooks and everything needed to build on the platform."
      icon={Code2}
      capabilities={capabilities}
    />
  );
}
