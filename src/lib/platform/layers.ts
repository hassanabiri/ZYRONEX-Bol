/**
 * PLATFORM LAYERS + MODULE CLASSIFICATION.
 *
 * Layer 1 Platform Core        — permanent, stable, provider-agnostic.
 * Layer 2 Expandable Services  — replaceable services built on top of core.
 * Layer 3 Business Layer       — solutions that consume core, never define it.
 *
 * Dependency direction is one-way: 3 -> 2 -> 1. A Layer 1 module must never
 * import from a Layer 2 or Layer 3 module.
 */

import type { CapabilityId } from "@/lib/platform/capabilities";
import type { CoreDomain, LifecycleStage } from "@/lib/platform/core";

export type PlatformLayer = "core" | "services" | "business";

export type Pillar = "build" | "operate" | "manage";

export const LAYERS: { layer: PlatformLayer; label: string; rule: string }[] = [
  {
    layer: "core",
    label: "Platform Core",
    rule: "Permanent foundation. Changes rarely and never depends on an external provider.",
  },
  {
    layer: "services",
    label: "Expandable Services",
    rule: "Replaceable services that extend core through registries, catalogs and adapters.",
  },
  {
    layer: "business",
    label: "Business Layer",
    rule: "Solutions, packaging and commerce. Consumes core; may never be depended on by core.",
  },
];

export type ModuleSpec = {
  /** Route the module is reachable at, mirroring src/lib/navigation.ts. */
  route: string;
  label: string;
  layer: PlatformLayer;
  pillar: Pillar;
  /** Core domains the module is grounded in — its dependency on Platform Core. */
  coreDomains: CoreDomain[];
  lifecycle: LifecycleStage[];
  capabilities: CapabilityId[];
};

export const MODULE_MAP: ModuleSpec[] = [
  {
    route: "/dashboard",
    label: "Mission Control",
    layer: "core",
    pillar: "operate",
    coreDomains: ["workspace", "observability"],
    lifecycle: ["operate", "monitor"],
    capabilities: ["analytics"],
  },
  {
    route: "/workspace",
    label: "Workspace",
    layer: "core",
    pillar: "manage",
    coreDomains: ["workspace", "security"],
    lifecycle: ["configure", "operate"],
    capabilities: ["files"],
  },
  {
    route: "/workers",
    label: "AI Workers",
    layer: "core",
    pillar: "build",
    coreDomains: ["agent_builder", "runtime"],
    lifecycle: ["build", "configure", "deploy", "replace"],
    capabilities: ["memory", "knowledge", "voice", "reasoning"],
  },
  {
    route: "/agents",
    label: "Agents",
    layer: "core",
    pillar: "build",
    coreDomains: ["agent_builder"],
    lifecycle: ["build", "configure"],
    capabilities: ["reasoning"],
  },
  {
    route: "/workflow",
    label: "Workflow",
    layer: "core",
    pillar: "build",
    coreDomains: ["workflow", "decision_engine"],
    lifecycle: ["build", "configure", "deploy", "improve"],
    capabilities: ["reasoning"],
  },
  {
    route: "/executions",
    label: "Executions",
    layer: "core",
    pillar: "operate",
    coreDomains: ["runtime", "observability"],
    lifecycle: ["operate", "monitor"],
    capabilities: ["analytics"],
  },
  {
    route: "/knowledge",
    label: "Knowledge",
    layer: "core",
    pillar: "build",
    coreDomains: ["memory"],
    lifecycle: ["build", "learn"],
    capabilities: ["knowledge", "search", "files"],
  },
  {
    route: "/memory",
    label: "Memory",
    layer: "core",
    pillar: "build",
    coreDomains: ["memory"],
    lifecycle: ["learn", "improve"],
    capabilities: ["memory", "search"],
  },
  {
    route: "/voice",
    label: "Voice",
    layer: "services",
    pillar: "operate",
    coreDomains: ["runtime", "agent_builder"],
    lifecycle: ["deploy", "operate", "monitor"],
    capabilities: ["voice", "analytics"],
  },
  {
    route: "/integrations",
    label: "Integrations",
    layer: "services",
    pillar: "operate",
    coreDomains: ["security", "runtime"],
    lifecycle: ["configure", "operate"],
    capabilities: ["crm_access", "email", "calendar"],
  },
  {
    route: "/resources",
    label: "Resources",
    layer: "services",
    pillar: "manage",
    coreDomains: ["workspace", "observability"],
    lifecycle: ["operate", "monitor"],
    capabilities: ["analytics"],
  },
  {
    route: "/billing",
    label: "Billing",
    layer: "services",
    pillar: "manage",
    coreDomains: ["workspace", "observability"],
    lifecycle: ["operate", "monitor"],
    capabilities: ["analytics"],
  },
  {
    route: "/developer",
    label: "Developer",
    layer: "services",
    pillar: "build",
    coreDomains: ["security", "runtime"],
    lifecycle: ["build", "deploy"],
    capabilities: [],
  },
  {
    route: "/marketplace",
    label: "Marketplace",
    layer: "business",
    pillar: "manage",
    coreDomains: ["workspace"],
    lifecycle: ["build", "improve", "replace"],
    capabilities: [],
  },
  {
    route: "/administration",
    label: "Administration",
    layer: "core",
    pillar: "manage",
    coreDomains: ["security", "workspace", "observability"],
    lifecycle: ["operate", "monitor"],
    capabilities: [],
  },
  {
    route: "/settings",
    label: "Settings",
    layer: "core",
    pillar: "manage",
    coreDomains: ["workspace", "security"],
    lifecycle: ["configure"],
    capabilities: [],
  },
];

export const modulesByLayer = (layer: PlatformLayer) =>
  MODULE_MAP.filter((module) => module.layer === layer);

export const modulesByPillar = (pillar: Pillar) =>
  MODULE_MAP.filter((module) => module.pillar === pillar);

export const modulesByLifecycle = (stage: LifecycleStage) =>
  MODULE_MAP.filter((module) => module.lifecycle.includes(stage));
