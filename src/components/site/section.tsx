import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { Reveal } from "@/components/site/reveal";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function SiteSection({
  children,
  className,
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-24", className)}>
      {children}
    </section>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  align = "start",
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "start" | "center";
}) {
  const { t } = useI18n();
  return (
    <Reveal className={cn("max-w-2xl space-y-3", align === "center" && "mx-auto text-center")}>
      {eyebrow && <p className="text-[11px] uppercase tracking-[0.22em] text-primary">{t(eyebrow)}</p>}
      <h2 className="text-balance-tight font-display text-3xl font-semibold sm:text-4xl">{t(title)}</h2>
      {description && <p className="text-base leading-relaxed text-muted-foreground">{t(description)}</p>}
    </Reveal>
  );
}

export function PageHero({
  eyebrow,
  title,
  description,
  cta,
}: {
  eyebrow: string;
  title: string;
  description: string;
  cta?: { label: string; to: string };
}) {
  const { t } = useI18n();
  return (
    <div className="relative overflow-hidden">
      <div className="aurora opacity-60" aria-hidden="true" />
      <div className="relative mx-auto max-w-7xl px-4 pb-10 pt-16 sm:px-6 sm:pb-14 sm:pt-24">
        <Reveal className="max-w-3xl space-y-5">
          <p className="text-[11px] uppercase tracking-[0.22em] text-primary">{t(eyebrow)}</p>
          <h1 className="text-balance-tight font-display text-4xl font-semibold sm:text-6xl">{t(title)}</h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">{t(description)}</p>
          {cta && (
            <Button asChild size="lg" className="gap-2">
              <Link to={cta.to}>
                {t(cta.label)}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
          )}
        </Reveal>
      </div>
    </div>
  );
}

export function CtaBanner() {
  const { t } = useI18n();
  return (
    <SiteSection>
      <Reveal className="glass-panel panel-shadow relative overflow-hidden rounded-3xl px-6 py-14 text-center sm:px-12">
        <div className="aurora opacity-70" aria-hidden="true" />
        <div className="relative space-y-5">
          <h2 className="text-balance-tight font-display text-3xl font-semibold sm:text-4xl">
            {t("Put your AI workforce to work")}
          </h2>
          <p className="mx-auto max-w-xl text-muted-foreground">
            {t("Create a workspace, build your first AI worker and run it through a governed execution engine — today.")}
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" className="gap-2">
              <Link to="/auth">
                {t("Start free")}
                <ArrowRight className="size-4 rtl:rotate-180" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/demo">{t("Book a demo")}</Link>
            </Button>
          </div>
        </div>
      </Reveal>
    </SiteSection>
  );
}
