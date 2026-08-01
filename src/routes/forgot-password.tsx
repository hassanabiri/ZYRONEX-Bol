import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { authService } from "@/services/auth-service";

export const Route = createFileRoute("/forgot-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Reset your password — ZYRONEX" },
      { name: "description", content: "Request a password reset link for your ZYRONEX account." },
      { property: "og:title", content: "Reset your password — ZYRONEX" },
      {
        property: "og:description",
        content: "Request a password reset link for your ZYRONEX account.",
      },
    ],
  }),
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await authService.requestPasswordReset(email);
      setSent(true);
      toast.success(t("Reset link sent. Check your inbox."));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not send reset link"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12">
      <Card className="w-full max-w-md panel-shadow">
        <CardHeader className="space-y-2">
          <CardTitle className="text-xl">{t("Forgot your password?")}</CardTitle>
          <CardDescription>
            {t("Enter your email and we'll send you a link to set a new password.")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
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
            <Button type="submit" className="w-full" disabled={submitting || sent}>
              {submitting ? t("Please wait…") : t("Send reset link")}
            </Button>
          </form>
          <Button asChild variant="ghost" className="w-full">
            <Link to="/auth">{t("Back to sign in")}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
