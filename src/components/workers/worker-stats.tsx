import { Archive, Bot, CircleDot, FileEdit, PauseCircle } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";
import type { Worker } from "@/services/worker-service";

/** Counters across the worker estate of the active workspace. */
export function WorkerStats({ workers }: { workers: Worker[] }) {
  const { t } = useI18n();
  const count = (status: Worker["status"]) => workers.filter((w) => w.status === status).length;

  const stats = [
    { label: "Total Workers", value: workers.length, icon: Bot },
    { label: "Active Workers", value: count("active"), icon: CircleDot },
    { label: "Paused Workers", value: count("paused"), icon: PauseCircle },
    { label: "Draft Workers", value: count("draft"), icon: FileEdit },
    { label: "Archived Workers", value: count("archived"), icon: Archive },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      {stats.map((stat) => (
        <Card key={stat.label} className="panel-shadow">
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex size-9 items-center justify-center rounded-lg bg-surface text-muted-foreground">
              <stat.icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {t(stat.label)}
              </p>
              <p className="text-xl font-semibold tabular-nums">{stat.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
