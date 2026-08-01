import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { authService } from "@/services/auth-service";

export const Route = createFileRoute("/reset-password")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Set a new password — ZYRONEX" },
      { name: "description", content: "Choose a new password for your ZYRONEX account." },
      { property: "og:title", content: "Set a new password — ZYRONEX" },
      { property: "og:description", content: "Choose a new password for your ZYRONEX account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      toast.error(t("Passwords do not match"));
      return;
    }
    setSubmitting(true);
    try {
      await authService.updatePassword(password);
      toast.success(t("Password updated"));
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not update password"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12">
      <Card className="w-full max-w-md panel-shadow">
        <CardHeader className="space-y-2">
          <CardTitle className="text-xl">{t("Set a new password")}</CardTitle>
          <CardDescription>{t("Choose a strong password you haven't used before.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{t("New password")}</Label>
              <Input
                id="password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">{t("Confirm password")}</Label>
              <Input
                id="confirm"
                type="password"
                required
                minLength={8}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                placeholder="••••••••"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t("Please wait…") : t("Update password")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
