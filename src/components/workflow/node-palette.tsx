import { useState } from "react";

import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { NODE_CATEGORIES, NODE_KINDS, NODE_SPECS, type NodeKind } from "@/lib/execution/nodes";
import { useI18n } from "@/lib/i18n";

export function NodePalette({ onAdd, disabled }: { onAdd: (kind: NodeKind) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const matches = (kind: NodeKind) => {
    const spec = NODE_SPECS[kind];
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return spec.label.toLowerCase().includes(term) || spec.description.toLowerCase().includes(term);
  };

  return (
    <div className="flex h-full flex-col gap-3">
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t("Search nodes")}
        className="h-9"
      />
      <ScrollArea className="h-[calc(100vh-22rem)] min-h-56 pe-2">
        <div className="space-y-4">
          {NODE_CATEGORIES.map((category) => {
            const kinds = NODE_KINDS.filter(
              (kind) => NODE_SPECS[kind].category === category.value && matches(kind),
            );
            if (!kinds.length) return null;
            return (
              <div key={category.value} className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(category.label)}
                </p>
                <div className="space-y-1.5">
                  {kinds.map((kind) => {
                    const spec = NODE_SPECS[kind];
                    const Icon = spec.icon;
                    return (
                      <button
                        key={kind}
                        type="button"
                        draggable={!disabled}
                        disabled={disabled}
                        onDragStart={(event) =>
                          event.dataTransfer.setData("application/zyronex-node", kind)
                        }
                        onClick={() => onAdd(kind)}
                        className="flex w-full items-start gap-2 rounded-lg border bg-card px-2.5 py-2 text-start transition hover:border-primary/60 hover:bg-surface disabled:opacity-50"
                      >
                        <span
                          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-background"
                          style={{ backgroundColor: spec.accent }}
                        >
                          <Icon className="size-3" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium">{t(spec.label)}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {t(spec.description)}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
