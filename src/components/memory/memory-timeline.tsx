import { History } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMemoryEvents, useMemoryStores } from "@/hooks/use-memory";
import { useI18n } from "@/lib/i18n";
import { humanize } from "@/lib/worker-options";

/** Chronological trail of every memory operation in the workspace. */
export function MemoryTimeline({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: events } = useMemoryEvents(workspaceId);
  const { data: stores } = useMemoryStores(workspaceId);

  if (!events?.length) {
    return (
      <EmptyState
        compact
        icon={History}
        title="No memory activity yet"
        description="Writes, recalls, archives and expirations are recorded here."
      />
    );
  }

  return (
    <ScrollArea className="max-h-[28rem]">
      <ul className="space-y-2 pe-2">
        {events.map((event) => (
          <li key={event.id} className="rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{humanize(event.event)}</p>
              <Badge variant="outline">
                {stores?.find((store) => store.id === event.store_id)?.name ?? t("Workspace")}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(event.created_at).toLocaleString()}
            </p>
            {event.detail && <p className="mt-1 text-xs text-muted-foreground">{event.detail}</p>}
          </li>
        ))}
      </ul>
    </ScrollArea>
  );
}
