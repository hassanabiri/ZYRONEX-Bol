import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CallCenter } from "@/components/voice/call-center";
import { VoiceAnalytics } from "@/components/voice/voice-analytics";
import { VoiceNumbers } from "@/components/voice/voice-numbers";
import { VoiceProfiles } from "@/components/voice/voice-profiles";
import { VoiceProviders } from "@/components/voice/voice-providers";
import { VoiceStats } from "@/components/voice/voice-stats";
import { useCreditBalances } from "@/hooks/use-billing";
import { useVoiceCalls, useVoiceNumbers, useVoiceProfiles, useVoiceProviders } from "@/hooks/use-voice";
import { useWorkspaceRole } from "@/hooks/use-workspace-role";
import { useI18n } from "@/lib/i18n";
import { useWorkspace } from "@/lib/workspace";
import { voiceService } from "@/services/voice-service";

export const Route = createFileRoute("/_authenticated/voice")({
  head: () => ({
    meta: [
      { title: "Voice Center — ZYRONEX" },
      {
        name: "description",
        content:
          "Voice providers, phone numbers, voice workers, call center and voice analytics for your workspace.",
      },
      { property: "og:title", content: "Voice Center — ZYRONEX" },
      {
        property: "og:description",
        content: "Numbers, providers, voice profiles, call logs and analytics.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: VoiceRoute,
});

function VoiceRoute() {
  const { t } = useI18n();
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id;
  const { canManageVoice } = useWorkspaceRole(workspaceId);

  const { data: providers = [] } = useVoiceProviders(workspaceId);
  const { data: numbers = [], isLoading: numbersLoading } = useVoiceNumbers(workspaceId);
  const { data: profiles = [] } = useVoiceProfiles(workspaceId);
  const { data: calls = [], isLoading: callsLoading } = useVoiceCalls(workspaceId);
  const { data: balances = [] } = useCreditBalances(workspaceId);

  const [tab, setTab] = useState("numbers");
  const analytics = useMemo(() => voiceService.analytics(calls), [calls]);
  const minutesLedger = balances.find((balance) => balance.credit_type === "voice_minutes");
  const minutesRemaining = minutesLedger
    ? Number(minutesLedger.granted) - Number(minutesLedger.used)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Voice Center")}
        description={t(
          "Voice is a core platform service — providers, numbers, worker voice profiles and every call ZYRONEX handles.",
        )}
      />

      <VoiceStats
        providers={providers}
        numbers={numbers}
        profiles={profiles}
        analytics={analytics}
        minutesRemaining={minutesRemaining}
      />

      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="flex w-full flex-wrap justify-start">
          <TabsTrigger value="numbers">{t("Numbers")}</TabsTrigger>
          <TabsTrigger value="providers">{t("Providers")}</TabsTrigger>
          <TabsTrigger value="workers">{t("Voice workers")}</TabsTrigger>
          <TabsTrigger value="calls">{t("Call center")}</TabsTrigger>
          <TabsTrigger value="analytics">{t("Analytics")}</TabsTrigger>
        </TabsList>

        <TabsContent value="numbers">
          <VoiceNumbers
            workspaceId={workspaceId}
            numbers={numbers}
            providers={providers}
            loading={numbersLoading}
            canManage={canManageVoice}
          />
        </TabsContent>

        <TabsContent value="providers">
          <VoiceProviders
            workspaceId={workspaceId}
            providers={providers}
            canManage={canManageVoice}
          />
        </TabsContent>

        <TabsContent value="workers">
          <VoiceProfiles
            workspaceId={workspaceId}
            profiles={profiles}
            numbers={numbers}
            canManage={canManageVoice}
          />
        </TabsContent>

        <TabsContent value="calls">
          <CallCenter calls={calls} loading={callsLoading} />
        </TabsContent>

        <TabsContent value="analytics">
          <VoiceAnalytics analytics={analytics} calls={calls} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
