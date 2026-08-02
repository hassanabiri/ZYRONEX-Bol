import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useIntegrationMutations } from "@/hooks/use-integrations";
import { useI18n } from "@/lib/i18n";
import { CONFLICT_STRATEGIES, type ProviderDefinition } from "@/lib/integrations/catalog";
import type { Integration } from "@/services/integration-service";

const STEPS = ["Connection", "Authentication", "Configuration", "Permissions", "Verification"];

export function ConnectionWizard({
  provider,
  workspaceId,
  open,
  onOpenChange,
  onCreated,
}: {
  provider: ProviderDefinition | null;
  workspaceId: string | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (integration: Integration) => void;
}) {
  const { t } = useI18n();
  const { createIntegration, saveCredentials, verifyIntegration } =
    useIntegrationMutations(workspaceId);

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [syncMode, setSyncMode] = useState("manual");
  const [conflict, setConflict] = useState<string>("source_wins");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [config, setConfig] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ status: string; message: string } | null>(null);

  useEffect(() => {
    if (!open || !provider) return;
    setStep(0);
    setName(provider.name);
    setDescription(provider.description);
    setEnvironment("production");
    setSyncMode(provider.supportsSync ? "scheduled" : "manual");
    setConflict("source_wins");
    setSecrets({});
    setConfig({});
    setScopes(provider.scopes);
    setResult(null);
  }, [open, provider]);

  const missingSecrets = useMemo(
    () =>
      (provider?.credentialFields ?? []).filter(
        (field) => !field.optional && !secrets[field.key]?.trim(),
      ),
    [provider, secrets],
  );
  const missingConfig = useMemo(
    () =>
      (provider?.configFields ?? []).filter(
        (field) => !field.optional && !config[field.key]?.trim(),
      ),
    [provider, config],
  );

  if (!provider) return null;

  const canAdvance =
    (step === 0 && name.trim().length > 0) ||
    (step === 1 && missingSecrets.length === 0) ||
    (step === 2 && missingConfig.length === 0) ||
    step === 3 ||
    step === 4;

  async function handleFinish() {
    if (!workspaceId || !provider) return;
    setBusy(true);
    try {
      const integration = await createIntegration.mutateAsync({
        provider: provider.id,
        category: provider.category,
        name: name.trim(),
        description: description.trim() || null,
        auth_type: provider.authType,
        environment,
        sync_mode: syncMode as Integration["sync_mode"],
        scopes,
        config: { ...config, conflict_strategy: conflict },
        enabled: true,
      });
      const secretPayload = Object.fromEntries(
        Object.entries(secrets).filter(([, value]) => value.trim().length > 0),
      );
      if (Object.keys(secretPayload).length > 0) {
        await saveCredentials.mutateAsync({
          integrationId: integration.id,
          values: secretPayload,
        });
      }
      const verification = await verifyIntegration.mutateAsync(integration);
      setResult(verification);
      toast.success(t("Connection created"));
      onCreated?.(integration);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("Connect")} {provider.name}
          </DialogTitle>
          <DialogDescription>
            {t("Step")} {step + 1} {t("of")} {STEPS.length} — {t(STEPS[step]!)}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1.5">
          {STEPS.map((label, index) => (
            <Badge key={label} variant={index === step ? "default" : "outline"}>
              {t(label)}
            </Badge>
          ))}
        </div>

        <div className="space-y-4 py-2">
          {step === 0 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="conn-name">{t("Connection name")}</Label>
                <Input id="conn-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="conn-desc">{t("Description")}</Label>
                <Textarea
                  id="conn-desc"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("Environment")}</Label>
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">{t("Production")}</SelectItem>
                    <SelectItem value="sandbox">{t("Sandbox")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Secrets are encrypted before storage and never returned to the browser again.",
                )}
              </p>
              {provider.credentialFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`cred-${field.key}`}>
                    {t(field.label)}
                    {field.optional ? ` (${t("optional")})` : ""}
                  </Label>
                  <Input
                    id={`cred-${field.key}`}
                    type={field.secret ? "password" : "text"}
                    autoComplete="off"
                    value={secrets[field.key] ?? ""}
                    onChange={(e) =>
                      setSecrets((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </div>
              ))}
              {provider.credentialFields.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("This provider does not require credentials.")}
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {(provider.configFields ?? []).map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`cfg-${field.key}`}>{t(field.label)}</Label>
                  <Input
                    id={`cfg-${field.key}`}
                    placeholder={field.placeholder ?? ""}
                    value={config[field.key] ?? ""}
                    onChange={(e) =>
                      setConfig((prev) => ({ ...prev, [field.key]: e.target.value }))
                    }
                  />
                </div>
              ))}
              <div className="space-y-2">
                <Label>{t("Synchronization mode")}</Label>
                <Select value={syncMode} onValueChange={setSyncMode}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">{t("Manual")}</SelectItem>
                    <SelectItem value="automatic">{t("Automatic")}</SelectItem>
                    <SelectItem value="scheduled">{t("Scheduled")}</SelectItem>
                    <SelectItem value="realtime">{t("Real-time")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("Conflict resolution")}</Label>
                <Select value={conflict} onValueChange={setConflict}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONFLICT_STRATEGIES.map((strategy) => (
                      <SelectItem key={strategy} value={strategy}>
                        {strategy.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("Only the scopes selected here will be requested for this connection.")}
              </p>
              {provider.scopes.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {t("This provider does not define scopes.")}
                </p>
              )}
              {provider.scopes.map((scope) => (
                <label key={scope} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onCheckedChange={(checked) =>
                      setScopes((prev) =>
                        checked ? [...prev, scope] : prev.filter((item) => item !== scope),
                      )
                    }
                  />
                  <span className="font-mono text-xs">{scope}</span>
                </label>
              ))}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-3 rounded-lg border p-4 text-sm">
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t("Provider")}</span>
                <span className="font-medium">{provider.name}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t("Authentication")}</span>
                <span className="font-medium">{provider.authType}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t("Secrets provided")}</span>
                <span className="font-medium">{Object.keys(secrets).length}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-muted-foreground">{t("Scopes")}</span>
                <span className="font-medium">{scopes.length}</span>
              </div>
              {result && <p className="text-xs text-muted-foreground">{result.message}</p>}
              <p className="text-xs text-muted-foreground">
                {t(
                  "Creating the connection stores the credentials and runs a verification check.",
                )}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => (step === 0 ? onOpenChange(false) : setStep((s) => s - 1))}
            disabled={busy}
          >
            {step === 0 ? t("Cancel") : t("Back")}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button onClick={() => setStep((s) => s + 1)} disabled={!canAdvance}>
              {t("Continue")}
            </Button>
          ) : (
            <Button onClick={() => void handleFinish()} disabled={busy || !workspaceId}>
              {t("Create connection")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
