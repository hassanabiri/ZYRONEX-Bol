import { useState } from "react";
import { Copy, KeyRound, Plus, RotateCcw, Trash2, Webhook } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useIntegrationMutations,
  useWebhookDeliveries,
  useWebhookEndpoints,
} from "@/hooks/use-integrations";
import { useI18n } from "@/lib/i18n";
import { WEBHOOK_EVENTS } from "@/lib/integrations/catalog";

/** Inbound and outbound webhook endpoints with signing secrets and delivery log. */
export function WebhookCenter({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: endpoints = [], isLoading } = useWebhookEndpoints(workspaceId);
  const { data: deliveries = [] } = useWebhookDeliveries(workspaceId);
  const mutations = useIntegrationMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"incoming" | "outgoing">("outgoing");
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>([]);
  const [secret, setSecret] = useState<string | null>(null);

  async function run(label: string, action: Promise<unknown>) {
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
    if (!name.trim()) return;
    const created = await run(
      "Webhook created",
      mutations.createWebhook.mutateAsync({
        name: name.trim(),
        direction,
        url: direction === "outgoing" ? url.trim() : null,
        events,
      }),
    );
    if (created) {
      setOpen(false);
      setName("");
      setUrl("");
      setEvents([]);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("Webhook endpoints")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("Signed inbound receivers and outbound event delivery.")}
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="me-2 size-4" />
          {t("New webhook")}
        </Button>
      </div>

      {!isLoading && endpoints.length === 0 ? (
        <EmptyState
          icon={Webhook}
          title={t("No webhooks configured")}
          description={t("Create an endpoint to receive or emit platform events.")}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Endpoint")}</TableHead>
                    <TableHead>{t("Direction")}</TableHead>
                    <TableHead>{t("Events")}</TableHead>
                    <TableHead>{t("Active")}</TableHead>
                    <TableHead className="text-end">{t("Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {endpoints.map((endpoint) => (
                    <TableRow key={endpoint.id}>
                      <TableCell>
                        <p className="font-medium">{endpoint.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {endpoint.url ?? `/api/public/webhooks/${endpoint.slug}`}
                        </p>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{t(endpoint.direction)}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {endpoint.events.length}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={endpoint.enabled}
                          onCheckedChange={(checked) =>
                            void run(
                              "Webhook updated",
                              mutations.updateWebhook.mutateAsync({
                                endpointId: endpoint.id,
                                patch: { enabled: checked },
                              }),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell className="space-x-1 text-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t("Rotate signing secret")}
                          onClick={async () => {
                            const value = (await run(
                              "Signing secret rotated",
                              mutations.rotateWebhookSecret.mutateAsync(endpoint.id),
                            )) as { secret?: string } | null;
                            if (value?.secret) setSecret(value.secret);
                          }}
                        >
                          <KeyRound className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          onClick={() =>
                            void run(
                              "Webhook deleted",
                              mutations.deleteWebhook.mutateAsync(endpoint.id),
                            )
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Recent deliveries")}</CardTitle>
          <CardDescription>{t("Last 100 inbound and outbound attempts.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {deliveries.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("No deliveries recorded yet.")}</p>
          )}
          {deliveries.map((delivery) => (
            <div
              key={delivery.id}
              className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{delivery.event}</p>
                <p className="text-xs text-muted-foreground">
                  {new Date(delivery.created_at).toLocaleString()} · {t("attempt")}{" "}
                  {delivery.attempt}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={delivery.success ? "default" : "destructive"}>
                  {delivery.status_code ?? (delivery.success ? "ok" : "failed")}
                </Badge>
                {!delivery.success && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      void run("Delivery re-queued", mutations.retryDelivery.mutateAsync(delivery))
                    }
                  >
                    <RotateCcw className="size-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("New webhook")}</DialogTitle>
            <DialogDescription>
              {t("Inbound endpoints receive signed payloads; outbound endpoints emit events.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hook-name">{t("Name")}</Label>
              <Input id="hook-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>{t("Direction")}</Label>
              <Select
                value={direction}
                onValueChange={(value) => setDirection(value as "incoming" | "outgoing")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="incoming">{t("Inbound")}</SelectItem>
                  <SelectItem value="outgoing">{t("Outbound")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {direction === "outgoing" && (
              <div className="space-y-2">
                <Label htmlFor="hook-url">{t("Target URL")}</Label>
                <Input
                  id="hook-url"
                  placeholder="https://example.com/hooks/zyronex"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>{t("Events")}</Label>
              <div className="grid max-h-48 gap-1.5 overflow-y-auto rounded-md border p-2">
                {WEBHOOK_EVENTS.map((event: string) => (
                  <label key={event} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={events.includes(event)}
                      onChange={(e) =>
                        setEvents((prev) =>
                          e.target.checked ? [...prev, event] : prev.filter((x) => x !== event),
                        )
                      }
                    />
                    <span className="font-mono">{event}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button onClick={() => void handleCreate()} disabled={!name.trim()}>
              {t("Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(secret)} onOpenChange={(value) => !value && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Signing secret")}</DialogTitle>
            <DialogDescription>
              {t("Copy this value now — it is not shown again.")}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-muted px-3 py-2 text-xs">{secret}</code>
            <Button
              variant="outline"
              size="icon"
              onClick={() => {
                void navigator.clipboard.writeText(secret ?? "");
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
