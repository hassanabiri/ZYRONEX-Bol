import { Boxes, Code2, Download, Puzzle, Store, TerminalSquare, Wallet } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

/** Top-line counters for the Developer Center dashboard. */
export function DeveloperStats({
  projects,
  plugins,
  sdks,
  apiRequests,
  revenueCents,
  publishedWorkers,
  publishedTemplates,
}: {
  projects: number;
  plugins: number;
  sdks: number;
  apiRequests: number;
  revenueCents: number;
  publishedWorkers: number;
  publishedTemplates: number;
}) {
  const { t } = useI18n();

  const stats = [
    { label: "Projects", value: projects, icon: Boxes },
    { label: "Plugins", value: plugins, icon: Puzzle },
    { label: "SDKs", value: sdks, icon: Code2 },
    { label: "API Usage", value: apiRequests, icon: TerminalSquare },
    {
      label: "Marketplace Revenue",
      value: `$${(revenueCents / 100).toFixed(2)}`,
      icon: Wallet,
    },
    { label: "Published Workers", value: publishedWorkers, icon: Store },
    { label: "Published Templates", value: publishedTemplates, icon: Download },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      {stats.map((stat) => (
        <Card key={stat.label} className="panel-shadow">
          <CardContent className="flex items-center gap-3 p-4">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-muted-foreground">
              <stat.icon className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                {t(stat.label)}
              </p>
              <p className="truncate text-lg font-semibold tabular-nums">{stat.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
