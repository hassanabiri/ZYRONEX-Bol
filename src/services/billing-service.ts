import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { activityService } from "@/services/activity-service";
import {
  BILLING_PLANS,
  CREDIT_TYPES,
  getPlan,
  type CreditType,
  type UsageCategory,
} from "@/lib/billing/catalog";

export type Subscription = Tables<"billing_subscriptions">;
export type CreditBalance = Tables<"credit_balances">;
export type CreditTransaction = Tables<"credit_transactions">;
export type UsageRecord = Tables<"usage_records">;
export type Invoice = Tables<"invoices">;
export type InvoiceItem = Tables<"invoice_items">;
export type PaymentMethod = Tables<"payment_methods">;

export type InvoiceWithItems = Invoice & { items: InvoiceItem[] };

function periodEnd(cycle: string) {
  const date = new Date();
  date.setMonth(date.getMonth() + (cycle === "yearly" ? 12 : 1));
  return date.toISOString();
}

/**
 * Billing Platform data layer: subscriptions, credit balances, metered usage,
 * invoices and prepared payment rails. No payment provider is ever charged here.
 */
export const billingService = {
  async getSubscription(workspaceId: string): Promise<Subscription | null> {
    const { data, error } = await supabase
      .from("billing_subscriptions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("scope", "workspace")
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async ensureSubscription(workspaceId: string, plan = "free", userId?: string) {
    const existing = await billingService.getSubscription(workspaceId);
    if (existing) return existing;
    const definition = getPlan(plan) ?? BILLING_PLANS[0]!;
    const { data, error } = await supabase
      .from("billing_subscriptions")
      .insert({
        workspace_id: workspaceId,
        plan: definition.id,
        status: definition.monthlyPrice === 0 ? "active" : "trialing",
        amount: definition.monthlyPrice,
        seats: definition.seats,
        created_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    await billingService.ensureBalances(workspaceId, definition.id);
    return data;
  },

  async changePlan(subscription: Subscription, plan: string, cycle: string, userId?: string) {
    const definition = getPlan(plan);
    const patch: TablesUpdate<"billing_subscriptions"> = {
      plan,
      billing_cycle: cycle,
      amount: definition
        ? cycle === "yearly"
          ? definition.monthlyPrice * 10
          : definition.monthlyPrice
        : subscription.amount,
      seats: definition?.seats ?? subscription.seats,
      status: "active",
      cancel_at_period_end: false,
      cancelled_at: null,
      current_period_start: new Date().toISOString(),
      current_period_end: periodEnd(cycle),
    };
    const updated = await billingService.updateSubscription(subscription, patch, userId);
    await billingService.ensureBalances(subscription.workspace_id, plan);
    return updated;
  },

  async updateSubscription(
    subscription: Subscription,
    patch: TablesUpdate<"billing_subscriptions">,
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("billing_subscriptions")
      .update(patch)
      .eq("id", subscription.id)
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(subscription.workspace_id, {
      entity_type: "subscription",
      entity_id: subscription.id,
      action: "billing.subscription.updated",
      detail: `${data.plan} · ${data.status}`,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  cancel(subscription: Subscription, immediate: boolean, userId?: string) {
    return billingService.updateSubscription(
      subscription,
      immediate
        ? { status: "cancelled", cancelled_at: new Date().toISOString(), cancel_at_period_end: false }
        : { cancel_at_period_end: true },
      userId,
    );
  },

  renew(subscription: Subscription, userId?: string) {
    return billingService.updateSubscription(
      subscription,
      {
        status: "active",
        cancel_at_period_end: false,
        cancelled_at: null,
        current_period_start: new Date().toISOString(),
        current_period_end: periodEnd(subscription.billing_cycle),
      },
      userId,
    );
  },

  async listBalances(workspaceId: string): Promise<CreditBalance[]> {
    const { data, error } = await supabase
      .from("credit_balances")
      .select("*")
      .eq("workspace_id", workspaceId);
    if (error) throw error;
    return data ?? [];
  },

  /** Creates the six credit ledgers for a workspace and tops them up to the plan allowance. */
  async ensureBalances(workspaceId: string, plan: string) {
    const definition = getPlan(plan);
    const rows = CREDIT_TYPES.map((type) => ({
      workspace_id: workspaceId,
      credit_type: type.value,
      unit: type.unit,
      granted: definition?.allowances[type.value] ?? 0,
    }));
    const { error } = await supabase
      .from("credit_balances")
      .upsert(rows, { onConflict: "workspace_id,credit_type" });
    if (error) throw error;
    return billingService.listBalances(workspaceId);
  },

  async adjustCredits(
    workspaceId: string,
    creditType: CreditType,
    amount: number,
    kind: Tables<"credit_transactions">["kind"],
    reason: string,
    userId?: string,
  ) {
    const balances = await billingService.listBalances(workspaceId);
    const balance = balances.find((row) => row.credit_type === creditType);
    if (!balance) throw new Error("Credit ledger not initialised");

    const granted = kind === "consumption" ? balance.granted : balance.granted + amount;
    const used = kind === "consumption" ? balance.used + amount : balance.used;
    const { error } = await supabase
      .from("credit_balances")
      .update({ granted, used })
      .eq("id", balance.id);
    if (error) throw error;

    const { error: txnError } = await supabase.from("credit_transactions").insert({
      workspace_id: workspaceId,
      credit_type: creditType,
      kind,
      amount,
      balance_after: granted - used,
      reason,
      actor_id: userId ?? null,
    });
    if (txnError) throw txnError;
    return granted - used;
  },

  async listTransactions(workspaceId: string, limit = 100): Promise<CreditTransaction[]> {
    const { data, error } = await supabase
      .from("credit_transactions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  async listUsage(workspaceId: string, limit = 300): Promise<UsageRecord[]> {
    const { data, error } = await supabase
      .from("usage_records")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("occurred_on", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  /** Single entry point every module uses to meter a consumed resource. */
  async recordUsage(
    workspaceId: string,
    input: Omit<TablesInsert<"usage_records">, "workspace_id">,
  ) {
    const { data, error } = await supabase
      .from("usage_records")
      .insert({
        ...input,
        workspace_id: workspaceId,
        total_cost: input.total_cost ?? (input.quantity ?? 0) * (input.unit_cost ?? 0),
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  usageByCategory(records: UsageRecord[]) {
    const map = new Map<UsageCategory, { quantity: number; cost: number; unit: string }>();
    for (const record of records) {
      const current = map.get(record.category) ?? { quantity: 0, cost: 0, unit: record.unit };
      map.set(record.category, {
        quantity: current.quantity + Number(record.quantity),
        cost: current.cost + Number(record.total_cost),
        unit: record.unit,
      });
    }
    return map;
  },

  async listInvoices(workspaceId: string): Promise<InvoiceWithItems[]> {
    const { data, error } = await supabase
      .from("invoices")
      .select("*, items:invoice_items(*)")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as InvoiceWithItems[];
  },

  /** Builds a draft invoice from unbilled usage plus the recurring plan fee. */
  async createInvoice(
    workspaceId: string,
    subscription: Subscription | null,
    usage: UsageRecord[],
    userId?: string,
  ) {
    const number = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(
      Math.random() * 9000 + 1000,
    )}`;
    const grouped = billingService.usageByCategory(usage);
    const lines = [...grouped.entries()]
      .filter(([, value]) => value.quantity > 0)
      .map(([category, value]) => ({
        description: `${category} usage`,
        category,
        quantity: Number(value.quantity.toFixed(4)),
        unit_price: value.quantity ? Number((value.cost / value.quantity).toFixed(4)) : 0,
        amount: Number(value.cost.toFixed(2)),
      }));

    if (subscription && Number(subscription.amount) > 0) {
      lines.unshift({
        description: `${subscription.plan} plan (${subscription.billing_cycle})`,
        category: null as unknown as UsageCategory,
        quantity: 1,
        unit_price: Number(subscription.amount),
        amount: Number(subscription.amount),
      });
    }

    const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);
    const taxRate = Number(subscription?.tax_rate ?? 0);
    const taxAmount = Number(((subtotal * taxRate) / 100).toFixed(2));

    const { data, error } = await supabase
      .from("invoices")
      .insert({
        workspace_id: workspaceId,
        subscription_id: subscription?.id ?? null,
        number,
        status: "draft",
        currency: subscription?.currency ?? "USD",
        subtotal,
        tax_rate: taxRate,
        tax_amount: taxAmount,
        total: Number((subtotal + taxAmount).toFixed(2)),
        issued_at: new Date().toISOString(),
        payment_provider: subscription?.payment_provider ?? "manual",
        created_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    if (lines.length) {
      const { error: itemError } = await supabase.from("invoice_items").insert(
        lines.map((line) => ({ ...line, workspace_id: workspaceId, invoice_id: data.id })),
      );
      if (itemError) throw itemError;
    }

    await activityService.log(workspaceId, {
      entity_type: "invoice",
      entity_id: data.id,
      action: "billing.invoice.created",
      detail: data.number,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async updateInvoice(invoice: Invoice, patch: TablesUpdate<"invoices">, userId?: string) {
    const { data, error } = await supabase
      .from("invoices")
      .update(patch)
      .eq("id", invoice.id)
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(invoice.workspace_id, {
      entity_type: "invoice",
      entity_id: invoice.id,
      action: "billing.invoice.updated",
      detail: `${invoice.number} · ${data.status}`,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async listPaymentMethods(workspaceId: string): Promise<PaymentMethod[]> {
    const { data, error } = await supabase
      .from("payment_methods")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createPaymentMethod(
    workspaceId: string,
    input: Omit<TablesInsert<"payment_methods">, "workspace_id" | "created_by">,
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("payment_methods")
      .insert({ ...input, workspace_id: workspaceId, created_by: userId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async removePaymentMethod(method: PaymentMethod) {
    const { error } = await supabase.from("payment_methods").delete().eq("id", method.id);
    if (error) throw error;
  },
};

/** CSV export used by the invoice center — kept out of components so it stays reusable. */
export function invoicesToCsv(invoices: InvoiceWithItems[]) {
  const header = ["number", "status", "currency", "subtotal", "tax", "total", "issued_at"];
  const rows = invoices.map((invoice) =>
    [
      invoice.number,
      invoice.status,
      invoice.currency,
      invoice.subtotal,
      invoice.tax_amount,
      invoice.total,
      invoice.issued_at ?? "",
    ].join(","),
  );
  return [header.join(","), ...rows].join("\n");
}
