import {
  Bot,
  Brain,
  Briefcase,
  Building2,
  Cpu,
  Gavel,
  GraduationCap,
  Headphones,
  Megaphone,
  Plane,
  Scale,
  Sparkles,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import type { Enums } from "@/integrations/supabase/types";

export type WorkerStatus = Enums<"worker_status">;

export const WORKER_STATUSES = ["draft", "active", "paused", "archived"] as const;

/**
 * Worker types are free-form strings in the database so new industries can be added
 * without a migration. These are suggestions surfaced in the UI only.
 */
export const WORKER_TYPE_SUGGESTIONS = [
  "sales",
  "customer-support",
  "marketing",
  "hr",
  "finance",
  "legal",
  "travel",
  "education",
  "custom",
] as const;

export const WORKER_PURPOSE_SUGGESTIONS = [
  "answer-customers",
  "generate-content",
  "sales-calls",
  "analyze-documents",
  "custom",
] as const;

export const WORKER_PROVIDER_SUGGESTIONS = [
  "openai",
  "anthropic",
  "google",
  "azure",
  "custom",
] as const;

const LABELS: Record<string, string> = {
  sales: "Sales",
  "customer-support": "Customer Support",
  marketing: "Marketing",
  hr: "HR",
  finance: "Finance",
  legal: "Legal",
  travel: "Travel",
  education: "Education",
  custom: "Custom",
  "answer-customers": "Answer Customers",
  "generate-content": "Generate Content",
  "sales-calls": "Sales Calls",
  "analyze-documents": "Analyze Documents",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  azure: "Azure",
};

/** Turns any slug (including user-defined ones) into a readable label. */
export function humanize(value: string | null | undefined) {
  if (!value) return "—";
  return (
    LABELS[value] ??
    value
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ")
  );
}

export const WORKER_COLORS = [
  { value: "cyan", className: "bg-[oklch(0.72_0.13_210)]" },
  { value: "violet", className: "bg-[oklch(0.62_0.18_295)]" },
  { value: "emerald", className: "bg-[oklch(0.68_0.15_160)]" },
  { value: "amber", className: "bg-[oklch(0.78_0.15_75)]" },
  { value: "rose", className: "bg-[oklch(0.66_0.19_15)]" },
  { value: "slate", className: "bg-[oklch(0.55_0.02_260)]" },
] as const;

export const WORKER_ICONS: { value: string; icon: LucideIcon }[] = [
  { value: "bot", icon: Bot },
  { value: "brain", icon: Brain },
  { value: "headphones", icon: Headphones },
  { value: "megaphone", icon: Megaphone },
  { value: "briefcase", icon: Briefcase },
  { value: "wallet", icon: Wallet },
  { value: "scale", icon: Scale },
  { value: "plane", icon: Plane },
  { value: "graduation", icon: GraduationCap },
  { value: "users", icon: Users },
  { value: "building", icon: Building2 },
  { value: "gavel", icon: Gavel },
  { value: "cpu", icon: Cpu },
  { value: "sparkles", icon: Sparkles },
];

export function workerIcon(value: string | null | undefined): LucideIcon {
  return WORKER_ICONS.find((entry) => entry.value === value)?.icon ?? Bot;
}

export function workerColorClass(value: string | null | undefined) {
  return WORKER_COLORS.find((entry) => entry.value === value)?.className ?? WORKER_COLORS[0].className;
}

export function statusVariant(status: WorkerStatus): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "paused" || status === "draft") return "secondary";
  return "outline";
}
