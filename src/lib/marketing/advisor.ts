import type { CreditType } from "@/lib/billing/catalog";
import type { TablesInsert } from "@/integrations/supabase/types";
import type {
  BudgetAllocation,
  Campaign,
  CreativeRequest,
  WalletMetrics,
} from "@/services/marketing-service";

export type CmoRecommendation = {
  key: string;
  kind: TablesInsert<"marketing_alerts">["kind"];
  severity: TablesInsert<"marketing_alerts">["severity"];
  title: string;
  message: string;
  action: string | null;
};

const LOW_CREDIT_RATIO = 0.2;
const CRITICAL_DAYS = 7;
const WARNING_DAYS = 21;

/**
 * Deterministic advisor for the Marketing Command Center. It reads the real
 * ledgers, budgets and campaign metrics already stored in the workspace and
 * derives recommendations — no model call and no invented data.
 */
export function buildRecommendations(input: {
  wallet: WalletMetrics[];
  campaigns: Campaign[];
  allocations: BudgetAllocation[];
  creatives: CreativeRequest[];
}): CmoRecommendation[] {
  const out: CmoRecommendation[] = [];

  for (const ledger of input.wallet) {
    const ratio = ledger.granted > 0 ? ledger.remaining / ledger.granted : 0;
    if (ledger.granted > 0 && ratio <= LOW_CREDIT_RATIO) {
      out.push({
        key: `low-${ledger.creditType}`,
        kind: "low_credit",
        severity: ratio <= 0.08 ? "critical" : "warning",
        title: `Low balance on ${ledger.creditType}`,
        message: `Only ${format(ledger.remaining)} of ${format(ledger.granted)} remaining (${Math.round(ratio * 100)}%).`,
        action: "Buy a top-up pack or transfer credits from an under-used ledger.",
      });
    }
    if (ledger.daysLeft !== null && ledger.daysLeft <= WARNING_DAYS && ledger.dailyBurn > 0) {
      out.push({
        key: `burn-${ledger.creditType}`,
        kind: ledger.daysLeft <= CRITICAL_DAYS ? "credit_exhaustion" : "high_burn",
        severity: ledger.daysLeft <= CRITICAL_DAYS ? "critical" : "warning",
        title: `${ledger.creditType} runs out in ${ledger.daysLeft} days`,
        message: `Current burn is ${format(ledger.dailyBurn)} per day (${format(ledger.monthlyBurn)} per month).`,
        action: "Increase the ledger before the forecast date to avoid stopped campaigns.",
      });
    }
  }

  const spare = input.wallet
    .filter((row) => row.granted > 0 && row.dailyBurn === 0 && row.remaining > 0)
    .map((row) => row.creditType as CreditType);
  const starved = input.wallet.filter((row) => row.daysLeft !== null && row.daysLeft <= WARNING_DAYS);
  if (spare.length && starved.length) {
    out.push({
      key: "transfer-suggestion",
      kind: "optimization",
      severity: "info",
      title: "Rebalance your credits",
      message: `${spare.join(", ")} shows no consumption while ${starved
        .map((row) => row.creditType)
        .join(", ")} is close to exhaustion.`,
      action: "Use Transfer credits to move the idle balance where it is needed.",
    });
  }

  for (const campaign of input.campaigns) {
    const spend = Number(campaign.spend);
    const revenue = Number(campaign.revenue);
    const budget = Number(campaign.budget);
    if (campaign.status === "active" && budget > 0 && spend / budget >= 0.9) {
      out.push({
        key: `budget-${campaign.id}`,
        kind: "campaign_stopped",
        severity: "warning",
        title: `${campaign.name} has used ${Math.round((spend / budget) * 100)}% of its budget`,
        message: `Spend ${format(spend)} of ${format(budget)}.`,
        action: "Raise the budget or the campaign will stop mid-flight.",
      });
    }
    if (campaign.status === "active" && spend >= 100 && revenue < spend) {
      out.push({
        key: `roi-${campaign.id}`,
        kind: "weak_performance",
        severity: "warning",
        title: `${campaign.name} is running below break-even`,
        message: `ROI ${(spend ? (revenue - spend) / spend : 0).toFixed(2)}x with ${format(spend)} spent.`,
        action: "Pause the weakest creatives and shift budget to the best performing channel.",
      });
    }
    if (campaign.status === "active" && spend > 0 && revenue >= spend * 2.5) {
      out.push({
        key: `scale-${campaign.id}`,
        kind: "opportunity",
        severity: "info",
        title: `${campaign.name} is outperforming`,
        message: `Return of ${(revenue / spend).toFixed(2)}x on ${format(spend)} spent.`,
        action: "Scale the budget on this campaign while the return holds.",
      });
    }
  }

  const stuck = input.creatives.filter((row) => row.status === "queued").length;
  if (stuck >= 5) {
    out.push({
      key: "creative-backlog",
      kind: "optimization",
      severity: "info",
      title: `${stuck} creative tasks are still queued`,
      message: "Delegated work is piling up in the creative studio.",
      action: "Assign more workers or raise their concurrency limit.",
    });
  }

  const unassigned = input.allocations.filter((row) => Number(row.allocated) === 0).length;
  if (unassigned) {
    out.push({
      key: "budget-gap",
      kind: "optimization",
      severity: "info",
      title: `${unassigned} channels have no budget`,
      message: "Some channels are enabled but receive nothing from the plan.",
      action: "Run the smart distribution to spread the budget by measured ROI.",
    });
  }

  return out;
}

function format(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}
