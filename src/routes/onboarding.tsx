import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { workspaceService } from "@/services/workspace-service";

export const Route = createFileRoute("/onboarding")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Create your workspace — ZYRONEX" },
      {
        name: "description",
        content: "Set up your first ZYRONEX workspace to start operating AI agents.",
      },
      { property: "og:title", content: "Create your workspace — ZYRONEX" },
      {
        property: "og:description",
        content: "Set up your first ZYRONEX workspace to start operating AI agents.",
      },
    ],
  }),
  component: OnboardingPage,
});

function OnboardingPage() {
  const { session, loading, user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await workspaceService.create(name, slug);
      await queryClient.refetchQueries({ queryKey: ["workspaces", user?.id] });
      toast.success(t("Workspace created"));
      navigate({ to: "/dashboard", replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Could not create workspace"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12">
      <Card className="w-full max-w-md panel-shadow">
        <CardHeader className="space-y-2">
          <span className="brand-gradient flex size-9 items-center justify-center rounded-lg">
            <Building2 className="size-4 text-primary-foreground" />
          </span>
          <CardTitle className="text-xl">{t("Create your first workspace")}</CardTitle>
          <CardDescription>
            {t("Workspaces isolate your agents, knowledge, members and billing.")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ws-name">{t("Workspace name")}</Label>
              <Input
                id="ws-name"
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Acme AI"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ws-slug">{t("Slug (optional)")}</Label>
              <Input
                id="ws-slug"
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="acme-ai"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? t("Please wait…") : t("Create workspace")}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
