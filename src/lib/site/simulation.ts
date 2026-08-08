/** Shared browser-safe types for the AI demo simulator and solution builder. */

export type SimAgent = { key: string; name: string; role: string; firstAction: string };
export type SimStep = { actor: string; title: string; detail: string; metric: string };
export type SimKpi = { label: string; value: string; delta: string };

export type SimulationResult = {
  businessSummary: string;
  agents: SimAgent[];
  timeline: SimStep[];
  today: string[];
  withZyronex: string[];
  opportunity: string;
  kpis: SimKpi[];
  recommendedPlan: string;
  planReason: string;
  modules: string[];
  integrations: string[];
};

export type ScenarioKey = "sales" | "support" | "marketing" | "operations" | "executive";

export const SCENARIOS: { key: ScenarioKey; label: string; prompt: string }[] = [
  { key: "sales", label: "Sales simulation", prompt: "Handle a new inbound customer and turn it into an opportunity." },
  { key: "support", label: "Customer service simulation", prompt: "Resolve a customer problem end to end." },
  { key: "marketing", label: "Marketing simulation", prompt: "Plan and launch a campaign." },
  { key: "operations", label: "Operations simulation", prompt: "Detect and fix an operational issue." },
  { key: "executive", label: "Executive simulation", prompt: "Analyse business performance and decide." },
];

export const BUSINESS_TYPES = [
  "E-commerce",
  "Restaurant",
  "Services company",
  "Factory",
  "Travel company",
  "Professional office",
  "Other",
];

export const FOCUS_AREAS = ["Sales", "Marketing", "Customer service", "Operations", "Management", "All of them"];
