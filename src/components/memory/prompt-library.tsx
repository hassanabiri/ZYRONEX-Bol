import { Copy, FileCode2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePromptMutations, usePrompts, usePromptVersions } from "@/hooks/use-prompts";
import { useWorkers } from "@/hooks/use-workers";
import { useI18n } from "@/lib/i18n";
import {
  extractVariables,
  PROMPT_CATEGORIES,
  PROMPT_SCOPES,
  type Prompt,
  type PromptScope,
} from "@/services/prompt-service";

export function PromptLibrary({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: prompts, isLoading } = usePrompts(workspaceId);
  const { data: workers } = useWorkers(workspaceId);
  const { createPrompt, updatePrompt, deletePrompt, duplicatePrompt, restoreVersion } =
    usePromptMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Prompt | null>(null);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<PromptScope>("workspace");
  const [category, setCategory] = useState("general");
  const [workerId, setWorkerId] = useState("none");
  const [body, setBody] = useState("");

  const { data: versions } = usePromptVersions(selected?.id);

  function openEditor(prompt?: Prompt) {
    setSelected(prompt ?? null);
    setName(prompt?.name ?? "");
    setScope(prompt?.scope ?? "workspace");
    setCategory(prompt?.category ?? "general");
    setWorkerId(prompt?.worker_id ?? "none");
    setBody(prompt?.body ?? "");
    setOpen(true);
  }

  async function handleSave() {
    if (!name.trim()) return;
    const payload = {
      name: name.trim(),
      scope,
      category,
      body,
      worker_id: workerId === "none" ? null : workerId,
    };
    try {
      if (selected) {
        await updatePrompt.mutateAsync({ promptId: selected.id, patch: payload });
      } else {
        await createPrompt.mutateAsync(payload);
      }
      setOpen(false);
      toast.success(t("Prompt saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t("Prompt library")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("Reusable system, workspace and worker prompts with variables and versions.")}
          </p>
        </div>
        <Button className="gap-2" onClick={() => openEditor()} disabled={!workspaceId}>
          <Plus className="size-4" />
          {t("New prompt")}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
      ) : !prompts?.length ? (
        <EmptyState
          icon={FileCode2}
          title="No prompts yet"
          description="Create reusable prompts with {{variables}} that any worker can adopt."
          action={<Button onClick={() => openEditor()}>{t("New prompt")}</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {prompts.map((prompt) => (
            <li key={prompt.id} className="rounded-xl border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-semibold">{prompt.name}</p>
                    <Badge variant="secondary">{t(prompt.scope)}</Badge>
                    <Badge variant="outline">{prompt.category}</Badge>
                    <Badge variant="outline">v{prompt.version}</Badge>
                  </div>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {prompt.body || t("Empty prompt")}
                  </p>
                  {Array.isArray(prompt.variables) && prompt.variables.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t("Variables")}: {(prompt.variables as string[]).join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openEditor(prompt)}>
                    {t("Edit")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("Duplicate")}
                    onClick={() => duplicatePrompt.mutate(prompt)}
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("Delete")}
                    onClick={() => deletePrompt.mutate(prompt.id)}
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
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selected ? t("Edit prompt") : t("New prompt")}</DialogTitle>
            <DialogDescription>
              {t("Use {{variable}} placeholders — they are detected automatically.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="prompt-name">{t("Name")}</Label>
                <Input
                  id="prompt-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("Scope")}</Label>
                <Select value={scope} onValueChange={(value) => setScope(value as PromptScope)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROMPT_SCOPES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {t(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("Category")}</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROMPT_CATEGORIES.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("Worker")}</Label>
                <Select value={workerId} onValueChange={setWorkerId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("Workspace scope")}</SelectItem>
                    {(workers ?? []).map((worker) => (
                      <SelectItem key={worker.id} value={worker.id}>
                        {worker.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prompt-body">{t("Prompt")}</Label>
              <Textarea
                id="prompt-body"
                rows={8}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="font-mono text-xs"
              />
              <p className="text-xs text-muted-foreground">
                {t("Detected variables")}: {extractVariables(body).join(", ") || "—"}
              </p>
            </div>

            {selected && versions && versions.length > 0 && (
              <div className="space-y-2">
                <Label>{t("Versions")}</Label>
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {versions.map((version) => (
                    <li
                      key={version.id}
                      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                    >
                      <span className="text-xs">
                        v{version.version} · {new Date(version.created_at).toLocaleString()}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1"
                        onClick={() =>
                          restoreVersion.mutate(
                            { prompt: selected, version },
                            {
                              onSuccess: (data) => {
                                setBody(data.body);
                                toast.success(t("Version restored"));
                              },
                            },
                          )
                        }
                      >
                        <RotateCcw className="size-3.5" />
                        {t("Restore")}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={() => void handleSave()} disabled={!name.trim()}>
              {t("Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
