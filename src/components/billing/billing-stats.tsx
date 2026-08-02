import { BadgeCheck, Coins, CreditCard, Gauge, ReceiptText, Timer } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n";
import { creditLabel, formatMoney, getPlan } from "@/lib/billing/catalog";
import type {
  CreditBalance,
  InvoiceWithItems,
  Subscription,
  UsageRecord,
} from "@/services/billing-service";

/** Billing Center dashboard cards. */
export function BillingStats({
  subscription,
  balances,
  invoices,
  usage,
}: {
  subscription: Subscription | null;
  balances: CreditBalance[];
  invoices: InvoiceWithItems[];
  usage: UsageRecord[];
}) {
  const { t } = useI18n();
  const plan = getPlan(subscription?.plan);
  const currency = subscription?.currency ?? "USD";
  const outstanding = invoices
    .filter((invoice) => invoice.status === "open" || invoice.status === "draft")
    .reduce((sum, invoice) => sum + Number(invoice.total), 0);
  const periodCost = usage.reduce((sum, record) => sum + Number(record.total_cost), 0);
  const aiCredits = balances.find((balance) => balance.credit_type === "ai_credits");
  const voiceMinutes = balances.find((balance) => balance.credit_type === "voice_minutes");

  const remaining = (balance?: CreditBalance) =>
    balance ? Math.max(0, Number(balance.granted) - Number(balance.used)) : 0;

  const cards = [
    {
      title: "Plan",
      value: plan?.name ?? t("Not set"),
      hint: subscription ? `${subscription.status} · ${subscription.billing_cycle}` : "No subscription yet",
      icon: BadgeCheck,
    },
    {
      title: "Recurring amount",
      value: formatMoney(Number(subscription?.amount ?? 0), currency),
      hint: "Per billing cycle",
      icon: CreditCard,
    },
    {
      title: "Usage this period",
      value: formatMoney(periodCost, currency),
      hint: "Metered consumption",
      icon: Gauge,
    },
    {
      title: "Outstanding",
      value: formatMoney(outstanding, currency),
      hint: "Draft and open invoices",
      icon: ReceiptText,
    },
    {
      title: creditLabel("ai_credits"),
      value: remaining(aiCredits),
      hint: "Remaining balance",
      icon: Coins,
      progress: aiCredits
        ? (remaining(aiCredits) / Math.max(1, Number(aiCredits.granted))) * 100
        : undefined,
    },
    {
      title: creditLabel("voice_minutes"),
      value: remaining(voiceMinutes),
      hint: "Remaining minutes",
      icon: Timer,
      progress: voiceMinutes
        ? (remaining(voiceMinutes) / Math.max(1, Number(voiceMinutes.granted))) * 100
        : undefined,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-medium text-muted-foreground">
              {t(card.title)}
            </CardTitle>
            <card.icon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-2xl font-semibold">{card.value}</p>
            <p className="text-xs text-muted-foreground">{t(card.hint)}</p>
            {card.progress !== undefined && <Progress value={card.progress} />}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
