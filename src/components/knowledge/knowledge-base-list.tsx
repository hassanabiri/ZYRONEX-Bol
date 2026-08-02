import { BookOpen, Copy, Download, MoreHorizontal, Search, Trash2 } from "lucide-react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { useKnowledgeMutations } from "@/hooks/use-knowledge";
import { useI18n } from "@/lib/i18n";
import {
  toKnowledgeDefinition,
  type KnowledgeBase,
  type KnowledgeDocument,
} from "@/services/knowledge-service";

export function downloadBase(base: KnowledgeBase) {
  const blob = new Blob([JSON.stringify(toKnowledgeDefinition(base), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${base.name.replace(/\s+/g, "-").toLowerCase()}.zyronex-kb.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function KnowledgeBaseList({
  bases,
  documents,
  workspaceId,
  isLoading,
  activeId,
  onSelect,
  onCreate,
}: {
  bases: KnowledgeBase[];
  documents: KnowledgeDocument[];
  workspaceId: string | undefined;
  isLoading?: boolean;
  activeId?: string;
  onSelect: (base: KnowledgeBase) => void;
  onCreate: () => void;
}) {
  const { t } = useI18n();
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("all");
  const { deleteBase, duplicateBase } = useKnowledgeMutations(workspaceId);

  const counts = useMemo(() => {
    const map = new Map<string, number>();
    documents.forEach((doc) => {
      map.set(doc.knowledge_base_id, (map.get(doc.knowledge_base_id) ?? 0) + 1);
    });
    return map;
  }, [documents]);

  const rows = useMemo(() => {
    const query = term.trim().toLowerCase();
    return bases.filter((base) => {
      const matches =
        !query ||
        base.name.toLowerCase().includes(query) ||
        (base.description ?? "").toLowerCase().includes(query) ||
        base.tags.some((tag) => tag.toLowerCase().includes(query));
      return matches && (status === "all" || base.status === status);
    });
  }, [bases, term, status]);

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-20 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("Search knowledge bases")}
            className="ps-9"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All statuses")}</SelectItem>
            <SelectItem value="draft">{t("draft")}</SelectItem>
            <SelectItem value="active">{t("active")}</SelectItem>
            <SelectItem value="archived">{t("archived")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!rows.length ? (
        <EmptyState
          icon={BookOpen}
          title="No knowledge bases yet"
          description="Create a knowledge base to group the documents your agents can reason over."
          action={<Button onClick={onCreate}>{t("Create Knowledge Base")}</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map((base) => (
            <li key={base.id}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(base)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") onSelect(base);
                }}
                className={`flex w-full cursor-pointer items-start justify-between gap-3 rounded-xl border p-4 text-start transition-colors hover:bg-surface ${
                  activeId === base.id ? "border-primary bg-surface" : "bg-card"
                }`}
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">{base.name}</p>
                    <Badge variant={base.status === "active" ? "default" : "outline"}>
                      {t(base.status)}
                    </Badge>
                    <Badge variant="outline">{base.category}</Badge>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {base.description || t("No description")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {counts.get(base.id) ?? 0} {t("documents")} · v{base.version}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
                    <Button variant="ghost" size="icon" aria-label={t("Actions")}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <DropdownMenuItem
                      onSelect={() => {
                        duplicateBase.mutate(base, {
                          onSuccess: () => toast.success(t("Knowledge base duplicated")),
                          onError: (error) => toast.error(error.message),
                        });
                      }}
                    >
                      <Copy className="size-4" />
                      {t("Duplicate")}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => downloadBase(base)}>
                      <Download className="size-4" />
                      {t("Export")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => {
                        deleteBase.mutate(base, {
                          onSuccess: () => toast.success(t("Knowledge base deleted")),
                          onError: (error) => toast.error(error.message),
                        });
                      }}
                    >
                      <Trash2 className="size-4" />
                      {t("Delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
