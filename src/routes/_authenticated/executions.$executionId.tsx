import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Ban, ListChecks } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { statusBadgeVariant } from "@/components/execution/execution-queue";
import { ExecutionTimeline } from "@/components/execution/execution-timeline";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useExecution, useExecutionSteps, useRuntime } from "@/hooks/use-executions";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { formatDuration, TERMINAL_STATUSES } from "@/services/execution-service";

export const Route = createFileRoute("/_authenticated/executions/$executionId")({
  head: () => ({
    meta: [
      { title: "Execution Detail — ZYRONEX" },
      {
        name: "description",
        content: "Step-level timeline, durations, retries and errors for a single workflow execution.",
      },
      { property: "og:title", content: "Execution Detail — ZYRONEX" },
      { property: "og:description", content: "Step-level timeline for a ZYRONEX execution." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExecutionDetailRoute,
});

function ExecutionDetailRoute() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { executionId } = Route.useParams();
  const { activeWorkspace } = useWorkspace();
  const { data: execution, isLoading } = useExecution(executionId);
  const { data: steps } = useExecutionSteps(executionId);
  const { cancelExecution } = useRuntime(activeWorkspace?.id);

  if (isLoading) return <div className="h-64 animate-pulse rounded-xl border bg-card" />;

  if (!execution) {
    return (
      <EmptyState
        icon={ListChecks}
        title="Execution not found"
        description="This execution record is no longer available."
        action={<Button onClick={() => navigate({ to: "/executions" })}>{t("Back to executions")}</Button>}
      />
    );
  }

  const active = !TERMINAL_STATUSES.includes(execution.status);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <Button variant="ghost" size="sm" className="-ms-2 gap-2" onClick={() => navigate({ to: "/executions" })}>
            <ArrowLeft className="size-4" />
            {t("Execution Dashboard")}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{t("Execution")}</h1>
            <Badge variant={statusBadgeVariant(execution.status)}>{t(execution.status)}</Badge>
            <Badge variant="outline">
              {t("attempt")} {execution.attempt}/{execution.max_attempts}
            </Badge>
            <Badge variant="outline">P{execution.priority}</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t(execution.trigger)} · {new Date(execution.created_at).toLocaleString()} ·{" "}
            {formatDuration(execution.duration_ms)}
          </p>
        </div>
        {active && (
          <Button variant="outline" className="gap-2" onClick={() => void cancelExecution.mutateAsync(executionId)}>
            <Ban className="size-4" />
            {t("Cancel")}
          </Button>
        )}
      </div>

      <div className="space-y-2 rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t("Progress")}</span>
          <span>{execution.progress}%</span>
        </div>
        <Progress value={execution.progress} className="h-2" />
        {execution.error && <p className="text-xs text-destructive">{execution.error}</p>}
        {execution.warnings.length > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {execution.warnings.map((warning, index) => (
              <li key={index}>• {warning}</li>
            ))}
          </ul>
        )}
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("Execution timeline")}</h2>
        <ExecutionTimeline steps={steps ?? []} />
      </section>
    </div>
  );
}
