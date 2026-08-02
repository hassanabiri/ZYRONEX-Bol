import { useMemo, useState } from "react";
import {
  Archive,
  KeyRound,
  MoreHorizontal,
  Plug,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIntegrationMutations } from "@/hooks/use-integrations";
import { useI18n } from "@/lib/i18n";
import {
  getProvider,
  INTEGRATION_CATEGORIES,
  STATUS_LABELS,
  STATUS_TONE,
} from "@/lib/integrations/catalog";
import type { Integration } from "@/services/integration-service";

function relative(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

/** Connected integrations with health, credential and lifecycle actions. */
export function ConnectionsTable({
  workspaceId,
  integrations,
  loading,
  onBrowseCatalog,
}: {
  workspaceId: string | undefined;
  integrations: Integration[];
  loading?: boolean;
  onBrowseCatalog: () => void;
}) {
  const { t } = useI18n();
  const mutations = useIntegrationMutations(workspaceId);
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [credentialTarget, setCredentialTarget] = useState<Integration | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});

  const rows = useMemo(() => {
    const query = term.trim().toLowerCase();
    return integrations.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (status !== "all" && item.status !== status) return false;
      if (!query) return true;
      return item.name.toLowerCase().includes(query) || item.provider.includes(query);
    });
  }, [integrations, term, category, status]);

  async function run(label: string, action: Promise<unknown>) {
    try {
      await action;
      toast.success(t(label));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  if (!loading && integrations.length === 0) {
    return (
      <EmptyState
        icon={Plug}
        title={t("No connections yet")}
        description={t("Connect your first external service to start routing data through the hub.")}
        action={<Button onClick={onBrowseCatalog}>{t("Browse catalog")}</Button>}
      />
    );
  }

  const credentialFields = credentialTarget
    ? (getProvider(credentialTarget.provider)?.credentialFields ?? [])
    : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          className="sm:max-w-xs"
          placeholder={t("Search connections")}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All categories")}</SelectItem>
            {INTEGRATION_CATEGORIES.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {t(item.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All statuses")}</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {t(label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Connection")}</TableHead>
                  <TableHead>{t("Category")}</TableHead>
                  <TableHead>{t("Status")}</TableHead>
                  <TableHead>{t("Enabled")}</TableHead>
                  <TableHead>{t("Last sync")}</TableHead>
                  <TableHead className="text-end">{t("Actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((integration) => (
                  <TableRow key={integration.id}>
                    <TableCell>
                      <p className="font-medium">{integration.name}</p>
                      <p className="text-xs text-muted-foreground">{integration.provider}</p>
                    </TableCell>
                    <TableCell className="capitalize">{integration.category}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_TONE[integration.status]}>
                        {t(STATUS_LABELS[integration.status])}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={integration.enabled}
                        onCheckedChange={(checked) =>
                          void run(
                            checked ? "Connection enabled" : "Connection paused",
                            mutations.toggleIntegration.mutateAsync({ integration, enabled: checked }),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {relative(integration.last_sync_at)}
                    </TableCell>
                    <TableCell className="text-end">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() =>
                              void run(
                                "Verification finished",
                                mutations.verifyIntegration.mutateAsync(integration),
                              )
                            }
                          >
                            <ShieldCheck className="me-2 size-4" />
                            {t("Test connection")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              void run(
                                "Sync queued",
                                mutations.queueSync.mutateAsync({ integration }),
                              )
                            }
                          >
                            <RefreshCw className="me-2 size-4" />
                            {t("Sync now")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              setSecrets({});
                              setCredentialTarget(integration);
                            }}
                          >
                            <KeyRound className="me-2 size-4" />
                            {t("Update credentials")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() =>
                              void run(
                                "Credentials revoked",
                                mutations.revokeCredentials.mutateAsync(integration.id),
                              )
                            }
                          >
                            {t("Revoke credentials")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() =>
                              void run(
                                "Connection archived",
                                mutations.archiveIntegration.mutateAsync(integration),
                              )
                            }
                          >
                            <Archive className="me-2 size-4" />
                            {t("Archive")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() =>
                              void run(
                                "Connection deleted",
                                mutations.deleteIntegration.mutateAsync(integration),
                              )
                            }
                          >
                            <Trash2 className="me-2 size-4" />
                            {t("Delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                      {t("No connections match your filters.")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(credentialTarget)}
        onOpenChange={(open) => !open && setCredentialTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Update credentials")}</DialogTitle>
            <DialogDescription>
              {t("Values are encrypted with AES-256-GCM before they reach the database.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {credentialFields.map((field) => (
              <div key={field.key} className="space-y-2">
                <Label htmlFor={`rot-${field.key}`}>{t(field.label)}</Label>
                <Input
                  id={`rot-${field.key}`}
                  type={field.secret ? "password" : "text"}
                  autoComplete="off"
                  value={secrets[field.key] ?? ""}
                  onChange={(event) =>
                    setSecrets((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                />
              </div>
            ))}
            {credentialFields.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {t("This provider does not require credentials.")}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCredentialTarget(null)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={!credentialTarget || Object.keys(secrets).length === 0}
              onClick={() => {
                const target = credentialTarget;
                if (!target) return;
                void run(
                  "Credentials updated",
                  mutations.saveCredentials.mutateAsync({
                    integrationId: target.id,
                    values: secrets,
                  }),
                ).then(() => setCredentialTarget(null));
              }}
            >
              {t("Save credentials")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
