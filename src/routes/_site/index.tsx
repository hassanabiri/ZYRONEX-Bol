import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Boxes, Play, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ProductPreview } from "@/components/site/product-preview";
import { Reveal } from "@/components/site/reveal";
import { CtaBanner, SectionHeading, SiteSection } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { capabilities, industries, integrationGroups, pillars } from "@/lib/site/content";

export const Route = createFileRoute("/_site/")({
  head: () => ({
    meta: [
      { title: "ZYRONEX — The AI Business Operating Platform" },
      {
        name: "description",
        content:
          "Build, operate and govern an AI workforce from one control plane: AI workers, workflow engine, knowledge, memory, voice, integrations and cost governance.",
      },
      { property: "og:title", content: "ZYRONEX — The AI Business Operating Platform" },
      { property: "og:description", content: "One control plane to build, run and govern AI workers across your company." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "ZYRONEX",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description: "AI business operating platform for building, running and governing AI workers across workspaces.",
        }),
      },
    ],
  }),
  component: HomePage,
});

const STATS = [
  { value: 19, suffix: "", label: "Workflow node types" },
  { value: 30, suffix: "+", label: "Integration providers" },
  { value: 13, suffix: "", label: "Platform modules" },
  { value: 100, suffix: "%", label: "Workspace-isolated data" },
];

function Counter({ value, suffix }: { value: number; suffix: string }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) return setDisplay(value);
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - start) / 1200, 1);
        setDisplay(Math.round(value * (1 - Math.pow(1 - progress, 3))));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [value]);

  return (
    <span ref={ref} className="font-display text-4xl font-semibold tabular-nums sm:text-5xl">
      {display}
      {suffix}
    </span>
  );
}

function HomePage() {
  const { t } = useI18n();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const marquee = [...integrationGroups.flatMap((group) => group.items)];

  useEffect(() => {
    if (!loading && session) navigate({ to: "/dashboard", replace: true });
  }, [loading, session, navigate]);

  if (loading || session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <span className="brand-gradient flex size-10 animate-pulse items-center justify-center rounded-xl font-display font-bold text-primary-foreground">
            Z
          </span>
          <p className="text-sm text-muted-foreground">{t("Loading ZYRONEX…")}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <section className="relative overflow-hidden">
        <div className="aurora" aria-hidden="true" />
        <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-40" aria-hidden="true" />
        <div className="relative mx-auto grid max-w-7xl gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pb-24 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:items-center">
          <Reveal className="space-y-7">
            <span className="glass-panel inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              {t("An operating system for AI-run business")}
            </span>
            <h1 className="text-balance-tight font-display text-4xl font-semibold leading-[1.05] sm:text-6xl lg:text-[4.25rem]">
              {t("Run your company")}{" "}
              <span className="brand-text">{t("with an AI workforce")}</span>
            </h1>
            <p className="max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              {t("ZYRONEX is the control plane where you build AI workers, give them knowledge, memory, tools and voice, run them through a validated execution engine, and govern access, cost and evidence — from one workspace.")}
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="gap-2">
                <Link to="/auth">
                  {t("Start free")}
                  <ArrowRight className="size-4 rtl:rotate-180" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="gap-2">
                <Link to="/demo">
                  <Play className="size-4" />
                  {t("Book a demo")}
                </Link>
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-3.5 text-success" />
                {t("Row-level tenant isolation")}
              </span>
              <span className="flex items-center gap-1.5">
                <Boxes className="size-3.5 text-primary" />
                {t("Provider independent")}
              </span>
              <span>{t("Arabic & English, full RTL")}</span>
            </div>
          </Reveal>

          <Reveal delay={120} className="float-slow">
            <ProductPreview />
          </Reveal>
        </div>
      </section>

      <div className="hairline overflow-hidden py-6">
        <div className="marquee-track flex gap-10 px-4">
          {[...marquee, ...marquee].map((name, index) => (
            <span
              key={`${name}-${index}`}
              className="whitespace-nowrap text-sm tracking-wide text-muted-foreground/70"
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      <SiteSection>
        <SectionHeading
          eyebrow="Build · Operate · Manage"
          title="Three pillars, one platform"
          description="Everything an AI worker needs to exist, run and be accountable — without stitching tools together."
        />
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          {pillars.map((pillar, index) => (
            <Reveal
              key={pillar.title}
              delay={index * 90}
              className="glass-panel group rounded-3xl p-6 transition-transform duration-300 hover:-translate-y-1"
            >
              <p className="text-[11px] uppercase tracking-[0.22em] text-primary">{t(pillar.title)}</p>
              <h3 className="mt-3 font-display text-xl font-semibold">{t(pillar.headline)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(pillar.body)}</p>
              <ul className="mt-5 space-y-2">
                {pillar.points.map((point) => (
                  <li key={point} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <span className="size-1.5 rounded-full brand-gradient" />
                    {t(point)}
                  </li>
                ))}
              </ul>
            </Reveal>
          ))}
        </div>
      </SiteSection>

      <SiteSection>
        <SectionHeading
          eyebrow="Platform"
          title="Reusable capabilities, not isolated features"
          description="Each capability is shared across every worker, workflow and workspace in the platform."
        />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((capability, index) => (
            <Reveal
              key={capability.title}
              delay={(index % 3) * 80}
              className="rounded-2xl border bg-card/50 p-5 transition-colors hover:border-primary/40"
            >
              <h3 className="font-display text-base font-semibold">{t(capability.title)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(capability.body)}</p>
            </Reveal>
          ))}
        </div>
      </SiteSection>

      <SiteSection>
        <div className="glass-panel grid gap-8 rounded-3xl px-6 py-12 sm:grid-cols-2 lg:grid-cols-4">
          {STATS.map((stat) => (
            <div key={stat.label} className="text-center">
              <Counter value={stat.value} suffix={stat.suffix} />
              <p className="mt-2 text-xs uppercase tracking-[0.16em] text-muted-foreground">{t(stat.label)}</p>
            </div>
          ))}
        </div>
      </SiteSection>

      <SiteSection>
        <SectionHeading
          eyebrow="Industries"
          title="Built for how your sector actually operates"
          description="The same core platform, configured around the controls and workflows each industry expects."
        />
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {industries.map((industry, index) => (
            <Reveal
              key={industry.name}
              delay={(index % 3) * 80}
              className="group relative overflow-hidden rounded-2xl border p-5"
            >
              <div className="absolute inset-0 -z-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100 brand-gradient" />
              <h3 className="font-display text-base font-semibold transition-colors group-hover:text-primary-foreground">
                {t(industry.name)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground transition-colors group-hover:text-primary-foreground/90">
                {t(industry.body)}
              </p>
            </Reveal>
          ))}
        </div>
      </SiteSection>

      <CtaBanner />
    </>
  );
}
