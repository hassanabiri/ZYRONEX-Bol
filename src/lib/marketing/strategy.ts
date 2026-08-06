import type { CreativeKind, MarketingChannel } from "@/lib/marketing/catalog";

/**
 * Deterministic marketing strategy planner used by the marketing worker.
 * It turns the company objective, budget and audience into a channel mix,
 * a phased plan and KPI targets. No model call, no invented performance data —
 * the output is a plan the operator reviews before anything is executed by the
 * platform's central execution engine.
 */

export type StrategyObjective = "awareness" | "leads" | "sales" | "retention" | "launch";

export const STRATEGY_OBJECTIVES: { value: StrategyObjective; label: string; description: string }[] = [
  { value: "awareness", label: "Brand awareness", description: "Reach and recall in new markets." },
  { value: "leads", label: "Lead generation", description: "Qualified pipeline for the sales team." },
  { value: "sales", label: "Direct sales", description: "Revenue and return on ad spend." },
  { value: "retention", label: "Retention & loyalty", description: "Repeat purchase and lower churn." },
  { value: "launch", label: "Product launch", description: "Concentrated launch moment across channels." },
];

export type ChannelPlan = {
  channel: MarketingChannel;
  share: number;
  budget: number;
  role: string;
};

export type StrategyPhase = {
  name: string;
  weeks: number;
  focus: string;
  deliverables: CreativeKind[];
};

export type StrategyKpi = { label: string; target: string };

export type Strategy = {
  summary: string;
  channels: ChannelPlan[];
  phases: StrategyPhase[];
  kpis: StrategyKpi[];
  segments: string[];
  delegation: { discipline: string; purpose: string }[];
};

const MIX: Record<StrategyObjective, { channel: MarketingChannel; share: number; role: string }[]> = {
  awareness: [
    { channel: "social", share: 0.35, role: "Reach and frequency" },
    { channel: "video", share: 0.25, role: "Story-driven creative" },
    { channel: "display", share: 0.2, role: "Broad retargeting" },
    { channel: "content", share: 0.2, role: "Owned authority content" },
  ],
  leads: [
    { channel: "search", share: 0.35, role: "High-intent capture" },
    { channel: "social", share: 0.25, role: "Lookalike prospecting" },
    { channel: "email", share: 0.2, role: "Nurture sequences" },
    { channel: "content", share: 0.2, role: "Gated assets" },
  ],
  sales: [
    { channel: "search", share: 0.3, role: "Bottom-funnel conversion" },
    { channel: "social", share: 0.25, role: "Catalogue and retargeting" },
    { channel: "email", share: 0.2, role: "Offer and cart recovery" },
    { channel: "whatsapp", share: 0.15, role: "Direct conversational selling" },
    { channel: "affiliate", share: 0.1, role: "Performance partners" },
  ],
  retention: [
    { channel: "email", share: 0.35, role: "Lifecycle programmes" },
    { channel: "whatsapp", share: 0.25, role: "Service and reorder prompts" },
    { channel: "sms", share: 0.15, role: "Time-critical offers" },
    { channel: "content", share: 0.15, role: "Education and enablement" },
    { channel: "social", share: 0.1, role: "Community" },
  ],
  launch: [
    { channel: "social", share: 0.3, role: "Teaser and launch day" },
    { channel: "video", share: 0.2, role: "Hero film and cutdowns" },
    { channel: "events", share: 0.2, role: "Launch moment" },
    { channel: "search", share: 0.15, role: "Brand demand capture" },
    { channel: "email", share: 0.15, role: "Existing base activation" },
  ],
};

