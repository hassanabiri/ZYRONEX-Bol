import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { activityService } from "@/services/activity-service";
import {
  ACTIVE_CALL_STATUSES,
  FAILED_CALL_STATUSES,
  SUCCESSFUL_CALL_STATUSES,
} from "@/lib/voice/catalog";

export type VoiceProvider = Tables<"voice_providers">;
export type VoiceNumber = Tables<"voice_numbers">;
export type VoiceProfile = Tables<"voice_profiles">;
export type VoiceCall = Tables<"voice_calls">;

export type VoiceProviderInsert = Omit<
  TablesInsert<"voice_providers">,
  "workspace_id" | "created_by"
>;
export type VoiceNumberInsert = Omit<TablesInsert<"voice_numbers">, "workspace_id" | "created_by">;
export type VoiceProfileInsert = Omit<
  TablesInsert<"voice_profiles">,
  "workspace_id" | "created_by"
>;

export type VoiceAnalytics = {
  calls: number;
  minutes: number;
  averageDurationSeconds: number;
  successRate: number;
  failedCalls: number;
  concurrentCalls: number;
  inbound: number;
  outbound: number;
  missed: number;
  queued: number;
};

/**
 * Voice Platform data layer. Every number, provider, profile and call log is
 * workspace-scoped; provider credentials never live in these rows — only the
 * vault fingerprint written by the server function does.
 */
export const voiceService = {
  async listProviders(workspaceId: string): Promise<VoiceProvider[]> {
    const { data, error } = await supabase
      .from("voice_providers")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createProvider(workspaceId: string, input: VoiceProviderInsert, userId?: string) {
    const { data, error } = await supabase
      .from("voice_providers")
      .insert({ ...input, workspace_id: workspaceId, created_by: userId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(workspaceId, {
      entity_type: "voice_provider",
      entity_id: data.id,
      action: "voice.provider.created",
      detail: data.name,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async updateProvider(
    provider: VoiceProvider,
    patch: TablesUpdate<"voice_providers">,
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("voice_providers")
      .update(patch)
      .eq("id", provider.id)
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(provider.workspace_id, {
      entity_type: "voice_provider",
      entity_id: provider.id,
      action: "voice.provider.updated",
      detail: provider.name,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async removeProvider(provider: VoiceProvider, userId?: string) {
    const { error } = await supabase.from("voice_providers").delete().eq("id", provider.id);
    if (error) throw error;
    await activityService.log(provider.workspace_id, {
      entity_type: "voice_provider",
      entity_id: provider.id,
      action: "voice.provider.deleted",
      detail: provider.name,
      result: "success",
      actor_id: userId ?? null,
    });
  },

  async listNumbers(workspaceId: string): Promise<VoiceNumber[]> {
    const { data, error } = await supabase
      .from("voice_numbers")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async registerNumber(workspaceId: string, input: VoiceNumberInsert, userId?: string) {
    const { data, error } = await supabase
      .from("voice_numbers")
      .insert({ ...input, workspace_id: workspaceId, created_by: userId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(workspaceId, {
      entity_type: "voice_number",
      entity_id: data.id,
      action: "voice.number.registered",
      detail: data.phone_number,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async updateNumber(number: VoiceNumber, patch: TablesUpdate<"voice_numbers">, userId?: string) {
    const { data, error } = await supabase
      .from("voice_numbers")
      .update(patch)
      .eq("id", number.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  /** Lifecycle transitions share one audited path so status changes stay consistent. */
  async transitionNumber(
    number: VoiceNumber,
    action: "connect" | "disconnect" | "verify" | "archive",
    userId?: string,
  ) {
    const now = new Date().toISOString();
    const patch: TablesUpdate<"voice_numbers"> =
      action === "connect"
        ? { status: "connected", connected_at: now }
        : action === "disconnect"
          ? { status: "disconnected", connected_at: null }
          : action === "verify"
            ? { status: "verifying", verified_at: now }
            : { status: "archived", worker_id: null };
    const data = await voiceService.updateNumber(number, patch, userId);
    await activityService.log(number.workspace_id, {
      entity_type: "voice_number",
      entity_id: number.id,
      action: `voice.number.${action}`,
      detail: number.phone_number,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async removeNumber(number: VoiceNumber, userId?: string) {
    const { error } = await supabase.from("voice_numbers").delete().eq("id", number.id);
    if (error) throw error;
    await activityService.log(number.workspace_id, {
      entity_type: "voice_number",
      entity_id: number.id,
      action: "voice.number.deleted",
      detail: number.phone_number,
      result: "success",
      actor_id: userId ?? null,
    });
  },

  async listProfiles(workspaceId: string): Promise<VoiceProfile[]> {
    const { data, error } = await supabase
      .from("voice_profiles")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createProfile(workspaceId: string, input: VoiceProfileInsert, userId?: string) {
    const { data, error } = await supabase
      .from("voice_profiles")
      .insert({ ...input, workspace_id: workspaceId, created_by: userId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(workspaceId, {
      entity_type: "voice_profile",
      entity_id: data.id,
      action: "voice.profile.created",
      detail: data.name,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async updateProfile(
    profile: VoiceProfile,
    patch: TablesUpdate<"voice_profiles">,
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("voice_profiles")
      .update(patch)
      .eq("id", profile.id)
      .select("*")
      .single();
    if (error) throw error;
    await activityService.log(profile.workspace_id, {
      entity_type: "voice_profile",
      entity_id: profile.id,
      action: "voice.profile.updated",
      detail: profile.name,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async removeProfile(profile: VoiceProfile, userId?: string) {
    const { error } = await supabase.from("voice_profiles").delete().eq("id", profile.id);
    if (error) throw error;
    await activityService.log(profile.workspace_id, {
      entity_type: "voice_profile",
      entity_id: profile.id,
      action: "voice.profile.deleted",
      detail: profile.name,
      result: "success",
      actor_id: userId ?? null,
    });
  },

  async listCalls(workspaceId: string, limit = 200): Promise<VoiceCall[]> {
    const { data, error } = await supabase
      .from("voice_calls")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  /** Pure aggregation over call logs — used by both the dashboard cards and analytics tab. */
  analytics(calls: VoiceCall[]): VoiceAnalytics {
    const finished = calls.filter((call) => call.duration_seconds > 0);
    const totalSeconds = calls.reduce((sum, call) => sum + call.duration_seconds, 0);
    const success = calls.filter((call) => SUCCESSFUL_CALL_STATUSES.includes(call.status)).length;
    const failed = calls.filter((call) => FAILED_CALL_STATUSES.includes(call.status)).length;
    const settled = success + failed;
    return {
      calls: calls.length,
      minutes: Math.round(totalSeconds / 60),
      averageDurationSeconds: finished.length ? Math.round(totalSeconds / finished.length) : 0,
      successRate: settled ? Math.round((success / settled) * 100) : 0,
      failedCalls: failed,
      concurrentCalls: calls.filter((call) => call.status === "in_progress").length,
      inbound: calls.filter((call) => call.direction === "inbound").length,
      outbound: calls.filter((call) => call.direction === "outbound").length,
      missed: calls.filter((call) => call.status === "missed").length,
      queued: calls.filter((call) => ACTIVE_CALL_STATUSES.includes(call.status)).length,
    };
  },
};
