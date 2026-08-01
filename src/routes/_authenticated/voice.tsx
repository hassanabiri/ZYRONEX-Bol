import { createFileRoute } from "@tanstack/react-router";
import { AudioLines, Captions, Mic, PhoneCall, Waves } from "lucide-react";

import { ModulePage, type ModuleCapability } from "@/components/module-page";

export const Route = createFileRoute("/_authenticated/voice")({
  head: () => ({
    meta: [
      { title: "Voice Center — ZYRONEX" },
      { name: "description", content: "Real-time speech interfaces: telephony, streaming audio, transcription and synthesis." },
      { property: "og:title", content: "Voice Center — ZYRONEX" },
      { property: "og:description", content: "Real-time speech interfaces: telephony, streaming audio, transcription and synthesis." },
    ],
  }),
  component: VoiceRoute,
});

function VoiceRoute() {
  const capabilities: ModuleCapability[] = [
    { title: "Voices", description: "Synthesis profiles and language coverage.", icon: Mic },
    { title: "Channels", description: "Telephony numbers, SIP trunks and web audio.", icon: PhoneCall },
    { title: "Transcription", description: "Streaming speech-to-text with diarization.", icon: Captions },
    { title: "Call Sessions", description: "Recordings, transcripts and quality metrics.", icon: Waves },
  ];

  return (
    <ModulePage
      title="Voice Center"
      description="Real-time speech interfaces: telephony, streaming audio, transcription and synthesis."
      icon={AudioLines}
      capabilities={capabilities}
    />
  );
}
