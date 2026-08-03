import { useState } from "react";
import { Copy, KeyRound, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
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
import { useDeveloperMutations, useDeveloperProjects, useOAuthClients } from "@/hooks/use-developer";
import { OAUTH_GRANT_TYPES } from "@/lib/developer/catalog";
import { useI18n } from "@/lib/i18n";
import { API_SCOPES } from "@/lib/integrations/catalog";
import { cn } from "@/lib/utils";

/** OAuth applications developers register to act on behalf of a workspace. */
export function OAuthClientsPanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { data: clients = [], isLoading } = useOAuthClients(workspaceId);
  const { data: projects = [] } = useDeveloperProjects(workspaceId);
  const mutations = useDeveloperMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [redirects, setRedirects] = useState("");
  const [scopes, setScopes] = useState<string[]>([]);
  const [grants, setGrants] = useState<string[]>(["authorization_code"]);
  const [issued, setIssued] = useState<{ clientId: string; secret: string } | null>(null);

  const toggle = (list: string[], value: string) =>
    list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

  function copy(value: string) {
    void navigator.clipboard.writeText(value);
    toast.success(t("Copied to clipboard"));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("Applications")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("OAuth clients with scoped access, redirect URIs and rotatable secrets.")}
          </p>
        </div>
        {canManage && <Button onClick={() => setOpen(true)}>{t("Register application")}</Button>}
      </div>

      {!isLoading && clients.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No applications registered"
          description="Register an OAuth client to let an external app act on this workspace."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {clients.map((client) => (
            <Card key={client.id} className="panel-shadow">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{client.name}</CardTitle>
                  <Badge variant="outline">{t(client.status)}</Badge>
                </div>
                <CardDescription className="font-mono text-xs">{client.client_id}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    {t("Secret")}: <span className="font-mono">{client.secret_preview ?? "—"}</span>
                  </p>
                  <p className="break-all">
                    {t("Redirect URIs")}: {client.redirect_uris.join(", ") || "—"}
                  </p>
                  <p>
                    {t("Grants")}: {client.grant_types.join(", ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {client.scopes.map((scope) => (
                    <span
                      key={scope}
                      className="rounded-md border px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                    >
                      {scope}
                    </span>
                  ))}
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={async () => {
                        try {
                          const result = await mutations.rotateOAuthSecret.mutateAsync(client.id);
                          setIssued({ clientId: client.client_id, secret: result.secret });
                        } catch (error) {
                          toast.error(
                            error instanceof Error ? error.message : t("Action failed"),
                          );
                        }
                      }}
                    >
                      <RefreshCw className="me-2 size-4" />
                      {t("Rotate secret")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      onClick={() => void mutations.deleteOAuthClient.mutateAsync(client.id)}
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
            <DialogTitle>{t("Register application")}</DialogTitle>
            <DialogDescription>
              {t("The client secret is shown once and stored only as a hash.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="oauth-name">{t("Name")}</Label>
              <Input id="oauth-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="oauth-redirects">{t("Redirect URIs")}</Label>
              <Textarea
                id="oauth-redirects"
                rows={2}
                placeholder="https://app.example.com/callback"
                value={redirects}
                onChange={(e) => setRedirects(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("Grant types")}</Label>
              <div className="flex flex-wrap gap-2">
                {OAUTH_GRANT_TYPES.map((grant) => (
                  <button
                    key={grant}
                    type="button"
                    onClick={() => setGrants((prev) => toggle(prev, grant))}
                    className={cn(
                      "rounded-md border px-2 py-1 font-mono text-[11px]",
                      grants.includes(grant)
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {grant}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("Scopes")}</Label>
              <div className="flex flex-wrap gap-2">
                {API_SCOPES.map((scope) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => setScopes((prev) => toggle(prev, scope))}
                    className={cn(
                      "rounded-md border px-2 py-1 font-mono text-[11px]",
                      scopes.includes(scope)
                        ? "border-primary bg-primary/10 text-primary"
                        : "text-muted-foreground",
                    )}
                  >
                    {scope}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={!name.trim() || grants.length === 0}
              onClick={async () => {
                try {
                  const result = await mutations.createOAuthClient.mutateAsync({
                    name: name.trim(),
                    projectId: projects[0]?.id ?? null,
                    redirectUris: redirects
                      .split(/[\s,]+/)
                      .map((uri) => uri.trim())
                      .filter(Boolean),
                    scopes,
                    grantTypes: grants,
                  });
                  setIssued({ clientId: result.client.client_id, secret: result.secret });
                  setOpen(false);
                  setName("");
                  setRedirects("");
                  setScopes([]);
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : t("Action failed"));
                }
              }}
            >
              {t("Register")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(issued)} onOpenChange={(next) => !next && setIssued(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Client secret")}</DialogTitle>
            <DialogDescription>
              {t("Copy this secret now — it will never be shown again.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-surface p-3 font-mono text-xs break-all">
              {issued?.clientId}
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-md border bg-surface p-3 font-mono text-xs break-all">
                {issued?.secret}
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() => issued && copy(issued.secret)}
                aria-label={t("Copy secret")}
              >
                <Copy className="size-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setIssued(null)}>
              <KeyRound className="me-2 size-4" />
              {t("Done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
