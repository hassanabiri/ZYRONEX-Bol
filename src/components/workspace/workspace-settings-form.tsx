import { AlertTriangle, Building2, Globe2, Palette, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspaceMutations, useWorkspaceSettings } from "@/hooks/use-workspace-data";
import { useI18n } from "@/lib/i18n";
import {
  WORKSPACE_LANGUAGES,
  WORKSPACE_PLANS,
  WORKSPACE_REGIONS,
  WORKSPACE_TIMEZONES,
} from "@/lib/workspace-options";
import type { Workspace } from "@/services/types";

export function WorkspaceSettingsForm({
  workspace,
  onDeleted,
}: {
  workspace: Workspace | null;
  onDeleted?: () => void;
}) {
  const { t } = useI18n();
  const { data: settings } = useWorkspaceSettings(workspace?.id);
  const mutations = useWorkspaceMutations(workspace?.id);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [logo, setLogo] = useState("");
  const [plan, setPlan] = useState("free");
  const [brandColor, setBrandColor] = useState("");
  const [domain, setDomain] = useState("");
  const [region, setRegion] = useState("us-east");
  const [language, setLanguage] = useState("en");
  const [timezone, setTimezone] = useState("UTC");
  const [confirmName, setConfirmName] = useState("");

  useEffect(() => {
    if (!workspace) return;
    setName(workspace.name);
    setSlug(workspace.slug);
    setLogo(workspace.logo ?? "");
    setPlan(workspace.subscription_plan);
  }, [workspace]);

  useEffect(() => {
    if (!settings) return;
    setBrandColor(settings.brand_color ?? "");
    setDomain(settings.domain ?? "");
    setRegion(settings.region);
    setLanguage(settings.language);
    setTimezone(settings.timezone);
  }, [settings]);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    try {
      await mutations.updateWorkspace.mutateAsync({
        name: name.trim(),
        slug: slug.trim(),
        logo: logo.trim() || null,
        subscription_plan: plan,
      });
      await mutations.saveSettings.mutateAsync({
        brand_color: brandColor.trim() || null,
        domain: domain.trim() || null,
        region,
        language,
        timezone,
      });
      toast.success(t("Workspace settings saved"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not save settings"));
    }
  }

  async function handleDelete() {
    try {
      await mutations.deleteWorkspace.mutateAsync();
      toast.success(t("Workspace deleted"));
      onDeleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not delete workspace"));
    }
  }

  const saving = mutations.updateWorkspace.isPending || mutations.saveSettings.isPending;

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <Card className="panel-shadow">
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <Building2 className="size-4 text-muted-foreground" />
          <div className="space-y-1">
            <CardTitle className="text-base">{t("General")}</CardTitle>
            <CardDescription>{t("Core identity of this workspace.")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ws-name">{t("Workspace name")}</Label>
            <Input id="ws-name" value={name} onChange={(event) => setName(event.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws-slug">{t("Slug")}</Label>
            <Input id="ws-slug" value={slug} onChange={(event) => setSlug(event.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>{t("Subscription plan")}</Label>
            <Select value={plan} onValueChange={setPlan}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKSPACE_PLANS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.label)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="panel-shadow">
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <Palette className="size-4 text-muted-foreground" />
          <div className="space-y-1">
            <CardTitle className="text-base">{t("Branding")}</CardTitle>
            <CardDescription>{t("Logo and accent color used across the workspace.")}</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ws-logo">{t("Logo URL")}</Label>
            <Input
              id="ws-logo"
              value={logo}
              onChange={(event) => setLogo(event.target.value)}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ws-color">{t("Brand color")}</Label>
            <Input
              id="ws-color"
              value={brandColor}
              onChange={(event) => setBrandColor(event.target.value)}
              placeholder="#22d3ee"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="panel-shadow">
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <Globe2 className="size-4 text-muted-foreground" />
          <div className="space-y-1">
            <CardTitle className="text-base">{t("Domain, region & locale")}</CardTitle>
            <CardDescription>
              {t("Where this workspace runs and how it is presented.")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="ws-domain">{t("Custom domain")}</Label>
            <Input
              id="ws-domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="agents.company.com"
            />
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
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button type="submit" className="gap-2" disabled={saving}>
          <Save className="size-4" /> {saving ? t("Please wait…") : t("Save changes")}
        </Button>
      </div>

      <Card className="border-destructive/40 panel-shadow">
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <AlertTriangle className="size-4 text-destructive" />
          <div className="space-y-1">
            <CardTitle className="text-base text-destructive">{t("Danger Zone")}</CardTitle>
            <CardDescription>
              {t("Deleting a workspace permanently removes its members, settings and roles.")}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive">
                {t("Delete workspace")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t("Delete workspace")}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t("This action cannot be undone. Type the workspace name to confirm.")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <Input
                value={confirmName}
                onChange={(event) => setConfirmName(event.target.value)}
                placeholder={workspace?.name ?? ""}
              />
              <AlertDialogFooter>
                <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={confirmName !== workspace?.name}
                  onClick={handleDelete}
                >
                  {t("Delete")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </form>
  );
}
