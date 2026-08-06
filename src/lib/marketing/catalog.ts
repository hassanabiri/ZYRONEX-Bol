import {
  BadgePercent,
  FileText,
  Film,
  Image as ImageIcon,
  Layout,
  Mail,
  MessageCircle,
  MessageSquare,
  Megaphone,
  PanelTop,
  Share2,
  Smartphone,
  Video,
  type LucideIcon,
} from "lucide-react";

import type { CreditType } from "@/lib/billing/catalog";
import type { Enums } from "@/integrations/supabase/types";

export type MarketingChannel = Enums<"marketing_channel">;
export type CampaignStatus = Enums<"marketing_campaign_status">;
export type CreativeKind = Enums<"creative_kind">;
export type CreativeStatus = Enums<"creative_status">;
export type AlertKind = Enums<"marketing_alert_kind">;
export type AlertSeverity = Enums<"marketing_alert_severity">;
export type ApprovalState = Enums<"approval_state">;

/**
 * Creative catalogue. Each entry declares which existing AI worker purpose is
 * responsible for it — the marketing agent never executes creative work itself,
 * it delegates to the specialised worker already present in the workspace.
 */
export type CreativeDefinition = {
  value: CreativeKind;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Worker purpose (see worker-options) preferred as the executor. */
  executorPurpose: string;
  creditType: CreditType;
  /** Indicative credit cost per generated asset. */
  unitCost: number;
};

export const CREATIVE_KINDS: CreativeDefinition[] = [
  { value: "image", label: "Image generation", description: "Brand-aligned visuals and product shots.", icon: ImageIcon, executorPurpose: "design", creditType: "ai_credits", unitCost: 12 },
  { value: "video", label: "Video generation", description: "Long-form video assets for campaigns.", icon: Video, executorPurpose: "design", creditType: "ai_credits", unitCost: 80 },
  { value: "reel", label: "Reels", description: "Vertical reels for Instagram and TikTok.", icon: Film, executorPurpose: "design", creditType: "ai_credits", unitCost: 45 },
  { value: "short_video", label: "Short videos", description: "Under-30s cutdowns for paid social.", icon: Film, executorPurpose: "design", creditType: "ai_credits", unitCost: 35 },
  { value: "copywriting", label: "Content writing", description: "Articles, blogs and long-form copy.", icon: FileText, executorPurpose: "content", creditType: "ai_credits", unitCost: 8 },
  { value: "ad_copy", label: "Ad copywriting", description: "Performance ad headlines and body copy.", icon: Megaphone, executorPurpose: "marketing", creditType: "ai_credits", unitCost: 6 },
  { value: "social_post", label: "Social posts", description: "Post design and caption per network.", icon: Share2, executorPurpose: "marketing", creditType: "ai_credits", unitCost: 7 },
  { value: "banner", label: "Banners", description: "Display banners in every ad size.", icon: PanelTop, executorPurpose: "design", creditType: "ai_credits", unitCost: 10 },
  { value: "landing_page", label: "Landing pages", description: "Conversion-focused landing page copy and layout.", icon: Layout, executorPurpose: "content", creditType: "ai_credits", unitCost: 25 },
  { value: "email_campaign", label: "Email campaigns", description: "Sequenced email campaigns with subject tests.", icon: Mail, executorPurpose: "marketing", creditType: "ai_credits", unitCost: 15 },
  { value: "whatsapp_message", label: "WhatsApp messages", description: "Template messages and broadcast flows.", icon: MessageCircle, executorPurpose: "support", creditType: "integrations", unitCost: 4 },
  { value: "sms_campaign", label: "SMS campaigns", description: "Short-code and bulk SMS campaigns.", icon: Smartphone, executorPurpose: "support", creditType: "integrations", unitCost: 3 },
  { value: "multi_platform", label: "All-platform content", description: "One brief fanned out to every social network.", icon: MessageSquare, executorPurpose: "marketing", creditType: "ai_credits", unitCost: 30 },
];

export const CREATIVE_KIND_MAP = new Map(CREATIVE_KINDS.map((item) => [item.value, item]));

export const MARKETING_CHANNELS: { value: MarketingChannel; label: string }[] = [
  { value: "social", label: "Social" },
  { value: "email", label: "Email" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "search", label: "Search" },
  { value: "display", label: "Display" },
  { value: "video", label: "Video" },
  { value: "content", label: "Content" },
  { value: "events", label: "Events" },
  { value: "affiliate", label: "Affiliate" },
];

