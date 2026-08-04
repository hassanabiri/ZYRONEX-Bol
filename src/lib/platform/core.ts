/**
 * PLATFORM CORE — the constitution of ZYRONEX.
 *
 * Layer 1 of the platform. Permanent, stable, provider-agnostic.
 * Every expandable service (Layer 2) and every business solution (Layer 3)
 * consumes Platform Core; nothing may bypass it and nothing outside it may
 * redefine it.
 *
 * This module is declarative only: it documents and types the architecture so
 * future sprints classify their work instead of re-inventing the foundation.
 */

export type CoreDomain =
  | "workspace"
  | "agent_builder"
  | "runtime"
  | "memory"
  | "workflow"
  | "decision_engine"
  | "security"
  | "observability";

export type CoreDomainSpec = {
  domain: CoreDomain;
  label: string;
  /** What the domain owns and guarantees to the rest of the platform. */
  responsibility: string;
  /** Where the current implementation lives. */
  implementation: string[];
};

export const PLATFORM_CORE: CoreDomainSpec[] = [
  {
    domain: "workspace",
    label: "Workspace",
    responsibility:
      "Tenancy root. Owns identity, membership, roles, permissions and isolation for every other domain.",
    implementation: [
      "src/lib/workspace.tsx",
      "src/services/workspace-service.ts",
      "src/services/team-service.ts",
      "src/services/role-service.ts",
    ],
  },
  {
    domain: "agent_builder",
    label: "Agent Builder",
    responsibility:
      "Authoring surface for AI Workers: identity, purpose, configuration, versions, import/export.",
    implementation: ["src/services/worker-service.ts", "src/components/workers"],
  },
  {
    domain: "runtime",
    label: "Runtime",
    responsibility:
      "Single execution entry point. Queueing, concurrency, retries, timeouts, cancellation, step state.",
    implementation: ["src/lib/execution/runtime.ts", "src/services/execution-service.ts"],
  },
  {
    domain: "memory",
    label: "Memory",
    responsibility:
      "Layered persistent memory plus knowledge retrieval used by agents and by the organization.",
    implementation: ["src/services/memory-service.ts", "src/services/knowledge-service.ts"],
  },
  {
    domain: "workflow",
    label: "Workflow",
    responsibility: "Graph model, node registry, versioning and publication of executable workflows.",
    implementation: [
      "src/lib/execution/graph.ts",
      "src/lib/execution/nodes.ts",
      "src/services/workflow-service.ts",
    ],
  },
  {
    domain: "decision_engine",
    label: "Decision Engine",
    responsibility:
      "Validation, routing and branching rules that decide whether and how a run proceeds.",
    implementation: ["src/lib/execution/validation.ts", "src/lib/execution/graph.ts"],
  },
  {
    domain: "security",
    label: "Security",
    responsibility:
      "Auth, RBAC, tenant isolation via RLS, credential encryption and scoped API keys.",
    implementation: [
      "src/lib/auth.tsx",
      "src/hooks/use-workspace-role.ts",
      "src/lib/integrations/crypto.server.ts",
    ],
  },
  {
    domain: "observability",
    label: "Observability",
    responsibility:
      "Audit trail, execution timeline, health and usage signals surfaced to Mission Control.",
    implementation: [
      "src/services/activity-service.ts",
      "src/components/execution/execution-timeline.tsx",
      "src/lib/error-capture.ts",
    ],
  },
];

/**
 * Agent Lifecycle — the primary philosophy of the platform.
 * Every feature must support one or more stages.
 */
export const AGENT_LIFECYCLE = [
  "build",
  "configure",
  "deploy",
  "operate",
  "monitor",
  "learn",
  "improve",
  "replace",
] as const;

export type LifecycleStage = (typeof AGENT_LIFECYCLE)[number];

/**
 * Provider independence: Platform Core never imports a provider SDK.
 * External systems are reached through these replaceable seams only.
 */
export const PROVIDER_SEAMS = [
  {
    kind: "ai",
    seam: "registerNodeHandler() in src/lib/execution/runtime.ts",
    rule: "Runtime orchestrates; providers are handlers registered from Layer 2.",
  },
  {
    kind: "voice",
    seam: "src/lib/voice/catalog.ts + src/services/voice-service.ts",
    rule: "Providers are catalog entries and stored credentials, never core imports.",
  },
  {
    kind: "payment",
    seam: "src/components/billing/payment-architecture.tsx",
    rule: "Payment providers are pluggable slots; billing state is provider-neutral.",
  },
  {
    kind: "communication",
    seam: "src/lib/integrations/catalog.ts",
    rule: "Connections are declarative catalog entries with encrypted credentials.",
  },
] as const;
