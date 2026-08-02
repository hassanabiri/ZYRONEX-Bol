import { useState } from "react";
import { CreditCard, Store, Trash2 } from "lucide-react";
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
import { useBillingMutations } from "@/hooks/use-billing";
import { useI18n } from "@/lib/i18n";
import {
  BILLING_SCOPES,
  MARKETPLACE_BILLING_ITEMS,
  PAYMENT_PROVIDERS,
  type PaymentProvider,
} from "@/lib/billing/catalog";
import type { PaymentMethod } from "@/services/billing-service";

/**
 * Payment architecture. Providers are prepared and stored only — ZYRONEX never
 * executes a charge today; the payment rail lands in a later sprint.
 */
export function PaymentArchitecture({
  workspaceId,
  methods,
  canManage,
}: {
  workspaceId: string | undefined;
  methods: PaymentMethod[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const mutations = useBillingMutations(workspaceId);
  const [provider, setProvider] = useState<PaymentProvider>("manual");
  const [label, setLabel] = useState("");

  async function prepare() {
    if (!label.trim()) {
      toast.error(t("Enter a label for this payment method"));
      return;
    }
    try {
      await mutations.createPaymentMethod.mutateAsync({
        provider,
        label: label.trim(),
        status: "prepared",
      });
      setLabel("");
      toast.success(t("Payment method prepared"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Payment providers")}</CardTitle>
          <CardDescription>
            {t("Provider slots are prepared now; no charge is executed until the payment rail ships.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {PAYMENT_PROVIDERS.map((item) => (
            <div key={item.value} className="rounded-xl border p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium">{item.label}</p>
                <Badge variant={item.available ? "default" : "outline"} className="text-[10px]">
                  {t(item.available ? "Available" : "Prepared")}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t(item.description)}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Payment methods")}</CardTitle>
          <CardDescription>{t("Methods registered for this workspace.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {canManage && (
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{t("Provider")}</Label>
                <Select
                  value={provider}
                  onValueChange={(value) => setProvider(value as PaymentProvider)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_PROVIDERS.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="method-label">{t("Label")}</Label>
                <Input
                  id="method-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
              <div className="flex items-end">
                <Button className="w-full" onClick={prepare}>
                  <CreditCard className="size-4" />
                  {t("Prepare method")}
                </Button>
              </div>
            </div>
          )}

          {methods.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("No payment methods prepared yet.")}</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {methods.map((method) => (
                <li key={method.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{method.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {method.provider} · {method.status}
                      {method.is_default ? ` · ${t("Default")}` : ""}
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("Remove payment method")}
                      onClick={() => mutations.removePaymentMethod.mutate(method)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Billing scopes")}</CardTitle>
            <CardDescription>{t("How charges can be attributed across the platform.")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {BILLING_SCOPES.map((scope) => (
              <div key={scope.value} className="rounded-lg border p-3">
                <p className="text-sm font-medium">{t(scope.label)}</p>
                <p className="text-xs text-muted-foreground">{t(scope.description)}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("Marketplace billing")}</CardTitle>
            <CardDescription>
              {t("Revenue-share architecture for sellable assets — reserved for a future release.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {MARKETPLACE_BILLING_ITEMS.map((item) => (
              <div key={item.id} className="flex items-start gap-3 rounded-lg border p-3">
                <Store className="mt-0.5 size-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">{t(item.label)}</p>
                  <p className="text-xs text-muted-foreground">{t(item.description)}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
