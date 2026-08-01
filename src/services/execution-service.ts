import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

import { activityService } from "./activity-service";

export type Execution = Tables<"executions">;
export type ExecutionStep = Tables<"execution_steps">;
export type ExecutionStatus = Execution["status"];
export type ExecutionInsert = Omit<TablesInsert<"executions">, "workspace_id">;
export type ExecutionPatch = TablesUpdate<"executions">;

export const EXECUTION_STATUSES: ExecutionStatus[] = [
  "waiting",
  "queued",
  "running",
  "retrying",
  "completed",
  "failed",
  "cancelled",
];

export const TERMINAL_STATUSES: ExecutionStatus[] = ["completed", "failed", "cancelled"];

export type ExecutionMetrics = {
  total: number;
  running: number;
  queued: number;
  completed: number;
  failed: number;
  cancelled: number;
  retries: number;
  averageDurationMs: number;
  successRate: number;
  failureRate: number;
};

export const executionService = {
  async list(workspaceId: string, limit = 200): Promise<Execution[]> {
    const { data, error } = await supabase
      .from("executions")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  async get(executionId: string): Promise<Execution | null> {
    const { data, error } = await supabase.from("executions").select("*").eq("id", executionId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(workspaceId: string, input: ExecutionInsert): Promise<Execution> {
    const { data, error } = await supabase
      .from("executions")
      .insert({ ...input, workspace_id: workspaceId })
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(workspaceId, {
      actor_id: input.created_by ?? null,
      workflow_id: input.workflow_id ?? null,
      worker_id: input.worker_id ?? null,
      execution_id: data.id,
      entity_type: "execution",
      entity_id: data.id,
      action: "execution.queued",
      detail: "Execution queued",
    });
    return data;
  },

  async update(executionId: string, patch: ExecutionPatch): Promise<Execution> {
    const { data, error } = await supabase
      .from("executions")
      .update(patch)
      .eq("id", executionId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async listSteps(executionId: string): Promise<ExecutionStep[]> {
    const { data, error } = await supabase
      .from("execution_steps")
      .select("*")
      .eq("execution_id", executionId)
      .order("seq", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async createSteps(rows: TablesInsert<"execution_steps">[]): Promise<ExecutionStep[]> {
    if (!rows.length) return [];
    const { data, error } = await supabase.from("execution_steps").insert(rows).select("*");
    if (error) throw error;
    return data ?? [];
  },

  async updateStep(stepId: string, patch: TablesUpdate<"execution_steps">) {
    const { error } = await supabase.from("execution_steps").update(patch).eq("id", stepId);
    if (error) throw error;
  },
};

export function computeMetrics(executions: Execution[]): ExecutionMetrics {
  const total = executions.length;
  const by = (status: ExecutionStatus) => executions.filter((item) => item.status === status).length;
  const completed = by("completed");
  const failed = by("failed");
  const finished = executions.filter((item) => item.duration_ms != null);
  const averageDurationMs = finished.length
    ? Math.round(finished.reduce((sum, item) => sum + (item.duration_ms ?? 0), 0) / finished.length)
    : 0;
  const resolved = completed + failed;
  return {
    total,
    running: by("running") + by("retrying"),
    queued: by("queued") + by("waiting"),
    completed,
    failed,
    cancelled: by("cancelled"),
    retries: executions.reduce((sum, item) => sum + Math.max(0, item.attempt - 1), 0),
    averageDurationMs,
    successRate: resolved ? Math.round((completed / resolved) * 100) : 0,
    failureRate: resolved ? Math.round((failed / resolved) * 100) : 0,
  };
}

export function formatDuration(ms: number | null | undefined) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
