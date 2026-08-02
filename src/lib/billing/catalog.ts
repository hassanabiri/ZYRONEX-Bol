import type { Enums } from "@/integrations/supabase/types";

export type CreditType = Enums<"credit_type">;
export type CreditTxnKind = Enums<"credit_txn_kind">;
export type UsageCategory = Enums<"usage_category">;
export type SubscriptionStatus = Enums<"subscription_status">;
export type InvoiceStatus = Enums<"invoice_status">;
export type PaymentProvider = Enums<"payment_provider">;
export type BillingScope = Enums<"billing_scope">;

export type PlanDefinition = {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  seats: number;
  /** Included allowance per credit type at the start of each period. */
  allowances: Partial<Record<CreditType, number>>;
};

export const BILLING_PLANS: PlanDefinition[] = [
  {
    id: "free",
    name: "Free",
    description: "Single workspace, community support.",
    monthlyPrice: 0,
    seats: 2,
    allowances: { ai_credits: 500, voice_minutes: 30, storage: 1, knowledge: 100, integrations: 2 },
  },
  {
    id: "starter",
    name: "Starter",
    description: "Small teams getting to production.",
    monthlyPrice: 49,
    seats: 5,
    allowances: { ai_credits: 10000, voice_minutes: 500, storage: 25, knowledge: 2500, integrations: 10 },
  },
  {
    id: "growth",
    name: "Growth",
    description: "Scaling agent operations.",
    monthlyPrice: 199,
    seats: 20,
    allowances: { ai_credits: 60000, voice_minutes: 3000, storage: 250, knowledge: 20000, integrations: 50 },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "SSO, audit and dedicated capacity.",
    monthlyPrice: 999,
    seats: 200,
    allowances: {
      ai_credits: 500000,
      voice_minutes: 25000,
      storage: 2000,
      knowledge: 200000,
      integrations: 500,
      marketplace: 1000,
    },
  },
];

export const PLAN_MAP = new Map(BILLING_PLANS.map((plan) => [plan.id, plan]));

export function getPlan(id: string | undefined) {
  return id ? PLAN_MAP.get(id) : undefined;
}

export const BILLING_CYCLES = [
  { value: "monthly", label: "Monthly" },
  { value: "yearly", label: "Yearly" },
] as const;

export const CREDIT_TYPES: {
  value: CreditType;
  label: string;
  unit: string;
  description: string;
}[] = [
  { value: "ai_credits", label: "AI credits", unit: "credit", description: "Worker reasoning and model calls." },
  { value: "voice_minutes", label: "Voice minutes", unit: "minute", description: "Inbound and outbound call time." },
  { value: "storage", label: "Storage", unit: "GB", description: "Documents, recordings and assets." },
  { value: "knowledge", label: "Knowledge processing", unit: "page", description: "Ingestion, chunking and indexing." },
  { value: "integrations", label: "Integrations", unit: "call", description: "External connector requests." },
  { value: "marketplace", label: "Marketplace credits", unit: "credit", description: "Reserved for marketplace purchases." },
];

export const CREDIT_TYPE_MAP = new Map(CREDIT_TYPES.map((item) => [item.value, item]));

export const USAGE_CATEGORIES: { value: UsageCategory; label: string; creditType: CreditType }[] = [
  { value: "worker", label: "Worker usage", creditType: "ai_credits" },
  { value: "voice", label: "Voice usage", creditType: "voice_minutes" },
  { value: "api", label: "API usage", creditType: "integrations" },
  { value: "knowledge", label: "Knowledge usage", creditType: "knowledge" },
  { value: "memory", label: "Memory usage", creditType: "ai_credits" },
  { value: "storage", label: "Storage usage", creditType: "storage" },
  { value: "integration", label: "Integration usage", creditType: "integrations" },
];

export const USAGE_CATEGORY_MAP = new Map(USAGE_CATEGORIES.map((item) => [item.value, item]));

export const SUBSCRIPTION_STATUS_LABELS: Record<SubscriptionStatus, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  paused: "Paused",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const SUBSCRIPTION_STATUS_TONE: Record<
  SubscriptionStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  trialing: "secondary",
  active: "default",
  past_due: "destructive",
  paused: "outline",
  cancelled: "outline",
  expired: "destructive",
};

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: "Draft",
  open: "Open",
  paid: "Paid",
  void: "Void",
  uncollectible: "Uncollectible",
  archived: "Archived",
};

export const INVOICE_STATUS_TONE: Record<
  InvoiceStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  draft: "outline",
  open: "secondary",
  paid: "default",
  void: "outline",
  uncollectible: "destructive",
  archived: "outline",
};

export const PAYMENT_PROVIDERS: {
  value: PaymentProvider;
  label: string;
  description: string;
  /** Payment rails are prepared only — no charge is ever executed today. */
  available: boolean;
}[] = [
  { value: "stripe", label: "Stripe", description: "Cards and subscriptions worldwide.", available: false },
  { value: "hyperpay", label: "HyperPay", description: "MENA cards and mada.", available: false },
  { value: "paytabs", label: "PayTabs", description: "Hosted payment pages for the Gulf.", available: false },
  { value: "moyasar", label: "Moyasar", description: "Saudi payments and Apple Pay.", available: false },
  { value: "stc_pay", label: "STC Pay", description: "Wallet payments in Saudi Arabia.", available: false },
  { value: "manual", label: "Manual billing", description: "Bank transfer and offline invoices.", available: true },
];

export const BILLING_SCOPES: { value: BillingScope; label: string; description: string }[] = [
  { value: "workspace", label: "Workspace billing", description: "Default scope — the workspace pays for itself." },
  { value: "organization", label: "Organization billing", description: "Consolidated billing across workspaces." },
  { value: "owner", label: "Owner billing", description: "Charged to the workspace owner personally." },
  { value: "developer", label: "Developer billing", description: "Marketplace developer payouts and fees." },
  { value: "reseller", label: "Reseller billing", description: "Reserved for future reseller programs." },
];

export const MARKETPLACE_BILLING_ITEMS = [
  { id: "workers", label: "Workers", description: "Sell prebuilt AI workers with revenue share." },
  { id: "plugins", label: "Plugins", description: "Sell connector and tool plugins." },
  { id: "templates", label: "Templates", description: "Sell workflow and prompt templates." },
  { id: "knowledge", label: "Knowledge packs", description: "Sell curated knowledge bases." },
] as const;

export function formatMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

export function creditLabel(type: CreditType) {
  return CREDIT_TYPE_MAP.get(type)?.label ?? type;
}

export function creditUnit(type: CreditType) {
  return CREDIT_TYPE_MAP.get(type)?.unit ?? "credit";
}
