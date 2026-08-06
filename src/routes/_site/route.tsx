import { Outlet, createFileRoute } from "@tanstack/react-router";

import { SiteAssistant } from "@/components/site/ai-assistant";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

export const Route = createFileRoute("/_site")({
  component: SiteLayout,
});

function SiteLayout() {
  return (
    <div className="relative min-h-screen overflow-x-clip bg-background">
      <SiteHeader />
      <main id="content">
        <Outlet />
      </main>
      <SiteFooter />
      <SiteAssistant />
    </div>
  );
}
