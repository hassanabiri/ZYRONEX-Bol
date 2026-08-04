/**
 * CAPABILITIES — reusable building blocks that agents are assembled from.
 *
 * A capability is owned by exactly one Platform Core domain or Layer 2 service
 * and may be attached to any number of agents. Features must attach an existing
 * capability rather than re-implementing behaviour inside a single agent.
 */

import type { CoreDomain } from "@/lib/platform/core";

export type CapabilityId =
  | "memory"
  | "knowledge"
  | "search"
  | "reasoning"
  | "voice"
  | "email"
  | "calendar"
  | "crm_access"
  | "files"
  | "analytics";

export type Capability = {
  id: CapabilityId;
  label: string;
  /** Core domain the capability is grounded in, when it is core-owned. */
  owner: CoreDomain | "expandable_service";
  description: string;
  /** Current implementation surface, or the seam it will plug into. */
  surface: string;
  status: "available" | "partial" | "planned";
};

export const CAPABILITIES: Capability[] = [
  {
    id: "memory",
    label: "Memory",
    owner: "memory",
    description: "Layered short/long-term recall shared across runs of an agent.",
    surface: "src/services/memory-service.ts",
    status: "available",
  },
  {
    id: "knowledge",
    label: "Knowledge",
    owner: "memory",
    description: "Assignable knowledge bases and ingested documents.",
    surface: "src/services/knowledge-service.ts",
    status: "available",
  },
  {
    id: "search",
    label: "Search",
    owner: "memory",
    description: "Retrieval over knowledge bases and memory entries.",
    surface: "src/components/knowledge/knowledge-search.tsx",
    status: "partial",
  },
  {
    id: "reasoning",
    label: "Reasoning",
    owner: "runtime",
    description: "Prompt and decision nodes executed by registered handlers.",
    surface: "registerNodeHandler() in src/lib/execution/runtime.ts",
    status: "partial",
  },
  {
    id: "voice",
    label: "Voice",
    owner: "expandable_service",
    description: "Numbers, voice profiles and call handling attached to an agent.",
    surface: "src/services/voice-service.ts",
    status: "available",
  },
  {
    id: "email",
    label: "Email",
    owner: "expandable_service",
    description: "Outbound and inbound mail through connected providers.",
    surface: "src/lib/integrations/catalog.ts",
    status: "planned",
  },
  {
    id: "calendar",
    label: "Calendar",
    owner: "expandable_service",
    description: "Scheduling and availability through connected providers.",
    surface: "src/lib/integrations/catalog.ts",
    status: "planned",
  },
  {
    id: "crm_access",
    label: "CRM Access",
    owner: "expandable_service",
    description: "Read/write access to customer records via integrations.",
    surface: "src/services/integration-service.ts",
    status: "partial",
  },
  {
    id: "files",
    label: "Files",
    owner: "workspace",
    description: "Workspace-scoped storage buckets for documents and recordings.",
    surface: "Supabase storage buckets (workspace-scoped policies)",
    status: "available",
  },
  {
    id: "analytics",
    label: "Analytics",
    owner: "observability",
    description: "Usage, execution and cost signals aggregated per workspace.",
    surface: "src/components/execution/execution-stats.tsx, billing usage tracking",
    status: "available",
  },
];

/**
 * COMPANY INTELLIGENCE — learning is organizational, not per-agent.
 *
 * Every capability that produces signal writes into workspace-scoped stores so
 * the organization accumulates operational intelligence that outlives any
 * single agent (an agent can be replaced without losing what was learned).
 */
export const COMPANY_INTELLIGENCE_SOURCES = [
  { source: "activity_log", meaning: "What the organization did and how it ended." },
  { source: "executions + execution steps", meaning: "How work actually runs, fails and retries." },
  { source: "memory stores", meaning: "Durable operational recall, scoped to the workspace." },
  { source: "knowledge bases", meaning: "Curated company truth reused by every agent." },
  { source: "usage + credit ledgers", meaning: "Cost and consumption intelligence." },
  { source: "marketplace reviews & installs", meaning: "What works well enough to be reused." },
] as const;
