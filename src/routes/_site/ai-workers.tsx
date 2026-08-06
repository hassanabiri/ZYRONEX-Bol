import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight, Bot, Cable, Layers } from "lucide-react";

import { Reveal } from "@/components/site/reveal";
import { CtaBanner, PageHero, SiteSection } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { capabilities, integrationGroups } from "@/lib/site/content";

export const Route = createFileRoute("/_site/ai-workers")({
  head: () => ({
    meta: [
      { title: "AI Workers — ZYRONEX" },
      {
        name: "description",
        content: "Build, deploy and govern AI workers with knowledge, memory, tools, voice and permissions.",
      },
      { property: "og:title", content: "AI Workers — ZYRONEX" },
      { property: "og:description", content: "Build, deploy and govern AI workers with knowledge, memory, tools and voice." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/ai-workers" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/ai-workers" }],
  }),
  component: AiWorkersPage,
});

function AiWorkersPage() {
  const { t } = useI18n();

  const highlights = [
    { icon: Bot, title: "Purpose-built", body: "Every worker has a clear objective, guardrails and a review step before it runs." },
    { icon: Layers, title: "Knowledge & memory", body: "Attach bases, documents and layered memory so the worker improves with every run." },
    { icon: Cable, title: "Tools & integrations", body: "Workers call connectors, APIs and other workers through a typed tool surface." },
  ];

  return (
    <>
      <PageHero
        eyebrow="AI Workers"
        title="One builder for every AI worker"
        description="Design workers that know your business, remember context, use tools and stay inside your governance rules."
        cta={{ label: "Start free", to: "/auth" }}
      />

      <SiteSection className="pt-4">
        <div className="grid gap-4 md:grid-cols-3">
          {highlights.map((item, index) => (
            <Reveal
              key={item.title}
              delay={index * 90}
              className="rounded-2xl border bg-card/50 p-6 transition-colors hover:border-primary/40"
            >
              <span className="flex size-10 items-center justify-center rounded-xl brand-gradient text-primary-foreground">
                <item.icon className="size-5" />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold">{t(item.title)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(item.body)}</p>
            </Reveal>
          ))}
        </div>
      </SiteSection>

      <SiteSection className="pt-0">
        <h2 className="font-display text-2xl font-semibold">{t("Capabilities every worker shares")}</h2>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((capability, index) => (
            <Reveal
              key={capability.title}
              delay={(index % 3) * 80}
              className="rounded-2xl border bg-card/50 p-5"
            >
              <h3 className="font-display text-base font-semibold">{t(capability.title)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(capability.body)}</p>
            </Reveal>
          ))}
        </div>
      </SiteSection>

      <SiteSection className="pt-0">
        <div className="glass-panel rounded-3xl p-8 text-center">
          <h2 className="font-display text-2xl font-semibold">{t("Ready to build your first worker?")}</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            {t("Create a workspace and follow the worker builder wizard — identity, purpose, provider, language and review.")}
          </p>
          <Button asChild size="lg" className="mt-6 gap-2">
            <Link to="/auth">
              {t("Create account")}
              <ArrowRight className="size-4 rtl:rotate-180" />
            </Link>
          </Button>
        </div>
      </SiteSection>

      <CtaBanner />
    </>
  );
}
