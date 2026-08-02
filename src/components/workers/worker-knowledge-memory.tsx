import { BookOpen, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useKnowledgeBases,
  useKnowledgeMutations,
  useWorkerKnowledgeLinks,
} from "@/hooks/use-knowledge";
import { useMemoryMutations, useMemoryStores } from "@/hooks/use-memory";
import { useWorkerMutations } from "@/hooks/use-workers";
import { useI18n } from "@/lib/i18n";
import { MEMORY_LAYERS, layerLabel, type MemoryLayer } from "@/services/memory-service";
import type { Worker } from "@/services/worker-service";

/** Knowledge bases connected to a single worker, ordered by priority. */
export function WorkerKnowledgeTab({ worker }: { worker: Worker }) {
  const { t } = useI18n();
  const { data: bases } = useKnowledgeBases(worker.workspace_id);
  const { data: links } = useWorkerKnowledgeLinks(worker.workspace_id);
  const { assignWorker, updateWorkerLink, unassignWorker } = useKnowledgeMutations(
    worker.workspace_id,
  );
  const [baseId, setBaseId] = useState("");

  const workerLinks = (links ?? []).filter((link) => link.worker_id === worker.id);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Select value={baseId} onValueChange={setBaseId}>
          <SelectTrigger className="flex-1">
            <SelectValue placeholder={t("Select a knowledge base")} />
          </SelectTrigger>
          <SelectContent>
            {(bases ?? []).map((base) => (
              <SelectItem key={base.id} value={base.id}>
                {base.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          disabled={!baseId}
          onClick={() =>
            assignWorker.mutate(
              { workerId: worker.id, knowledgeBaseId: baseId },
              {
                onSuccess: () => toast.success(t("Knowledge base assigned")),
                onError: (error) => toast.error(error.message),
              },
            )
          }
        >
          {t("Assign")}
        </Button>
      </div>

      {!workerLinks.length ? (
        <EmptyState
          compact
          icon={BookOpen}
          title="No knowledge sources linked"
          description="Assign a knowledge base so this worker can ground its answers."
        />
      ) : (
        <ul className="space-y-2">
          {workerLinks.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-3"
            >
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {bases?.find((base) => base.id === link.knowledge_base_id)?.name ??
                    t("Unknown base")}
                </p>
                <Badge variant="outline">
                  {t("Priority")} {link.priority}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
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
          ))}
        </ul>
      )}
    </div>
  );
}

/** Per-worker memory policy plus the stores scoped to this worker. */
export function WorkerMemoryTab({ worker }: { worker: Worker }) {
  const { t } = useI18n();
  const { updateWorker } = useWorkerMutations(worker.workspace_id);
  const { data: stores } = useMemoryStores(worker.workspace_id);
  const { createStore } = useMemoryMutations(worker.workspace_id);

  const workerStores = (stores ?? []).filter((store) => store.worker_id === worker.id);

  const patch = (values: Partial<Worker>) =>
    updateWorker
      .mutateAsync({ workerId: worker.id, patch: values })
      .catch(() => toast.error(t("Action failed")));

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold">{t("Memory enabled")}</p>
            <p className="text-xs text-muted-foreground">
              {t("Turn recall on or off for this worker.")}
            </p>
          </div>
          <Switch
            checked={worker.memory_enabled}
            aria-label={t("Memory enabled")}
            onCheckedChange={(checked) => patch({ memory_enabled: checked })}
          />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label>{t("Default layer")}</Label>
            <Select
              value={worker.memory_type}
              onValueChange={(value) => patch({ memory_type: value as MemoryLayer })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEMORY_LAYERS.map((layer) => (
                  <SelectItem key={layer.layer} value={layer.layer}>
                    {t(layer.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="worker-memory-size">{t("Max entries")}</Label>
            <Input
              id="worker-memory-size"
              type="number"
              min={1}
              defaultValue={worker.memory_size}
              onBlur={(event) => patch({ memory_size: Number(event.target.value) || 1 })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="worker-memory-retention">{t("Retention (days)")}</Label>
            <Input
              id="worker-memory-retention"
              type="number"
              min={1}
              defaultValue={worker.memory_retention_days}
              onBlur={(event) => patch({ memory_retention_days: Number(event.target.value) || 1 })}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{t("Memory stores")}</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            createStore.mutate(
              {
                name: `${worker.name} — ${layerLabel(worker.memory_type)}`,
                layer: worker.memory_type,
                worker_id: worker.id,
                max_items: worker.memory_size,
                retention_days: worker.memory_retention_days,
              },
              { onSuccess: () => toast.success(t("Memory store created")) },
            )
          }
        >
          {t("Create store")}
        </Button>
      </div>

      {!workerStores.length ? (
        <EmptyState
          compact
          icon={BookOpen}
          title="No memory stores linked"
          description="Create a store scoped to this worker to hold what it remembers."
        />
      ) : (
        <ul className="space-y-2">
          {workerStores.map((store) => (
            <li key={store.id} className="rounded-xl border bg-card p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium">{store.name}</p>
                <Badge variant="secondary">{t(layerLabel(store.layer))}</Badge>
                <Badge variant="outline">
                  {store.max_items} {t("entries")}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
