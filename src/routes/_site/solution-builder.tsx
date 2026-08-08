import { createFileRoute } from "@tanstack/react-router";

import { DemoSimulator } from "@/components/site/demo-simulator";
import { SiteSection } from "@/components/site/section";

export const Route = createFileRoute("/_site/solution-builder")({
  head: () => ({
    meta: [
      { title: "Design your ZYRONEX system with AI — custom configuration" },
      {
        name: "description",
        content:
          "Describe your business and let the AI design your ZYRONEX environment: capabilities, integrations, expected usage and the right plan — no sales form.",
      },
      { property: "og:title", content: "Design your ZYRONEX system with AI" },
      { property: "og:description", content: "An AI solution builder that configures ZYRONEX around your business." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/solution-builder" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/solution-builder" }],
  }),
  component: SolutionBuilderPage,
});

function SolutionBuilderPage() {
  return (
    <SiteSection className="pt-10">
      <DemoSimulator mode="solution" />
    </SiteSection>
  );
}
