import { useMemo, useState } from "react";
import { PhoneCall } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import { ACTIVE_CALL_STATUSES, CALL_STATUS_LABELS, CALL_STATUS_TONE } from "@/lib/voice/catalog";
import type { VoiceCall } from "@/services/voice-service";

function duration(seconds: number) {
  if (!seconds) return "—";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

/**
 * Call Center. Calls are logged by the future telephony runtime; this surface is
 * the read model for incoming, outgoing, missed, queued calls and their artifacts.
 */
export function CallCenter({ calls, loading }: { calls: VoiceCall[]; loading?: boolean }) {
  const { t } = useI18n();
  const [scope, setScope] = useState("all");
  const [status, setStatus] = useState("all");

  const rows = useMemo(
    () =>
      calls.filter((call) => {
        if (scope === "inbound" && call.direction !== "inbound") return false;
        if (scope === "outbound" && call.direction !== "outbound") return false;
        if (scope === "missed" && call.status !== "missed") return false;
        if (scope === "queued" && !ACTIVE_CALL_STATUSES.includes(call.status)) return false;
        if (scope === "recordings" && !call.recording_path) return false;
        if (scope === "transcripts" && !call.transcript) return false;
        if (status !== "all" && call.status !== status) return false;
        return true;
      }),
    [calls, scope, status],
  );

  return (
    <div className="space-y-4">
      <Tabs value={scope} onValueChange={setScope}>
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="all">{t("History")}</TabsTrigger>
          <TabsTrigger value="inbound">{t("Incoming")}</TabsTrigger>
          <TabsTrigger value="outbound">{t("Outgoing")}</TabsTrigger>
          <TabsTrigger value="missed">{t("Missed")}</TabsTrigger>
          <TabsTrigger value="queued">{t("Queued")}</TabsTrigger>
          <TabsTrigger value="recordings">{t("Recordings")}</TabsTrigger>
          <TabsTrigger value="transcripts">{t("Transcripts")}</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex justify-end">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All statuses")}</SelectItem>
            {Object.entries(CALL_STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {t(label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!loading && rows.length === 0 ? (
        <EmptyState
          icon={PhoneCall}
          title="No calls logged"
          description="Call logs, recordings and transcripts appear here once the telephony runtime starts routing traffic."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("Call")}</TableHead>
                    <TableHead>{t("Direction")}</TableHead>
                    <TableHead>{t("Status")}</TableHead>
                    <TableHead className="hidden md:table-cell">{t("Duration")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Artifacts")}</TableHead>
                    <TableHead className="hidden lg:table-cell">{t("Result")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((call) => (
                    <TableRow key={call.id}>
                      <TableCell>
                        <p className="text-sm font-medium">
                          {call.from_number} → {call.to_number}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(call.created_at).toLocaleString()}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs capitalize text-muted-foreground">
                        {call.direction}
                      </TableCell>
                      <TableCell>
                        <Badge variant={CALL_STATUS_TONE[call.status]}>
                          {t(CALL_STATUS_LABELS[call.status])}
                        </Badge>
                      </TableCell>
                      <TableCell className="hidden text-xs md:table-cell">
                        {duration(call.duration_seconds)}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        <div className="flex gap-1">
                          {call.recording_path && (
                            <Badge variant="secondary" className="text-[10px]">
                              {t("Recording")}
                            </Badge>
                          )}
                          {call.transcript && (
                            <Badge variant="secondary" className="text-[10px]">
                              {t("Transcript")}
                            </Badge>
                          )}
                          {!call.recording_path && !call.transcript && (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="hidden max-w-48 truncate text-xs text-muted-foreground lg:table-cell">
                        {call.result ?? call.error ?? "—"}
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
