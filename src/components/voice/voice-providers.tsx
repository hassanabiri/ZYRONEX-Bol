import { useState } from "react";
import { Plus, Server, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { useVoiceMutations } from "@/hooks/use-voice";
import { useI18n } from "@/lib/i18n";
import {
  PROVIDER_STATUS_LABELS,
  VOICE_PROVIDERS,
  VOICE_REGIONS,
  getVoiceProvider,
  type VoiceProviderKind,
} from "@/lib/voice/catalog";
import type { VoiceProvider } from "@/services/voice-service";

/**
 * Voice provider architecture. Providers are registered and configured, but no
 * telephony traffic is sent — transport is reserved for a future sprint.
 */
export function VoiceProviders({
  workspaceId,
  providers,
  canManage,
}: {
  workspaceId: string | undefined;
  providers: VoiceProvider[];
  canManage: boolean;
}) {
  const { t } = useI18n();
  const mutations = useVoiceMutations(workspaceId);
  const [kind, setKind] = useState<VoiceProviderKind | null>(null);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("global");

  async function submit() {
    if (!kind || !workspaceId) return;
    try {
      await mutations.createProvider.mutateAsync({
        kind,
        name: name.trim() || (getVoiceProvider(kind)?.name ?? kind),
        region,
        description: getVoiceProvider(kind)?.description ?? null,
        capabilities: getVoiceProvider(kind)?.capabilities ?? [],
        status: "prepared",
      });
      toast.success(t("Provider prepared"));
      setKind(null);
      setName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Configured providers")}</CardTitle>
          <CardDescription>
            {t("Credentials are stored in the encrypted vault; no provider is dialled yet.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <EmptyState
              compact
              icon={Server}
              title="No voice providers yet"
              description="Prepare a provider so numbers can be attached to it later."
            />
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="flex flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold">{provider.name}</p>
                      <Badge variant="outline">{t(PROVIDER_STATUS_LABELS[provider.status])}</Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {provider.kind} · {provider.region}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={provider.enabled}
                        onCheckedChange={(enabled) =>
                          mutations.updateProvider.mutate({
                            provider,
                            patch: { enabled, status: enabled ? "pending" : "prepared" },
                          })
                        }
                        aria-label={t("Enable provider")}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => mutations.removeProvider.mutate(provider)}
                        aria-label={t("Remove provider")}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {VOICE_PROVIDERS.map((definition) => (
          <Card key={definition.id}>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">{definition.name}</CardTitle>
              <CardDescription className="text-xs">{t(definition.description)}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1">
                {definition.capabilities.map((capability) => (
                  <Badge key={capability} variant="secondary" className="text-[10px]">
                    {capability}
                  </Badge>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={!canManage}
                onClick={() => {
                  setKind(definition.id);
                  setName(definition.name);
                }}
              >
                <Plus className="size-4" />
                {t("Prepare")}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={Boolean(kind)} onOpenChange={(open) => !open && setKind(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Prepare voice provider")}</DialogTitle>
            <DialogDescription>
              {t("Registers the provider for this workspace. Connection happens in a later sprint.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider-name">{t("Display name")}</Label>
              <Input id="provider-name" value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Region")}</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOICE_REGIONS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {t(item.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKind(null)}>
              {t("Cancel")}
            </Button>
            <Button onClick={submit} disabled={mutations.createProvider.isPending}>
              {t("Prepare provider")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
