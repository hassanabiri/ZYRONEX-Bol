import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppSidebar } from "@/components/app-sidebar";
import { AskZyronexAi } from "@/components/ask-zyronex-ai";
import { TopBar } from "@/components/top-bar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  component: AuthenticatedLayout,
});

function Loader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <span className="brand-gradient size-10 animate-pulse rounded-xl" />
    </div>
  );
}

function WorkspaceGate({ children }: { children: React.ReactNode }) {
  const { workspaces, isFetching, isLoaded } = useWorkspace();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoaded && !isFetching && workspaces.length === 0)
      navigate({ to: "/onboarding", replace: true });
  }, [isLoaded, isFetching, workspaces, navigate]);

  if (workspaces.length === 0) return <Loader />;
  return <>{children}</>;
}

function AuthenticatedLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session)
      navigate({
        to: "/auth",
        replace: true,
        search: { next: window.location.pathname + window.location.search },
      });
  }, [loading, session, navigate]);

  if (loading || !session) return <Loader />;

  return (
    <WorkspaceProvider>
      <WorkspaceGate>
        <SidebarProvider>
          <div className="relative flex min-h-screen w-full bg-background">
            <div
              aria-hidden="true"
              className="pointer-events-none fixed inset-0 z-0 opacity-[0.55] [background:radial-gradient(60rem_40rem_at_15%_-10%,color-mix(in_oklab,var(--primary)_16%,transparent),transparent_60%),radial-gradient(50rem_35rem_at_100%_0%,color-mix(in_oklab,var(--primary)_10%,transparent),transparent_55%)]"
            />
            <AppSidebar />
            <SidebarInset className="relative z-10 min-w-0 flex-1 bg-transparent">
              <TopBar />
              <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
                <Outlet />
              </main>
            </SidebarInset>
            <AskZyronexAi />
          </div>
        </SidebarProvider>

      </WorkspaceGate>
    </WorkspaceProvider>
  );
}

