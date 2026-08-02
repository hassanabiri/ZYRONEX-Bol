import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

import { emptyGraph, parseGraph, type WorkflowGraph } from "@/lib/execution/graph";
import { activityService } from "./activity-service";

export type Workflow = Tables<"workflows">;
export type WorkflowVersion = Tables<"workflow_versions">;
export type WorkflowWorker = Tables<"workflow_workers">;
export type WorkflowInsert = Omit<TablesInsert<"workflows">, "workspace_id" | "created_by">;
export type WorkflowPatch = TablesUpdate<"workflows">;

export type WorkflowDefinition = {
  name: string;
  description: string | null;
  tags: string[];
  graph: WorkflowGraph;
};

export function toDefinition(workflow: Workflow): WorkflowDefinition {
  return {
    name: workflow.name,
    description: workflow.description,
    tags: workflow.tags ?? [],
    graph: parseGraph(workflow.graph),
  };
}

export const workflowService = {
  async list(workspaceId: string): Promise<Workflow[]> {
    const { data, error } = await supabase
      .from("workflows")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async get(workflowId: string): Promise<Workflow | null> {
    const { data, error } = await supabase.from("workflows").select("*").eq("id", workflowId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async create(workspaceId: string, input: WorkflowInsert, actorId?: string): Promise<Workflow> {
    const { data, error } = await supabase
      .from("workflows")
      .insert({
        graph: emptyGraph() as never,
        ...input,
        workspace_id: workspaceId,
        created_by: actorId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(workspaceId, {
      actor_id: actorId ?? null,
      workflow_id: data.id,
      entity_type: "workflow",
      entity_id: data.id,
      action: "workflow.created",
      detail: `Workflow "${data.name}" created`,
    });
    return data;
  },

  async update(workflowId: string, patch: WorkflowPatch, actorId?: string): Promise<Workflow> {
    const { data, error } = await supabase
      .from("workflows")
      .update(patch)
      .eq("id", workflowId)
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(data.workspace_id, {
      actor_id: actorId ?? null,
      workflow_id: data.id,
      entity_type: "workflow",
      entity_id: data.id,
      action: patch.status ? `workflow.${patch.status}` : "workflow.updated",
      detail: `Workflow "${data.name}" updated`,
    });
    return data;
  },

  /** Auto-save path: no audit entry, keeps the log readable. */
  async saveGraph(workflowId: string, graph: WorkflowGraph): Promise<Workflow> {
    const { data, error } = await supabase
      .from("workflows")
      .update({ graph: graph as never })
      .eq("id", workflowId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async remove(workflow: Workflow, actorId?: string) {
    const { error } = await supabase.from("workflows").delete().eq("id", workflow.id);
    if (error) throw error;
    await activityService.log(workflow.workspace_id, {
      actor_id: actorId ?? null,
      entity_type: "workflow",
      entity_id: workflow.id,
      action: "workflow.deleted",
      detail: `Workflow "${workflow.name}" deleted`,
    });
  },

  async duplicate(workflow: Workflow, actorId?: string): Promise<Workflow> {
    const definition = toDefinition(workflow);
    return workflowService.create(
      workflow.workspace_id,
      {
        name: `${definition.name} (copy)`,
        description: definition.description,
        tags: definition.tags,
        graph: definition.graph as never,
        status: "draft",
      },
      actorId,
    );
  },

  async importDefinition(
    workspaceId: string,
    definition: Partial<WorkflowDefinition> & { name: string },
    actorId?: string,
  ): Promise<Workflow> {
    return workflowService.create(
      workspaceId,
      {
        name: definition.name,
        description: definition.description ?? null,
        tags: definition.tags ?? [],
        graph: parseGraph(definition.graph) as never,
        status: "draft",
      },
      actorId,
    );
  },

  async publish(workflow: Workflow, actorId?: string): Promise<Workflow> {
    const version = workflow.version + 1;
    await workflowService.snapshot(workflow, actorId, `Published v${version}`, version);
    return workflowService.update(
      workflow.id,
      { status: "published", version, published_at: new Date().toISOString() },
      actorId,
    );
  },

  // Versions -------------------------------------------------------------
  async listVersions(workflowId: string): Promise<WorkflowVersion[]> {
    const { data, error } = await supabase
      .from("workflow_versions")
      .select("*")
      .eq("workflow_id", workflowId)
      .order("version", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async snapshot(workflow: Workflow, actorId?: string, label?: string, version?: number) {
    const versions = await workflowService.listVersions(workflow.id).catch(() => []);
    const next = version ?? (versions[0]?.version ?? 0) + 1;
    const { error } = await supabase.from("workflow_versions").insert({
      workflow_id: workflow.id,
      workspace_id: workflow.workspace_id,
      version: next,
      label: label ?? `Version ${next}`,
      snapshot: JSON.parse(JSON.stringify(toDefinition(workflow))),
      created_by: actorId ?? null,
    });
    if (error) throw error;
  },

  async restoreVersion(workflow: Workflow, version: WorkflowVersion, actorId?: string): Promise<Workflow> {
    const snapshot = version.snapshot as unknown as Partial<WorkflowDefinition>;
    await workflowService.snapshot(workflow, actorId, `Before rollback to v${version.version}`);
    return workflowService.update(
      workflow.id,
      {
        name: snapshot.name ?? workflow.name,
        description: snapshot.description ?? workflow.description,
        tags: snapshot.tags ?? workflow.tags,
        graph: parseGraph(snapshot.graph) as never,
      },
      actorId,
    );
  },

  // Assigned workers -----------------------------------------------------
  async listWorkers(workflowId: string): Promise<WorkflowWorker[]> {
    const { data, error } = await supabase.from("workflow_workers").select("*").eq("workflow_id", workflowId);
    if (error) throw error;
    return data ?? [];
  },

  async assignWorker(workflow: Workflow, workerId: string) {
    const { error } = await supabase.from("workflow_workers").insert({
      workflow_id: workflow.id,
      worker_id: workerId,
      workspace_id: workflow.workspace_id,
    });
    if (error) throw error;
  },

  async unassignWorker(workflowId: string, workerId: string) {
    const { error } = await supabase
      .from("workflow_workers")
      .delete()
      .eq("workflow_id", workflowId)
      .eq("worker_id", workerId);
    if (error) throw error;
  },
};
