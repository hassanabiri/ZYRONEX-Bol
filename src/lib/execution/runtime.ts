import { topologicalOrder, type WorkflowGraph, type WorkflowNode } from "@/lib/execution/graph";
import { validateWorkflow } from "@/lib/execution/validation";
import { activityService } from "@/services/activity-service";
import { executionService, type Execution } from "@/services/execution-service";

/**
 * Execution Runtime — the single entry point for running an AI Worker.
 * Nothing in the product may execute a worker directly; every run is created,
 * queued, scheduled, retried and tracked here.
 *
 * The engine is provider-agnostic: node handlers are registered, and the
 * default handlers only orchestrate + record state (no AI provider is called
 * yet). Sprint 007 plugs real handlers into the same registry.
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
};

export type NodeHandler = (context: {
  node: WorkflowNode;
  variables: Record<string, unknown>;
  signal: AbortSignal;
}) => Promise<{ output?: Record<string, unknown>; warning?: string }>;

const handlers = new Map<string, NodeHandler>();

/** Extension point for Sprint 007 (AI providers, HTTP, integrations…). */
export function registerNodeHandler(kind: string, handler: NodeHandler) {
  handlers.set(kind, handler);
}

function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
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

/** Deterministic orchestration step used until real handlers are registered. */
const defaultHandler: NodeHandler = async ({ node, signal }) => {
  if (node.kind === "delay") {
    const seconds = Number(node.params?.seconds ?? 0);
    await wait(Math.min(Math.max(seconds, 0), 30) * 1000, signal);
    return {};
  }
  if (node.kind === "human_approval")
    return { warning: `"${node.label}" auto-continued: human approval is not wired yet.` };
  if (node.kind === "future") return { warning: `"${node.label}" is a reserved node and was skipped.` };
  await wait(180, signal);
  return {};
};

type QueueItem = {
  execution: Execution;
  request: RuntimeRequest;
  controller: AbortController;
};

class ExecutionEngine {
  private queue: QueueItem[] = [];
  private running = new Map<string, QueueItem>();
  private listeners = new Set<() => void>();
  /** Global safety valve; per-worker limits are enforced on top of this. */
  maxConcurrent = 3;

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  get activeIds() {
    return [...this.running.keys()];
  }

  /** Validates, persists and queues a run. Throws when the workflow is invalid. */
  async start(request: RuntimeRequest): Promise<Execution> {
    const report = validateWorkflow(request.graph);
    if (!report.valid) throw new Error(report.errors[0]?.message ?? "Workflow validation failed");

    const order = topologicalOrder(request.graph);
    if (!order) throw new Error("Workflow contains a circular reference");

    const execution = await executionService.create(request.workspaceId, {
      workflow_id: request.workflowId,
      workflow_version: request.workflowVersion,
      worker_id: request.workerId ?? null,
      status: "queued",
      priority: request.priority ?? 5,
      max_attempts: Math.max(1, request.maxAttempts ?? 1),
      timeout_seconds: request.timeoutSeconds ?? 300,
      trigger: request.trigger ?? "manual",
      created_by: request.actorId ?? null,
    });

    await executionService.createSteps(
      order.map((node, index) => ({
        execution_id: execution.id,
        workspace_id: request.workspaceId,
        node_id: node.id,
        node_type: String(node.kind),
        label: node.label,
        seq: index,
        status: "waiting" as const,
      })),
    );

    this.queue.push({ execution, request, controller: new AbortController() });
    this.emit();
    void this.drain();
    return execution;
  }

  cancel(executionId: string) {
    const active = this.running.get(executionId);
    if (active) {
      active.controller.abort();
      return true;
    }
    const index = this.queue.findIndex((item) => item.execution.id === executionId);
    if (index >= 0) {
      const [item] = this.queue.splice(index, 1);
      void this.finish(item, "cancelled", "Cancelled before start");
      return true;
    }
    return false;
  }

  private workerLoad(workerId: string | null | undefined) {
    if (!workerId) return 0;
    return [...this.running.values()].filter((item) => item.request.workerId === workerId).length;
  }

