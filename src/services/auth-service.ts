import { supabase } from "@/integrations/supabase/client";

/**
 * Auth layer — the only place that talks to Supabase Auth.
 * Social providers (google | azure | github | apple) are architecturally
 * supported through `signInWithProvider` but intentionally not exposed in UI yet.
 */
export type OAuthProvider = "google" | "azure" | "github" | "apple";

export const authService = {
  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signUp(email: string, password: string, fullName?: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: fullName ?? "" },
      },
    });
    if (error) throw error;
    return data;
  },

  async requestPasswordReset(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) throw error;
  },

  async updatePassword(password: string) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user;
  },

  /** Reserved for future social sign-in support. Not wired to any UI yet. */
  async signInWithProvider(provider: OAuthProvider) {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
    return data;
  },
};
