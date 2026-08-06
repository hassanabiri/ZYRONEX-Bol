import type { Campaign, CreativeRequest } from "@/services/marketing-service";

/**
 * Campaign performance math. Every figure is derived from data already stored
 * on the campaign row (budget, spend, revenue) plus the funnel counters the
 * operator records in `metadata`. Nothing is simulated.
 */

export type CampaignMetrics = {
  impressions: number;
  clicks: number;
  conversions: number;
  newCustomers: number;
};

export type CampaignKpis = CampaignMetrics & {
  campaign: Campaign;
  spend: number;
  revenue: number;
  roi: number | null;
  roas: number | null;
  cac: number | null;
  cpa: number | null;
  ctr: number | null;
  conversionRate: number | null;
  pacing: number | null;
};

const num = (value: unknown) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

export function readMetrics(campaign: Campaign): CampaignMetrics {
  const meta = (campaign.metadata ?? {}) as Record<string, unknown>;
  return {
    impressions: num(meta['impressions']),
    clicks: num(meta['clicks']),
    conversions: num(meta['conversions']),
    newCustomers: num(meta['new_customers']),
  };
}

export function campaignKpis(campaign: Campaign): CampaignKpis {
  const metrics = readMetrics(campaign);
  const spend = num(campaign.budget_spent);
  const revenue = num(campaign.revenue);
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

  return {
    ...metrics,
    campaign,
    spend,
    revenue,
    roi: spend > 0 ? (revenue - spend) / spend : null,
    roas: ratio(revenue, spend),
    cac: ratio(spend, metrics.newCustomers),
    cpa: ratio(spend, metrics.conversions),
    ctr: ratio(metrics.clicks, metrics.impressions),
    conversionRate: ratio(metrics.conversions, metrics.clicks),
    pacing: ratio(spend, num(campaign.budget_total)),
  };
}

export type PortfolioKpis = {
  spend: number;
  revenue: number;
  conversions: number;
  newCustomers: number;
  roi: number | null;
  roas: number | null;
  cac: number | null;
  cpa: number | null;
  conversionRate: number | null;
  activeCampaigns: number;
};

export function portfolioKpis(campaigns: Campaign[]): PortfolioKpis {
  const rows = campaigns.map(campaignKpis);
  const sum = (pick: (row: CampaignKpis) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const spend = sum((row) => row.spend);
  const revenue = sum((row) => row.revenue);
  const conversions = sum((row) => row.conversions);
  const newCustomers = sum((row) => row.newCustomers);
  const clicks = sum((row) => row.clicks);
  const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

  return {
    spend,
    revenue,
    conversions,
    newCustomers,
    roi: spend > 0 ? (revenue - spend) / spend : null,
    roas: ratio(revenue, spend),
    cac: ratio(spend, newCustomers),
    cpa: ratio(spend, conversions),
    conversionRate: ratio(conversions, clicks),
    activeCampaigns: campaigns.filter((campaign) => campaign.status === "active").length,
  };
}

export type VariantGroup = {
  key: string;
  title: string;
  variants: CreativeRequest[];
  winner: CreativeRequest | null;
};

/**
 * Groups creative variants (children of the same brief) so the operator can see
 * which version scored best. Scores come from `performance_score` recorded by
 * the executing worker — an untested group has no winner.
 */
export function variantGroups(creatives: CreativeRequest[]): VariantGroup[] {
  const groups = new Map<string, CreativeRequest[]>();
  for (const item of creatives) {
    const key = item.parent_request_id ?? item.id;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }

  return [...groups.entries()]
    .filter(([, variants]) => variants.length > 1)
    .map(([key, variants]) => {
      const scored = variants.filter((item) => item.performance_score !== null);
      const winner = scored.length
        ? scored.reduce((best, item) =>
            (item.performance_score ?? 0) > (best.performance_score ?? 0) ? item : best,
          )
        : null;
      return { key, title: variants[0]?.title ?? "", variants, winner };
    });
}

export function formatRatio(value: number | null, digits = 2) {
  return value === null ? "—" : value.toFixed(digits);
}

export function formatPercent(value: number | null, digits = 1) {
  return value === null ? "—" : `${(value * 100).toFixed(digits)}%`;
}
