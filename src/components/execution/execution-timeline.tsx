import { EmptyState } from "@/components/empty-state";
import { StatusIcon } from "@/components/execution/execution-queue";
import { Badge } from "@/components/ui/badge";
import { ListChecks } from "lucide-react";

import { nodeSpec } from "@/lib/execution/nodes";
import { useI18n } from "@/lib/i18n";
import { formatDuration, type ExecutionStep } from "@/services/execution-service";

/** Step-level timeline of a single execution. */
export function ExecutionTimeline({ steps }: { steps: ExecutionStep[] }) {
  const { t } = useI18n();

  if (!steps.length) {
    return (
      <EmptyState
        compact
        icon={ListChecks}
        title="No steps recorded"
        description="Steps appear as soon as the runtime schedules the workflow nodes."
      />
    );
  }

  return (
    <ol className="relative space-y-3 ps-6">
      <span className="absolute inset-y-1 start-2 w-px bg-border" aria-hidden />
      {steps.map((step) => {
        const spec = nodeSpec(step.node_type);
        const Icon = spec.icon;
        return (
          <li key={step.id} className="relative">
            <span className="absolute -start-6 top-2 flex size-4 items-center justify-center rounded-full border bg-background">
              <StatusIcon status={step.status} />
            </span>
            <div className="rounded-xl border bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="size-3.5 text-muted-foreground" />
                  {step.label || spec.label}
                </p>
                <div className="flex items-center gap-2">
                  {step.attempt > 1 && (
                    <Badge variant="outline">
                      {t("attempt")} {step.attempt}
                    </Badge>
                  )}
                  <Badge variant="secondary">{t(step.status)}</Badge>
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {spec.label} · {formatDuration(step.duration_ms)}
                {step.started_at ? ` · ${new Date(step.started_at).toLocaleTimeString()}` : ""}
              </p>
              {step.error && <p className="mt-1 text-xs text-destructive">{step.error}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
