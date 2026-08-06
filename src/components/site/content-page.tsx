import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { Reveal } from "@/components/site/reveal";
import { CtaBanner, PageHero, SiteSection } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { contentPages, type ContentPage } from "@/lib/site/content";

/** Renders any data-driven secondary page from the site content model. */
export function ContentPageView({ page }: { page: ContentPage }) {
  const { t } = useI18n();

  return (
    <>
      <PageHero eyebrow={page.eyebrow} title={page.title} description={page.description} />

      <SiteSection className="pt-4">
        <div className="grid gap-4 md:grid-cols-2">
          {page.sections.map((section, index) => (
            <Reveal
              key={section.heading}
              delay={(index % 2) * 80}
              className="rounded-2xl border bg-card/50 p-6 transition-colors hover:border-primary/40"
            >
              <h2 className="font-display text-lg font-semibold">{t(section.heading)}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(section.body)}</p>
              {section.bullets && (
                <ul className="mt-4 space-y-2">
                  {section.bullets.map((bullet) => (
                    <li key={bullet} className="flex gap-2 text-sm text-muted-foreground">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full brand-gradient" />
                      <span>{t(bullet)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Reveal>
          ))}
        </div>

        {page.cta && (
          <Reveal className="mt-10">
            <Button asChild variant="outline" className="gap-2">
              <Link to={page.cta.to}>
                {t(page.cta.label)}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          </Reveal>
        )}
      </SiteSection>

      <CtaBanner />
    </>
  );
}

/** Head metadata helper so every content route ships unique SEO tags. */
export function contentHead(key: keyof typeof contentPages) {
  const page = contentPages[key]!;
  const title = `${page.title} — ZYRONEX`;
  return () => ({
    meta: [
      { title },
      { name: "description", content: page.description.slice(0, 155) },
      { property: "og:title", content: title },
      { property: "og:description", content: page.description.slice(0, 155) },
      { property: "og:type", content: "website" },
      { property: "og:url", content: page.slug },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: page.slug }],
  });
}
