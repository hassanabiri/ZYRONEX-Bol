import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download, History, Play, Redo2, Save, Undo2, Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { ActivityLog } from "@/components/execution/activity-log";
import { ExecutionQueue } from "@/components/execution/execution-queue";
import { NodeInspector } from "@/components/workflow/node-inspector";
import { NodePalette } from "@/components/workflow/node-palette";
import { ValidationReportPanel } from "@/components/workflow/validation-report";
import { WorkflowCanvas } from "@/components/workflow/workflow-canvas";
import { downloadWorkflow, workflowStatusVariant } from "@/components/workflow/workflows-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useActivityLog, useExecutions, useRuntime } from "@/hooks/use-executions";
import { useWorkers } from "@/hooks/use-workers";
import { useWorkflow, useWorkflowMutations, useWorkflowVersions, useWorkflowWorkers } from "@/hooks/use-workflows";
import { createNode, emptyGraph, parseGraph, type WorkflowGraph } from "@/lib/execution/graph";
import type { NodeKind } from "@/lib/execution/nodes";
import { validateWorkflow } from "@/lib/execution/validation";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/workflow/$workflowId")({
  head: () => ({
    meta: [
      { title: "Workflow Designer — ZYRONEX" },
      {
        name: "description",
        content: "Visual designer for a ZYRONEX workflow: nodes, validation, versions and runs.",
      },
      { property: "og:title", content: "Workflow Designer — ZYRONEX" },
      { property: "og:description", content: "Design, validate and run a ZYRONEX workflow." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WorkflowDesignerRoute,
});

function WorkflowDesignerRoute() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { workflowId } = Route.useParams();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;

  const { data: workflow, isLoading } = useWorkflow(workflowId);
  const { data: versions } = useWorkflowVersions(workflowId);
  const { data: assigned } = useWorkflowWorkers(workflowId);
  const { data: workers } = useWorkers(workspaceId);
  const { data: executions } = useExecutions(workspaceId);
  const { data: activity } = useActivityLog(workspaceId);
  const { startExecution, cancelExecution } = useRuntime(workspaceId);
  const {
    saveGraph,
    publishWorkflow,
    snapshotWorkflow,
    restoreVersion,
    assignWorker,
    unassignWorker,
  } = useWorkflowMutations(workspaceId);

  const [draft, setDraft] = useState<WorkflowGraph | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const history = useRef<{ past: WorkflowGraph[]; future: WorkflowGraph[] }>({ past: [], future: [] });
  const [, forceRender] = useState(0);

  const graph = draft ?? (workflow ? parseGraph(workflow.graph) : emptyGraph());
  const report = useMemo(() => validateWorkflow(graph), [graph]);
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;

  const commit = useCallback(
    (next: WorkflowGraph) => {
      history.current.past.push(graph);
      history.current.future = [];
      setDraft(next);
    },
    [graph],
  );

  const undo = () => {
    const previous = history.current.past.pop();
    if (!previous) return;
    history.current.future.push(graph);
    setDraft(previous);
    forceRender((value) => value + 1);
  };

  const redo = () => {
    const next = history.current.future.pop();
    if (!next) return;
    history.current.past.push(graph);
    setDraft(next);
    forceRender((value) => value + 1);
  };

  const addNode = (kind: NodeKind) => {
    const offset = graph.nodes.length;
    commit({
      ...graph,
      nodes: [...graph.nodes, createNode(kind, { x: 120 + (offset % 4) * 220, y: 100 + Math.floor(offset / 4) * 140 })],
    });
  };

  const workflowExecutions = (executions ?? []).filter((item) => item.workflow_id === workflowId);
  const workflowNames = workflow ? { [workflow.id]: workflow.name } : {};
  const assignedIds = (assigned ?? []).map((item) => item.worker_id);

  if (isLoading) {
    return <div className="h-64 animate-pulse rounded-xl border bg-card" />;
  }

  if (!workflow) {
    return (
      <EmptyState
        icon={History}
        title="Workflow not found"
        description="This workflow no longer exists in the active workspace."
        action={<Button onClick={() => navigate({ to: "/workflow" })}>{t("Back to workflows")}</Button>}
      />
    );
  }

  const save = () =>
    saveGraph
      .mutateAsync({ workflowId, graph })
      .then(() => {
        setDraft(null);
        history.current = { past: [], future: [] };
        toast.success(t("Workflow saved"));
      })
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : t("Action failed")));

  const publish = async () => {
    if (!report.valid) {
      toast.error(t("Fix the validation errors before publishing."));
      return;
    }
    try {
      if (draft) await saveGraph.mutateAsync({ workflowId, graph });
      await publishWorkflow.mutateAsync({ ...workflow, graph: graph as never });
      setDraft(null);
      toast.success(t("Workflow published"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  };

  const run = async () => {
    if (!report.valid) {
      toast.error(t("Fix the validation errors before running."));
      return;
    }
    try {
      const worker = (workers ?? []).find((item) => assignedIds.includes(item.id));
      await startExecution.mutateAsync({
        workflowId,
        workflowVersion: workflow.version,
        workflowName: workflow.name,
        graph,
        workerId: worker?.id ?? null,
        workerName: worker?.name ?? null,
        trigger: "manual",
      });
      toast.success(t("Execution queued"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Button variant="ghost" size="sm" className="-ms-2 gap-2" onClick={() => navigate({ to: "/workflow" })}>
            <ArrowLeft className="size-4" />
            {t("Workflow Center")}
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-xl font-semibold tracking-tight">{workflow.name}</h1>
            <Badge variant={workflowStatusVariant(workflow.status)}>{t(workflow.status)}</Badge>
            <Badge variant="outline">v{workflow.version}</Badge>
            {draft && <Badge variant="secondary">{t("Unsaved changes")}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">{workflow.description || t("No description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="icon" onClick={undo} disabled={!history.current.past.length}>
            <Undo2 className="size-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={redo} disabled={!history.current.future.length}>
            <Redo2 className="size-4" />
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => downloadWorkflow(workflow)}>
            <Download className="size-4" />
            {t("Export")}
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => void save()} disabled={!draft}>
            <Save className="size-4" />
            {t("Save")}
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => void publish()}>
            <Upload className="size-4" />
            {t("Publish")}
          </Button>
          <Button className="gap-2" onClick={() => void run()}>
            <Play className="size-4" />
            {t("Run")}
          </Button>
        </div>
      </div>

      <Tabs defaultValue="canvas" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="canvas">{t("Canvas")}</TabsTrigger>
          <TabsTrigger value="workers">{t("Workers")}</TabsTrigger>
          <TabsTrigger value="runs">{t("Runs")}</TabsTrigger>
          <TabsTrigger value="versions">{t("Versions")}</TabsTrigger>
          <TabsTrigger value="activity">{t("Activity")}</TabsTrigger>
        </TabsList>

        <TabsContent value="canvas" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_300px]">
            <div className="rounded-xl border bg-card p-3">
              <NodePalette onAdd={addNode} />
            </div>
            <div className="h-[32rem] overflow-hidden rounded-xl border bg-card">
              <WorkflowCanvas
                value={graph}
                onChange={commit}
                onSelect={setSelectedId}
                selectedId={selectedId}
                invalidIds={report.issues.map((issue) => issue.nodeId).filter(Boolean) as string[]}
              />
            </div>
            <div className="space-y-4">
              {selected ? (
                <div className="rounded-xl border bg-card p-3">
                  <NodeInspector
                    node={selected}
                    onChange={(node) =>
                      commit({
                        ...graph,
                        nodes: graph.nodes.map((item) => (item.id === node.id ? node : item)),
                      })
                    }
                    onDelete={() => {
                      commit({
                        nodes: graph.nodes.filter((item) => item.id !== selected.id),
                        edges: graph.edges.filter(
                          (edge) => edge.source !== selected.id && edge.target !== selected.id,
                        ),
                      });
                      setSelectedId(null);
                    }}
                  />
                </div>
              ) : (
                <EmptyState
                  compact
                  icon={History}
                  title="No node selected"
                  description="Select a node on the canvas to edit its parameters."
                />
              )}
              <div className="rounded-xl border bg-card p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("Validation")}
                </p>
                <ValidationReportPanel report={report} onSelect={setSelectedId} />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="workers" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              onValueChange={(workerId) =>
                assignWorker
                  .mutateAsync({ workflow, workerId })
                  .then(() => toast.success(t("Worker assigned")))
                  .catch(() => toast.error(t("Action failed")))
              }
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder={t("Assign an AI worker")} />
              </SelectTrigger>
              <SelectContent>
                {(workers ?? [])
                  .filter((worker) => !assignedIds.includes(worker.id))
                  .map((worker) => (
                    <SelectItem key={worker.id} value={worker.id}>
                      {worker.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          {assignedIds.length === 0 ? (
            <EmptyState
              compact
              icon={History}
              title="No workers assigned"
              description="Assign an AI worker so runtime settings (timeout, retries, priority) apply to this workflow."
            />
          ) : (
            <ul className="space-y-2">
              {(assigned ?? []).map((link) => {
                const worker = (workers ?? []).find((item) => item.id === link.worker_id);
                return (
                  <li key={link.id} className="flex items-center justify-between rounded-xl border bg-card p-3">
                    <span className="text-sm font-medium">{worker?.name ?? t("Worker")}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        unassignWorker
                          .mutateAsync({ workflowId, workerId: link.worker_id })
                          .then(() => toast.success(t("Worker unassigned")))
                          .catch(() => toast.error(t("Action failed")))
                      }
                    >
                      {t("Remove")}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="runs">
          <ExecutionQueue
            executions={workflowExecutions}
            workflowNames={workflowNames}
            onCancel={(executionId) => void cancelExecution.mutateAsync(executionId)}
          />
        </TabsContent>

        <TabsContent value="versions" className="space-y-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              snapshotWorkflow
                .mutateAsync({ workflow })
                .then(() => toast.success(t("Version created")))
                .catch(() => toast.error(t("Action failed")))
            }
          >
            {t("Create version snapshot")}
          </Button>
          {(versions ?? []).length === 0 ? (
            <EmptyState
              compact
              icon={History}
              title="No versions yet"
              description="Publishing or snapshotting a workflow stores a restorable version."
            />
          ) : (
            <ul className="space-y-2">
              {(versions ?? []).map((version) => (
                <li key={version.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-card p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      v{version.version} · {version.label || t("Snapshot")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(version.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      restoreVersion
                        .mutateAsync({ workflow, version })
                        .then(() => {
                          setDraft(null);
                          toast.success(t("Version restored"));
                        })
                        .catch(() => toast.error(t("Action failed")))
                    }
                  >
                    {t("Restore")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="activity">
          <ActivityLog
            entries={(activity ?? []).filter((entry) => entry.workflow_id === workflowId)}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
