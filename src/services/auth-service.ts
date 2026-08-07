import { lovable } from "@/integrations/lovable/index";
import { supabase } from "@/integrations/supabase/client";

/**
 * Auth layer — the only place that talks to Supabase Auth.
 * Social providers go through the managed Lovable Cloud broker.
 */
export type OAuthProvider = "google" | "apple";

const SESSION_ONLY_KEY = "zyronex.session-only";
const SESSION_ALIVE_KEY = "zyronex.session-alive";

export const authService = {
  /**
   * "Remember me" handling: Supabase always persists the session in
   * localStorage, so a session-only login is enforced by marking the tab and
   * clearing the session when the app boots without that tab marker.
   */
  setRememberMe(remember: boolean) {
    if (typeof window === "undefined") return;
    if (remember) {
      window.localStorage.removeItem(SESSION_ONLY_KEY);
      window.sessionStorage.removeItem(SESSION_ALIVE_KEY);
    } else {
      window.localStorage.setItem(SESSION_ONLY_KEY, "1");
      window.sessionStorage.setItem(SESSION_ALIVE_KEY, "1");
    }
  },

  /** Returns true when a non-remembered session must be dropped. */
  shouldDropSession() {
    if (typeof window === "undefined") return false;
    return (
      window.localStorage.getItem(SESSION_ONLY_KEY) === "1" &&
      window.sessionStorage.getItem(SESSION_ALIVE_KEY) !== "1"
    );
  },

  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  },

  async signUp(email: string, password: string, fullName?: string, redirectTo?: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo ?? window.location.origin,
        data: { full_name: fullName ?? "" },
      },
    });
    if (error) throw error;
    return data;
  },

  /** Passwordless sign-in / sign-up via a one-time magic link. */
  async signInWithMagicLink(email: string, redirectTo?: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo ?? window.location.origin,
        shouldCreateUser: true,
      },
    });
    if (error) throw error;
  },

  /** Enterprise SSO (SAML 2.0) resolved from the corporate email domain. */
  async signInWithSSO(email: string) {
    const domain = email.split("@")[1]?.trim().toLowerCase();
    if (!domain) throw new Error("Enter your work email to continue with SSO");
    const { data, error } = await supabase.auth.signInWithSSO({
      domain,
      options: { redirectTo: window.location.origin },
    });
    if (error) throw error;
    if (data?.url) window.location.assign(data.url);
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
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(SESSION_ONLY_KEY);
      window.sessionStorage.removeItem(SESSION_ALIVE_KEY);
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  /** Sign out of every device by revoking all refresh tokens for the user. */
  async signOutEverywhere() {
    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) throw error;
  },

  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user;
  },

  /**
   * Managed social sign-in. Identities that share a verified email are linked
   * to the same account by the auth provider instead of duplicating users.
   */
  async signInWithProvider(provider: OAuthProvider, redirectUri?: string) {
    const result = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: redirectUri ?? window.location.origin,
    });
    if (result.error) throw result.error;
    return result;
  },
};
