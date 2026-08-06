import { useMemo, useState } from "react";
import { ArrowLeftRight, ShoppingCart, Wallet } from "lucide-react";
import { toast } from "sonner";

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
import { useCreditBalances, useUsageRecords } from "@/hooks/use-billing";
import { useCreditTransfers, useMarketingMutations } from "@/hooks/use-marketing";
import { CREDIT_TYPES, creditLabel, type CreditType } from "@/lib/billing/catalog";
import { CREDIT_PACKS, previewTransfer } from "@/lib/marketing/catalog";
import { useI18n } from "@/lib/i18n";
import { marketingService } from "@/services/marketing-service";

/** Smart credit wallet: live balances, burn forecast, in-app store and transfers. */
export function CreditWallet({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { data: balances = [] } = useCreditBalances(workspaceId);
  const { data: usage = [] } = useUsageRecords(workspaceId);
  const { data: transfers = [] } = useCreditTransfers(workspaceId);
  const mutations = useMarketingMutations(workspaceId);

  const wallet = useMemo(() => marketingService.wallet(balances, usage), [balances, usage]);

  const [from, setFrom] = useState<CreditType>("ai_credits");
  const [to, setTo] = useState<CreditType>("voice_minutes");
  const [amount, setAmount] = useState("100");

  const preview = previewTransfer(from, to, Number(amount) || 0);

  async function transfer() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error(t("Enter a positive amount"));
      return;
    }
    if (!preview) {
      toast.error(t("This transfer is not allowed by your plan policy."));
      return;
    }
    try {
      await mutations.transferCredits.mutateAsync({ from, to, amount: value });
      toast.success(t("Credits transferred"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Something went wrong"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {wallet.map((ledger) => {
          const pct = ledger.granted > 0 ? Math.min(100, (ledger.used / ledger.granted) * 100) : 0;
          return (
            <Card key={ledger.creditType}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between gap-2 text-sm">
                  <span>{t(creditLabel(ledger.creditType))}</span>
                  {ledger.daysLeft !== null && ledger.daysLeft <= 7 && (
                    <Badge variant="destructive">{t("Critical")}</Badge>
                  )}
                </CardTitle>
                <CardDescription>
                  {ledger.remaining.toLocaleString()} {t("remaining of")} {ledger.granted.toLocaleString()}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <Progress value={pct} />
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <span>
                    {t("Daily burn")}: {ledger.dailyBurn.toLocaleString()}
                  </span>
                  <span>
                    {t("Monthly")}: {ledger.monthlyBurn.toLocaleString()}
                  </span>
                  <span className="col-span-2">
                    {ledger.exhaustionDate
                      ? `${t("Runs out on")} ${new Date(ledger.exhaustionDate).toLocaleDateString()} (${ledger.daysLeft} ${t("days")})`
                      : t("No consumption recorded yet")}
                  </span>
                </div>
              </CardContent>
            </Card>
          );
        })}
        {wallet.length === 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Wallet className="size-4" />
                {t("No ledgers yet")}
              </CardTitle>
              <CardDescription>
                {t("Initialise the credit ledgers from the Billing center first.")}
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="size-4" />
              {t("Credit store")}
            </CardTitle>
            <CardDescription>{t("Top up any ledger instantly — an invoice is issued automatically.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {CREDIT_PACKS.map((pack) => (
              <div
                key={pack.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{t(pack.label)}</p>
                  <p className="text-xs text-muted-foreground">{t(pack.description)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">${pack.price}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canManage || mutations.purchaseCredits.isPending}
                    onClick={async () => {
                      try {
                        await mutations.purchaseCredits.mutateAsync(pack);
                        toast.success(t("Credits added and invoice issued"));
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : t("Something went wrong"));
                      }
                    }}
                  >
                    {t("Buy")}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ArrowLeftRight className="size-4" />
              {t("Transfer credits")}
            </CardTitle>
            <CardDescription>{t("Move balance between services using the plan conversion policy.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t("From")}</Label>
                <Select value={from} onValueChange={(value) => setFrom(value as CreditType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CREDIT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {t(type.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("To")}</Label>
                <Select value={to} onValueChange={(value) => setTo(value as CreditType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CREDIT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {t(type.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{t("Amount")}</Label>
                <Input value={amount} onChange={(event) => setAmount(event.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {preview
                ? `${t("You receive")} ${preview.converted.toLocaleString()} — ${t("fee")} ${preview.fee.toLocaleString()} · ${t("rate")} ${preview.rate}`
                : t("This transfer is not allowed by your plan policy.")}
            </p>
            <Button
              className="w-full"
              disabled={!canManage || !preview || mutations.transferCredits.isPending}
              onClick={transfer}
            >
              {t("Transfer")}
            </Button>

            {transfers.length > 0 && (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("From")}</TableHead>
                      <TableHead>{t("To")}</TableHead>
                      <TableHead>{t("Amount")}</TableHead>
                      <TableHead>{t("Date")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {transfers.slice(0, 6).map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{t(creditLabel(row.from_type))}</TableCell>
                        <TableCell>{t(creditLabel(row.to_type))}</TableCell>
                        <TableCell>
                          {Number(row.from_amount).toLocaleString()} → {Number(row.to_amount).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(row.created_at).toLocaleDateString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
