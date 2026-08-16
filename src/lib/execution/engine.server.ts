import { randomUUID } from "node:crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import type { DispatchReport, ExecutionPayload, RuntimeRequest } from "@/lib/execution/contracts";
import { topologicalOrder, type WorkflowNode } from "@/lib/execution/graph";
import { validateWorkflow } from "@/lib/execution/validation";

/**
 * Server Execution Runtime.
 *
 * Every workflow run is created, leased, executed, retried and finalised here —
 * on the server, never in the browser. State lives entirely in Postgres so a
 * run survives page reloads, and a lease guarantees exactly one worker touches
 * an execution at a time.
 *
 * Node handlers are pluggable (`registerNodeHandler`). No connector, OAuth or
 * webhook transport is wired yet — that is a later phase. Credentials are never
 * read here and never cross the RPC boundary.
 */

type ExecutionRow = Database["public"]["Tables"]["executions"]["Row"] & {
  trace_id?: string | null;
  lease_owner?: string | null;
  cancel_requested?: boolean | null;
};

export type NodeHandler = (context: {
  node: WorkflowNode;
  variables: Record<string, unknown>;
  signal: AbortSignal;
  traceId: string;
  workspaceId: string;
}) => Promise<{ output?: Record<string, unknown>; warning?: string }>;

const handlers = new Map<string, NodeHandler>();

/** Extension point for the connector phase (HTTP, integrations, AI providers…). */
export function registerNodeHandler(kind: string, handler: NodeHandler) {
  handlers.set(kind, handler);
}

const MAX_STEP_BACKOFF_MS = 8_000;
const DEFAULT_LEASE_SECONDS = 120;

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new Error("cancelled"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("cancelled"));
      },
      { once: true },
    );
  });
}

