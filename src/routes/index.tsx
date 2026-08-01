import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "ZYRONEX — Sign in to your workspace" },
      {
        name: "description",
        content: "Access the ZYRONEX AI Agent Operating Platform and your workspace dashboard.",
      },
      { property: "og:title", content: "ZYRONEX — Sign in to your workspace" },
      {
        property: "og:description",
        content: "Access the ZYRONEX AI Agent Operating Platform and your workspace dashboard.",
      },
    ],
  }),
  component: IndexRedirect,
});

function IndexRedirect() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    navigate({ to: session ? "/dashboard" : "/auth", replace: true });
  }, [session, loading, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <span className="brand-gradient flex size-10 animate-pulse items-center justify-center rounded-xl font-display font-bold text-primary-foreground">
          Z
        </span>
        <p className="text-sm text-muted-foreground">Loading ZYRONEX…</p>
      </div>
    </div>
  );
}
