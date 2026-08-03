import { useState } from "react";
import { Boxes, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { useDeveloperMutations, useDeveloperProjects } from "@/hooks/use-developer";
import {
  API_VERSIONS,
  PROJECT_ENVIRONMENTS,
  type DeveloperProjectStatus,
} from "@/lib/developer/catalog";
import { useI18n } from "@/lib/i18n";

const STATUSES: DeveloperProjectStatus[] = ["draft", "active", "suspended", "archived"];

/** Developer projects: the container for keys, apps, env vars and rate limits. */
export function ProjectsPanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { data: projects = [], isLoading } = useDeveloperProjects(workspaceId);
  const mutations = useDeveloperMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [environment, setEnvironment] = useState<string>(PROJECT_ENVIRONMENTS[0]);
  const [apiVersion, setApiVersion] = useState<string>(API_VERSIONS[0]);
  const [rateLimit, setRateLimit] = useState("600");

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
          <h3 className="text-sm font-semibold">{t("Projects")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("Group applications, keys and environment configuration per product.")}
          </p>
        </div>
        {canManage && (
          <Button onClick={() => setOpen(true)}>
            <Plus className="me-2 size-4" />
            {t("New project")}
          </Button>
        )}
      </div>

      {!isLoading && projects.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No developer projects yet"
          description="Create a project to organise API keys, OAuth apps and environment variables."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.map((project) => (
            <Card key={project.id} className="flex flex-col panel-shadow">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{project.name}</CardTitle>
                  <Badge variant="outline">{t(project.status)}</Badge>
                </div>
                <CardDescription className="line-clamp-2">
                  {project.description ?? t("No description provided.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <div className="flex flex-wrap gap-2 font-mono text-[11px] text-muted-foreground">
                  <span className="rounded-md border px-2 py-1">{project.slug}</span>
                  <span className="rounded-md border px-2 py-1">{project.environment}</span>
                  <span className="rounded-md border px-2 py-1">{project.api_version}</span>
                  <span className="rounded-md border px-2 py-1">
                    {project.rate_limit_per_min} {t("req/min")}
                  </span>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2">
                    <Select
                      value={project.status}
                      onValueChange={(status) =>
                        void run(
                          "Project updated",
                          mutations.updateProject.mutateAsync({
                            id: project.id,
                            patch: { status: status as DeveloperProjectStatus },
                          }),
                        )
                      }
                    >
                      <SelectTrigger className="h-9 flex-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {t(status)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() =>
                        void run("Project deleted", mutations.deleteProject.mutateAsync(project.id))
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("New project")}</DialogTitle>
            <DialogDescription>
              {t("Projects are scoped to this workspace and carry their own API limits.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="project-name">{t("Name")}</Label>
              <Input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-desc">{t("Description")}</Label>
              <Textarea
                id="project-desc"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{t("Environment")}</Label>
                <Select value={environment} onValueChange={setEnvironment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_ENVIRONMENTS.map((env) => (
                      <SelectItem key={env} value={env}>
                        {t(env)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("API version")}</Label>
                <Select value={apiVersion} onValueChange={setApiVersion}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {API_VERSIONS.map((version) => (
                      <SelectItem key={version} value={version}>
                        {version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="project-rate">{t("Rate limit")}</Label>
                <Input
                  id="project-rate"
                  inputMode="numeric"
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value.replace(/\D/g, ""))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={!name.trim()}
              onClick={async () => {
                const ok = await run(
                  "Project created",
                  mutations.createProject.mutateAsync({
                    name: name.trim(),
                    description: description.trim() || null,
                    environment,
                    api_version: apiVersion,
                    rate_limit_per_min: Number(rateLimit) || 600,
                  }),
                );
                if (ok) {
                  setOpen(false);
                  setName("");
                  setDescription("");
                }
              }}
            >
              {t("Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
