import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

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
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import {
  WORKSPACE_LANGUAGES,
  WORKSPACE_PLANS,
  WORKSPACE_TIMEZONES,
} from "@/lib/workspace-options";
import { workspaceService } from "@/services/workspace-service";

const STEPS = ["Workspace name", "Logo", "Language", "Timezone", "Plan", "Finish"] as const;

export function CreateWorkspaceWizard({
  onCreated,
  onCancel,
}: {
  onCreated: (workspaceId: string) => void;
  onCancel?: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [logo, setLogo] = useState("");
  const [language, setLanguage] = useState("en");
  const [timezone, setTimezone] = useState("UTC");
  const [plan, setPlan] = useState("free");

  const canContinue = step !== 0 || name.trim().length > 1;

  async function finish() {
    setSubmitting(true);
    try {
      const workspaceId = await workspaceService.create(name, slug);
      if (logo.trim() || plan !== "free") {
        await workspaceService.update(workspaceId, {
          logo: logo.trim() || null,
          subscription_plan: plan,
        });
      }
      await workspaceService.saveSettings(workspaceId, { language, timezone });
      queryClient.removeQueries({ queryKey: ["workspaces", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success(t("Workspace created"));
      onCreated(workspaceId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not create workspace"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{t(STEPS[step] ?? "Finish")}</span>
          <span>
            {step + 1}/{STEPS.length}
          </span>
        </div>
        <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5" />
      </div>

      <div className="min-h-[168px] space-y-4">
        {step === 0 && (
          <>
            <div className="space-y-2">
              <Label htmlFor="wz-name">{t("Workspace name")}</Label>
              <Input
                id="wz-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme AI"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wz-slug">{t("Slug (optional)")}</Label>
              <Input
                id="wz-slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="acme-ai"
              />
            </div>
          </>
        )}

        {step === 1 && (
          <div className="space-y-2">
            <Label htmlFor="wz-logo">{t("Logo URL")}</Label>
            <Input
              id="wz-logo"
              value={logo}
              onChange={(event) => setLogo(event.target.value)}
              placeholder="https://…"
            />
            <p className="text-xs text-muted-foreground">
              {t("Optional. You can change the logo any time in workspace settings.")}
            </p>
          </div>
        )}

        {step === 2 && (
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
        )}

        {step === 3 && (
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
        )}

        {step === 4 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {WORKSPACE_PLANS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setPlan(option.value)}
                className={`rounded-xl border p-4 text-start transition ${
                  plan === option.value ? "border-primary bg-surface" : "hover:bg-surface"
                }`}
              >
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {t(option.label)}
                  {plan === option.value && <Check className="size-3.5 text-primary" />}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">{t(option.description)}</p>
              </button>
            ))}
          </div>
        )}

        {step === 5 && (
          <div className="space-y-3 rounded-xl border p-4 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              <Sparkles className="size-4 text-primary" /> {t("Ready to create")}
            </p>
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              {[
                [t("Workspace name"), name],
                [t("Language"), language],
                [t("Timezone"), timezone],
                [t("Plan"), plan],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3 border-b pb-1">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="truncate font-medium capitalize">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          className="gap-2"
          onClick={() => (step === 0 ? onCancel?.() : setStep(step - 1))}
          disabled={step === 0 && !onCancel}
        >
          <ArrowLeft className="size-4" /> {step === 0 ? t("Cancel") : t("Back")}
        </Button>
        {step < STEPS.length - 1 ? (
          <Button type="button" className="gap-2" disabled={!canContinue} onClick={() => setStep(step + 1)}>
            {t("Continue")} <ArrowRight className="size-4" />
          </Button>
        ) : (
          <Button type="button" className="gap-2" disabled={submitting} onClick={finish}>
            {submitting ? t("Please wait…") : t("Create workspace")}
          </Button>
        )}
      </div>
    </div>
  );
}