  private async drain() {
    while (this.running.size < this.maxConcurrent) {
      // Priority queue: highest priority first, then FIFO.
      this.queue.sort((a, b) => b.execution.priority - a.execution.priority);
      const next = this.queue.find(
        (item) => this.workerLoad(item.request.workerId) < Math.max(1, item.request.concurrencyLimit ?? 1),
      );
      if (!next) return;
      this.queue.splice(this.queue.indexOf(next), 1);
      this.running.set(next.execution.id, next);
      this.emit();
      void this.run(next).finally(() => {
        this.running.delete(next.execution.id);
        this.emit();
        void this.drain();
      });
    }
  }

  private async run(item: QueueItem) {
    const { request, controller } = item;
    const startedAt = Date.now();
    const warnings: string[] = [];
    const variables: Record<string, unknown> = {};
    const maxAttempts = Math.max(1, request.maxAttempts ?? 1);

    const timeout = setTimeout(() => controller.abort(), (request.timeoutSeconds ?? 300) * 1000);
    let timedOut = false;
    controller.signal.addEventListener("abort", () => {
      timedOut = Date.now() - startedAt >= (request.timeoutSeconds ?? 300) * 1000;
    });

    try {
      await executionService.update(item.execution.id, {
        status: "running",
        started_at: new Date().toISOString(),
      });
      this.emit();

      const steps = await executionService.listSteps(item.execution.id);
      const byNode = new Map(steps.map((step) => [step.node_id, step]));
      const order = topologicalOrder(request.graph) ?? [];

      for (const [index, node] of order.entries()) {
        if (controller.signal.aborted) throw new Error(timedOut ? "timeout" : "cancelled");
        const step = byNode.get(node.id);
        const handler = handlers.get(String(node.kind)) ?? defaultHandler;
        const stepStart = Date.now();
        if (step)
          await executionService.updateStep(step.id, {
            status: "running",
            started_at: new Date().toISOString(),
          });
        this.emit();

        let attempt = 1;
        for (;;) {
          try {
            const result = await handler({ node, variables, signal: controller.signal });
            if (result.warning) warnings.push(result.warning);
            if (step)
              await executionService.updateStep(step.id, {
                status: "completed",
                attempt,
                finished_at: new Date().toISOString(),
                duration_ms: Date.now() - stepStart,
                output: (result.output ?? {}) as never,
              });
            break;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (controller.signal.aborted) throw new Error(timedOut ? "timeout" : "cancelled");
            if (attempt >= maxAttempts) {
              if (step)
                await executionService.updateStep(step.id, {
                  status: "failed",
                  attempt,
                  finished_at: new Date().toISOString(),
                  duration_ms: Date.now() - stepStart,
                  error: message,
                });
              throw error;
            }
            attempt += 1;
            await executionService.update(item.execution.id, { status: "retrying", attempt });
            if (step) await executionService.updateStep(step.id, { status: "retrying", attempt });
            this.emit();
            await wait(300, controller.signal);
            await executionService.update(item.execution.id, { status: "running" });
          }
        }

        await executionService.update(item.execution.id, {
          progress: Math.round(((index + 1) / Math.max(1, order.length)) * 100),
          warnings,
        });
        this.emit();
      }

      clearTimeout(timeout);
      await this.finish(item, "completed", null, Date.now() - startedAt, warnings);
    } catch (error) {
      clearTimeout(timeout);
      const message = error instanceof Error ? error.message : String(error);
      const status = message === "cancelled" ? "cancelled" : "failed";
      await this.finish(
        item,
        status,
        status === "cancelled" ? "Cancelled by user" : timedOut ? "Execution timed out" : message,
        Date.now() - startedAt,
        warnings,
      );
    }
  }

  private async finish(
    item: QueueItem,
    status: Execution["status"],
    error: string | null,
    durationMs?: number,
    warnings: string[] = [],
  ) {
    await executionService
      .update(item.execution.id, {
        status,
        error,
        warnings,
        finished_at: new Date().toISOString(),
        duration_ms: durationMs ?? null,
        progress: status === "completed" ? 100 : undefined,
      })
      .catch(() => undefined);

    await activityService.log(item.request.workspaceId, {
      actor_id: item.request.actorId ?? null,
      workflow_id: item.request.workflowId,
      worker_id: item.request.workerId ?? null,
      execution_id: item.execution.id,
      entity_type: "execution",
      entity_id: item.execution.id,
      action: `execution.${status}`,
      result: status === "completed" ? "success" : status,
      detail: error ?? `Workflow "${item.request.workflowName}" ${status}`,
    });
    this.emit();
  }
}

export const executionEngine = new ExecutionEngine();
