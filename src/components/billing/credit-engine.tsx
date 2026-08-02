import { useState } from "react";
import { Coins } from "lucide-react";
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
import { useBillingMutations } from "@/hooks/use-billing";
import { useI18n } from "@/lib/i18n";
import { CREDIT_TYPES, creditLabel, type CreditType } from "@/lib/billing/catalog";
import type { CreditBalance, CreditTransaction, Subscription } from "@/services/billing-service";

const KINDS = ["grant", "purchase", "consumption", "refund", "expiry", "adjustment"] as const;

/** Credit Engine: one ledger per credit type plus the full transaction history. */
export function CreditEngine({
  workspaceId,
  subscription,
  balances,
  transactions,
  canManage,
}: {
  workspaceId: string | undefined;
  subscription: Subscription | null;
  balances: CreditBalance[];
  transactions: CreditTransaction[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const mutations = useBillingMutations(workspaceId);
  const [creditType, setCreditType] = useState<CreditType>("ai_credits");
  const [kind, setKind] = useState<(typeof KINDS)[number]>("grant");
  const [amount, setAmount] = useState("100");
  const [reason, setReason] = useState("");

  async function apply() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      toast.error(t("Enter a positive amount"));
      return;
    }
    try {
      await mutations.adjustCredits.mutateAsync({
        creditType,
        amount: value,
        kind,
        reason: reason.trim() || `${kind} ${creditLabel(creditType)}`,
      });
      setReason("");
      toast.success(t("Credit ledger updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  return (
    <div className="space-y-4">
      {balances.length === 0 ? (
        <EmptyState
          icon={Coins}
          title="No credit ledgers yet"
          description="Credit ledgers are created from the plan allowance once a subscription exists."
          action={
            canManage ? (
              <Button onClick={() => mutations.ensureBalances.mutate(subscription?.plan ?? "free")}>
                {t("Initialise ledgers")}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {CREDIT_TYPES.map((type) => {
            const balance = balances.find((row) => row.credit_type === type.value);
            const granted = Number(balance?.granted ?? 0);
            const used = Number(balance?.used ?? 0);
            const remaining = Math.max(0, granted - used);
            return (
              <Card key={type.value}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{t(type.label)}</CardTitle>
                  <CardDescription className="text-xs">{t(type.description)}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-2xl font-semibold">
                    {remaining.toLocaleString()}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      {t(type.unit)}
                    </span>
                  </p>
                  <Progress value={granted ? (used / granted) * 100 : 0} />
                  <p className="text-xs text-muted-foreground">
                    {used.toLocaleString()} / {granted.toLocaleString()} {t("consumed")}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Ledger operation")}</CardTitle>
            <CardDescription>
              {t("Grant, purchase, consume, refund or adjust a credit ledger. Every change is recorded.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="space-y-2">
              <Label>{t("Credit type")}</Label>
              <Select value={creditType} onValueChange={(value) => setCreditType(value as CreditType)}>
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
            <div className="space-y-2">
              <Label>{t("Operation")}</Label>
              <Select value={kind} onValueChange={(value) => setKind(value as typeof kind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {KINDS.map((item) => (
                    <SelectItem key={item} value={item}>
                      {t(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="credit-amount">{t("Amount")}</Label>
              <Input
                id="credit-amount"
                type="number"
                min={1}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="credit-reason">{t("Reason")}</Label>
              <Input
                id="credit-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={apply}>
                {t("Apply")}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Credit transactions")}</CardTitle>
          <CardDescription>{t("Immutable ledger history for this workspace.")}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {transactions.length === 0 ? (
            <div className="p-6">
              <EmptyState
                compact
                icon={Coins}
                title="No transactions yet"
                description="Grants, purchases and consumption appear here as they happen."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Date")}</TableHead>
                    <TableHead>{t("Credit type")}</TableHead>
                    <TableHead>{t("Operation")}</TableHead>
                    <TableHead className="text-right">{t("Amount")}</TableHead>
                    <TableHead className="hidden text-right md:table-cell">{t("Balance after")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Reason")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {transactions.map((txn) => (
                    <TableRow key={txn.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {new Date(txn.created_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm">{t(creditLabel(txn.credit_type))}</TableCell>
                      <TableCell>
                        <Badge variant={txn.kind === "consumption" ? "secondary" : "outline"}>
                          {t(txn.kind)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {txn.kind === "consumption" ? "−" : "+"}
                        {Number(txn.amount).toLocaleString()}
                      </TableCell>
                      <TableCell className="hidden text-right text-sm md:table-cell">
                        {Number(txn.balance_after).toLocaleString()}
                      </TableCell>
                      <TableCell className="hidden max-w-64 truncate text-xs text-muted-foreground lg:table-cell">
                        {txn.reason ?? "—"}
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
  );
}
