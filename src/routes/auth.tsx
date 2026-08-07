import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, Globe, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { authService } from "@/services/auth-service";
import { profileService } from "@/services/profile-service";

type AuthSearch = { next?: string };

function safeNext(next?: string) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  if (next.startsWith("/auth") || next.startsWith("/reset-password")) return "/dashboard";
  return next;
}

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): AuthSearch => ({
    next: typeof search['next'] === "string" ? (search['next'] as string) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Sign in — ZYRONEX" },
      {
        name: "description",
        content: "Sign in or create an account to access your ZYRONEX workspace.",
      },
      { property: "og:title", content: "Sign in — ZYRONEX" },
      {
        property: "og:description",
        content: "Sign in or create an account to access your ZYRONEX workspace.",
      },
    ],
  }),
  component: AuthPage,
});

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path
        fill="#4285F4"
        d="M23.5 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.45a5.5 5.5 0 0 1-2.39 3.62v3h3.86c2.26-2.08 3.58-5.15 3.58-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.95-2.93l-3.87-3c-1.07.72-2.45 1.15-4.08 1.15-3.13 0-5.78-2.11-6.73-4.95H1.29v3.1A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.27a7.2 7.2 0 0 1 0-4.54v-3.1H1.29a12 12 0 0 0 0 10.74l3.98-3.1Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.43-3.43C17.95 1.19 15.23 0 12 0A12 12 0 0 0 1.29 6.63l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77Z"
      />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 fill-current" aria-hidden>
      <path d="M16.4 12.7c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.6.9-.8 0-1.9-.9-3.1-.8-1.6 0-3 .9-3.8 2.4-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.9-2.3.9-1.3 1.3-2.6 1.3-2.6s-2.4-.9-2.4-3.7ZM14 5.3c.6-.8 1.1-1.9 1-3-.9 0-2.1.6-2.8 1.4-.6.7-1.2 1.9-1 3 1 .1 2.1-.5 2.8-1.4Z" />
    </svg>
  );
}

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const destination = safeNext(next);
  const { session } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [method, setMethod] = useState<"password" | "magic" | "sso">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [remember, setRemember] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [pendingProvider, setPendingProvider] = useState<string | null>(null);

  useEffect(() => {
    if (session) navigate({ to: destination, replace: true });
  }, [session, navigate, destination]);

  async function handleProvider(provider: "google" | "apple") {
    setPendingProvider(provider);
    try {
      authService.setRememberMe(remember);
      const result = await authService.signInWithProvider(
        provider,
        `${window.location.origin}${destination}`,
      );
      if (!("redirected" in result) || !result.redirected) {
        navigate({ to: destination, replace: true });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Authentication failed"));
    } finally {
      setPendingProvider(null);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    authService.setRememberMe(remember);
    try {
      if (method === "sso") {
        await authService.signInWithSSO(email);
        return;
      }

      if (method === "magic") {
        await authService.signInWithMagicLink(email, `${window.location.origin}${destination}`);
        toast.success(t("Magic link sent. Check your inbox to finish signing in."));
        return;
      }

      if (mode === "signin") {
        const data = await authService.signIn(email, password);
        if (data.user) {
          void profileService.touchLastLogin(data.user.id).catch(() => undefined);
        }
        navigate({ to: destination, replace: true });
      } else {
        const data = await authService.signUp(
          email,
          password,
          fullName,
          `${window.location.origin}${destination}`,
        );
        if (!data.session) {
          toast.success(t("Check your inbox to confirm your email address."));
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Authentication failed"));
    } finally {
      setSubmitting(false);
    }
  }

  const providerBusy = pendingProvider !== null;

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <section className="grid-backdrop relative hidden flex-col justify-between border-r bg-surface p-12 lg:flex">
        <div className="flex items-center gap-3">
          <span className="brand-gradient flex size-9 items-center justify-center rounded-lg font-display font-bold text-primary-foreground">
            Z
          </span>
          <span className="font-display text-sm font-semibold tracking-[0.24em]">ZYRONEX</span>
        </div>
        <div className="max-w-md space-y-5">
          <h2 className="font-display text-4xl font-semibold leading-tight">
            {t("The operating platform for")} <span className="brand-text">{t("AI agents")}</span>.
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(
              "Build, orchestrate, govern and scale autonomous agents across every workspace — with enterprise-grade access control, observability and cost management.",
            )}
          </p>
          <ul className="space-y-2 text-xs text-muted-foreground">
            <li className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary" />
              {t("OAuth 2.0, OpenID Connect and SAML 2.0 single sign-on")}
            </li>
            <li className="flex items-center gap-2">
              <KeyRound className="size-4 text-primary" />
              {t("Passwordless magic links and verified email accounts")}
            </li>
            <li className="flex items-center gap-2">
              <Building2 className="size-4 text-primary" />
              {t("Automatic identity linking — one account per person")}
            </li>
          </ul>
        </div>
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
          Workspace · Agents · Workflow · Knowledge · Memory · Voice
        </p>
      </section>

      <section className="relative flex items-center justify-center px-5 py-12">
        <Button
          variant="ghost"
          size="sm"
          className="absolute end-4 top-4 gap-2"
          onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
        >
          <Globe className="size-4" />
          {language === "ar" ? "English" : "العربية"}
        </Button>
        <Card className="w-full max-w-md panel-shadow">
          <CardHeader className="space-y-2">
            <div className="flex items-center gap-2.5 lg:hidden">
              <span className="brand-gradient flex size-8 items-center justify-center rounded-lg font-display text-sm font-bold text-primary-foreground">
                Z
              </span>
              <span className="font-display text-sm font-semibold tracking-[0.22em]">ZYRONEX</span>
            </div>
            <CardTitle className="text-xl">
              {mode === "signin" ? t("Sign in to your workspace") : t("Create your account")}
            </CardTitle>
            <CardDescription>
              {mode === "signin"
                ? t("Enter your credentials to access the platform.")
                : t("A personal workspace is provisioned automatically.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2.5"
                disabled={providerBusy}
                onClick={() => handleProvider("google")}
              >
                <GoogleMark />
                {mode === "signin" ? t("Continue with Google") : t("Sign up with Google")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full gap-2.5"
                disabled={providerBusy}
                onClick={() => handleProvider("apple")}
              >
                <AppleMark />
                {mode === "signin" ? t("Continue with Apple") : t("Sign up with Apple")}
              </Button>
            </div>

            <div className="my-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {t("or")}
              </span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <Tabs value={mode} onValueChange={(value) => setMode(value as "signin" | "signup")}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">{t("Sign in")}</TabsTrigger>
                <TabsTrigger value="signup">{t("Register")}</TabsTrigger>
              </TabsList>

              <form onSubmit={handleSubmit} className="mt-6 space-y-4">
                <TabsContent value="signup" className="m-0 space-y-2">
                  <Label htmlFor="fullName">{t("Full name")}</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    placeholder="Ada Lovelace"
                    autoComplete="name"
                  />
                </TabsContent>

                <div className="space-y-2">
                  <Label htmlFor="email">{t("Work email")}</Label>
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    webkit-autofill="true"
                  />
                </div>

                {method === "password" && (
                  <div className="space-y-2">
                    <Label htmlFor="password">{t("Password")}</Label>
                    <Input
                      id="password"
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    />
                  </div>
                )}

                {method === "magic" && (
                  <p className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                    {t(
                      "We'll email you a one-time link. No password needed — the link expires shortly after it is sent.",
                    )}
                  </p>
                )}

                {method === "sso" && (
                  <p className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
                    {t(
                      "You'll be redirected to your organization's identity provider (SAML 2.0 / OIDC).",
                    )}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Checkbox
                      checked={remember}
                      onCheckedChange={(value) => setRemember(value === true)}
                    />
                    {t("Remember me")}
                  </label>
                  {mode === "signin" && method === "password" && (
                    <Button asChild variant="link" size="sm" className="h-auto p-0 text-xs">
                      <Link to="/forgot-password">{t("Forgot password?")}</Link>
                    </Button>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting
                    ? t("Please wait…")
                    : method === "magic"
                      ? t("Email me a magic link")
                      : method === "sso"
                        ? t("Continue with SSO")
                        : mode === "signin"
                          ? t("Sign in")
                          : t("Create account")}
                </Button>
              </form>
            </Tabs>

            <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs">
              {method !== "password" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto gap-1.5 px-2 py-1 text-xs"
                  onClick={() => setMethod("password")}
                >
                  <KeyRound className="size-3.5" />
                  {t("Use a password")}
                </Button>
              )}
              {method !== "magic" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto gap-1.5 px-2 py-1 text-xs"
                  onClick={() => setMethod("magic")}
                >
                  <Mail className="size-3.5" />
                  {t("Email me a magic link")}
                </Button>
              )}
              {method !== "sso" && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-auto gap-1.5 px-2 py-1 text-xs"
                  onClick={() => setMethod("sso")}
                >
                  <Building2 className="size-3.5" />
                  {t("Enterprise SSO")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
