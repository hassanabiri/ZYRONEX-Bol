import { createFileRoute } from "@tanstack/react-router";
import { Check, Minus } from "lucide-react";

import { Reveal } from "@/components/site/reveal";
import { CtaBanner, PageHero, SiteSection } from "@/components/site/section";
import { useI18n } from "@/lib/i18n";
import { planComparison } from "@/lib/site/content";

export const Route = createFileRoute("/_site/compare")({
  head: () => ({
    meta: [
      { title: "Compare plans — ZYRONEX" },
      { name: "description", content: "Feature-by-feature comparison of the Starter, Growth and Enterprise plans on ZYRONEX." },
      { property: "og:title", content: "Compare plans — ZYRONEX" },
      { property: "og:description", content: "Starter, Growth and Enterprise compared feature by feature." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/compare" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/compare" }],
  }),
  component: ComparePage,
});

function ComparePage() {
  const { t } = useI18n();

  return (
    <>
      <PageHero
        eyebrow="Plans"
        title="Compare every plan"
        description="The platform core is identical across plans. What changes is scale, services and governance depth."
        cta={{ label: "See pricing", to: "/pricing" }}
      />

      <SiteSection className="pt-4">
        <Reveal className="glass-panel overflow-hidden rounded-3xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b">
                  <th className="p-4 text-start text-xs uppercase tracking-[0.16em] text-muted-foreground">{t("Capability")}</th>
                  {planComparison.columns.map((column) => (
                    <th key={column} className="p-4 text-start font-display text-base font-semibold">{t(column)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {planComparison.rows.map((row) => (
                  <tr key={row.label} className="border-b last:border-0">
                    <td className="p-4 text-muted-foreground">{t(row.label)}</td>
                    {row.values.map((value, index) => (
                      <td key={`${row.label}-${index}`} className="p-4">
                        {value === "—" ? (
                          <Minus className="size-4 text-muted-foreground/60" />
                        ) : value === "Included" ? (
                          <span className="flex items-center gap-1.5 text-success">
                            <Check className="size-4" />
                            {t("Included")}
                          </span>
                        ) : (
                          t(value)
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>
      </SiteSection>

      <CtaBanner />
    </>
  );
}
