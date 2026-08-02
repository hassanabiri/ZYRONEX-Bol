import { Link } from "@tanstack/react-router";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  Trash2,
  Workflow as WorkflowIcon,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useWorkflowMutations } from "@/hooks/use-workflows";
import { parseGraph } from "@/lib/execution/graph";
import { useI18n } from "@/lib/i18n";
import { toDefinition, type Workflow } from "@/services/workflow-service";

const PAGE_SIZE = 8;

export const WORKFLOW_STATUSES = ["draft", "published", "paused", "archived"] as const;

export function workflowStatusVariant(status: Workflow["status"]): "default" | "secondary" | "outline" {
  if (status === "published") return "default";
  if (status === "draft" || status === "paused") return "secondary";
  return "outline";
}

export function downloadWorkflow(workflow: Workflow) {
  const blob = new Blob([JSON.stringify(toDefinition(workflow), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${workflow.name.replace(/\s+/g, "-").toLowerCase()}.zyronex-workflow.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function WorkflowsTable({
  workflows,
  workspaceId,
  isLoading,
  onCreate,
}: {
  workflows: Workflow[];
  workspaceId: string | undefined;
  isLoading: boolean;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const { updateWorkflow, deleteWorkflow, duplicateWorkflow } = useWorkflowMutations(workspaceId);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = workflows.filter((workflow) => {
      const matchesTerm =
        !term ||
        workflow.name.toLowerCase().includes(term) ||
        (workflow.description ?? "").toLowerCase().includes(term) ||
        (workflow.tags ?? []).some((tag) => tag.toLowerCase().includes(term));
      return matchesTerm && (status === "all" || workflow.status === status);
    });
    return rows.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sort === "status") return a.status.localeCompare(b.status);
      return b.updated_at.localeCompare(a.updated_at);
    });
  }, [workflows, query, status, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const setStatusFor = (workflow: Workflow, next: Workflow["status"]) =>
    updateWorkflow
      .mutateAsync({ workflowId: workflow.id, patch: { status: next } })
      .then(() => toast.success(t("Workflow updated")))
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : t("Action failed")));

  if (!isLoading && workflows.length === 0) {
    return (
      <EmptyState
        icon={WorkflowIcon}
        title="No workflows yet"
        description="Create your first workflow to orchestrate AI workers through the execution engine."
        action={<Button onClick={onCreate}>{t("Create Workflow")}</Button>}
      />
    );
  }

  return (
    <div className="space-y-4 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={t("Search workflows")}
            className="ps-9"
          />
        </div>
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All statuses")}</SelectItem>
            {WORKFLOW_STATUSES.map((item) => (
              <SelectItem key={item} value={item}>
                {t(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">{t("Recently updated")}</SelectItem>
            <SelectItem value="oldest">{t("Oldest first")}</SelectItem>
            <SelectItem value="name">{t("Name")}</SelectItem>
            <SelectItem value="status">{t("Status")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("Workflow")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("Status")}</TableHead>
              <TableHead className="hidden md:table-cell">{t("Nodes")}</TableHead>
              <TableHead className="hidden lg:table-cell">{t("Version")}</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((workflow) => {
              const graph = parseGraph(workflow.graph);
              return (
                <TableRow key={workflow.id}>
                  <TableCell>
                    <Link
                      to="/workflow/$workflowId"
                      params={{ workflowId: workflow.id }}
                      className="block min-w-0"
                    >
                      <span className="block truncate text-sm font-medium hover:underline">
                        {workflow.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {workflow.description || t("No description")}
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge variant={workflowStatusVariant(workflow.status)}>{t(workflow.status)}</Badge>
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {graph.nodes.length} · {graph.edges.length} {t("links")}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground lg:table-cell">
                    v{workflow.version}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8">
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {workflow.status !== "published" && (
                          <DropdownMenuItem onClick={() => setStatusFor(workflow, "published")}>
                            <Play className="size-4" /> {t("Publish")}
                          </DropdownMenuItem>
                        )}
                        {workflow.status === "published" && (
                          <DropdownMenuItem onClick={() => setStatusFor(workflow, "paused")}>
                            <Pause className="size-4" /> {t("Pause")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setStatusFor(workflow, "archived")}>
                          <Archive className="size-4" /> {t("Archive")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            duplicateWorkflow
                              .mutateAsync(workflow)
                              .then(() => toast.success(t("Workflow duplicated")))
                              .catch(() => toast.error(t("Action failed")))
                          }
                        >
                          <Copy className="size-4" /> {t("Duplicate")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => downloadWorkflow(workflow)}>
                          <Download className="size-4" /> {t("Export")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() =>
                            deleteWorkflow
                              .mutateAsync(workflow)
                              .then(() => toast.success(t("Workflow deleted")))
                              .catch(() => toast.error(t("Action failed")))
                          }
                        >
                          <Trash2 className="size-4" /> {t("Delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t("Page")} {current + 1} / {pageCount}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="size-8" disabled={current === 0} onClick={() => setPage(current - 1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
