import { useMemo } from "react";
import { Brain, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useCreditBalances, useUsageRecords } from "@/hooks/use-billing";
import {
  useBudgetAllocations,
  useCampaigns,
  useCreativeRequests,
  useMarketingAlerts,
  useMarketingMutations,
} from "@/hooks/use-marketing";
import { useI18n } from "@/lib/i18n";
import { ALERT_KIND_LABELS, ALERT_SEVERITY_TONE } from "@/lib/marketing/catalog";
import { buildRecommendations } from "@/lib/marketing/advisor";
import { marketingService } from "@/services/marketing-service";

/**
 * AI CMO — proactive advisor. Recommendations are derived from the workspace's
 * real ledgers, budgets and campaign performance, then can be pinned as alerts.
 */
export function CmoPanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { data: balances = [] } = useCreditBalances(workspaceId);
  const { data: usage = [] } = useUsageRecords(workspaceId);
  const { data: campaigns = [] } = useCampaigns(workspaceId);
  const { data: allocations = [] } = useBudgetAllocations(workspaceId);
  const { data: creatives = [] } = useCreativeRequests(workspaceId);
  const { data: alerts = [] } = useMarketingAlerts(workspaceId);
  const mutations = useMarketingMutations(workspaceId);

  const recommendations = useMemo(
    () =>
      buildRecommendations({
        wallet: marketingService.wallet(balances, usage),
        campaigns,
        allocations,
        creatives,
      }),
    [balances, usage, campaigns, allocations, creatives],
  );

  const openAlerts = alerts.filter((alert) => !alert.resolved);

  async function pinAll() {
    if (!recommendations.length) return;
    await mutations.saveAlerts.mutateAsync(
      recommendations.map((item) => ({
        kind: item.kind,
        severity: item.severity,
        title: item.title,
        reason: item.message,
        recommended_action: item.action,
        action_key: item.key,
      })),
    );
    toast.success(t("Recommendations pinned to alerts"));
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Brain className="size-4" />
              {t("AI CMO recommendations")}
            </CardTitle>
            <CardDescription>
              {t("Derived from live spend, credit burn and campaign returns.")}
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={pinAll} disabled={!recommendations.length}>
            {t("Pin all")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {recommendations.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Everything looks healthy"
              description="No budget, credit or performance risk detected right now."
              compact
            />
          ) : (
            recommendations.map((item) => (
              <div key={item.key} className="space-y-1 rounded-lg border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={ALERT_SEVERITY_TONE[item.severity]}>
                    {t(ALERT_KIND_LABELS[item.kind])}
                  </Badge>
                  <p className="text-sm font-medium">{item.title}</p>
                </div>
                <p className="text-xs text-muted-foreground">{item.message}</p>
                {item.action && <p className="text-xs">{t(item.action)}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Open alerts")}</CardTitle>
          <CardDescription>{t("Pinned issues awaiting a decision.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {openAlerts.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No open alerts"
              description="Pinned recommendations will appear here until resolved."
              compact
            />
          ) : (
            openAlerts.map((alert) => (
              <div key={alert.id} className="space-y-1 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={ALERT_SEVERITY_TONE[alert.severity]}>
                      {t(ALERT_KIND_LABELS[alert.kind])}
                    </Badge>
                    <p className="text-sm font-medium">{alert.title}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!canManage}
                    onClick={() => mutations.resolveAlert.mutate(alert)}
                  >
                    {t("Resolve")}
                  </Button>
                </div>
                {alert.reason && <p className="text-xs text-muted-foreground">{alert.reason}</p>}
                {alert.recommended_action && <p className="text-xs">{alert.recommended_action}</p>}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
