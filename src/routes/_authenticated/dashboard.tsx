import { createFileRoute } from "@tanstack/react-router";

import { QuickActions } from "@/components/workspace/quick-actions";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { WorkspaceOverview } from "@/components/workspace/workspace-overview";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Workspace Home — ZYRONEX" },
      {
        name: "description",
        content:
          "Your ZYRONEX workspace home: status, usage overview, team and quick actions across every module.",
      },
      { property: "og:title", content: "Workspace Home — ZYRONEX" },
      {
        property: "og:description",
        content: "Workspace status, usage overview, team and quick actions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WorkspaceHome,
});

function WorkspaceHome() {
  const { activeWorkspace } = useWorkspace();

  return (
    <div className="space-y-6">
      <WorkspaceHeader workspace={activeWorkspace} />
      <QuickActions />
      <WorkspaceOverview workspaceId={activeWorkspace?.id} />
    </div>
  );
}
