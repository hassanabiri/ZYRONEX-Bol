import type { WorkflowGraph } from "@/lib/execution/graph";

/**
 * Client-safe contracts for the Execution Runtime.
 * The runtime itself lives on the server (`engine.server.ts`); this module only
 * describes the request/response shapes so components can stay type-safe.
 */
export type RuntimeRequest = {
  workspaceId: string;
  workflowId: string;
  workflowVersion: number;
  workflowName: string;
  graph: WorkflowGraph;
  workerId?: string | null;
  workerName?: string | null;
  actorId?: string | null;
  priority?: number;
  maxAttempts?: number;
  timeoutSeconds?: number;
  concurrencyLimit?: number;
  trigger?: string;
  /** Optional caller-supplied key; identical keys never create a second run. */
  idempotencyKey?: string;
};

/** Payload persisted in `executions.input` so the server can replay the run. */
export type ExecutionPayload = {
  graph: WorkflowGraph;
  workflowName: string;
  workerName?: string | null;
  concurrencyLimit?: number;
};

export type DispatchReport = {
  claimed: number;
  completed: number;
  failed: number;
  cancelled: number;
  reaped: number;
  leaseOwner: string;
};
