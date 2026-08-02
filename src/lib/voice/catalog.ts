import type { Enums } from "@/integrations/supabase/types";

export type VoiceProviderKind = Enums<"voice_provider_kind">;
export type VoiceProviderStatus = Enums<"voice_provider_status">;
export type VoiceNumberType = Enums<"voice_number_type">;
export type VoiceNumberStatus = Enums<"voice_number_status">;
export type CallDirection = Enums<"call_direction">;
export type CallStatus = Enums<"call_status">;

export type VoiceProviderDefinition = {
  id: VoiceProviderKind;
  name: string;
  description: string;
  capabilities: string[];
  /** Reserved for a future release — no provider traffic is sent today. */
  available: boolean;
};

/**
 * Voice provider architecture. Connections are prepared and stored, but the
 * platform never dials a provider yet — telephony transport lands in a later sprint.
 */
export const VOICE_PROVIDERS: VoiceProviderDefinition[] = [
  {
    id: "twilio",
    name: "Twilio",
    description: "Programmable Voice, global PSTN numbers and media streams.",
    capabilities: ["voice", "sms", "recording", "streaming"],
    available: false,
  },
  {
    id: "telnyx",
    name: "Telnyx",
    description: "Carrier-grade voice API with private IP transport.",
    capabilities: ["voice", "sms", "recording"],
    available: false,
  },
  {
    id: "vonage",
    name: "Vonage",
    description: "Voice API with global number inventory.",
    capabilities: ["voice", "recording"],
    available: false,
  },
  {
    id: "plivo",
    name: "Plivo",
    description: "Voice and messaging platform with regional coverage.",
    capabilities: ["voice", "sms"],
    available: false,
  },
  {
    id: "sip",
    name: "SIP Trunk",
    description: "Bring your own SIP trunk for direct carrier interconnect.",
    capabilities: ["voice", "byon"],
    available: false,
  },
  {
    id: "pbx",
    name: "PBX Gateway",
    description: "On-premise or hosted PBX bridged into ZYRONEX.",
    capabilities: ["voice", "transfer"],
    available: false,
  },
  {
    id: "local",
    name: "Local Provider",
    description: "Regional telecom operator integration slot.",
    capabilities: ["voice"],
    available: false,
  },
  {
    id: "custom",
    name: "Custom Provider",
    description: "Any provider described by a custom manifest.",
    capabilities: ["voice"],
    available: false,
  },
];

export const VOICE_PROVIDER_MAP = new Map(VOICE_PROVIDERS.map((item) => [item.id, item]));

export function getVoiceProvider(kind: string) {
  return VOICE_PROVIDER_MAP.get(kind as VoiceProviderKind);
}

export const NUMBER_TYPES: { value: VoiceNumberType; label: string; description: string }[] = [
  { value: "platform", label: "Platform number", description: "Provisioned and billed by ZYRONEX." },
  { value: "byon", label: "Customer number (BYON)", description: "Bring your own number from any carrier." },
  { value: "sip_trunk", label: "SIP trunk", description: "Reserved for direct SIP interconnect." },
  { value: "pbx", label: "PBX extension", description: "Reserved for PBX bridging." },
];

export const NUMBER_STATUS_LABELS: Record<VoiceNumberStatus, string> = {
  available: "Available",
  pending: "Pending",
  verifying: "Verifying",
  connected: "Connected",
  disconnected: "Disconnected",
  archived: "Archived",
};

export const NUMBER_STATUS_TONE: Record<
  VoiceNumberStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  available: "secondary",
  pending: "outline",
  verifying: "outline",
  connected: "default",
  disconnected: "destructive",
  archived: "outline",
};

export const PROVIDER_STATUS_LABELS: Record<VoiceProviderStatus, string> = {
  prepared: "Prepared",
  pending: "Pending",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Error",
  archived: "Archived",
};

export const CALL_STATUS_LABELS: Record<CallStatus, string> = {
  queued: "Queued",
  ringing: "Ringing",
  in_progress: "In progress",
  completed: "Completed",
  failed: "Failed",
  missed: "Missed",
  cancelled: "Cancelled",
  no_answer: "No answer",
};

export const CALL_STATUS_TONE: Record<
  CallStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  queued: "outline",
  ringing: "secondary",
  in_progress: "secondary",
  completed: "default",
  failed: "destructive",
  missed: "destructive",
  cancelled: "outline",
  no_answer: "destructive",
};

export const SUCCESSFUL_CALL_STATUSES: CallStatus[] = ["completed"];
export const FAILED_CALL_STATUSES: CallStatus[] = ["failed", "missed", "no_answer"];
export const ACTIVE_CALL_STATUSES: CallStatus[] = ["queued", "ringing", "in_progress"];

export const VOICE_OPTIONS = [
  { value: "neutral", label: "Neutral" },
  { value: "female_warm", label: "Female — warm" },
  { value: "female_clear", label: "Female — clear" },
  { value: "male_deep", label: "Male — deep" },
  { value: "male_calm", label: "Male — calm" },
] as const;

export const VOICE_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "ar", label: "العربية" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
] as const;

export const VOICE_ACCENTS = [
  { value: "standard", label: "Standard" },
  { value: "gulf", label: "Gulf" },
  { value: "egyptian", label: "Egyptian" },
  { value: "levantine", label: "Levantine" },
  { value: "british", label: "British" },
  { value: "american", label: "American" },
] as const;

export const RECORDING_POLICIES = [
  { value: "disabled", label: "Disabled", description: "No audio is captured." },
  { value: "on_demand", label: "On demand", description: "Recorded only when the worker requests it." },
  { value: "always", label: "Always", description: "Every call is recorded and stored." },
  { value: "consent", label: "Consent required", description: "Recorded after explicit caller consent." },
] as const;

export const VOICE_REGIONS = [
  { value: "global", label: "Global" },
  { value: "me-central", label: "Middle East Central" },
  { value: "eu-central", label: "EU Central" },
  { value: "us-east", label: "US East" },
  { value: "ap-south", label: "Asia Pacific South" },
] as const;
