import { Link } from "@tanstack/react-router";
import { Ban, CheckCircle2, Clock, Loader2, RotateCw, XCircle } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import { formatDuration, type Execution, type ExecutionStatus } from "@/services/execution-service";

export function statusBadgeVariant(status: ExecutionStatus): "default" | "secondary" | "outline" | "destructive" {
  if (status === "completed") return "default";
  if (status === "failed") return "destructive";
  if (status === "running" || status === "retrying") return "secondary";
  return "outline";
}

export function StatusIcon({ status }: { status: ExecutionStatus }) {
  if (status === "completed") return <CheckCircle2 className="size-3.5 text-[oklch(0.68_0.15_160)]" />;
  if (status === "failed") return <XCircle className="size-3.5 text-destructive" />;
  if (status === "cancelled") return <Ban className="size-3.5 text-muted-foreground" />;
  if (status === "retrying") return <RotateCw className="size-3.5 text-[oklch(0.78_0.15_75)]" />;
  if (status === "running") return <Loader2 className="size-3.5 animate-spin text-primary" />;
  return <Clock className="size-3.5 text-muted-foreground" />;
}

export function ExecutionQueue({
  executions,
  workflowNames,
  onCancel,
  emptyAction,
}: {
  executions: Execution[];
  workflowNames: Record<string, string>;
  onCancel: (executionId: string) => void;
  emptyAction?: React.ReactNode;
}) {
  const { t } = useI18n();

  if (!executions.length) {
    return (
      <EmptyState
        icon={Clock}
        title="No executions yet"
        description="Run a published workflow and every attempt will appear here with its full lifecycle."
        {...(emptyAction ? { action: emptyAction } : {})}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("Run")}</TableHead>
            <TableHead className="hidden md:table-cell">{t("Status")}</TableHead>
            <TableHead className="hidden lg:table-cell">{t("Priority")}</TableHead>
            <TableHead className="hidden sm:table-cell">{t("Progress")}</TableHead>
            <TableHead className="hidden lg:table-cell">{t("Duration")}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {executions.map((execution) => {
            const active = ["queued", "waiting", "running", "retrying"].includes(execution.status);
            return (
              <TableRow key={execution.id}>
                <TableCell>
                  <Link
                    to="/executions/$executionId"
                    params={{ executionId: execution.id }}
                    className="block min-w-0"
                  >
                    <span className="flex items-center gap-2 text-sm font-medium hover:underline">
                      <StatusIcon status={execution.status} />
                      <span className="truncate">
                        {workflowNames[execution.workflow_id ?? ""] ?? t("Workflow")}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {new Date(execution.created_at).toLocaleString()} · {t(execution.trigger)}
                      {execution.attempt > 1 ? ` · ${t("attempt")} ${execution.attempt}` : ""}
                    </span>
                  </Link>
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <Badge variant={statusBadgeVariant(execution.status)}>{t(execution.status)}</Badge>
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                  P{execution.priority}
                </TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Progress value={execution.progress} className="h-1.5 w-24" />
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                  {formatDuration(execution.duration_ms)}
                </TableCell>
                <TableCell className="text-end">
                  {active && (
                    <Button variant="outline" size="sm" onClick={() => onCancel(execution.id)}>
                      {t("Cancel")}
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
