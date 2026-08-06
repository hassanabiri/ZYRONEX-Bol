import { useMemo, useState } from "react";
import { PieChart, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBudgetAllocations, useCampaigns, useMarketingMutations } from "@/hooks/use-marketing";
import { useI18n } from "@/lib/i18n";
import {
  CAMPAIGN_STATUSES,
  MARKETING_CHANNELS,
  type CampaignStatus,
  type MarketingChannel,
} from "@/lib/marketing/catalog";
import { marketingService } from "@/services/marketing-service";

/** Campaign + budget command board: allocation, spend, ROI and smart distribution. */
export function BudgetBoard({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { data: campaigns = [], isLoading } = useCampaigns(workspaceId);
  const { data: allocations = [] } = useBudgetAllocations(workspaceId);
  const mutations = useMarketingMutations(workspaceId);

  const [name, setName] = useState("");
  const [channel, setChannel] = useState<MarketingChannel>("social");
  const [budget, setBudget] = useState("1000");
  const [allocChannel, setAllocChannel] = useState<MarketingChannel>("social");
  const [allocAmount, setAllocAmount] = useState("500");
  const [allocCampaign, setAllocCampaign] = useState("");

  const totals = useMemo(() => {
    const budgetTotal = campaigns.reduce((sum, row) => sum + Number(row.budget_total), 0);
    const spent = campaigns.reduce((sum, row) => sum + Number(row.budget_spent), 0);
    const revenue = campaigns.reduce((sum, row) => sum + Number(row.revenue), 0);
    return { budgetTotal, spent, revenue, roi: spent > 0 ? revenue / spent : 0 };
  }, [campaigns]);

  const revenueByChannel = useMemo(() => {
    const map = new Map<string, number>();
    for (const campaign of campaigns) {
      map.set(campaign.channel, (map.get(campaign.channel) ?? 0) + Number(campaign.revenue));
    }
    return map;
  }, [campaigns]);

  const suggestions = useMemo(
    () => marketingService.smartDistribution(totals.budgetTotal, allocations, revenueByChannel),
    [totals.budgetTotal, allocations, revenueByChannel],
  );

  async function createCampaign() {
    if (!name.trim()) {
      toast.error(t("Give the campaign a name"));
      return;
    }
    await mutations.createCampaign.mutateAsync({
      name: name.trim(),
      channel,
      budget_total: Number(budget) || 0,
    });
    setName("");
    toast.success(t("Campaign created"));
  }

  async function applySuggestions() {
    for (const item of suggestions) {
      await mutations.updateAllocation.mutateAsync({
        id: item.id,
        patch: { allocated: item.suggested },
      });
    }
    toast.success(t("Budget redistributed by measured ROI"));
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Total budget", value: totals.budgetTotal },
          { label: "Spent", value: totals.spent },
          { label: "Revenue", value: totals.revenue },
        ].map((card) => (
          <Card key={card.label}>
            <CardHeader className="pb-2">
              <CardDescription>{t(card.label)}</CardDescription>
              <CardTitle className="text-2xl">${card.value.toLocaleString()}</CardTitle>
            </CardHeader>
          </Card>
        ))}
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{t("Return on investment")}</CardDescription>
            <CardTitle className="text-2xl">{totals.roi.toFixed(2)}x</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Campaigns")}</CardTitle>
          <CardDescription>{t("Budget, spend and return for every marketing campaign.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {canManage && (
            <div className="grid gap-2 sm:grid-cols-4">
              <Input
                placeholder={t("Campaign name")}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <Select value={channel} onValueChange={(value) => setChannel(value as MarketingChannel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETING_CHANNELS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {t(item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={budget} onChange={(event) => setBudget(event.target.value)} />
              <Button onClick={createCampaign} disabled={mutations.createCampaign.isPending}>
                <Plus className="size-4" />
                {t("Create campaign")}
              </Button>
            </div>
          )}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
          ) : campaigns.length === 0 ? (
            <EmptyState
              icon={PieChart}
              title="No campaigns yet"
              description="Create your first campaign to start tracking budget and return."
              compact
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Campaign")}</TableHead>
                    <TableHead>{t("Channel")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                    <TableHead>{t("Budget")}</TableHead>
                    <TableHead>{t("Spent")}</TableHead>
                    <TableHead>{t("ROI")}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {campaigns.map((campaign) => {
                    const spent = Number(campaign.budget_spent);
                    const budgetTotal = Number(campaign.budget_total);
                    const roi = spent > 0 ? Number(campaign.revenue) / spent : 0;
                    return (
                      <TableRow key={campaign.id}>
                        <TableCell className="font-medium">{campaign.name}</TableCell>
                        <TableCell className="text-muted-foreground">{t(campaign.channel)}</TableCell>
                        <TableCell>
                          <Select
                            value={campaign.status}
                            onValueChange={(value) =>
                              mutations.updateCampaign.mutate({
                                campaign,
                                patch: { status: value as CampaignStatus },
                              })
                            }
                            disabled={!canManage}
                          >
                            <SelectTrigger className="h-8 w-40">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CAMPAIGN_STATUSES.map((item) => (
                                <SelectItem key={item.value} value={item.value}>
                                  {t(item.label)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>${budgetTotal.toLocaleString()}</TableCell>
                        <TableCell className="min-w-32">
                          <Progress
                            value={budgetTotal ? Math.min(100, (spent / budgetTotal) * 100) : 0}
                          />
                          <span className="text-xs text-muted-foreground">
                            ${spent.toLocaleString()}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={roi >= 1 ? "default" : "outline"}>{roi.toFixed(2)}x</Badge>
                        </TableCell>
                        <TableCell className="text-end">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={!canManage}
                            onClick={() => mutations.deleteCampaign.mutate(campaign)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base">{t("Channel allocation")}</CardTitle>
            <CardDescription>{t("Split the plan budget across channels, or let the advisor do it.")}</CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={!canManage || !suggestions.length}
            onClick={applySuggestions}
          >
            {t("Smart distribution")}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {canManage && (
            <div className="grid gap-2 sm:grid-cols-4">
              <Select value={allocCampaign} onValueChange={setAllocCampaign}>
                <SelectTrigger>
                  <SelectValue placeholder={t("Select a campaign")} />
                </SelectTrigger>
                <SelectContent>
                  {campaigns.map((campaign) => (
                    <SelectItem key={campaign.id} value={campaign.id}>
                      {campaign.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={allocChannel}
                onValueChange={(value) => setAllocChannel(value as MarketingChannel)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MARKETING_CHANNELS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {t(item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input value={allocAmount} onChange={(event) => setAllocAmount(event.target.value)} />
              <Button
                variant="outline"
                disabled={!allocCampaign}
                onClick={() =>
                  mutations.saveAllocation.mutate({
                    campaign_id: allocCampaign,
                    channel: allocChannel,
                    allocated: Number(allocAmount) || 0,
                  })
                }
              >
                <Plus className="size-4" />
                {t("Allocate")}
              </Button>
            </div>
          )}

          {allocations.length === 0 ? (
            <EmptyState
              icon={PieChart}
              title="No allocations yet"
              description="Allocate budget per channel to unlock the smart distribution advisor."
              compact
            />
          ) : (
            <div className="space-y-2">
              {allocations.map((row) => {
                const suggestion = suggestions.find((item) => item.id === row.id);
                return (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div>
                      <p className="text-sm font-medium">{t(row.channel)}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("Allocated")} ${Number(row.allocated).toLocaleString()} · {t("Spent")} $
                        {Number(row.spent).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {suggestion && (
                        <Badge variant="secondary">
                          {t("Suggested")} ${suggestion.suggested.toLocaleString()}
                        </Badge>
                      )}
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={!canManage}
                        onClick={() => mutations.deleteAllocation.mutate(row.id)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
