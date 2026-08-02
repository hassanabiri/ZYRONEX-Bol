import { Bot, Link2, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useKnowledgeMutations, useWorkerKnowledgeLinks } from "@/hooks/use-knowledge";
import { useWorkers } from "@/hooks/use-workers";
import { useI18n } from "@/lib/i18n";
import type { KnowledgeBase } from "@/services/knowledge-service";

/** Connects AI Workers to one or many knowledge bases with a priority order. */
export function KnowledgeAssignment({
  workspaceId,
  bases,
}: {
  workspaceId: string | undefined;
  bases: KnowledgeBase[];
}) {
  const { t } = useI18n();
  const { data: workers } = useWorkers(workspaceId);
  const { data: links } = useWorkerKnowledgeLinks(workspaceId);
  const { assignWorker, updateWorkerLink, unassignWorker } = useKnowledgeMutations(workspaceId);

  const [workerId, setWorkerId] = useState("");
  const [baseId, setBaseId] = useState("");

  function handleAssign() {
    if (!workerId || !baseId) return;
    assignWorker.mutate(
      { workerId, knowledgeBaseId: baseId },
      {
        onSuccess: () => toast.success(t("Knowledge base assigned")),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={workerId} onValueChange={setWorkerId}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={t("Select an AI Worker")} />
          </SelectTrigger>
          <SelectContent>
            {(workers ?? []).map((worker) => (
              <SelectItem key={worker.id} value={worker.id}>
                {worker.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={baseId} onValueChange={setBaseId}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={t("Select a knowledge base")} />
          </SelectTrigger>
          <SelectContent>
            {bases.map((base) => (
              <SelectItem key={base.id} value={base.id}>
                {base.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button className="gap-2" onClick={handleAssign} disabled={!workerId || !baseId}>
          <Link2 className="size-4" />
          {t("Assign")}
        </Button>
      </div>

      {!links?.length ? (
        <EmptyState
          compact
          icon={Bot}
          title="No knowledge assigned"
          description="Connect a worker to a knowledge base so it can ground its answers."
        />
      ) : (
        <ul className="space-y-2">
          {links.map((link) => {
            const worker = workers?.find((item) => item.id === link.worker_id);
            const base = bases.find((item) => item.id === link.knowledge_base_id);
            return (
              <li
                key={link.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">
                    {worker?.name ?? t("Unknown worker")} → {base?.name ?? t("Unknown base")}
                  </p>
                  <Badge variant="outline">
                    {t("Priority")} {link.priority}
                  </Badge>
                </div>
                <div className="flex items-center gap-3">
                  <Select
                    value={String(link.priority)}
                    onValueChange={(value) =>
                      updateWorkerLink.mutate({
                        linkId: link.id,
                        patch: { priority: Number(value) },
                      })
                    }
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5].map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Switch
                    checked={link.enabled}
                    aria-label={t("Enabled")}
                    onCheckedChange={(checked) =>
                      updateWorkerLink.mutate({ linkId: link.id, patch: { enabled: checked } })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("Remove")}
                    onClick={() => unassignWorker.mutate(link.id)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
