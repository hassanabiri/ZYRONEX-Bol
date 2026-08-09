import { ArrowLeft, ArrowRight, Check, PlugZap, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { WorkerAvatar } from "@/components/workers/worker-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import { useWorkerMutations } from "@/hooks/use-workers";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  humanize,
  WORKER_COLORS,
  WORKER_ICONS,
  WORKER_PROVIDER_SUGGESTIONS,
  WORKER_PURPOSE_SUGGESTIONS,
  WORKER_TYPE_SUGGESTIONS,
} from "@/lib/worker-options";
import {
  WORKSPACE_LANGUAGES,
  WORKSPACE_REGIONS,
  WORKSPACE_TIMEZONES,
} from "@/lib/workspace-options";

import { testAiProviderConnection } from "@/lib/ai-provider.functions";

const STEPS = ["Identity", "Purpose", "AI Provider", "Localization", "Review"] as const;

const TEST_ERRORS: Record<string, string> = {
  invalid_key: "Invalid API key.",
  expired_credentials: "Credentials have expired.",
  unreachable: "Provider is unreachable.",
  model_unavailable: "Model is not available.",
  rate_limited: "Usage limit exceeded.",
  failed: "Connection failed.",
};


function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Five-step wizard that creates a worker definition. No AI is connected or executed. */
export function CreateWorkerWizard({
  workspaceId,
  onCreated,
  onCancel,
}: {
  workspaceId: string | undefined;
  onCreated: (workerId: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const { createWorker } = useWorkerMutations(workspaceId);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [color, setColor] = useState<string>(WORKER_COLORS[0].value);
  const [icon, setIcon] = useState<string>(WORKER_ICONS[0]!.value);
  const [type, setType] = useState<string>("customer-support");
  const [customType, setCustomType] = useState("");
  const [purpose, setPurpose] = useState<string>("answer-customers");
  const [customPurpose, setCustomPurpose] = useState("");
  const [aiMode, setAiMode] = useState<"platform" | "custom">("platform");
  const [provider, setProvider] = useState<string>("openai");
  const [customProvider, setCustomProvider] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [testing, setTesting] = useState(false);
  const [testState, setTestState] = useState<"idle" | "ok" | "error">("idle");
  const [testMessage, setTestMessage] = useState("");
  const [language, setLanguage] = useState("ar");
  const [timezone, setTimezone] = useState("Asia/Riyadh");
  const [region, setRegion] = useState("me-central");

  const resolvedType = type === "custom" && customType ? slugify(customType) : type;
  const resolvedPurpose = purpose === "custom" && customPurpose ? slugify(customPurpose) : purpose;
  const resolvedProvider =
    aiMode === "platform"
      ? "zyronex"
      : provider === "custom" && customProvider
        ? slugify(customProvider)
        : provider;

  const canContinue = step !== 0 || name.trim().length > 1;

  async function handleTestConnection() {
    setTesting(true);
    setTestState("idle");
    try {
      const result = await testAiProviderConnection({
        data: {
          provider: resolvedProvider,
          apiKey,
          model: model.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
        },
      });
      if (result.ok) {
        setTestState("ok");
        setTestMessage("");
      } else {
        setTestState("error");
        setTestMessage(TEST_ERRORS[result.reason ?? "failed"] ?? TEST_ERRORS["failed"]!);
      }
    } catch {
      setTestState("error");
      setTestMessage(TEST_ERRORS["failed"]!);
    } finally {
      setTesting(false);
    }
  }

  async function handleFinish() {
    if (!workspaceId) return;
    try {
      const worker = await createWorker.mutateAsync({
        name: name.trim(),
        description: description.trim() || null,
        avatar_url: avatarUrl.trim() || null,
        color,
        icon,
        type: resolvedType,
        purpose: resolvedPurpose,
        provider: resolvedProvider,
        model: aiMode === "custom" ? model.trim() || null : null,
        language,
        timezone,
        region,
        status: "draft",
      });
      toast.success(t("Worker created successfully"));
      onCreated(worker.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not create worker"));
    }
  }


  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {t("Step")} {step + 1} / {STEPS.length}
          </span>
          <span>{t(STEPS[step]!)}</span>
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5" />
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="worker-name">{t("Worker Name")}</Label>
            <Input
              id="worker-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("e.g. Support Concierge")}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="worker-description">{t("Description")}</Label>
            <Textarea
              id="worker-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("What is this worker responsible for?")}
              rows={3}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="worker-avatar">{t("Avatar URL")}</Label>
            <Input
              id="worker-avatar"
              value={avatarUrl}
              onChange={(event) => setAvatarUrl(event.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-2">
            <Label>{t("Color")}</Label>
            <div className="flex flex-wrap gap-2">
              {WORKER_COLORS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  aria-label={entry.value}
                  onClick={() => setColor(entry.value)}
                  className={cn(
                    "size-8 rounded-lg ring-offset-2 ring-offset-background transition",
                    entry.className,
                    color === entry.value && "ring-2 ring-ring",
                  )}
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label>{t("Icon")}</Label>
            <div className="flex flex-wrap gap-2">
              {WORKER_ICONS.map((entry) => (
                <button
                  key={entry.value}
                  type="button"
                  aria-label={entry.value}
                  onClick={() => setIcon(entry.value)}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg border text-muted-foreground transition",
                    icon === entry.value && "border-primary text-primary",
                  )}
                >
                  <entry.icon className="size-4" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Worker Type")}</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKER_TYPE_SUGGESTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(humanize(value))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {type === "custom" && (
              <Input
                value={customType}
                onChange={(event) => setCustomType(event.target.value)}
                placeholder={t("Name your own worker type")}
              />
            )}
          </div>
          <div className="space-y-2">
            <Label>{t("Purpose")}</Label>
            <Select value={purpose} onValueChange={setPurpose}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKER_PURPOSE_SUGGESTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(humanize(value))}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {purpose === "custom" && (
              <Input
                value={customPurpose}
                onChange={(event) => setCustomPurpose(event.target.value)}
                placeholder={t("Describe the purpose")}
              />
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  value: "platform" as const,
                  title: "ZYRONEX Intelligence (default)",
                  body: "The platform handles models, keys and routing automatically. Nothing to configure.",
                },
                {
                  value: "custom" as const,
                  title: "Use my own provider account",
                  body: "Connect your own AI provider credentials for this worker.",
                },
              ]
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setAiMode(option.value)}
                className={cn(
                  "rounded-xl border p-4 text-start transition",
                  aiMode === option.value ? "border-primary ring-1 ring-primary/40" : "hover:border-primary/40",
                )}
              >
                <p className="text-sm font-semibold">{t(option.title)}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(option.body)}</p>
              </button>
            ))}
          </div>

          {aiMode === "custom" && (
            <div className="space-y-4 rounded-xl border p-4">
              <div className="space-y-2">
                <Label>{t("AI Provider")}</Label>
                <Select value={provider} onValueChange={setProvider}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WORKER_PROVIDER_SUGGESTIONS.map((value) => (
                      <SelectItem key={value} value={value}>
                        {t(humanize(value))}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {provider === "custom" && (
                  <Input
                    value={customProvider}
                    onChange={(event) => setCustomProvider(event.target.value)}
                    placeholder={t("Provider name")}
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="worker-api-key">{t("API Key")}</Label>
                <Input
                  id="worker-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                />
              </div>
              {(provider === "custom" || provider === "azure") && (
                <div className="space-y-2">
                  <Label htmlFor="worker-base-url">{t("Base URL")}</Label>
                  <Input
                    id="worker-base-url"
                    value={baseUrl}
                    onChange={(event) => setBaseUrl(event.target.value)}
                    placeholder="https://api.example.com/v1"
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="worker-model">{t("Model (optional)")}</Label>
                <Input
                  id="worker-model"
                  value={model}
                  onChange={(event) => setModel(event.target.value)}
                  placeholder={t("Model identifier")}
                />
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  disabled={testing || !apiKey.trim()}
                  onClick={handleTestConnection}
                >
                  {testing ? <Sparkles className="size-4 animate-pulse" /> : <PlugZap className="size-4" />}
                  {t("Test connection")}
                </Button>
                {testState === "ok" && (
                  <span className="text-xs font-medium text-emerald-500">{t("Connected successfully.")}</span>
                )}
                {testState === "error" && (
                  <span className="text-xs font-medium text-destructive">{t(testMessage)}</span>
                )}
              </div>
            </div>
          )}
        </div>
      )}


      {step === 3 && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("Language")}</Label>
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_LANGUAGES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("Timezone")}</Label>
            <Select value={timezone} onValueChange={setTimezone}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_TIMEZONES.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("Region")}</Label>
            <Select value={region} onValueChange={setRegion}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_REGIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-xl border p-4">
            <WorkerAvatar icon={icon} color={color} avatarUrl={avatarUrl || null} className="size-11" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{name || t("Untitled worker")}</p>
              <p className="truncate text-xs text-muted-foreground">
                {description || t("No description")}
              </p>
            </div>
            <Badge variant="secondary" className="ms-auto">
              {t("draft")}
            </Badge>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {[
              ["Type", humanize(resolvedType)],
              ["Purpose", humanize(resolvedPurpose)],
              ["AI Provider", humanize(resolvedProvider)],
              ["Model", model || "—"],
              ["Language", language],
              ["Timezone", timezone],
              ["Region", humanize(region)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <dt className="text-xs text-muted-foreground">{t(label!)}</dt>
                <dd className="truncate ps-2 text-xs font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => (step === 0 ? onCancel?.() : setStep((value) => value - 1))}
          className="gap-2"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {step === 0 ? t("Cancel") : t("Back")}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button
            type="button"
            disabled={!canContinue}
            onClick={() => setStep((value) => value + 1)}
            className="gap-2"
          >
            {t("Continue")}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </Button>
        ) : (
          <Button
            type="button"
            disabled={createWorker.isPending || !workspaceId}
            onClick={handleFinish}
            className="gap-2"
          >
            {createWorker.isPending ? <Sparkles className="size-4 animate-pulse" /> : <Check className="size-4" />}
            {t("Create Worker")}
          </Button>
        )}
      </div>
    </div>
  );
}
