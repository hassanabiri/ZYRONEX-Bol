import { Activity, Bot, Clock, Gauge, Hash, PhoneCall, Server, Timer } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n";
import { VOICE_PROVIDERS } from "@/lib/voice/catalog";
import type { VoiceAnalytics, VoiceNumber, VoiceProfile, VoiceProvider } from "@/services/voice-service";

/** The Voice Center dashboard cards. */
export function VoiceStats({
  providers,
  numbers,
  profiles,
  analytics,
  minutesRemaining,
}: {
  providers: VoiceProvider[];
  numbers: VoiceNumber[];
  profiles: VoiceProfile[];
  analytics: VoiceAnalytics;
  minutesRemaining: number | null;
}) {
  const { t } = useI18n();
  const live = numbers.filter((item) => item.status !== "archived");
  const connected = live.filter((item) => item.status === "connected").length;
  const available = live.filter((item) => item.status === "available").length;
  const activeProviders = providers.filter((item) => item.status === "connected").length;
  const health = live.length === 0 ? 0 : Math.round((connected / live.length) * 100);

  const cards = [
    {
      title: "Voice providers",
      value: `${activeProviders}/${providers.length || VOICE_PROVIDERS.length}`,
      hint: "Connected of configured providers",
      icon: Server,
    },
    { title: "Connected numbers", value: connected, hint: "Routing live traffic", icon: PhoneCall },
    { title: "Available numbers", value: available, hint: "Ready to connect", icon: Hash },
    { title: "Voice workers", value: profiles.length, hint: "Workers with a voice profile", icon: Bot },
    {
      title: "Minutes used",
      value: analytics.minutes,
      hint: "Across every logged call",
      icon: Timer,
    },
    {
      title: "Minutes remaining",
      value: minutesRemaining === null ? "—" : Math.max(0, Math.round(minutesRemaining)),
      hint: "From the voice minutes ledger",
      icon: Clock,
    },
    {
      title: "Call success rate",
      value: `${analytics.successRate}%`,
      hint: `${analytics.failedCalls} ${t("failed calls")}`,
      icon: Gauge,
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.title}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {t(card.title)}
            </CardTitle>
            <card.icon className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="truncate text-2xl font-semibold">{card.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{card.hint}</p>
          </CardContent>
        </Card>
      ))}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {t("Voice health")}
          </CardTitle>
          <Activity className="size-4 text-muted-foreground" />
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-2xl font-semibold">{health}%</p>
          <Progress value={health} />
          <p className="text-xs text-muted-foreground">
            {live.length} {t("numbers monitored")}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
