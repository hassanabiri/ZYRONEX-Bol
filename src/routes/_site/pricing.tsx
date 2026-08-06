import { Link, createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";

import { Reveal } from "@/components/site/reveal";
import { CtaBanner, PageHero, SiteSection } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { faqs, plans } from "@/lib/site/content";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_site/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — ZYRONEX" },
      { name: "description", content: "Start free, scale to production. Plans for teams building, running and governing AI workers." },
      { property: "og:title", content: "Pricing — ZYRONEX" },
      { property: "og:description", content: "Start free, scale to production. Plans for teams operating an AI workforce." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/pricing" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/pricing" }],
  }),
  component: PricingPage,
});

function PricingPage() {
  const { t } = useI18n();

  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Start free. Scale when the work does."
        description="Every plan includes the platform core — workspaces, workers, workflow engine and audit trail. You grow into services, not out of the product."
      />

      <SiteSection className="pt-4">
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map((plan, index) => (
            <Reveal
              key={plan.name}
              delay={index * 90}
              className={cn(
                "relative flex flex-col rounded-3xl border p-6",
                plan.highlighted ? "glass-panel ring-glow border-primary/40" : "bg-card/50",
              )}
            >
              {plan.highlighted && (
                <span className="absolute -top-3 start-6 rounded-full brand-gradient px-3 py-1 text-[11px] font-medium text-primary-foreground">
                  {t("Most chosen")}
                </span>
              )}
              <h2 className="font-display text-lg font-semibold">{t(plan.name)}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t(plan.tagline)}</p>
              <p className="mt-5 font-display text-3xl font-semibold">{t(plan.price)}</p>
              <p className="text-xs text-muted-foreground">{t(plan.cadence)}</p>
              <ul className="mt-6 flex-1 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2 text-sm text-muted-foreground">
                    <Check className="mt-0.5 size-4 shrink-0 text-success" />
                    <span>{t(feature)}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-6" variant={plan.highlighted ? "default" : "outline"}>
                <Link to={plan.to}>{t(plan.cta)}</Link>
              </Button>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-6 text-sm text-muted-foreground">
          {t("Usage of AI, voice and creative services is metered through credit ledgers in the Billing Center.")}{" "}
          <Link to="/compare" className="text-primary underline-offset-4 hover:underline">
            {t("Compare plans in detail")}
          </Link>
        </Reveal>
      </SiteSection>

      <SiteSection className="pt-0">
        <SectionHeading eyebrow="FAQ" title="Questions we hear most" />
        <div className="mt-8 grid gap-3 md:grid-cols-2">
          {faqs.slice(0, 4).map((faq, index) => (
            <Reveal key={faq.q} delay={(index % 2) * 80} className="rounded-2xl border bg-card/50 p-5">
              <h3 className="text-sm font-semibold">{t(faq.q)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(faq.a)}</p>
            </Reveal>
          ))}
        </div>
      </SiteSection>

      <CtaBanner />
    </>
  );
}
