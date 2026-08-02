import { Search } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useKnowledgeSearch } from "@/hooks/use-knowledge";
import { useI18n } from "@/lib/i18n";
import { humanize } from "@/lib/worker-options";
import type { KnowledgeBase } from "@/services/knowledge-service";

/** Keyword retrieval preview across every indexed document in the workspace. */
export function KnowledgeSearch({
  workspaceId,
  bases,
}: {
  workspaceId: string | undefined;
  bases: KnowledgeBase[];
}) {
  const { t } = useI18n();
  const [term, setTerm] = useState("");
  const [scope, setScope] = useState("all");
  const { data, isFetching } = useKnowledgeSearch(
    workspaceId,
    term,
    scope === "all" ? undefined : scope,
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={t("Search across every document")}
            className="ps-9"
          />
        </div>
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All knowledge bases")}</SelectItem>
            {bases.map((base) => (
              <SelectItem key={base.id} value={base.id}>
                {base.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {term.trim().length <= 1 ? (
        <EmptyState
          compact
          icon={Search}
          title="Start typing to search"
          description="Retrieval runs over document titles, descriptions and extracted text."
        />
      ) : isFetching ? (
        <p className="text-sm text-muted-foreground">{t("Searching…")}</p>
      ) : !data?.length ? (
        <EmptyState
          compact
          icon={Search}
          title="No matches"
          description="Nothing in this workspace matches that query yet."
        />
      ) : (
        <ul className="space-y-2">
          {data.map((doc) => (
            <li key={doc.id} className="rounded-xl border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{doc.name}</p>
                <Badge variant="outline">{humanize(doc.source)}</Badge>
                <Badge variant="secondary">{humanize(doc.status)}</Badge>
              </div>
              {doc.content && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{doc.content}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
