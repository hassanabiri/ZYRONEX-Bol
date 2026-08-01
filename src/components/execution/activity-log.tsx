import { History } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { humanize } from "@/lib/worker-options";
import { useI18n } from "@/lib/i18n";
import type { ActivityEntry } from "@/services/activity-service";

export function ActivityLog({ entries, limit }: { entries: ActivityEntry[]; limit?: number }) {
  const { t } = useI18n();
  const rows = limit ? entries.slice(0, limit) : entries;

  if (!rows.length) {
    return (
      <EmptyState
        compact
        icon={History}
        title="No activity yet"
        description="Every engine action — create, publish, run, cancel — is recorded here."
      />
    );
  }

  return (
    <ScrollArea className="max-h-[28rem]">
      <ul className="space-y-2 pe-2">
        {rows.map((entry) => (
          <li key={entry.id} className="rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{humanize(entry.action)}</p>
              <Badge variant={entry.result === "failed" ? "destructive" : "outline"}>
                {t(entry.result)}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {humanize(entry.entity_type)} · {new Date(entry.created_at).toLocaleString()}
            </p>
            {entry.detail && <p className="mt-1 text-xs text-muted-foreground">{entry.detail}</p>}
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
