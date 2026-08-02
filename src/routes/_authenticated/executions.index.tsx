import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";

import { ActivityLog } from "@/components/execution/activity-log";
import { ExecutionQueue } from "@/components/execution/execution-queue";
import { ExecutionStats } from "@/components/execution/execution-stats";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActivityLog, useEngineSync, useExecutions, useRuntime } from "@/hooks/use-executions";
import { useWorkflows } from "@/hooks/use-workflows";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { computeMetrics, TERMINAL_STATUSES } from "@/services/execution-service";

export const Route = createFileRoute("/_authenticated/executions/")({
  head: () => ({
    meta: [
      { title: "Execution Dashboard — ZYRONEX" },
      {
        name: "description",
        content:
          "Live queue, throughput and system health for every AI workflow execution in your workspace.",
      },
      { property: "og:title", content: "Execution Dashboard — ZYRONEX" },
      {
        property: "og:description",
        content: "Live queue, throughput and health of the ZYRONEX execution engine.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExecutionsRoute,
});

function ExecutionsRoute() {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;

  useEngineSync(workspaceId);
  const { data: executions } = useExecutions(workspaceId);
  const { data: workflows } = useWorkflows(workspaceId);
  const { data: activity } = useActivityLog(workspaceId);
  const { cancelExecution } = useRuntime(workspaceId);

  const rows = useMemo(() => executions ?? [], [executions]);
  const metrics = useMemo(() => computeMetrics(rows), [rows]);
  const names = useMemo(
    () => Object.fromEntries((workflows ?? []).map((workflow) => [workflow.id, workflow.name])),
    [workflows],
  );

  const queue = rows.filter((item) => !TERMINAL_STATUSES.includes(item.status));
  const history = rows.filter((item) => TERMINAL_STATUSES.includes(item.status));
  const cancel = (id: string) => void cancelExecution.mutateAsync(id);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Execution Dashboard")}
        description={t("Real-time queue, throughput and health of the AI execution engine.")}
      />

      <ExecutionStats metrics={metrics} />

      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="queue">
            {t("Queue")} ({queue.length})
          </TabsTrigger>
          <TabsTrigger value="history">{t("History")}</TabsTrigger>
          <TabsTrigger value="activity">{t("Activity Log")}</TabsTrigger>
        </TabsList>
        <TabsContent value="queue">
          <ExecutionQueue executions={queue} workflowNames={names} onCancel={cancel} />
        </TabsContent>
        <TabsContent value="history">
          <ExecutionQueue executions={history} workflowNames={names} onCancel={cancel} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityLog entries={activity ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