const PHASES: Record<StrategyObjective, StrategyPhase[]> = {
  awareness: [
    { name: "Foundation", weeks: 2, focus: "Brand memory, messaging pillars and creative territories.", deliverables: ["image", "copywriting"] },
    { name: "Reach", weeks: 6, focus: "Always-on reach across social and video.", deliverables: ["reel", "short_video", "social_post"] },
    { name: "Consolidate", weeks: 4, focus: "Double down on the territories with the strongest recall.", deliverables: ["multi_platform"] },
  ],
  leads: [
    { name: "Offer design", weeks: 2, focus: "Lead magnet, landing page and qualification criteria.", deliverables: ["landing_page", "copywriting"] },
    { name: "Acquisition", weeks: 6, focus: "Search and paid social driving to the offer.", deliverables: ["ad_copy", "banner"] },
    { name: "Nurture", weeks: 4, focus: "Email sequences handing qualified leads to sales.", deliverables: ["email_campaign"] },
  ],
  sales: [
    { name: "Conversion audit", weeks: 1, focus: "Fix the path to purchase before adding spend.", deliverables: ["landing_page"] },
    { name: "Scale", weeks: 8, focus: "Scale winning ad sets and creative variants.", deliverables: ["ad_copy", "image", "short_video"] },
    { name: "Recover", weeks: 3, focus: "Cart recovery and direct conversational selling.", deliverables: ["email_campaign", "whatsapp_message"] },
  ],
  retention: [
    { name: "Segment", weeks: 2, focus: "Define lifecycle segments from real customer behaviour.", deliverables: ["copywriting"] },
    { name: "Lifecycle", weeks: 6, focus: "Automated lifecycle programmes per segment.", deliverables: ["email_campaign", "whatsapp_message"] },
    { name: "Advocacy", weeks: 4, focus: "Referral and community activation.", deliverables: ["social_post"] },
  ],
  launch: [
    { name: "Tease", weeks: 2, focus: "Build anticipation with limited reveals.", deliverables: ["reel", "social_post"] },
    { name: "Launch", weeks: 2, focus: "Concentrated multi-channel launch moment.", deliverables: ["video", "multi_platform", "landing_page"] },
    { name: "Sustain", weeks: 6, focus: "Convert launch attention into repeatable demand.", deliverables: ["ad_copy", "email_campaign"] },
  ],
};

const KPIS: Record<StrategyObjective, StrategyKpi[]> = {
  awareness: [
    { label: "Reach", target: "Grow unique reach month over month" },
    { label: "CPM", target: "Keep cost per 1,000 impressions flat or lower" },
    { label: "Engagement rate", target: "Above the account's trailing average" },
  ],
  leads: [
    { label: "CPL", target: "Cost per lead below the agreed ceiling" },
    { label: "MQL rate", target: "Share of leads accepted by sales" },
    { label: "CAC", target: "Acquisition cost under contribution margin" },
  ],
  sales: [
    { label: "ROAS", target: "Return on ad spend above 3x" },
    { label: "Conversion rate", target: "Improve versus the previous period" },
    { label: "CAC", target: "Below customer lifetime value / 3" },
  ],
  retention: [
    { label: "Repeat rate", target: "Increase repeat purchases per customer" },
    { label: "Churn", target: "Reduce monthly churn" },
    { label: "LTV", target: "Grow lifetime value per segment" },
  ],
  launch: [
    { label: "Launch reach", target: "Hit the planned audience in week one" },
    { label: "Conversion rate", target: "Convert launch traffic at or above benchmark" },
    { label: "ROI", target: "Recover launch investment inside the quarter" },
  ],
};

const SEGMENTS: Record<StrategyObjective, string[]> = {
  awareness: ["Cold audience", "Interest lookalikes", "Category researchers"],
  leads: ["High-intent searchers", "Content subscribers", "Free-trial visitors"],
  sales: ["Cart abandoners", "Repeat buyers", "High-value prospects"],
  retention: ["Active customers", "At-risk customers", "Lapsed customers", "Advocates"],
  launch: ["Existing customers", "Waitlist", "Press and partners", "Cold audience"],
};

/** Disciplines the marketing worker delegates to — never executes itself. */
const DELEGATION = [
  { discipline: "Visual design & video", purpose: "design" },
  { discipline: "Content & long-form copy", purpose: "content" },
  { discipline: "Conversational follow-up", purpose: "support" },
  { discipline: "Analysis & reporting", purpose: "analyze-documents" },
];

export function buildStrategy(input: {
  objective: StrategyObjective;
  budget: number;
  horizonMonths: number;
  audience: string;
  market: string;
}): Strategy {
  const budget = Number.isFinite(input.budget) && input.budget > 0 ? input.budget : 0;
  const mix = MIX[input.objective];
  const scale = Math.max(1, Math.round(input.horizonMonths || 3));

  return {
    summary: `${STRATEGY_OBJECTIVES.find((item) => item.value === input.objective)?.label ?? "Plan"} over ${scale} month(s)${
      input.market ? ` in ${input.market}` : ""
    }${input.audience ? `, targeting ${input.audience}` : ""}.`,
    channels: mix.map((entry) => ({
      channel: entry.channel,
      share: entry.share,
      budget: Math.round(budget * entry.share),
      role: entry.role,
    })),
    phases: PHASES[input.objective],
    kpis: KPIS[input.objective],
    segments: SEGMENTS[input.objective],
    delegation: DELEGATION,
  };
}
