import { createFileRoute } from "@tanstack/react-router";
import { Brain } from "lucide-react";

import { MemoryAnalytics } from "@/components/memory/memory-analytics";
import { MemoryEntries, MemoryStores } from "@/components/memory/memory-stores";
import { MemoryTimeline } from "@/components/memory/memory-timeline";
import { ModelConfigPanel } from "@/components/memory/model-config-panel";
import { PromptLibrary } from "@/components/memory/prompt-library";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/memory")({
  head: () => ({
    meta: [
      { title: "Memory Center — ZYRONEX" },
      {
        name: "description",
        content:
          "Four-layer agent memory with retention, compaction, prompt library and model presets.",
      },
      { property: "og:title", content: "Memory Center — ZYRONEX" },
      {
        property: "og:description",
        content: "Short-term, session, long-term and persistent memory for every AI worker.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: MemoryRoute,
});

function MemoryRoute() {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Memory Center")}
        description={t(
          "Persistent short-term and long-term memory for agents, scoped per workspace and user.",
        )}
        actions={
          <span className="flex size-10 items-center justify-center rounded-xl bg-surface text-muted-foreground">
            <Brain className="size-5" />
          </span>
        }
      />

      <Tabs defaultValue="stores" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="stores">{t("Stores")}</TabsTrigger>
          <TabsTrigger value="entries">{t("Memories")}</TabsTrigger>
          <TabsTrigger value="timeline">{t("Timeline")}</TabsTrigger>
          <TabsTrigger value="prompts">{t("Prompts")}</TabsTrigger>
          <TabsTrigger value="models">{t("Models")}</TabsTrigger>
          <TabsTrigger value="analytics">{t("Analytics")}</TabsTrigger>
        </TabsList>

        <TabsContent value="stores">
          <MemoryStores workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="entries">
          <MemoryEntries workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="timeline">
          <MemoryTimeline workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="prompts">
          <PromptLibrary workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="models">
          <ModelConfigPanel workspaceId={workspaceId} />
        </TabsContent>
        <TabsContent value="analytics">
          <MemoryAnalytics workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
