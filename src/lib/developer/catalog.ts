import {
  BookOpen,
  Braces,
  Code2,
  FileCode2,
  Puzzle,
  Rocket,
  Smartphone,
  Terminal,
  type LucideIcon,
} from "lucide-react";

import type { Enums } from "@/integrations/supabase/types";

export type DeveloperProjectStatus = Enums<"developer_project_status">;
export type PluginStatus = Enums<"plugin_status">;
export type MarketplaceCategory = Enums<"marketplace_category">;
export type MarketplaceLicense = Enums<"marketplace_license">;

export const PROJECT_ENVIRONMENTS = ["production", "staging", "sandbox"] as const;

export const API_VERSIONS = ["v1", "v2-preview"] as const;

export const OAUTH_GRANT_TYPES = [
  "authorization_code",
  "client_credentials",
  "refresh_token",
  "device_code",
] as const;

/** Transport surfaces the platform API exposes (or is architected for). */
export const API_SURFACES: {
  id: string;
  label: string;
  description: string;
  state: "live" | "ready";
  icon: LucideIcon;
}[] = [
  {
    id: "rest",
    label: "REST API",
    description: "Versioned, workspace-scoped JSON endpoints authenticated with bearer API keys.",
    state: "live",
    icon: Braces,
  },
  {
    id: "webhooks",
    label: "Webhooks",
    description: "Signed outbound event delivery with retries and delivery inspection.",
    state: "live",
    icon: Rocket,
  },
  {
    id: "graphql",
    label: "GraphQL",
    description: "Schema-first gateway over the same scopes and permission model.",
    state: "ready",
    icon: Code2,
  },
  {
    id: "streaming",
    label: "Streaming",
    description: "Server-sent execution streams for token-by-token worker output.",
    state: "ready",
    icon: Terminal,
  },
];

export const API_POLICIES = [
  { label: "Rate limiting", detail: "Per-project request ceiling, enforced per minute." },
  { label: "API versioning", detail: "Version pinned per project; v1 stable, v2 preview." },
  { label: "Scopes", detail: "Least-privilege scope grants on every key and OAuth client." },
  { label: "Permissions", detail: "Workspace RBAC applies on top of every token." },
  { label: "Token rotation", detail: "One-click rotation for API keys, webhooks and OAuth secrets." },
  { label: "Workspace isolation", detail: "Every request is bound to a single workspace tenant." },
];

export const SDKS: {
  id: string;
  label: string;
  language: string;
  install: string;
  snippet: string;
  state: "ready" | "planned";
  icon: LucideIcon;
}[] = [
  {
    id: "javascript",
    label: "JavaScript SDK",
    language: "JavaScript",
    install: "npm install @zyronex/sdk",
    snippet: `const zyronex = new Zyronex({ apiKey: process.env.ZYRONEX_API_KEY });
const run = await zyronex.executions.create({ workerId, input });`,
    state: "ready",
    icon: FileCode2,
  },
  {
    id: "typescript",
    label: "TypeScript SDK",
    language: "TypeScript",
    install: "npm install @zyronex/sdk",
    snippet: `import { Zyronex } from "@zyronex/sdk";
const zyronex = new Zyronex({ apiKey });
const workers = await zyronex.workers.list();`,
    state: "ready",
    icon: FileCode2,
  },
  {
    id: "python",
    label: "Python SDK",
    language: "Python",
    install: "pip install zyronex",
    snippet: `from zyronex import Zyronex
client = Zyronex(api_key=API_KEY)
run = client.executions.create(worker_id=worker_id, input=payload)`,
    state: "ready",
    icon: Terminal,
  },
  {
    id: "php",
    label: "PHP SDK",
    language: "PHP",
    install: "composer require zyronex/sdk",
    snippet: `$zyronex = new Zyronex\\Client($apiKey);
$run = $zyronex->executions()->create($workerId, $payload);`,
    state: "planned",
    icon: Terminal,
  },
  {
    id: "flutter",
    label: "Flutter SDK",
    language: "Dart",
    install: "flutter pub add zyronex",
    snippet: `final zyronex = Zyronex(apiKey: apiKey);
final run = await zyronex.executions.create(workerId: id, input: payload);`,
    state: "planned",
    icon: Smartphone,
  },
  {
    id: "mobile",
    label: "Mobile SDKs",
    language: "Swift / Kotlin",
    install: "coming with the mobile platform",
    snippet: `// Swift and Kotlin clients share the REST contract above.`,
    state: "planned",
    icon: Smartphone,
  },
];

