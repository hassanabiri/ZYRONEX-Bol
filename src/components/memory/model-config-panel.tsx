import { Plus, Sliders, Trash2 } from "lucide-react";
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
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useModelConfigMutations, useModelConfigs } from "@/hooks/use-prompts";
import { useWorkers } from "@/hooks/use-workers";
import { useI18n } from "@/lib/i18n";

const PROVIDERS = ["lovable", "openai", "anthropic", "google", "azure", "custom"];

/** Model parameter presets. No provider is called — configuration only. */
export function ModelConfigPanel({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: configs, isLoading } = useModelConfigs(workspaceId);
  const { data: workers } = useWorkers(workspaceId);
  const { createConfig, updateConfig, deleteConfig } = useModelConfigMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [provider, setProvider] = useState("lovable");
  const [model, setModel] = useState("google/gemini-2.5-flash");
  const [workerId, setWorkerId] = useState("none");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [topP, setTopP] = useState(1);

  async function handleCreate() {
    if (!name.trim()) return;
    try {
      await createConfig.mutateAsync({
        name: name.trim(),
        provider,
        model,
        worker_id: workerId === "none" ? null : workerId,
        temperature,
        max_tokens: maxTokens,
        top_p: topP,
      });
      setOpen(false);
      setName("");
      toast.success(t("Configuration saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold">{t("Model configuration")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("Sampling presets reused by workers once providers are connected.")}
          </p>
        </div>
        <Button className="gap-2" onClick={() => setOpen(true)} disabled={!workspaceId}>
          <Plus className="size-4" />
          {t("New configuration")}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
      ) : !configs?.length ? (
        <EmptyState
          icon={Sliders}
          title="No model presets"
          description="Define temperature, token limits and sampling once, then reuse everywhere."
          action={<Button onClick={() => setOpen(true)}>{t("New configuration")}</Button>}
        />
      ) : (
        <ul className="space-y-2">
          {configs.map((config) => (
            <li
              key={config.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold">{config.name}</p>
                  <Badge variant="secondary">{config.provider}</Badge>
                  <Badge variant="outline">{config.model}</Badge>
                  {config.worker_id && (
                    <Badge variant="outline">
                      {workers?.find((worker) => worker.id === config.worker_id)?.name ??
                        t("Worker")}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("Temperature")} {Number(config.temperature)} · {t("Max tokens")}{" "}
                  {config.max_tokens} · top_p {Number(config.top_p)}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t("Default")}</span>
                  <Switch
                    checked={config.is_default}
                    aria-label={t("Default")}
                    onCheckedChange={(checked) =>
                      updateConfig.mutate({
                        configId: config.id,
                        patch: { is_default: checked },
                      })
                    }
                  />
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("Delete")}
                  onClick={() => deleteConfig.mutate(config.id)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("New configuration")}</DialogTitle>
            <DialogDescription>
              {t("Provider credentials are not required at this stage.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="config-name">{t("Name")}</Label>
              <Input id="config-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("Provider")}</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="config-model">{t("Model")}</Label>
                <Input
                  id="config-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("Scope")}</Label>
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
            <div className="space-y-2">
              <Label>
                {t("Temperature")} — {temperature}
              </Label>
              <Slider
                value={[temperature]}
                min={0}
                max={2}
                step={0.1}
                onValueChange={([value]) => setTemperature(value ?? 0)}
              />
            </div>
            <div className="space-y-2">
              <Label>
                top_p — {topP}
              </Label>
              <Slider
                value={[topP]}
                min={0}
                max={1}
                step={0.05}
                onValueChange={([value]) => setTopP(value ?? 1)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="config-tokens">{t("Max tokens")}</Label>
              <Input
                id="config-tokens"
                type="number"
                min={1}
                value={maxTokens}
                onChange={(e) => setMaxTokens(Number(e.target.value) || 1)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={!name.trim()}>
              {t("Save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
