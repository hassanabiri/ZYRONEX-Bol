import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Public RPC surface of the Server Execution Runtime.
 * Every entry point is authenticated; workspace isolation and RBAC are
 * enforced through the caller's own RLS view before any privileged work runs.
 */

const graphSchema = z.object({
  nodes: z.array(z.record(z.string(), z.unknown())),
  edges: z.array(z.record(z.string(), z.unknown())),
});

const startInput = z.object({
  workspaceId: z.string().uuid(),
  workflowId: z.string().uuid(),
  workflowVersion: z.number().int().min(1),
  workflowName: z.string().min(1).max(200),
  graph: graphSchema,
  workerId: z.string().uuid().nullable().default(null),
  workerName: z.string().max(200).nullable().default(null),
  priority: z.number().int().min(1).max(10).default(5),
  maxAttempts: z.number().int().min(1).max(10).default(1),
  timeoutSeconds: z.number().int().min(5).max(1800).default(300),
  concurrencyLimit: z.number().int().min(1).max(20).default(1),
  trigger: z.string().max(40).default("manual"),
  idempotencyKey: z.string().max(120).nullable().default(null),
});

export const startExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => startInput.parse(data))
  .handler(async ({ data, context }) => {
    const { assertCanExecute } = await import("@/lib/execution/guard.server");
    await assertCanExecute(context.supabase, data.workspaceId, context.userId);

    const { enqueueExecution } = await import("@/lib/execution/engine.server");
    const execution = await enqueueExecution({
      workspaceId: data.workspaceId,
      workflowId: data.workflowId,
      workflowVersion: data.workflowVersion,
      workflowName: data.workflowName,
      graph: data.graph as never,
      workerId: data.workerId,
      workerName: data.workerName,
      actorId: context.userId,
      priority: data.priority,
      maxAttempts: data.maxAttempts,
      timeoutSeconds: data.timeoutSeconds,
      concurrencyLimit: data.concurrencyLimit,
      trigger: data.trigger,
      ...(data.idempotencyKey ? { idempotencyKey: data.idempotencyKey } : {}),
    });

    return { id: execution.id, status: execution.status, traceId: execution.trace_id ?? null };
  });

export const cancelExecution = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ workspaceId: z.string().uuid(), executionId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { assertCanExecute, assertExecutionInWorkspace } = await import(
      "@/lib/execution/guard.server"
    );
    await assertCanExecute(context.supabase, data.workspaceId, context.userId);
    await assertExecutionInWorkspace(context.supabase, data.executionId, data.workspaceId);

    const { requestCancel } = await import("@/lib/execution/engine.server");
    return requestCancel(data.executionId);
  });

/**
 * Drives the queue. Called by the app while runs are in flight; a scheduled
 * trigger takes over in the dispatcher phase. Only workspace members can tick
 * the queue, and the tick itself is workspace-agnostic and side-effect safe.
 */
export const dispatchQueue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        max: z.number().int().min(1).max(5).default(3),
        budgetMs: z.number().int().min(1000).max(25000).default(15000),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { assertCanExecute } = await import("@/lib/execution/guard.server");
    await assertCanExecute(context.supabase, data.workspaceId, context.userId);

    const { dispatchExecutions } = await import("@/lib/execution/engine.server");
    return dispatchExecutions({ max: data.max, budgetMs: data.budgetMs });
  });
