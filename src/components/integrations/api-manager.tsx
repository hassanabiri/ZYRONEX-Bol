import { useState } from "react";
import { Copy, KeyRound, Plus, RotateCcw, ShieldOff, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useApiKeys, useIntegrationMutations } from "@/hooks/use-integrations";
import { useI18n } from "@/lib/i18n";
import { API_SCOPES } from "@/lib/integrations/catalog";

/** API key manager: issue, scope, rotate and revoke workspace API keys. */
export function ApiManager({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: keys = [], isLoading } = useApiKeys(workspaceId);
  const mutations = useIntegrationMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<"production" | "sandbox">("production");
  const [scopes, setScopes] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState("");
  const [issued, setIssued] = useState<string | null>(null);

  async function run<T>(label: string, action: Promise<T>) {
    try {
      const value = await action;
      toast.success(t(label));
      return value;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
      return null;
    }
  }

  async function handleCreate() {
    const created = (await run(
      "API key created",
      mutations.createApiKey.mutateAsync({
        name: name.trim(),
        scopes,
        environment,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      }),
    )) as { key?: string } | null;
    if (created) {
      setOpen(false);
      setName("");
      setScopes([]);
      setExpiresAt("");
      if (created.key) setIssued(created.key);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("API keys")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("Scoped, workspace-isolated keys for the public API.")}
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="me-2 size-4" />
          {t("Create key")}
        </Button>
      </div>

      {!isLoading && keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t("No API keys yet")}
          description={t("Issue a scoped key to call the ZYRONEX API from your own systems.")}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Name")}</TableHead>
                    <TableHead>{t("Prefix")}</TableHead>
                    <TableHead>{t("Environment")}</TableHead>
                    <TableHead>{t("Scopes")}</TableHead>
                    <TableHead>{t("Last used")}</TableHead>
                    <TableHead className="text-end">{t("Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {keys.map((key) => (
                    <TableRow key={key.id}>
                      <TableCell>
                        <p className="font-medium">{key.name}</p>
                        {key.revoked_at && (
                          <Badge variant="destructive" className="mt-1">
                            {t("Revoked")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{key.prefix}</TableCell>
                      <TableCell className="capitalize">{key.environment}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {key.scopes.length}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {key.last_used_at ? new Date(key.last_used_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="space-x-1 text-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t("Rotate")}
                          onClick={async () => {
                            const value = (await run(
                              "API key rotated",
                              mutations.rotateApiKey.mutateAsync(key),
                            )) as { key?: string } | null;
                            if (value?.key) setIssued(value.key);
                          }}
                        >
                          <RotateCcw className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t("Revoke")}
                          onClick={() =>
                            void run("API key revoked", mutations.revokeApiKey.mutateAsync(key))
                          }
                        >
                          <ShieldOff className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() =>
                            void run("API key deleted", mutations.deleteApiKey.mutateAsync(key))
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("Create API key")}</DialogTitle>
            <DialogDescription>
              {t("The key is displayed once. Only its hash is stored.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="key-name">{t("Name")}</Label>
              <Input id="key-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Environment")}</Label>
              <Select
                value={environment}
                onValueChange={(value) => setEnvironment(value as "production" | "sandbox")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">{t("Production")}</SelectItem>
                  <SelectItem value="sandbox">{t("Sandbox")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="key-exp">{t("Expires at")}</Label>
              <Input
                id="key-exp"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Scopes")}</Label>
              <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-md border p-2">
                {API_SCOPES.map((scope) => (
                  <label key={scope} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={scopes.includes(scope)}
                      onChange={(e) =>
                        setScopes((prev) =>
                          e.target.checked ? [...prev, scope] : prev.filter((x) => x !== scope),
                        )
                      }
                    />
                    <span className="font-mono">{scope}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={!name.trim() || scopes.length === 0}
            >
              {t("Create key")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(issued)} onOpenChange={(value) => !value && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Your new API key")}</DialogTitle>
            <DialogDescription>
              {t("Copy this value now — it is not shown again.")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{issued}</code>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                void navigator.clipboard.writeText(issued ?? "");
                toast.success(t("Copied"));
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
