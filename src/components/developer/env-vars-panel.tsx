import { useState } from "react";
import { Eye, EyeOff, Plus, Trash2, Variable } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useDeveloperMutations,
  useDeveloperProjects,
  useEnvironmentVariables,
} from "@/hooks/use-developer";
import { PROJECT_ENVIRONMENTS } from "@/lib/developer/catalog";
import { useI18n } from "@/lib/i18n";

/** Project configuration values. Secret values are masked until revealed. */
export function EnvVarsPanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { data: vars = [], isLoading } = useEnvironmentVariables(workspaceId, canManage);
  const { data: projects = [] } = useDeveloperProjects(workspaceId);
  const mutations = useDeveloperMutations(workspaceId);

  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [isSecret, setIsSecret] = useState(false);
  const [environment, setEnvironment] = useState<string>(PROJECT_ENVIRONMENTS[0]);
  const [projectId, setProjectId] = useState<string>("none");
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});

  if (!canManage) {
    return (
      <EmptyState
        icon={Variable}
        title="Restricted"
        description="Only workspace owners and admins can view environment variables."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 xl:grid-cols-5">
        <div className="space-y-2">
          <Label htmlFor="env-key">{t("Key")}</Label>
          <Input
            id="env-key"
            placeholder="API_BASE_URL"
            value={key}
            onChange={(e) => setKey(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="env-value">{t("Value")}</Label>
          <Input id="env-value" value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
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
          <Label>{t("Project")}</Label>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("Workspace wide")}</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <Switch id="env-secret" checked={isSecret} onCheckedChange={setIsSecret} />
            <Label htmlFor="env-secret" className="text-xs">
              {t("Secret")}
            </Label>
          </div>
          <Button
            disabled={!key.trim()}
            onClick={async () => {
              try {
                await mutations.saveEnvVar.mutateAsync({
                  key,
                  value,
                  isSecret,
                  environment,
                  projectId: projectId === "none" ? null : projectId,
                });
                toast.success(t("Variable saved"));
                setKey("");
                setValue("");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : t("Action failed"));
              }
            }}
          >
            <Plus className="me-2 size-4" />
            {t("Add")}
          </Button>
        </div>
      </div>

      {!isLoading && vars.length === 0 ? (
        <EmptyState
          icon={Variable}
          title="No environment variables"
          description="Store non-sensitive configuration for your projects here."
          compact
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Key")}</TableHead>
                <TableHead>{t("Value")}</TableHead>
                <TableHead>{t("Environment")}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {vars.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs">{item.key}</TableCell>
                  <TableCell className="font-mono text-xs">
                    {item.is_secret && !revealed[item.id] ? "••••••••••" : (item.value ?? "—")}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{item.environment}</Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    {item.is_secret && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("Toggle value")}
                        onClick={() =>
                          setRevealed((prev) => ({ ...prev, [item.id]: !prev[item.id] }))
                        }
                      >
                        {revealed[item.id] ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      aria-label={t("Delete")}
                      onClick={() => void mutations.deleteEnvVar.mutateAsync(item.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
