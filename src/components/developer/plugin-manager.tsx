import { useState } from "react";
import { ArrowUpCircle, Plus, Power, PowerOff, Puzzle, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useDeveloperMutations, usePlugins } from "@/hooks/use-developer";
import { PLUGIN_PERMISSIONS } from "@/lib/developer/catalog";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Plugin registry: install, enable, disable, update and remove extensions. */
export function PluginManager({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { data: plugins = [], isLoading } = usePlugins(workspaceId);
  const mutations = useDeveloperMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [publisher, setPublisher] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [description, setDescription] = useState("");
  const [permissions, setPermissions] = useState<string[]>([]);
  const [dependencies, setDependencies] = useState("");

  async function run(label: string, action: Promise<unknown>) {
    try {
      await action;
      toast.success(t(label));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
      return false;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("Plugins")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("Extensions run with declared permissions and versioned dependencies.")}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="me-2 size-4" />
            {t("Install plugin")}
          </Button>
        )}
      </div>

      {!isLoading && plugins.length === 0 ? (
        <EmptyState
          icon={Puzzle}
          title="No plugins installed"
          description="Install a plugin to extend workers, workflows or the developer surface."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plugins.map((plugin) => (
            <Card key={plugin.id} className="flex flex-col panel-shadow">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{plugin.name}</CardTitle>
                  <Badge variant={plugin.status === "enabled" ? "default" : "outline"}>
                    {t(plugin.status)}
                  </Badge>
                </div>
                <CardDescription className="line-clamp-2">
                  {plugin.description ?? t("No description provided.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <p className="text-xs text-muted-foreground">
                  {plugin.publisher} · v{plugin.version}
                  {plugin.latest_version !== plugin.version && ` → v${plugin.latest_version}`}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {plugin.permissions.map((permission) => (
                    <span
                      key={permission}
                      className="rounded-md border px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                    >
                      {permission}
                    </span>
                  ))}
                </div>
                {plugin.dependencies.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("Dependencies")}: {plugin.dependencies.join(", ")}
                  </p>
                )}
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void run(
                          plugin.status === "enabled" ? "Plugin disabled" : "Plugin enabled",
                          mutations.setPluginStatus.mutateAsync({
                            plugin,
                            status: plugin.status === "enabled" ? "disabled" : "enabled",
                          }),
                        )
                      }
                    >
                      {plugin.status === "enabled" ? (
                        <PowerOff className="me-2 size-4" />
                      ) : (
                        <Power className="me-2 size-4" />
                      )}
                      {plugin.status === "enabled" ? t("Disable") : t("Enable")}
                    </Button>
                    {plugin.latest_version !== plugin.version && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void run("Plugin updated", mutations.updatePlugin.mutateAsync(plugin))
                        }
                      >
                        <ArrowUpCircle className="me-2 size-4" />
                        {t("Update")}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      aria-label={t("Remove")}
                      onClick={() =>
                        void run("Plugin removed", mutations.deletePlugin.mutateAsync(plugin.id))
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Install plugin")}</DialogTitle>
            <DialogDescription>
              {t("Declare the permissions and dependencies the plugin requires.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="plugin-name">{t("Name")}</Label>
                <Input id="plugin-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="plugin-version">{t("Version")}</Label>
                <Input
                  id="plugin-version"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-publisher">{t("Publisher")}</Label>
              <Input
                id="plugin-publisher"
                value={publisher}
                onChange={(e) => setPublisher(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-desc">{t("Description")}</Label>
              <Textarea
                id="plugin-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Permissions")}</Label>
              <div className="flex flex-wrap gap-2">
                {PLUGIN_PERMISSIONS.map((permission) => (
                  <button
                    key={permission}
                    type="button"
                    onClick={() =>
                      setPermissions((prev) =>
                        prev.includes(permission)
                          ? prev.filter((item) => item !== permission)
                          : [...prev, permission],
                      )
                    }
                    className={cn(
                      "rounded-md border px-2 py-1 font-mono text-[11px]",
                      permissions.includes(permission)
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {permission}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="plugin-deps">{t("Dependencies")}</Label>
              <Input
                id="plugin-deps"
                placeholder="core@1.x, voice@2.x"
                value={dependencies}
                onChange={(e) => setDependencies(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={!name.trim() || !publisher.trim()}
              onClick={async () => {
                const ok = await run(
                  "Plugin installed",
                  mutations.installPlugin.mutateAsync({
                    name: name.trim(),
                    publisher: publisher.trim(),
                    description: description.trim() || null,
                    version: version.trim(),
                    permissions,
                    dependencies: dependencies
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  }),
                );
                if (ok) {
                  setOpen(false);
                  setName("");
                  setPublisher("");
                  setDescription("");
                  setPermissions([]);
                  setDependencies("");
                }
              }}
            >
              {t("Install")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
