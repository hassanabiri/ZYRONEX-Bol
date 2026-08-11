import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="hairline-b grid grid-cols-[minmax(0,1fr)] gap-3 pb-4 sm:flex sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 space-y-1.5">
        <h1 className="font-display text-xl font-semibold tracking-[-0.02em] sm:text-2xl lg:text-[1.75rem]">
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>
      )}
    </div>
  );
}
