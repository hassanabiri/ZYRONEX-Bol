/**
 * Developer-ready architecture contracts.
 *
 * Nothing here is wired to a transport yet — this file documents the stable
 * surface the Execution Engine will expose to the SDK, REST API, GraphQL
 * gateway, CLI, marketplace and plugin system so future sprints only add
 * adapters, never redesign the core.
 */

export type EngineResource = "workflow" | "worker" | "execution" | "activity" | "queue";

export type EngineOperation =
  | "list"
  | "get"
  | "create"
  | "update"
  | "delete"
  | "publish"
  | "run"
  | "cancel"
  | "validate";

export type EngineContract = {
  resource: EngineResource;
  operations: EngineOperation[];
  /** Permission key required, checked against workspace RBAC. */
  permission: string;
  /** Planned REST path once the HTTP adapter ships. */
  restPath: string;
};

export const ENGINE_CONTRACTS: EngineContract[] = [
  { resource: "workflow", operations: ["list", "get", "create", "update", "delete", "publish", "validate"], permission: "workflow.manage", restPath: "/api/v1/workflows" },
  { resource: "worker", operations: ["list", "get", "create", "update", "delete"], permission: "agents.manage", restPath: "/api/v1/workers" },
  { resource: "execution", operations: ["list", "get", "run", "cancel"], permission: "workflow.execute", restPath: "/api/v1/executions" },
  { resource: "queue", operations: ["list", "cancel"], permission: "workflow.execute", restPath: "/api/v1/queue" },
  { resource: "activity", operations: ["list"], permission: "workspace.audit", restPath: "/api/v1/activity" },
];

export type EngineChannel = "sdk" | "rest" | "graphql" | "cli" | "webhooks" | "plugins" | "marketplace";

export const ENGINE_CHANNELS: { channel: EngineChannel; label: string; description: string; status: "planned" }[] = [
  { channel: "sdk", label: "TypeScript SDK", description: "Typed client generated from the engine contracts.", status: "planned" },
  { channel: "rest", label: "REST API", description: "Versioned HTTP surface under /api/v1 with workspace-scoped keys.", status: "planned" },
  { channel: "graphql", label: "GraphQL", description: "Single endpoint over the same resolvers used by the SDK.", status: "planned" },
  { channel: "cli", label: "CLI", description: "Import, export, validate and run workflows from CI.", status: "planned" },
  { channel: "webhooks", label: "Webhooks", description: "Signed execution lifecycle events for external systems.", status: "planned" },
  { channel: "plugins", label: "Plugin system", description: "Third-party node handlers registered into the runtime registry.", status: "planned" },
  { channel: "marketplace", label: "Marketplace", description: "Shareable workflow and worker templates.", status: "planned" },
];

/** Lifecycle events the webhook adapter will emit. */
export const ENGINE_EVENTS = [
  "execution.queued",
  "execution.started",
  "execution.completed",
  "execution.failed",
  "execution.cancelled",
  "workflow.published",
  "workflow.updated",
] as const;
