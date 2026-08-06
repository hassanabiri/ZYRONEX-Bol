import { useMemo, useState } from "react";
import { BarChart3, Download, FlaskConical, LineChart } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCampaigns, useCreativeRequests, useMarketingMutations } from "@/hooks/use-marketing";
import { useI18n } from "@/lib/i18n";
import {
  campaignKpis,
  formatPercent,
  formatRatio,
  portfolioKpis,
  readMetrics,
  variantGroups,
} from "@/lib/marketing/performance";
import type { Campaign } from "@/services/marketing-service";

/**
 * Live performance monitoring, A/B decisions and the executive report.
 * All figures are computed from campaign rows stored centrally.
 */
export function PerformancePanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { data: campaigns = [] } = useCampaigns(workspaceId);
  const { data: creatives = [] } = useCreativeRequests(workspaceId);
  const mutations = useMarketingMutations(workspaceId);

  const totals = useMemo(() => portfolioKpis(campaigns), [campaigns]);
  const rows = useMemo(() => campaigns.map(campaignKpis), [campaigns]);
  const groups = useMemo(() => variantGroups(creatives), [creatives]);

  const cards: [string, string][] = [
    ["Spend", totals.spend.toLocaleString()],
    ["Revenue", totals.revenue.toLocaleString()],
    ["ROI", formatPercent(totals.roi)],
    ["ROAS", formatRatio(totals.roas)],
    ["CAC", formatRatio(totals.cac, 0)],
    ["CPA", formatRatio(totals.cpa, 0)],
    ["Conversion rate", formatPercent(totals.conversionRate)],
    ["Active campaigns", String(totals.activeCampaigns)],
  ];

  function exportReport() {
    const lines = [
      "# Marketing executive report",
      "",
      ...cards.map(([label, value]) => `- ${label}: ${value}`),
      "",
      "## Campaigns",
      "name,channel,status,spend,revenue,roi,roas,cac,cpa,conversion_rate",
      ...rows.map((row) =>
        [
          row.campaign.name,
          row.campaign.channel,
          row.campaign.status,
          row.spend,
          row.revenue,
          formatPercent(row.roi),
          formatRatio(row.roas),
          formatRatio(row.cac, 0),
          formatRatio(row.cpa, 0),
          formatPercent(row.conversionRate),
        ].join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `marketing-report-${new Date().toISOString().slice(0, 10)}.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="size-4" />
              {t("Performance overview")}
            </CardTitle>
            <CardDescription>{t("Computed from live campaign spend, revenue and funnel counters.")}</CardDescription>
          </div>
          <Button size="sm" variant="outline" className="gap-2" onClick={exportReport}>
            <Download className="size-4" />
            {t("Executive report")}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map(([label, value]) => (
              <div key={label} className="rounded-lg border px-3 py-2">
                <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">{t(label)}</p>
                <p className="text-lg font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <LineChart className="size-4" />
            {t("Campaign results")}
          </CardTitle>
          <CardDescription>{t("Record the funnel counters your channels report to keep KPIs accurate.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <EmptyState
              compact
              icon={BarChart3}
              title="No campaigns yet"
              description="Build a strategy or add a campaign to start measuring performance."
            />
          ) : (
            rows.map((row) => (
              <CampaignRow
                key={row.campaign.id}
                campaign={row.campaign}
                canManage={canManage}
                onSave={(patch) =>
                  mutations.updateCampaign
                    .mutateAsync({ campaign: row.campaign, patch })
                    .then(() => toast.success(t("Campaign updated")))
                    .catch(() => toast.error(t("Action failed")))
                }
              />
            ))
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="size-4" />
            {t("A/B testing")}
          </CardTitle>
          <CardDescription>{t("Variants of the same brief, ranked by the score reported by the executing worker.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {groups.length === 0 ? (
            <EmptyState
              compact
              icon={FlaskConical}
              title="No variants under test"
              description="Duplicate a creative brief as a variant to start an A/B test."
            />
          ) : (
            groups.map((group) => (
              <div key={group.key} className="space-y-2 rounded-lg border p-3">
                <p className="text-sm font-medium">{group.title}</p>
                {group.variants.map((variant) => {
                  const isWinner = group.winner?.id === variant.id;
                  return (
                    <div
                      key={variant.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <Badge variant={isWinner ? "default" : "secondary"}>
                          {variant.variant_label || t("Variant")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {t("Score")}: {variant.performance_score ?? "—"}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        variant={isWinner ? "default" : "outline"}
                        disabled={!canManage}
                        onClick={() =>
                          mutations.updateCreative
                            .mutateAsync({ request: variant, patch: { status: "approved" } })
                            .then(() => toast.success(t("Winning variant selected")))
                            .catch(() => toast.error(t("Action failed")))
                        }
                      >
                        {t("Select winner")}
                      </Button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CampaignRow({
  campaign,
  canManage,
  onSave,
}: {
  campaign: Campaign;
  canManage: boolean;
  onSave: (patch: { revenue: number; metadata: Record<string, number> }) => void;
}) {
  const { t } = useI18n();
  const metrics = readMetrics(campaign);
  const [form, setForm] = useState({
    impressions: String(metrics.impressions),
    clicks: String(metrics.clicks),
    conversions: String(metrics.conversions),
    newCustomers: String(metrics.newCustomers),
    revenue: String(campaign.revenue ?? 0),
  });

  const kpis = campaignKpis(campaign);

  const fields: [keyof typeof form, string][] = [
    ["impressions", "Impressions"],
    ["clicks", "Clicks"],
    ["conversions", "Conversions"],
    ["newCustomers", "New customers"],
    ["revenue", "Revenue"],
  ];

  return (
    <form
      className="space-y-3 rounded-lg border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          revenue: Number(form.revenue) || 0,
          metadata: {
            ...((campaign.metadata ?? {}) as Record<string, number>),
            impressions: Number(form.impressions) || 0,
            clicks: Number(form.clicks) || 0,
            conversions: Number(form.conversions) || 0,
            new_customers: Number(form.newCustomers) || 0,
          },
        });
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{campaign.name}</p>
        <div className="flex flex-wrap gap-1 text-[11px]">
          <Badge variant="outline">ROI {formatPercent(kpis.roi)}</Badge>
          <Badge variant="outline">ROAS {formatRatio(kpis.roas)}</Badge>
          <Badge variant="outline">CAC {formatRatio(kpis.cac, 0)}</Badge>
          <Badge variant="outline">CTR {formatPercent(kpis.ctr)}</Badge>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-5">
        {fields.map(([key, label]) => (
          <div key={key} className="space-y-1">
            <Label className="text-[11px]" htmlFor={`${campaign.id}-${key}`}>
              {t(label)}
            </Label>
            <Input
              id={`${campaign.id}-${key}`}
              type="number"
              min={0}
              value={form[key]}
              onChange={(event) => setForm({ ...form, [key]: event.target.value })}
            />
          </div>
        ))}
      </div>
      <Button type="submit" size="sm" variant="outline" disabled={!canManage}>
        {t("Save results")}
      </Button>
    </form>
  );
}
