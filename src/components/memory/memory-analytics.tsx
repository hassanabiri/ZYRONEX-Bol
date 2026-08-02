import { useMemo } from "react";

import { useMemoryEntries, useMemoryStores } from "@/hooks/use-memory";
import { useI18n } from "@/lib/i18n";
import { MEMORY_LAYERS } from "@/services/memory-service";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Usage analytics across every memory layer in the workspace. */
export function MemoryAnalytics({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: stores } = useMemoryStores(workspaceId);
  const { data: entries } = useMemoryEntries(workspaceId);

  const stats = useMemo(() => {
    const rows = entries ?? [];
    const active = rows.filter((entry) => entry.status === "active");
    const reads = rows.reduce((sum, entry) => sum + entry.read_count, 0);
    const bytes = rows.reduce((sum, entry) => sum + entry.size_bytes, 0);
    const byLayer = MEMORY_LAYERS.map((layer) => {
      const storeIds = new Set(
        (stores ?? []).filter((store) => store.layer === layer.layer).map((store) => store.id),
      );
      return {
        ...layer,
        count: rows.filter((entry) => storeIds.has(entry.store_id)).length,
      };
    });
    return { total: rows.length, active: active.length, reads, bytes, byLayer };
  }, [entries, stores]);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("Total memories")} value={String(stats.total)} />
        <StatCard label={t("Active")} value={String(stats.active)} />
        <StatCard label={t("Recalls")} value={String(stats.reads)} />
        <StatCard
          label={t("Stored size")}
          value={`${(stats.bytes / 1024).toFixed(1)} KB`}
          hint={t("Approximate, based on stored text length.")}
        />
      </div>
      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm font-semibold">{t("Distribution by layer")}</p>
        <ul className="mt-3 space-y-2">
          {stats.byLayer.map((layer) => {
            const percent = stats.total ? Math.round((layer.count / stats.total) * 100) : 0;
            return (
              <li key={layer.layer} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span>{t(layer.label)}</span>
                  <span className="text-muted-foreground">
                    {layer.count} · {percent}%
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