/** Exponential backoff with jitter, capped so a lease is never starved. */
function backoffMs(attempt: number) {
  const base = Math.min(MAX_STEP_BACKOFF_MS, 400 * 2 ** (attempt - 1));
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/** Deterministic orchestration step used until real handlers are registered. */
const defaultHandler: NodeHandler = async ({ node, signal }) => {
  if (node.kind === "delay") {
    const seconds = Number(node.params?.["seconds"] ?? 0);
    await wait(Math.min(Math.max(seconds, 0), 30) * 1000, signal);
    return {};
  }
  if (node.kind === "human_approval")
    return { warning: `"${node.label}" auto-continued: human approval is not wired yet.` };
  if (node.kind === "future")
    return { warning: `"${node.label}" is a reserved node and was skipped.` };
  await wait(120, signal);
  return {};
};

const db = () => supabaseAdmin as unknown as ReturnType<typeof supabaseAdmin.from> extends never ? never : typeof supabaseAdmin;

async function logActivity(
  workspaceId: string,
  row: Record<string, unknown>,
) {
  await supabaseAdmin
    .from("activity_log")
    .insert({ workspace_id: workspaceId, ...row } as never)
    .then(() => undefined, () => undefined);
}

/* ------------------------------------------------------------------ enqueue */

export async function enqueueExecution(request: RuntimeRequest): Promise<ExecutionRow> {
  const report = validateWorkflow(request.graph);
  if (!report.valid) throw new Error(report.errors[0]?.message ?? "Workflow validation failed");

  const order = topologicalOrder(request.graph);
  if (!order) throw new Error("Workflow contains a circular reference");

  // Idempotency: the same key never produces a second run for a workspace.
  if (request.idempotencyKey) {
    const { data: existing } = await supabaseAdmin
      .from("executions")
      .select("*")
      .eq("workspace_id", request.workspaceId)
      .eq("idempotency_key", request.idempotencyKey)
      .maybeSingle();
    if (existing) return existing as ExecutionRow;
  }

  const traceId = randomUUID();
  const payload: ExecutionPayload = {
    graph: request.graph,
    workflowName: request.workflowName,
    workerName: request.workerName ?? null,
    concurrencyLimit: request.concurrencyLimit ?? 1,
  };

  const insert = {
    workspace_id: request.workspaceId,
    workflow_id: request.workflowId,
    workflow_version: request.workflowVersion,
    worker_id: request.workerId ?? null,
    status: "queued" as const,
    priority: request.priority ?? 5,
    max_attempts: Math.max(1, request.maxAttempts ?? 1),
    timeout_seconds: request.timeoutSeconds ?? 300,
    trigger: request.trigger ?? "manual",
    created_by: request.actorId ?? null,
    input: payload as never,
    trace_id: traceId,
    idempotency_key: request.idempotencyKey ?? null,
    next_run_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("executions")
    .insert(insert as never)
    .select("*")
    .single();

  if (error) {
    // Unique violation on the idempotency key: return the winning row.
    if (error.code === "23505" && request.idempotencyKey) {
      const { data: existing } = await supabaseAdmin
        .from("executions")
        .select("*")
        .eq("workspace_id", request.workspaceId)
        .eq("idempotency_key", request.idempotencyKey)
        .maybeSingle();
      if (existing) return existing as ExecutionRow;
    }
    throw error;
  }

  const execution = data as ExecutionRow;

  await supabaseAdmin.from("execution_steps").insert(
    order.map((node, index) => ({
      execution_id: execution.id,
      workspace_id: request.workspaceId,
      node_id: node.id,
      node_type: String(node.kind),
      label: node.label,
      seq: index,
      status: "waiting" as const,
      trace_id: traceId,
    })) as never,
  );

  await logActivity(request.workspaceId, {
    actor_id: request.actorId ?? null,
    workflow_id: request.workflowId,
    worker_id: request.workerId ?? null,
    execution_id: execution.id,
    entity_type: "execution",
    entity_id: execution.id,
    action: "execution.queued",
    detail: `Execution queued · trace ${traceId}`,
  });

  return execution;
}

/* ----------------------------------------------------------------- cancel */

export async function requestCancel(executionId: string) {
  const { data, error } = await supabaseAdmin
    .from("executions")
    .select("id, status, workspace_id")
    .eq("id", executionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Execution not found");
  if (["completed", "failed", "cancelled"].includes(data.status)) return { ok: true, already: true };

  if (data.status === "queued" || data.status === "waiting") {
    await supabaseAdmin
      .from("executions")
      .update({
        status: "cancelled",
        error: "Cancelled before start",
        cancel_requested: true,
        finished_at: new Date().toISOString(),
      } as never)
      .eq("id", executionId)
      .in("status", ["queued", "waiting"]);
    return { ok: true, already: false };
  }

  // Running: the worker observes the flag between steps and stops cleanly.
  await supabaseAdmin
    .from("executions")
    .update({ cancel_requested: true } as never)
    .eq("id", executionId);
  return { ok: true, already: false };
}

/* --------------------------------------------------------------- dispatcher */

export async function dispatchExecutions(options: {
  leaseOwner?: string;
  max?: number;
  budgetMs?: number;
} = {}): Promise<DispatchReport> {
  const leaseOwner = options.leaseOwner ?? `worker-${randomUUID().slice(0, 8)}`;
  const budgetMs = Math.min(Math.max(options.budgetMs ?? 20_000, 1_000), 25_000);
  const deadline = Date.now() + budgetMs;

  const { data: reaped } = await supabaseAdmin.rpc("reap_stale_executions" as never);

  const { data: claimed, error } = await supabaseAdmin.rpc("claim_executions" as never, {
    _lease_owner: leaseOwner,
    _lease_seconds: DEFAULT_LEASE_SECONDS,
    _limit: Math.min(Math.max(options.max ?? 3, 1), 10),
  } as never);
  if (error) throw error;

  const rows = (claimed ?? []) as unknown as ExecutionRow[];
  const report: DispatchReport = {
    claimed: rows.length,
    completed: 0,
    failed: 0,
    cancelled: 0,
    reaped: Number(reaped ?? 0),
    leaseOwner,
  };

  for (const row of rows) {
    if (Date.now() > deadline) {
      // Out of budget: hand the run back to the queue untouched.
      await supabaseAdmin
        .from("executions")
        .update({ status: "queued", lease_owner: null, lease_expires_at: null } as never)
        .eq("id", row.id);
      report.claimed -= 1;
      continue;
    }
    const status = await runExecution(row, leaseOwner, deadline);
    if (status === "completed") report.completed += 1;
    else if (status === "cancelled") report.cancelled += 1;
    else report.failed += 1;
  }

  return report;
}

/* ------------------------------------------------------------------- runner */

async function isCancelRequested(executionId: string) {
  const { data } = await supabaseAdmin
    .from("executions")
    .select("cancel_requested")
    .eq("id", executionId)
    .maybeSingle();
  return Boolean((data as { cancel_requested?: boolean } | null)?.cancel_requested);
}

async function renewLease(executionId: string, leaseOwner: string) {
  await supabaseAdmin
    .from("executions")
    .update({
      lease_expires_at: new Date(Date.now() + DEFAULT_LEASE_SECONDS * 1000).toISOString(),
    } as never)
    .eq("id", executionId)
    .eq("lease_owner", leaseOwner);
}

async function runExecution(
  execution: ExecutionRow,
  leaseOwner: string,
  dispatchDeadline: number,
): Promise<"completed" | "failed" | "cancelled"> {
  const traceId = execution.trace_id ?? execution.id;
  const payload = (execution.input ?? {}) as unknown as ExecutionPayload;
  const startedAt = Date.now();
  const warnings: string[] = [];
  const variables: Record<string, unknown> = {};
  const maxAttempts = Math.max(1, execution.max_attempts ?? 1);
  const controller = new AbortController();

  const timeoutMs = (execution.timeout_seconds ?? 300) * 1000;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    if (!payload.graph) throw new Error("Execution payload is missing its workflow graph");
    const order = topologicalOrder(payload.graph);
    if (!order) throw new Error("Workflow contains a circular reference");

    const { data: stepRows } = await supabaseAdmin
      .from("execution_steps")
      .select("*")
      .eq("execution_id", execution.id);
    const byNode = new Map((stepRows ?? []).map((step) => [step.node_id, step]));

    for (const [index, node] of order.entries()) {
      if (await isCancelRequested(execution.id)) throw new Error("cancelled");
      if (controller.signal.aborted) throw new Error(timedOut ? "timeout" : "cancelled");
      if (Date.now() > dispatchDeadline) throw new Error("budget");

      await renewLease(execution.id, leaseOwner);

      const step = byNode.get(node.id);
      const handler = handlers.get(String(node.kind)) ?? defaultHandler;
      const stepStart = Date.now();
      if (step)
        await supabaseAdmin
          .from("execution_steps")
          .update({ status: "running", started_at: new Date().toISOString(), trace_id: traceId } as never)
          .eq("id", step.id);

      let attempt = 1;
      for (;;) {
        try {
          const result = await handler({
            node,
            variables,
            signal: controller.signal,
            traceId,
            workspaceId: execution.workspace_id,
          });
          if (result.warning) warnings.push(result.warning);
          if (step)
            await supabaseAdmin
              .from("execution_steps")
              .update({
                status: "completed",
                attempt,
                finished_at: new Date().toISOString(),
                duration_ms: Date.now() - stepStart,
                output: (result.output ?? {}) as never,
              } as never)
              .eq("id", step.id);
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (controller.signal.aborted) throw new Error(timedOut ? "timeout" : "cancelled");
          if (attempt >= maxAttempts) {
            if (step)
              await supabaseAdmin
                .from("execution_steps")
                .update({
                  status: "failed",
                  attempt,
                  finished_at: new Date().toISOString(),
                  duration_ms: Date.now() - stepStart,
                  error: message,
                } as never)
                .eq("id", step.id);
            throw error;
          }
          attempt += 1;
          await supabaseAdmin
            .from("executions")
            .update({ status: "retrying", attempt } as never)
            .eq("id", execution.id);
          if (step)
            await supabaseAdmin
              .from("execution_steps")
              .update({ status: "retrying", attempt } as never)
              .eq("id", step.id);
          await wait(backoffMs(attempt - 1), controller.signal);
          await renewLease(execution.id, leaseOwner);
          await supabaseAdmin
            .from("executions")
            .update({ status: "running" } as never)
            .eq("id", execution.id);
        }
      }

      await supabaseAdmin
        .from("executions")
        .update({
          progress: Math.round(((index + 1) / Math.max(1, order.length)) * 100),
          warnings,
        } as never)
        .eq("id", execution.id);
    }

    clearTimeout(timer);
    await finish(execution, traceId, "completed", null, Date.now() - startedAt, warnings);
    return "completed";
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : String(error);

    if (message === "budget") {
      // Not a failure: release the lease and let the next dispatch resume it.
      await supabaseAdmin
        .from("executions")
        .update({
          status: "queued",
          lease_owner: null,
          lease_expires_at: null,
          next_run_at: new Date().toISOString(),
          warnings,
        } as never)
        .eq("id", execution.id);
      return "failed";
    }

    const cancelled = message === "cancelled" || (await isCancelRequested(execution.id));
    const status = cancelled ? "cancelled" : "failed";
    await finish(
      execution,
      traceId,
      status,
      cancelled ? "Cancelled by user" : timedOut ? "Execution timed out" : message,
      Date.now() - startedAt,
      warnings,
    );
    return cancelled ? "cancelled" : "failed";
  }
}

async function finish(
  execution: ExecutionRow,
  traceId: string,
  status: "completed" | "failed" | "cancelled",
  error: string | null,
  durationMs: number,
  warnings: string[],
) {
  await supabaseAdmin
    .from("executions")
    .update({
      status,
      error,
      warnings,
      finished_at: new Date().toISOString(),
      duration_ms: durationMs,
      lease_owner: null,
      lease_expires_at: null,
      ...(status === "completed" ? { progress: 100 } : {}),
    } as never)
    .eq("id", execution.id)
    .then(() => undefined, () => undefined);

  await supabaseAdmin
    .from("execution_steps")
    .update({ status: "cancelled" } as never)
    .eq("execution_id", execution.id)
    .in("status", ["waiting", "running", "retrying"])
    .then(() => undefined, () => undefined);

  await logActivity(execution.workspace_id, {
    actor_id: execution.created_by ?? null,
    workflow_id: execution.workflow_id ?? null,
    worker_id: execution.worker_id ?? null,
    execution_id: execution.id,
    entity_type: "execution",
    entity_id: execution.id,
    action: `execution.${status}`,
    result: status === "completed" ? "success" : status,
    detail: `${error ?? `Execution ${status}`} · trace ${traceId}`,
  });
}

export const __internal = { backoffMs, defaultHandler, db };
