import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { useEffect } from "react";

import { CreateWorkspaceWizard } from "@/components/workspace/create-workspace-wizard";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";

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
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const { t } = useI18n();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-5 py-12">
      <Card className="w-full max-w-xl panel-shadow">
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
          <CreateWorkspaceWizard onCreated={() => navigate({ to: "/dashboard", replace: true })} />
        </CardContent>
      </Card>
    </main>
  );
}
