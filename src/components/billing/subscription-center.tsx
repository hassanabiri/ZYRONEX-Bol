import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useBillingMutations } from "@/hooks/use-billing";
import { useI18n } from "@/lib/i18n";
import {
  BILLING_CYCLES,
  BILLING_PLANS,
  BILLING_SCOPES,
  SUBSCRIPTION_STATUS_LABELS,
  SUBSCRIPTION_STATUS_TONE,
  creditLabel,
  formatMoney,
} from "@/lib/billing/catalog";
import type { CreditType } from "@/lib/billing/catalog";
import type { Subscription } from "@/services/billing-service";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

/** Subscription Center: plans, trials, renewals and cancellation. */
export function SubscriptionCenter({
  workspaceId,
  subscription,
  canManage,
}: {
  workspaceId: string | undefined;
  subscription: Subscription | null;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const mutations = useBillingMutations(workspaceId);
  const [cycle, setCycle] = useState<string>(subscription?.billing_cycle ?? "monthly");

  async function selectPlan(plan: string) {
    try {
      if (!subscription) await mutations.ensureSubscription.mutateAsync(plan);
      else await mutations.changePlan.mutateAsync({ subscription, plan, cycle });
      toast.success(t("Subscription updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">{t("Current subscription")}</CardTitle>
              <CardDescription>
                {t("Plan, billing cycle, renewal window and scope for this workspace.")}
              </CardDescription>
            </div>
            {subscription && (
              <Badge variant={SUBSCRIPTION_STATUS_TONE[subscription.status]}>
                {t(SUBSCRIPTION_STATUS_LABELS[subscription.status])}
              </Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!subscription ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {t("No subscription exists yet for this workspace.")}
              </p>
              {canManage && (
                <Button onClick={() => selectPlan("free")}>{t("Start on Free")}</Button>
              )}
            </div>
          ) : (
            <>
              <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("Plan")}</dt>
                  <dd className="text-sm font-medium capitalize">{subscription.plan}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("Amount")}</dt>
                  <dd className="text-sm font-medium">
                    {formatMoney(Number(subscription.amount), subscription.currency)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("Period ends")}</dt>
                  <dd className="text-sm font-medium">{formatDate(subscription.current_period_end)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("Trial ends")}</dt>
                  <dd className="text-sm font-medium">{formatDate(subscription.trial_ends_at)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("Seats")}</dt>
                  <dd className="text-sm font-medium">{subscription.seats}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("Scope")}</dt>
                  <dd className="text-sm font-medium">
                    {t(
                      BILLING_SCOPES.find((scope) => scope.value === subscription.scope)?.label ??
                        subscription.scope,
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("Renewal")}</dt>
                  <dd className="text-sm font-medium">
                    {subscription.cancel_at_period_end ? t("Cancels at period end") : t("Auto-renews")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("Billing cycle")}</dt>
                  <dd className="text-sm font-medium capitalize">{subscription.billing_cycle}</dd>
                </div>
              </dl>

              {canManage && (
                <>
                  <Separator />
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={cycle} onValueChange={setCycle}>
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BILLING_CYCLES.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {t(item.label)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      onClick={() => mutations.renewSubscription.mutate(subscription)}
                    >
                      {t("Renew now")}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        mutations.cancelSubscription.mutate({ subscription, immediate: false })
                      }
                    >
                      {t("Cancel at period end")}
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() =>
                        mutations.cancelSubscription.mutate({ subscription, immediate: true })
                      }
                    >
                      {t("Cancel immediately")}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BILLING_PLANS.map((plan) => {
          const current = subscription?.plan === plan.id;
          return (
            <Card key={plan.id} className={current ? "border-primary" : undefined}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{plan.name}</CardTitle>
                  {current && <Badge>{t("Current")}</Badge>}
                </div>
                <CardDescription>{t(plan.description)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-2xl font-semibold">
                  {formatMoney(cycle === "yearly" ? plan.monthlyPrice * 10 : plan.monthlyPrice)}
                  <span className="text-xs font-normal text-muted-foreground">
                    /{cycle === "yearly" ? t("year") : t("month")}
                  </span>
                </p>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <Check className="size-3.5 text-primary" />
                    {plan.seats} {t("seats")}
                  </li>
                  {Object.entries(plan.allowances).map(([type, amount]) => (
                    <li key={type} className="flex items-center gap-2">
                      <Check className="size-3.5 text-primary" />
                      {amount.toLocaleString()} {t(creditLabel(type as CreditType))}
                    </li>
                  ))}
                </ul>
                {canManage && (
                  <Button
                    className="w-full"
                    variant={current ? "outline" : "default"}
                    disabled={current}
                    onClick={() => selectPlan(plan.id)}
                  >
                    {current ? t("Active plan") : t("Switch to this plan")}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
