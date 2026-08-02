import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import type { CreditType } from "@/lib/billing/catalog";
import {
  billingService,
  type Invoice,
  type PaymentMethod,
  type Subscription,
  type UsageRecord,
} from "@/services/billing-service";

export const billingKeys = {
  subscription: (workspaceId: string) => ["workspace", workspaceId, "subscription"] as const,
  balances: (workspaceId: string) => ["workspace", workspaceId, "credit-balances"] as const,
  transactions: (workspaceId: string) => ["workspace", workspaceId, "credit-transactions"] as const,
  usage: (workspaceId: string) => ["workspace", workspaceId, "usage-records"] as const,
  invoices: (workspaceId: string) => ["workspace", workspaceId, "invoices"] as const,
  paymentMethods: (workspaceId: string) => ["workspace", workspaceId, "payment-methods"] as const,
};

export function useSubscription(workspaceId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.subscription(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => billingService.getSubscription(workspaceId!),
  });
}

export function useCreditBalances(workspaceId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.balances(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => billingService.listBalances(workspaceId!),
  });
}

export function useCreditTransactions(workspaceId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.transactions(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => billingService.listTransactions(workspaceId!),
  });
}

export function useUsageRecords(workspaceId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.usage(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => billingService.listUsage(workspaceId!),
  });
}

export function useInvoices(workspaceId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.invoices(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => billingService.listInvoices(workspaceId!),
  });
}

export function usePaymentMethods(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: billingKeys.paymentMethods(workspaceId ?? "none"),
    enabled: Boolean(workspaceId) && enabled,
    queryFn: () => billingService.listPaymentMethods(workspaceId!),
  });
}

/** Every billing write path, with cache invalidation handled once. */
export function useBillingMutations(workspaceId: string | undefined) {
  const client = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "none";

  const invalidate = (keys: readonly (readonly unknown[])[]) => {
    for (const key of keys) client.invalidateQueries({ queryKey: key });
  };

  const ensureSubscription = useMutation({
    mutationFn: (plan: string) => billingService.ensureSubscription(workspaceId!, plan, user?.id),
    onSuccess: () => invalidate([billingKeys.subscription(id), billingKeys.balances(id)]),
  });

  const changePlan = useMutation({
    mutationFn: (vars: { subscription: Subscription; plan: string; cycle: string }) =>
      billingService.changePlan(vars.subscription, vars.plan, vars.cycle, user?.id),
    onSuccess: () => invalidate([billingKeys.subscription(id), billingKeys.balances(id)]),
  });

  const updateSubscription = useMutation({
    mutationFn: (vars: {
      subscription: Subscription;
      patch: TablesUpdate<"billing_subscriptions">;
    }) => billingService.updateSubscription(vars.subscription, vars.patch, user?.id),
    onSuccess: () => invalidate([billingKeys.subscription(id)]),
  });

  const cancelSubscription = useMutation({
    mutationFn: (vars: { subscription: Subscription; immediate: boolean }) =>
      billingService.cancel(vars.subscription, vars.immediate, user?.id),
    onSuccess: () => invalidate([billingKeys.subscription(id)]),
  });

  const renewSubscription = useMutation({
    mutationFn: (subscription: Subscription) => billingService.renew(subscription, user?.id),
    onSuccess: () => invalidate([billingKeys.subscription(id)]),
  });

  const ensureBalances = useMutation({
    mutationFn: (plan: string) => billingService.ensureBalances(workspaceId!, plan),
    onSuccess: () => invalidate([billingKeys.balances(id)]),
  });

  const adjustCredits = useMutation({
    mutationFn: (vars: {
      creditType: CreditType;
      amount: number;
      kind: "grant" | "purchase" | "consumption" | "refund" | "expiry" | "adjustment";
      reason: string;
    }) =>
      billingService.adjustCredits(
        workspaceId!,
        vars.creditType,
        vars.amount,
        vars.kind,
        vars.reason,
        user?.id,
      ),
    onSuccess: () => invalidate([billingKeys.balances(id), billingKeys.transactions(id)]),
  });

  const recordUsage = useMutation({
    mutationFn: (input: Omit<TablesInsert<"usage_records">, "workspace_id">) =>
      billingService.recordUsage(workspaceId!, input),
    onSuccess: () => invalidate([billingKeys.usage(id)]),
  });

  const createInvoice = useMutation({
    mutationFn: (vars: { subscription: Subscription | null; usage: UsageRecord[] }) =>
      billingService.createInvoice(workspaceId!, vars.subscription, vars.usage, user?.id),
    onSuccess: () => invalidate([billingKeys.invoices(id)]),
  });

  const updateInvoice = useMutation({
    mutationFn: (vars: { invoice: Invoice; patch: TablesUpdate<"invoices"> }) =>
      billingService.updateInvoice(vars.invoice, vars.patch, user?.id),
    onSuccess: () => invalidate([billingKeys.invoices(id)]),
  });

  const createPaymentMethod = useMutation({
    mutationFn: (input: Omit<TablesInsert<"payment_methods">, "workspace_id" | "created_by">) =>
      billingService.createPaymentMethod(workspaceId!, input, user?.id),
    onSuccess: () => invalidate([billingKeys.paymentMethods(id)]),
  });

  const removePaymentMethod = useMutation({
    mutationFn: (method: PaymentMethod) => billingService.removePaymentMethod(method),
    onSuccess: () => invalidate([billingKeys.paymentMethods(id)]),
  });

  return {
    ensureSubscription,
    changePlan,
    updateSubscription,
    cancelSubscription,
    renewSubscription,
    ensureBalances,
    adjustCredits,
    recordUsage,
    createInvoice,
    updateInvoice,
    createPaymentMethod,
    removePaymentMethod,
  };
}
