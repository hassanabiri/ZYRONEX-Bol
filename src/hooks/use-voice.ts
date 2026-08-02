import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import {
  voiceService,
  type VoiceNumber,
  type VoiceNumberInsert,
  type VoiceProfile,
  type VoiceProfileInsert,
  type VoiceProvider,
  type VoiceProviderInsert,
} from "@/services/voice-service";
import type { TablesUpdate } from "@/integrations/supabase/types";

export const voiceKeys = {
  providers: (workspaceId: string) => ["workspace", workspaceId, "voice-providers"] as const,
  numbers: (workspaceId: string) => ["workspace", workspaceId, "voice-numbers"] as const,
  profiles: (workspaceId: string) => ["workspace", workspaceId, "voice-profiles"] as const,
  calls: (workspaceId: string) => ["workspace", workspaceId, "voice-calls"] as const,
};

export function useVoiceProviders(workspaceId: string | undefined) {
  return useQuery({
    queryKey: voiceKeys.providers(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => voiceService.listProviders(workspaceId!),
  });
}

export function useVoiceNumbers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: voiceKeys.numbers(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => voiceService.listNumbers(workspaceId!),
  });
}

export function useVoiceProfiles(workspaceId: string | undefined) {
  return useQuery({
    queryKey: voiceKeys.profiles(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => voiceService.listProfiles(workspaceId!),
  });
}

export function useVoiceCalls(workspaceId: string | undefined) {
  return useQuery({
    queryKey: voiceKeys.calls(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => voiceService.listCalls(workspaceId!),
  });
}

/** Every write path for the Voice Platform, with cache invalidation handled once. */
export function useVoiceMutations(workspaceId: string | undefined) {
  const client = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "none";

  const invalidate = (keys: readonly (readonly unknown[])[]) => {
    for (const key of keys) client.invalidateQueries({ queryKey: key });
  };

  const createProvider = useMutation({
    mutationFn: (input: VoiceProviderInsert) =>
      voiceService.createProvider(workspaceId!, input, user?.id),
    onSuccess: () => invalidate([voiceKeys.providers(id)]),
  });

  const updateProvider = useMutation({
    mutationFn: (vars: { provider: VoiceProvider; patch: TablesUpdate<"voice_providers"> }) =>
      voiceService.updateProvider(vars.provider, vars.patch, user?.id),
    onSuccess: () => invalidate([voiceKeys.providers(id)]),
  });

  const removeProvider = useMutation({
    mutationFn: (provider: VoiceProvider) => voiceService.removeProvider(provider, user?.id),
    onSuccess: () => invalidate([voiceKeys.providers(id), voiceKeys.numbers(id)]),
  });

  const registerNumber = useMutation({
    mutationFn: (input: VoiceNumberInsert) =>
      voiceService.registerNumber(workspaceId!, input, user?.id),
    onSuccess: () => invalidate([voiceKeys.numbers(id)]),
  });

  const updateNumber = useMutation({
    mutationFn: (vars: { number: VoiceNumber; patch: TablesUpdate<"voice_numbers"> }) =>
      voiceService.updateNumber(vars.number, vars.patch, user?.id),
    onSuccess: () => invalidate([voiceKeys.numbers(id)]),
  });

  const transitionNumber = useMutation({
    mutationFn: (vars: {
      number: VoiceNumber;
      action: "connect" | "disconnect" | "verify" | "archive";
    }) => voiceService.transitionNumber(vars.number, vars.action, user?.id),
    onSuccess: () => invalidate([voiceKeys.numbers(id)]),
  });

  const removeNumber = useMutation({
    mutationFn: (number: VoiceNumber) => voiceService.removeNumber(number, user?.id),
    onSuccess: () => invalidate([voiceKeys.numbers(id)]),
  });

  const createProfile = useMutation({
    mutationFn: (input: VoiceProfileInsert) =>
      voiceService.createProfile(workspaceId!, input, user?.id),
    onSuccess: () => invalidate([voiceKeys.profiles(id)]),
  });

  const updateProfile = useMutation({
    mutationFn: (vars: { profile: VoiceProfile; patch: TablesUpdate<"voice_profiles"> }) =>
      voiceService.updateProfile(vars.profile, vars.patch, user?.id),
    onSuccess: () => invalidate([voiceKeys.profiles(id)]),
  });

  const removeProfile = useMutation({
    mutationFn: (profile: VoiceProfile) => voiceService.removeProfile(profile, user?.id),
    onSuccess: () => invalidate([voiceKeys.profiles(id)]),
  });

  return {
    createProvider,
    updateProvider,
    removeProvider,
    registerNumber,
    updateNumber,
    transitionNumber,
    removeNumber,
    createProfile,
    updateProfile,
    removeProfile,
  };
}
