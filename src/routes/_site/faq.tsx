import { createFileRoute } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { Reveal } from "@/components/site/reveal";
import { CtaBanner, PageHero, SiteSection } from "@/components/site/section";
import { useI18n } from "@/lib/i18n";
import { faqs } from "@/lib/site/content";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_site/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — ZYRONEX" },
      { name: "description", content: "Straight answers about ZYRONEX: data isolation, providers, billing, Arabic support and getting started." },
      { property: "og:title", content: "FAQ — ZYRONEX" },
      { property: "og:description", content: "Straight answers about the ZYRONEX AI business operating platform." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/faq" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/faq" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: faqs.map((faq) => ({
            "@type": "Question",
            name: faq.q,
            acceptedAnswer: { "@type": "Answer", text: faq.a },
          })),
        }),
      },
    ],
  }),
  component: FaqPage,
});

function FaqPage() {
  const { t } = useI18n();
  const [open, setOpen] = useState<number | null>(0);

  return (
    <>
      <PageHero
        eyebrow="Answers"
        title="Frequently asked questions"
        description="If something is missing here, the assistant in the corner answers with the context of the page you are on."
      />

      <SiteSection className="pt-4">
        <div className="mx-auto max-w-3xl space-y-3">
          {faqs.map((faq, index) => {
            const isOpen = open === index;
            return (
              <Reveal key={faq.q} delay={index * 50} className="rounded-2xl border bg-card/50">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : index)}
                  aria-expanded={isOpen}
                  className="flex w-full items-center justify-between gap-4 p-5 text-start"
                >
                  <span className="text-sm font-semibold">{t(faq.q)}</span>
                  <ChevronDown className={cn("size-4 shrink-0 transition-transform", isOpen && "rotate-180")} />
                </button>
                <div
                  className={cn(
                    "grid transition-all duration-300",
                    isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
                  )}
                >
                  <p className="overflow-hidden px-5 pb-5 text-sm leading-relaxed text-muted-foreground">{t(faq.a)}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </SiteSection>

      <CtaBanner />
    </>
  );
}
