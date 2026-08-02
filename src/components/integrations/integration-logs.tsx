import { useMemo, useState } from "react";
import { ScrollText } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIntegrationLogs } from "@/hooks/use-integrations";
import { useI18n } from "@/lib/i18n";
import type { Integration } from "@/services/integration-service";

const KINDS = ["connection", "sync", "webhook", "api", "error", "security"];

/** Unified integration log with filtering by connection and event kind. */
export function IntegrationLogs({
  workspaceId,
  integrations,
}: {
  workspaceId: string | undefined;
  integrations: Integration[];
}) {
  const { t } = useI18n();
  const [integrationId, setIntegrationId] = useState("all");
  const [kind, setKind] = useState("all");
  const [term, setTerm] = useState("");
  const { data: logs = [], isLoading } = useIntegrationLogs(
    workspaceId,
    integrationId === "all" ? undefined : integrationId,
  );

  const nameFor = useMemo(
    () => new Map(integrations.map((item) => [item.id, item.name])),
    [integrations],
  );

  const rows = useMemo(() => {
    const query = term.trim().toLowerCase();
    return logs.filter((log) => {
      if (kind !== "all" && log.kind !== kind) return false;
      if (!query) return true;
      return log.message.toLowerCase().includes(query);
    });
  }, [logs, kind, term]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          className="sm:max-w-xs"
          placeholder={t("Search log messages")}
          value={term}
          onChange={(event) => setTerm(event.target.value)}
        />
        <Select value={integrationId} onValueChange={setIntegrationId}>
          <SelectTrigger className="sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All connections")}</SelectItem>
            {integrations.map((integration) => (
              <SelectItem key={integration.id} value={integration.id}>
                {integration.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger className="sm:w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All events")}</SelectItem>
            {KINDS.map((item) => (
              <SelectItem key={item} value={item}>
                {t(item)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!isLoading && rows.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title={t("No log entries")}
          description={t("Connection, sync, webhook and API events will be recorded here.")}
        />
      ) : (
        <Card>
          <CardContent className="space-y-2 p-4">
            {rows.map((log) => (
              <div
                key={log.id}
                className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{log.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString()}
                    {log.integration_id
                      ? ` · ${nameFor.get(log.integration_id) ?? t("Unknown connection")}`
                      : ""}
                  </p>
                </div>
                <Badge variant={log.kind === "error" ? "destructive" : "outline"}>
                  {t(log.kind)}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
