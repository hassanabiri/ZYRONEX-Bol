import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Gauge,
  ListRestart,
  Loader2,
  XCircle,
  type LucideIcon,
} from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { formatDuration, type ExecutionMetrics } from "@/services/execution-service";

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t(label)}</p>
        <Icon className="size-4 text-muted-foreground" />
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{t(hint)}</p>}
    </div>
  );
}

export function ExecutionStats({ metrics }: { metrics: ExecutionMetrics }) {
  const health =
    metrics.failureRate > 40 ? "Degraded" : metrics.failureRate > 15 ? "Watch" : "Healthy";

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard icon={Loader2} label="Running" value={String(metrics.running)} />
      <StatCard icon={Clock} label="Queued" value={String(metrics.queued)} />
      <StatCard icon={Gauge} label="Average duration" value={formatDuration(metrics.averageDurationMs)} />
      <StatCard icon={CheckCircle2} label="Success rate" value={`${metrics.successRate}%`} />
      <StatCard icon={XCircle} label="Failure rate" value={`${metrics.failureRate}%`} />
      <StatCard icon={ListRestart} label="Retries" value={String(metrics.retries)} />
      <StatCard icon={AlertTriangle} label="Cancelled" value={String(metrics.cancelled)} />
      <StatCard icon={Activity} label="System health" value={health} hint="Based on the recent failure rate" />
    </div>
  );
}
