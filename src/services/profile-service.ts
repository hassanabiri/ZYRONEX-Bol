import { supabase } from "@/integrations/supabase/client";
import type { Profile } from "@/services/types";

/** Database layer for the `profiles` table. */
export const profileService = {
  async get(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async update(userId: string, patch: Partial<Pick<Profile, "full_name" | "avatar_url" | "status">>) {
    const { data, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async touchLastLogin(userId: string) {
    const { error } = await supabase
      .from("profiles")
      .update({ last_login: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw error;
  },
};
