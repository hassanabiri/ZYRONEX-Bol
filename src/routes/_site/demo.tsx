import { createFileRoute } from "@tanstack/react-router";
import { Calendar, CheckCircle, Clock, Users } from "lucide-react";
import { useState } from "react";

import { Reveal } from "@/components/site/reveal";
import { CtaBanner, PageHero, SiteSection } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_site/demo")({
  head: () => ({
    meta: [
      { title: "Book a demo — ZYRONEX" },
      { name: "description", content: "Schedule a guided demo of the ZYRONEX AI business operating platform." },
      { property: "og:title", content: "Book a demo — ZYRONEX" },
      { property: "og:description", content: "See ZYRONEX in action with a product expert." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/demo" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/demo" }],
  }),
  component: DemoPage,
});

function DemoPage() {
  const { t } = useI18n();
  const [submitted, setSubmitted] = useState(false);

  return (
    <>
      <PageHero
        eyebrow="Demo"
        title="See ZYRONEX with your own data"
        description="A 30-minute guided walkthrough. We will show the platform, then discuss how it fits your workflows."
      />

      <SiteSection className="pt-4">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <Reveal className="glass-panel rounded-3xl p-6 sm:p-8">
            {submitted ? (
              <div className="text-center">
                <CheckCircle className="mx-auto size-10 text-success" />
                <h2 className="mt-4 font-display text-xl font-semibold">{t("Demo request received")}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{t("Our team will contact you within one business day to confirm a time.")}</p>
                <Button className="mt-6" variant="outline" onClick={() => setSubmitted(false)}>
                  {t("Request another")}
                </Button>
              </div>
            ) : (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setSubmitted(true);
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="name">{t("Full name")}</Label>
                    <Input id="name" placeholder="John Doe" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">{t("Work email")}</Label>
                    <Input id="email" type="email" placeholder="john@company.com" required />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="company">{t("Company")}</Label>
                    <Input id="company" placeholder="Acme Inc." required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="team-size">{t("Team size")}</Label>
                    <Input id="team-size" placeholder="10-50" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">{t("What would you like to see?")}</Label>
                  <Input id="notes" placeholder="AI workers, voice, billing, integrations..." />
                </div>
                <Button type="submit" className="w-full sm:w-auto">
                  {t("Request demo")}
                </Button>
              </form>
            )}
          </Reveal>

          <div className="space-y-4">
            <Reveal delay={80} className="rounded-2xl border bg-card/50 p-5">
              <Clock className="size-5 text-primary" />
              <h3 className="mt-3 font-display text-base font-semibold">{t("30 minutes")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t("Focused on your use case, not a generic pitch.")}</p>
            </Reveal>
            <Reveal delay={160} className="rounded-2xl border bg-card/50 p-5">
              <Users className="size-5 text-primary" />
              <h3 className="mt-3 font-display text-base font-semibold">{t("Live workspace")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t("See a real workspace with workers, workflows and audit logs.")}</p>
            </Reveal>
            <Reveal delay={240} className="rounded-2xl border bg-card/50 p-5">
              <Calendar className="size-5 text-primary" />
              <h3 className="mt-3 font-display text-base font-semibold">{t("Flexible scheduling")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t("We work with your timezone and language preference.")}</p>
            </Reveal>
          </div>
        </div>
      </SiteSection>

      <CtaBanner />
    </>
  );
}
