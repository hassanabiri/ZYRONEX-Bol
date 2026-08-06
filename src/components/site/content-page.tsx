import type { ReactNode } from "react";

import { Reveal } from "@/components/site/reveal";
import { SiteSection } from "@/components/site/section";

export function ContentPage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <>
      <section className="relative overflow-hidden border-b">
        <div className="aurora" aria-hidden="true" />
        <div className="relative mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20">
          <Reveal className="max-w-2xl">
            {eyebrow && (
              <span className="text-[11px] uppercase tracking-[0.22em] text-primary">{eyebrow}</span>
            )}
            <h1 className="mt-2 text-balance-tight font-display text-3xl font-semibold leading-tight sm:text-5xl">
              {title}
            </h1>
            {description && (
              <p className="mt-4 text-base leading-relaxed text-muted-foreground sm:text-lg">{description}</p>
            )}
          </Reveal>
        </div>
      </section>

      <SiteSection className="pt-8">
        <Reveal className="mx-auto max-w-3xl">{children}</Reveal>
      </SiteSection>
    </>
  );
}
