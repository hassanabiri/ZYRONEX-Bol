import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { authService } from "@/services/auth-service";
import { profileService } from "@/services/profile-service";

export const Route = createFileRoute("/auth")({
  ssr: false,
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

function AuthPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (session) navigate({ to: "/dashboard", replace: true });
  }, [session, navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      if (mode === "signin") {
        const data = await authService.signIn(email, password);
        if (data.user) {
          void profileService.touchLastLogin(data.user.id).catch(() => undefined);
        }
        navigate({ to: "/dashboard", replace: true });
      } else {
        const data = await authService.signUp(email, password, fullName);
        if (data.session) {
          navigate({ to: "/onboarding", replace: true });
        } else {
          toast.success(t("Check your inbox to confirm your email address."));
        }
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Authentication failed"));
    } finally {
      setSubmitting(false);
    }
  }

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
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">{t("Password")}</Label>
                  <Input
                    id="password"
                    type="password"
                    required
                    minLength={8}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  />
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting
                    ? t("Please wait…")
                    : mode === "signin"
                      ? t("Sign in")
                      : t("Create account")}
                </Button>
              </form>
            </Tabs>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
