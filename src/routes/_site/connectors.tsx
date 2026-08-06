import { createFileRoute } from "@tanstack/react-router";

import { Reveal } from "@/components/site/reveal";
import { CtaBanner, PageHero, SiteSection } from "@/components/site/section";
import { useI18n } from "@/lib/i18n";
import { integrationGroups } from "@/lib/site/content";

export const Route = createFileRoute("/_site/connectors")({
  head: () => ({
    meta: [
      { title: "Connectors — ZYRONEX" },
      { name: "description", content: "Explore the integration providers available on ZYRONEX: AI, CRM, messaging, voice, storage and more." },
      { property: "og:title", content: "Connectors — ZYRONEX" },
      { property: "og:description", content: "AI, CRM, messaging, voice and storage integrations for ZYRONEX." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/connectors" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/connectors" }],
  }),
  component: ConnectorsPage,
});

function ConnectorsPage() {
  const { t } = useI18n();

  return (
    <>
      <PageHero
        eyebrow="Integrations"
        title="Connect the tools you already use"
        description="ZYRONEX integrates with AI providers, CRMs, messaging platforms, voice carriers, cloud storage and developer tools — all scoped to a workspace."
      />

      <SiteSection className="pt-4">
        <div className="grid gap-6">
          {integrationGroups.map((group, groupIndex) => (
            <Reveal key={group.group} delay={groupIndex * 80} className="rounded-3xl border bg-card/50 p-6">
              <h2 className="font-display text-lg font-semibold">{t(group.group)}</h2>
              <div className="mt-5 flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <span
                    key={item}
                    className="glass-panel rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground"
                  >
                    {item}
                  </span>
                ))}
              </div>
            </Reveal>
          ))}
        </div>
      </SiteSection>

      <CtaBanner />
    </>
  );
}