export const CAMPAIGN_STATUSES: { value: CampaignStatus; label: string; tone: "default" | "secondary" | "outline" | "destructive" }[] = [
  { value: "draft", label: "Draft", tone: "outline" },
  { value: "pending_approval", label: "Pending approval", tone: "secondary" },
  { value: "scheduled", label: "Scheduled", tone: "secondary" },
  { value: "active", label: "Active", tone: "default" },
  { value: "paused", label: "Paused", tone: "outline" },
  { value: "completed", label: "Completed", tone: "secondary" },
  { value: "archived", label: "Archived", tone: "outline" },
];

export const CAMPAIGN_STATUS_MAP = new Map(CAMPAIGN_STATUSES.map((item) => [item.value, item]));

export const CREATIVE_STATUS_LABELS: Record<CreativeStatus, string> = {
  draft: "Draft",
  queued: "Queued",
  running: "Running",
  review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Failed",
  archived: "Archived",
};

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  low_credit: "Low credit",
  credit_exhaustion: "Credit running out",
  high_burn: "High burn rate",
  campaign_stopped: "Campaign stopped",
  weak_performance: "Weak performance",
  opportunity: "New opportunity",
  optimization: "Optimization suggestion",
  buy_credits: "Buy credits",
  upgrade_plan: "Upgrade plan",
};

export const ALERT_SEVERITY_TONE: Record<AlertSeverity, "default" | "secondary" | "destructive" | "outline"> = {
  info: "secondary",
  warning: "outline",
  critical: "destructive",
};

/**
 * Credit transfer matrix. Rates are expressed as "target units per 1 source
 * unit" and every transfer carries a policy fee taken from the source ledger.
 */
export const TRANSFER_RATES: Record<string, number> = {
  "ai_credits>voice_minutes": 0.05,
  "ai_credits>knowledge": 1.5,
  "ai_credits>integrations": 2,
  "ai_credits>storage": 0.01,
  "voice_minutes>ai_credits": 18,
  "knowledge>ai_credits": 0.6,
  "integrations>ai_credits": 0.45,
  "storage>ai_credits": 80,
  "marketplace>ai_credits": 1,
};

export const TRANSFER_FEE_RATE = 0.05;

export function transferRate(from: CreditType, to: CreditType) {
  if (from === to) return 1;
  return TRANSFER_RATES[`${from}>${to}`] ?? null;
}

export function previewTransfer(from: CreditType, to: CreditType, amount: number) {
  const rate = transferRate(from, to);
  if (rate === null) return null;
  const fee = Number((amount * TRANSFER_FEE_RATE).toFixed(4));
  const converted = Number(((amount - fee) * rate).toFixed(4));
  return { rate, fee, converted };
}

/** Credit top-up packs sold inside the marketing store. */
export const CREDIT_PACKS: {
  id: string;
  label: string;
  creditType: CreditType;
  amount: number;
  price: number;
  description: string;
}[] = [
  { id: "ai-10k", label: "AI booster 10K", creditType: "ai_credits", amount: 10000, price: 79, description: "Extra reasoning and generation capacity." },
  { id: "ai-50k", label: "AI booster 50K", creditType: "ai_credits", amount: 50000, price: 329, description: "Best value for high-volume creative output." },
  { id: "voice-1k", label: "Voice 1,000 minutes", creditType: "voice_minutes", amount: 1000, price: 119, description: "Outbound and inbound call minutes." },
  { id: "knowledge-10k", label: "Knowledge 10K pages", creditType: "knowledge", amount: 10000, price: 89, description: "Ingestion and indexing capacity." },
  { id: "integrations-25k", label: "Integrations 25K calls", creditType: "integrations", amount: 25000, price: 69, description: "Connector and messaging requests." },
  { id: "storage-250", label: "Storage 250 GB", creditType: "storage", amount: 250, price: 49, description: "Assets, recordings and documents." },
];

export const APPROVAL_SUBJECTS: { value: string; label: string; levels: number }[] = [
  { value: "credit_purchase", label: "Credit purchase", levels: 1 },
  { value: "credit_transfer", label: "Credit transfer", levels: 1 },
  { value: "budget_change", label: "Budget change", levels: 2 },
  { value: "campaign_publish", label: "Campaign publish", levels: 2 },
  { value: "plan_upgrade", label: "Plan upgrade", levels: 1 },
];

export const APPROVAL_SUBJECT_MAP = new Map(APPROVAL_SUBJECTS.map((item) => [item.value, item]));
