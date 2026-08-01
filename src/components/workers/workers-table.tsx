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
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { WorkerAvatar } from "@/components/workers/worker-avatar";
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
import { useWorkerMutations } from "@/hooks/use-workers";
import { useI18n } from "@/lib/i18n";
import { Bot } from "lucide-react";
import { humanize, statusVariant, WORKER_STATUSES } from "@/lib/worker-options";
import { toDefinition, type Worker } from "@/services/worker-service";

const PAGE_SIZE = 8;

export function downloadWorker(worker: Worker) {
  const blob = new Blob([JSON.stringify(toDefinition(worker), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${worker.name.replace(/\s+/g, "-").toLowerCase()}.zyronex-worker.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Searchable, sortable, filterable and paginated worker list. */
export function WorkersTable({
  workers,
  workspaceId,
  isLoading,
  onCreate,
}: {
  workers: Worker[];
  workspaceId: string | undefined;
  isLoading: boolean;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const { updateWorker, deleteWorker, duplicateWorker } = useWorkerMutations(workspaceId);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [sort, setSort] = useState("recent");
  const [page, setPage] = useState(0);

  const types = useMemo(
    () => Array.from(new Set(workers.map((worker) => worker.type).filter(Boolean))) as string[],
    [workers],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = workers.filter((worker) => {
      const matchesTerm =
        !term ||
        worker.name.toLowerCase().includes(term) ||
        (worker.description ?? "").toLowerCase().includes(term) ||
        (worker.tags ?? []).some((tag) => tag.toLowerCase().includes(term));
      const matchesStatus = status === "all" || worker.status === status;
      const matchesType = type === "all" || worker.type === type;
      return matchesTerm && matchesStatus && matchesType;
    });

    return rows.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sort === "status") return a.status.localeCompare(b.status);
      return b.updated_at.localeCompare(a.updated_at);
    });
  }, [workers, query, status, type, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const rows = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const setStatusFor = (worker: Worker, next: Worker["status"]) =>
    updateWorker
      .mutateAsync({ workerId: worker.id, patch: { status: next } })
      .then(() => toast.success(t("Worker updated")))
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : t("Action failed")),
      );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 sm:min-w-56">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder={t("Search workers…")}
            className="ps-9"
          />
        </div>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder={t("Status")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All statuses")}</SelectItem>
            {WORKER_STATUSES.map((value) => (
              <SelectItem key={value} value={value}>
                {t(humanize(value))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={type}
          onValueChange={(value) => {
            setType(value);
            setPage(0);
          }}
        >
          <SelectTrigger className="sm:w-44">
            <SelectValue placeholder={t("Type")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All types")}</SelectItem>
            {types.map((value) => (
              <SelectItem key={value} value={value}>
                {t(humanize(value))}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent">{t("Recently updated")}</SelectItem>
            <SelectItem value="oldest">{t("Oldest first")}</SelectItem>
            <SelectItem value="name">{t("Name A–Z")}</SelectItem>
            <SelectItem value="status">{t("Status")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Bot}
          title={isLoading ? "Loading workers" : workers.length ? "No matching workers" : "No AI workers yet"}
          description={
            isLoading
              ? "Fetching the workers in this workspace."
              : workers.length
                ? "Try a different search term or clear the filters."
                : "Create your first AI worker to start organizing agent operations in this workspace."
          }
          action={
            workers.length === 0 && !isLoading ? (
              <Button onClick={onCreate}>{t("Create Worker")}</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Worker")}</TableHead>
                <TableHead className="hidden md:table-cell">{t("Type")}</TableHead>
                <TableHead className="hidden lg:table-cell">{t("AI Provider")}</TableHead>
                <TableHead>{t("Status")}</TableHead>
                <TableHead className="hidden xl:table-cell">{t("Updated")}</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((worker) => (
                <TableRow key={worker.id}>
                  <TableCell>
                    <Link
                      to="/workers/$workerId"
                      params={{ workerId: worker.id }}
                      className="flex items-center gap-3"
                    >
                      <WorkerAvatar icon={worker.icon} color={worker.color} avatarUrl={worker.avatar_url} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">{worker.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {worker.description || t("No description")}
                        </span>
                      </span>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                    {t(humanize(worker.type))}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                    {t(humanize(worker.provider))}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(worker.status)} className="capitalize">
                      {t(humanize(worker.status))}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-xs text-muted-foreground">
                    {new Date(worker.updated_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={t("Worker actions")}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {worker.status !== "active" && (
                          <DropdownMenuItem onClick={() => setStatusFor(worker, "active")}>
                            <Play className="size-4" /> {t("Activate")}
                          </DropdownMenuItem>
                        )}
                        {worker.status === "active" && (
                          <DropdownMenuItem onClick={() => setStatusFor(worker, "paused")}>
                            <Pause className="size-4" /> {t("Pause")}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => setStatusFor(worker, "archived")}>
                          <Archive className="size-4" /> {t("Archive")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            duplicateWorker
                              .mutateAsync(worker)
                              .then(() => toast.success(t("Worker duplicated")))
                              .catch(() => toast.error(t("Action failed")))
                          }
                        >
                          <Copy className="size-4" /> {t("Duplicate")}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => downloadWorker(worker)}>
                          <Download className="size-4" /> {t("Export")}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() =>
                            deleteWorker
                              .mutateAsync(worker.id)
                              .then(() => toast.success(t("Worker deleted")))
                              .catch(() => toast.error(t("Action failed")))
                          }
                        >
                          <Trash2 className="size-4" /> {t("Delete")}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {filtered.length > PAGE_SIZE && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t("Showing")} {current * PAGE_SIZE + 1}–
            {Math.min(filtered.length, (current + 1) * PAGE_SIZE)} {t("of")} {filtered.length}
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="icon"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
              aria-label={t("Previous page")}
            >
              <ChevronLeft className="size-4 rtl:rotate-180" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
              aria-label={t("Next page")}
            >
              <ChevronRight className="size-4 rtl:rotate-180" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
