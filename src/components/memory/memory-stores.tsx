import { Brain, Layers, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useMemoryEntries, useMemoryMutations, useMemoryStores } from "@/hooks/use-memory";
import { useWorkers } from "@/hooks/use-workers";
import { useI18n } from "@/lib/i18n";
import { MEMORY_LAYERS, layerLabel, type MemoryLayer } from "@/services/memory-service";

export function MemoryStores({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: stores, isLoading } = useMemoryStores(workspaceId);
  const { data: entries } = useMemoryEntries(workspaceId);
  const { data: workers } = useWorkers(workspaceId);
  const { createStore, updateStore, deleteStore, compactStore, resetStore } =
    useMemoryMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [layer, setLayer] = useState<MemoryLayer>("short_term");
  const [workerId, setWorkerId] = useState("workspace");
  const [maxItems, setMaxItems] = useState(100);
  const [retention, setRetention] = useState(30);

  const usage = useMemo(() => {
    const map = new Map<string, number>();
    (entries ?? [])
      .filter((entry) => entry.status === "active")
      .forEach((entry) => map.set(entry.store_id, (map.get(entry.store_id) ?? 0) + 1));
    return map;
  }, [entries]);

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      await createStore.mutateAsync({
        name: name.trim(),
        layer,
        worker_id: workerId === "workspace" ? null : workerId,
        max_items: maxItems,
        retention_days: retention,
      });
      setOpen(false);
      setName("");
      toast.success(t("Memory store created"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t("Memory stores")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("Four layers: short-term, session, long-term and persistent.")}
          </p>
        </div>
        <Button className="gap-2" onClick={() => setOpen(true)} disabled={!workspaceId}>
          <Plus className="size-4" />
          {t("Create store")}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {MEMORY_LAYERS.map((item) => (
          <div key={item.layer} className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-2">
              <Layers className="size-4 text-muted-foreground" />
              <p className="text-sm font-semibold">{t(item.label)}</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t(item.description)}</p>
            <p className="mt-2 text-2xl font-semibold">
              {(stores ?? []).filter((store) => store.layer === item.layer).length}
            </p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
      ) : !stores?.length ? (
        <EmptyState
          icon={Brain}
          title="No memory stores yet"
          description="Create a store to give your agents short-term recall or durable long-term knowledge."
          action={<Button onClick={() => setOpen(true)}>{t("Create store")}</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {stores.map((store) => {
            const used = usage.get(store.id) ?? 0;
            const worker = workers?.find((item) => item.id === store.worker_id);
            return (
              <li key={store.id} className="rounded-xl border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{store.name}</p>
                      <Badge variant="secondary">{t(layerLabel(store.layer))}</Badge>
                      <Badge variant="outline">{worker ? worker.name : t("Workspace scope")}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {used}/{store.max_items} {t("entries")} · {store.retention_days}{" "}
                      {t("day retention")} · {t("Priority")} {store.priority}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={store.enabled}
                      aria-label={t("Enabled")}
                      onCheckedChange={(checked) =>
                        updateStore.mutate({ storeId: store.id, patch: { enabled: checked } })
                      }
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1"
                      onClick={() =>
                        compactStore.mutate(store, {
                          onSuccess: (count) =>
                            toast.success(`${count} ${t("memories compacted")}`),
                        })
                      }
                    >
                      <RefreshCw className="size-4" />
                      {t("Compact")}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resetStore.mutate(store)}>
                      {t("Reset")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("Delete")}
                      onClick={() => deleteStore.mutate(store.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
                <Progress
                  value={Math.min(100, Math.round((used / Math.max(1, store.max_items)) * 100))}
                  className="mt-3 h-1.5"
                />
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Create store")}</DialogTitle>
            <DialogDescription>
              {t("Choose a memory layer, scope and retention policy.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="store-name">{t("Name")}</Label>
              <Input id="store-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("Layer")}</Label>
                <Select value={layer} onValueChange={(value) => setLayer(value as MemoryLayer)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MEMORY_LAYERS.map((item) => (
                      <SelectItem key={item.layer} value={item.layer}>
                        {t(item.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("Scope")}</Label>
                <Select value={workerId} onValueChange={setWorkerId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="workspace">{t("Workspace scope")}</SelectItem>
                    {(workers ?? []).map((worker) => (
                      <SelectItem key={worker.id} value={worker.id}>
                        {worker.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="store-max">{t("Max entries")}</Label>
                <Input
                  id="store-max"
                  type="number"
                  min={1}
                  value={maxItems}
                  onChange={(e) => setMaxItems(Number(e.target.value) || 1)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="store-retention">{t("Retention (days)")}</Label>
                <Input
                  id="store-retention"
                  type="number"
                  min={1}
                  value={retention}
                  onChange={(e) => setRetention(Number(e.target.value) || 1)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={!name.trim()}>
              {t("Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function MemoryEntries({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const [storeId, setStoreId] = useState("all");
  const { data: stores } = useMemoryStores(workspaceId);
  const { data: entries } = useMemoryEntries(workspaceId, storeId === "all" ? undefined : storeId);
  const { createEntry, updateEntry, touchEntry, deleteEntry, expireStale } =
    useMemoryMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [content, setContent] = useState("");
  const [importance, setImportance] = useState(5);
  const [targetStore, setTargetStore] = useState("");

  const store = stores?.find((item) => item.id === targetStore);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Select value={storeId} onValueChange={setStoreId}>
          <SelectTrigger className="sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All stores")}</SelectItem>
            {(stores ?? []).map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() =>
              expireStale.mutate(undefined, {
                onSuccess: (count) => toast.success(`${count} ${t("memories expired")}`),
              })
            }
          >
            {t("Run retention")}
          </Button>
          <Button className="gap-2" onClick={() => setOpen(true)} disabled={!stores?.length}>
            <Plus className="size-4" />
            {t("Write memory")}
          </Button>
        </div>
      </div>

      {!entries?.length ? (
        <EmptyState
          compact
          icon={Brain}
          title="No memories stored"
          description="Memories written by agents or operators appear here with importance and usage."
        />
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-xl border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{entry.key}</p>
                    <Badge variant={entry.status === "active" ? "secondary" : "outline"}>
                      {t(entry.status)}
                    </Badge>
                    <Badge variant="outline">
                      {t("Importance")} {entry.importance}
                    </Badge>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">{entry.content}</p>
                  <p className="text-xs text-muted-foreground">
                    {t("Reads")} {entry.read_count} · {t("Writes")} {entry.write_count}
                    {entry.expires_at
                      ? ` · ${t("expires")} ${new Date(entry.expires_at).toLocaleDateString()}`
                      : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => touchEntry.mutate(entry)}>
                    {t("Recall")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      updateEntry.mutate({
                        entry,
                        patch: { status: entry.status === "archived" ? "active" : "archived" },
                      })
                    }
                  >
                    {entry.status === "archived" ? t("Restore") : t("Archive")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("Delete")}
                    onClick={() => deleteEntry.mutate(entry)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Write memory")}</DialogTitle>
            <DialogDescription>
              {t("Store a fact in a memory layer with an importance weight.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("Store")}</Label>
              <Select value={targetStore} onValueChange={setTargetStore}>
                <SelectTrigger>
                  <SelectValue placeholder={t("Select a store")} />
                </SelectTrigger>
                <SelectContent>
                  {(stores ?? []).map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-key">{t("Key")}</Label>
              <Input id="memory-key" value={key} onChange={(e) => setKey(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-content">{t("Content")}</Label>
              <Textarea
                id="memory-content"
                rows={5}
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="memory-importance">{t("Importance")}</Label>
              <Input
                id="memory-importance"
                type="number"
                min={1}
                max={10}
                value={importance}
                onChange={(e) => setImportance(Number(e.target.value) || 1)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={!store || !key.trim() || !content.trim()}
              onClick={() => {
                if (!store) return;
                createEntry.mutate(
                  { store, key: key.trim(), content: content.trim(), importance },
                  {
                    onSuccess: () => {
                      setOpen(false);
                      setKey("");
                      setContent("");
                      toast.success(t("Memory stored"));
                    },
                    onError: (error) => toast.error(error.message),
                  },
                );
              }}
            >
              {t("Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