export const DOC_SECTIONS: {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  topics: string[];
}[] = [
  {
    id: "api-reference",
    title: "API Reference",
    description: "Every REST resource, parameter and response shape.",
    icon: Braces,
    topics: ["Workers", "Workflows", "Executions", "Knowledge", "Voice", "Billing"],
  },
  {
    id: "sdk-reference",
    title: "SDK Reference",
    description: "Client libraries, configuration and typed models.",
    icon: FileCode2,
    topics: ["Installation", "Clients", "Pagination", "Errors", "Retries"],
  },
  {
    id: "authentication",
    title: "Authentication",
    description: "API keys, OAuth clients, scopes and token rotation.",
    icon: Code2,
    topics: ["API keys", "OAuth 2.0", "Scopes", "Rotation"],
  },
  {
    id: "webhooks",
    title: "Webhooks",
    description: "Event catalogue, signature verification and retries.",
    icon: Rocket,
    topics: ["Signatures", "Event types", "Retry policy", "Replay"],
  },
  {
    id: "examples",
    title: "Examples",
    description: "Copy-paste recipes for the most common integrations.",
    icon: BookOpen,
    topics: ["Run a worker", "Stream output", "Sync knowledge", "Handle a webhook"],
  },
  {
    id: "tutorials",
    title: "Tutorials",
    description: "End-to-end guides from first key to published product.",
    icon: Puzzle,
    topics: ["Build a worker", "Publish to marketplace", "Ship a plugin"],
  },
  {
    id: "changelog",
    title: "Changelog",
    description: "Platform releases, deprecations and migration notes.",
    icon: Terminal,
    topics: ["v1 stable", "v2 preview", "Deprecations"],
  },
];

export const PLUGIN_PERMISSIONS = [
  "workers.read",
  "workers.write",
  "workflows.read",
  "workflows.write",
  "executions.read",
  "knowledge.read",
  "knowledge.write",
  "memory.read",
  "voice.read",
  "billing.read",
  "webhooks.write",
] as const;

export const MARKETPLACE_CATEGORIES: { id: MarketplaceCategory; label: string }[] = [
  { id: "workers", label: "Workers" },
  { id: "workflows", label: "Workflows" },
  { id: "knowledge_packs", label: "Knowledge Packs" },
  { id: "prompt_packs", label: "Prompt Packs" },
  { id: "voice_packs", label: "Voice Packs" },
  { id: "templates", label: "Templates" },
  { id: "plugins", label: "Plugins" },
  { id: "extensions", label: "Extensions" },
  { id: "automation_packs", label: "Automation Packs" },
];

export const MARKETPLACE_LICENSES: { id: MarketplaceLicense; label: string }[] = [
  { id: "free", label: "Free" },
  { id: "paid", label: "Paid" },
  { id: "subscription", label: "Subscription" },
  { id: "enterprise", label: "Enterprise" },
  { id: "trial", label: "Trial" },
  { id: "lifetime", label: "Lifetime" },
];

export const MARKETPLACE_COLLECTIONS = [
  { id: "featured", label: "Featured" },
  { id: "trending", label: "Trending" },
  { id: "recent", label: "Recently Updated" },
  { id: "verified", label: "Verified" },
  { id: "all", label: "All products" },
] as const;

export type MarketplaceCollection = (typeof MARKETPLACE_COLLECTIONS)[number]["id"];

export function categoryLabel(category: MarketplaceCategory) {
  return MARKETPLACE_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}

export function formatPrice(priceCents: number, currency: string, license: MarketplaceLicense) {
  if (license === "free" || priceCents === 0) return "Free";
  const amount = (priceCents / 100).toFixed(2);
  const suffix = license === "subscription" ? " / mo" : "";
  return `${currency} ${amount}${suffix}`;
}
