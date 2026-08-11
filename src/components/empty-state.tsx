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
      className={`relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-dashed border-border/70 bg-surface/30 px-6 text-center ${
        compact ? "py-8" : "py-14"
      }`}
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-60 [background:radial-gradient(24rem_8rem_at_50%_0%,color-mix(in_oklab,var(--primary)_12%,transparent),transparent_70%)]"
      />
      <span className="icon-chip relative size-12 rounded-2xl">
        <Icon className="size-5" />
      </span>
      <div className="relative space-y-1">
        <p className="text-sm font-semibold">{t(title)}</p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-muted-foreground">
          {t(description)}
        </p>
      </div>
      {action && <div className="relative pt-1">{action}</div>}
    </div>
  );
}
