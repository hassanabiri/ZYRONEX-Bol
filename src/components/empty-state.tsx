import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useI18n } from "@/lib/i18n";

/** Shared empty state used by every workspace module (team, agents, knowledge, voice…). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  const { t } = useI18n();

  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 text-center ${
        compact ? "py-8" : "py-14"
      }`}
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-surface text-muted-foreground">
        <Icon className="size-5" />
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold">{t(title)}</p>
        <p className="mx-auto max-w-sm text-xs text-muted-foreground">{t(description)}</p>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
