import { useMemo } from "react";
import { RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useIntegrationMutations, useSyncRuns } from "@/hooks/use-integrations";
import { useI18n } from "@/lib/i18n";
import type { Integration, SyncRun } from "@/services/integration-service";

const TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  queued: "outline",
  running: "secondary",
  completed: "default",
  failed: "destructive",
  cancelled: "outline",
  partial: "secondary",
};

/** Synchronization engine: queue, history, conflict outcome and retries. */
export function SyncEngine({
  workspaceId,
  integrations,
}: {
  workspaceId: string | undefined;
  integrations: Integration[];
}) {
  const { t } = useI18n();
  const { data: runs = [], isLoading } = useSyncRuns(workspaceId);
  const mutations = useIntegrationMutations(workspaceId);

  const nameFor = useMemo(
    () => new Map(integrations.map((item) => [item.id, item.name])),
    [integrations],
  );

  async function run(label: string, action: Promise<unknown>) {
    try {
      await action;
      toast.success(t(label));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  const active = runs.filter((item) => item.status === "queued" || item.status === "running");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Synchronization queue")}</CardTitle>
          <CardDescription>
            {active.length} {t("runs waiting or in progress")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {integrations
            .filter((integration) => integration.enabled && integration.status !== "archived")
            .map((integration) => (
              <Button
                key={integration.id}
                variant="outline"
                size="sm"
                onClick={() =>
                  void run("Sync queued", mutations.queueSync.mutateAsync({ integration }))
                }
              >
                <RefreshCw className="me-2 size-3.5" />
                {integration.name}
              </Button>
            ))}
          {integrations.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {t("Connect an integration to run synchronizations.")}
            </p>
          )}
        </CardContent>
      </Card>

      {!isLoading && runs.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title={t("No synchronization history")}
          description={t("Runs appear here as soon as a synchronization is queued.")}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Connection")}</TableHead>
                    <TableHead>{t("Mode")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                    <TableHead>{t("Records")}</TableHead>
                    <TableHead>{t("Attempt")}</TableHead>
                    <TableHead>{t("Started")}</TableHead>
                    <TableHead className="text-end">{t("Actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((item: SyncRun) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {nameFor.get(item.integration_id) ?? item.integration_id.slice(0, 8)}
                      </TableCell>
                      <TableCell className="capitalize">{item.mode}</TableCell>
                      <TableCell>
                        <Badge variant={TONE[item.status] ?? "outline"}>{t(item.status)}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.records_processed} {t("processed")} · {item.conflicts}{" "}
                        {t("conflicts")}
                      </TableCell>
                      <TableCell>
                        {item.attempt}/{item.max_attempts}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {item.started_at ? new Date(item.started_at).toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="space-x-1 text-end">
                        {(item.status === "queued" || item.status === "running") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              void run("Run cancelled", mutations.cancelSync.mutateAsync(item))
                            }
                          >
                            <XCircle className="size-4" />
                          </Button>
                        )}
                        {(item.status === "failed" || item.status === "cancelled") && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              void run("Run re-queued", mutations.retrySync.mutateAsync(item))
                            }
                          >
                            <RotateCcw className="size-4" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
