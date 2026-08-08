import { createFileRoute } from "@tanstack/react-router";

import { DemoSimulator } from "@/components/site/demo-simulator";
import { SiteSection } from "@/components/site/section";

export const Route = createFileRoute("/_site/demo")({
  head: () => ({
    meta: [
      { title: "See ZYRONEX run on your business — AI live simulation" },
      {
        name: "description",
        content:
          "No forms, no sales calls. Tell the AI about your business and watch a live simulation of how ZYRONEX would run your sales, service, marketing and operations.",
      },
      { property: "og:title", content: "See ZYRONEX run on your business" },
      { property: "og:description", content: "An interactive AI simulation of your company operating on ZYRONEX." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/demo" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/demo" }],
  }),
  component: DemoPage,
});

function DemoPage() {
  return (
    <SiteSection className="pt-10">
      <DemoSimulator mode="simulation" />
    </SiteSection>
  );
}
