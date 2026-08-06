import { useState } from "react";
import { Compass, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMarketingMutations } from "@/hooks/use-marketing";
import { useI18n } from "@/lib/i18n";
import { CREATIVE_KIND_MAP, MARKETING_CHANNELS } from "@/lib/marketing/catalog";
import {
  buildStrategy,
  STRATEGY_OBJECTIVES,
  type Strategy,
  type StrategyObjective,
} from "@/lib/marketing/strategy";
import { humanize } from "@/lib/worker-options";

/**
 * Strategy planner for the marketing worker. The plan is derived from the
 * company objective and budget, then materialised as campaigns through the
 * existing central campaign store — no separate planning system.
 */
export function StrategyPanel({
  workspaceId,
  workerId,
  canManage,
}: {
  workspaceId: string | undefined;
  workerId: string;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const mutations = useMarketingMutations(workspaceId);

  const [objective, setObjective] = useState<StrategyObjective>("leads");
  const [budget, setBudget] = useState("50000");
  const [horizon, setHorizon] = useState("3");
  const [audience, setAudience] = useState("");
  const [market, setMarket] = useState("");
  const [strategy, setStrategy] = useState<Strategy | null>(null);

  const channelLabel = (value: string) =>
    MARKETING_CHANNELS.find((item) => item.value === value)?.label ?? humanize(value);

  async function materialise(plan: Strategy) {
    for (const entry of plan.channels) {
      await mutations.createCampaign.mutateAsync({
        name: `${STRATEGY_OBJECTIVES.find((item) => item.value === objective)?.label} — ${channelLabel(entry.channel)}`,
        channel: entry.channel,
        objective: plan.summary,
        budget_total: entry.budget,
        status: "draft",
        coordinator_worker_id: workerId,
      });
    }
    toast.success(t("Campaigns created from the plan"));
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Compass className="size-4" />
            {t("Marketing strategy")}
          </CardTitle>
          <CardDescription>
            {t("Set the company objective and this worker builds the channel mix, phases and KPI targets.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              setStrategy(
                buildStrategy({
                  objective,
                  budget: Number(budget),
                  horizonMonths: Number(horizon),
                  audience: audience.trim(),
                  market: market.trim(),
                }),
              );
            }}
          >
            <div className="space-y-2">
              <Label>{t("Objective")}</Label>
              <Select value={objective} onValueChange={(value) => setObjective(value as StrategyObjective)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_OBJECTIVES.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {t(item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy-budget">{t("Budget")}</Label>
              <Input
                id="strategy-budget"
                type="number"
                min={0}
                value={budget}
                onChange={(event) => setBudget(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy-horizon">{t("Horizon (months)")}</Label>
              <Input
                id="strategy-horizon"
                type="number"
                min={1}
                value={horizon}
                onChange={(event) => setHorizon(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy-market">{t("Market")}</Label>
              <Input
                id="strategy-market"
                value={market}
                onChange={(event) => setMarket(event.target.value)}
                placeholder={t("e.g. Saudi Arabia, GCC")}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="strategy-audience">{t("Target audience")}</Label>
              <Input
                id="strategy-audience"
                value={audience}
                onChange={(event) => setAudience(event.target.value)}
                placeholder={t("Who are we trying to reach?")}
              />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" className="gap-2">
                <Sparkles className="size-4" />
                {t("Build strategy")}
              </Button>
              {strategy && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!canManage || mutations.createCampaign.isPending}
                  onClick={() => materialise(strategy)}
                >
                  {t("Create campaigns from plan")}
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {strategy && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Channel mix")}</CardTitle>
              <CardDescription>{strategy.summary}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {strategy.channels.map((entry) => (
                <div key={entry.channel} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t(channelLabel(entry.channel))}</p>
                    <Badge variant="secondary">{Math.round(entry.share * 100)}%</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{t(entry.role)}</p>
                  <p className="mt-1 text-xs font-medium">{entry.budget.toLocaleString()}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("Execution phases")}</CardTitle>
              <CardDescription>{t("Each phase lists the assets the specialised workers will produce.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {strategy.phases.map((phase) => (
                <div key={phase.name} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">{t(phase.name)}</p>
                    <Badge variant="outline">
                      {phase.weeks} {t("weeks")}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{t(phase.focus)}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {phase.deliverables.map((kind) => (
                      <Badge key={kind} variant="secondary" className="text-[11px]">
                        {t(CREATIVE_KIND_MAP.get(kind)?.label ?? kind)}
                      </Badge>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("KPI targets")}</CardTitle>
              <CardDescription>{t("Measured against the campaign data in this workspace.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {strategy.kpis.map((kpi) => (
                <div key={kpi.label} className="rounded-lg border p-3">
                  <p className="text-sm font-medium">{t(kpi.label)}</p>
                  <p className="text-xs text-muted-foreground">{t(kpi.target)}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="size-4" />
                {t("Audience segments & delegation")}
              </CardTitle>
              <CardDescription>{t("This worker coordinates; specialised workers execute.")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {strategy.segments.map((segment) => (
                  <Badge key={segment} variant="secondary">
                    {t(segment)}
                  </Badge>
                ))}
              </div>
              <ul className="space-y-1">
                {strategy.delegation.map((entry) => (
                  <li key={entry.purpose} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                    <span>{t(entry.discipline)}</span>
                    <Badge variant="outline">{t(humanize(entry.purpose))}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
