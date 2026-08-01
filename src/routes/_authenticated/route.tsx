import { Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { AppSidebar } from "@/components/app-sidebar";
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
  const { workspaces, isLoading } = useWorkspace();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && workspaces.length === 0) navigate({ to: "/onboarding", replace: true });
  }, [isLoading, workspaces, navigate]);

  if (isLoading || workspaces.length === 0) return <Loader />;
  return <>{children}</>;
}

function AuthenticatedLayout() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !session) navigate({ to: "/auth", replace: true });
  }, [loading, session, navigate]);

  if (loading || !session) return <Loader />;

  return (
    <WorkspaceProvider>
      <WorkspaceGate>
        <SidebarProvider>
          <div className="flex min-h-screen w-full bg-background">
            <AppSidebar />
            <SidebarInset className="min-w-0 flex-1">
              <TopBar />
              <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 sm:py-8">
                <Outlet />
              </main>
            </SidebarInset>
          </div>
        </SidebarProvider>
      </WorkspaceGate>
    </WorkspaceProvider>
  );
}

