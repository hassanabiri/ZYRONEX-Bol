import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Plug,
  RefreshCw,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n";
import { FAILING_STATUSES, PROVIDERS } from "@/lib/integrations/catalog";
import type { Integration } from "@/services/integration-service";

function formatWhen(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return new Date(value).toLocaleString();
}

/** The six Integration Hub dashboard cards. */
export function IntegrationStats({ integrations }: { integrations: Integration[] }) {
  const { t } = useI18n();
  const live = integrations.filter((item) => item.status !== "archived");
  const connected = live.filter((item) => item.enabled && item.status === "healthy").length;
  const failed = live.filter((item) => FAILING_STATUSES.includes(item.status)).length;
  const pending = live.filter((item) => item.status === "pending").length;
  const lastSync = live
    .map((item) => item.last_sync_at)
    .filter(Boolean)
    .sort()
    .at(-1);
  const health = live.length === 0 ? 0 : Math.round((connected / live.length) * 100);

  const cards = [
    { title: "Connected", value: connected, icon: CheckCircle2, hint: "Enabled and healthy" },
    { title: "Available", value: PROVIDERS.length, icon: Plug, hint: "Providers ready to connect" },
    { title: "Failed", value: failed, icon: AlertTriangle, hint: "Need attention" },
    { title: "Pending", value: pending, icon: Clock, hint: "Awaiting verification" },
    {
      title: "Last synchronization",
      value: formatWhen(lastSync, "—"),
      icon: RefreshCw,
      hint: "Most recent successful sync",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t(card.title)}
            </CardTitle>
            <card.icon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="truncate text-2xl font-semibold">{card.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t(card.hint)}</p>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("Integration health")}
          </CardTitle>
          <Activity className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-2xl font-semibold">{health}%</p>
          <Progress value={health} />
          <p className="text-xs text-muted-foreground">
            {live.length} {t("connections monitored")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
