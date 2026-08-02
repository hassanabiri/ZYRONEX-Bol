import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n";
import type { VoiceAnalytics as VoiceAnalyticsData, VoiceCall } from "@/services/voice-service";

function Metric({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  const { t } = useI18n();
  return (
    <div className="rounded-xl border p-4">
      <p className="text-xs text-muted-foreground">{t(label)}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{t(hint)}</p>}
    </div>
  );
}

/** Aggregated voice metrics derived from the call log. */
export function VoiceAnalytics({
  analytics,
  calls,
}: {
  analytics: VoiceAnalyticsData;
  calls: VoiceCall[];
}) {
  const { t } = useI18n();
  const byDay = new Map<string, number>();
  for (const call of calls) {
    const day = call.created_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const recent = [...byDay.entries()].sort().slice(-7);
  const peak = Math.max(1, ...recent.map(([, count]) => count));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Calls" value={analytics.calls} hint="Total logged calls" />
        <Metric label="Minutes" value={analytics.minutes} hint="Total talk time" />
        <Metric
          label="Average duration"
          value={`${analytics.averageDurationSeconds}s`}
          hint="Across answered calls"
        />
        <Metric label="Success rate" value={`${analytics.successRate}%`} hint="Completed vs failed" />
        <Metric label="Failed calls" value={analytics.failedCalls} hint="Failed, missed or unanswered" />
        <Metric label="Concurrent calls" value={analytics.concurrentCalls} hint="Currently in progress" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("Call volume")}</CardTitle>
          <CardDescription>{t("Calls logged over the last seven active days.")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("No call volume recorded yet.")}</p>
          ) : (
            recent.map(([day, count]) => (
              <div key={day} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{day}</span>
                  <span className="font-medium">{count}</span>
                </div>
                <Progress value={(count / peak) * 100} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
