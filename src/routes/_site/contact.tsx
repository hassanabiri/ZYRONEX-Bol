import { createFileRoute } from "@tanstack/react-router";
import { Mail, MapPin, Phone } from "lucide-react";
import { useState } from "react";

import { Reveal } from "@/components/site/reveal";
import { CtaBanner, PageHero, SiteSection } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_site/contact")({
  head: () => ({
    meta: [
      { title: "Contact — ZYRONEX" },
      { name: "description", content: "Get in touch with the ZYRONEX team for sales, support or partnership questions." },
      { property: "og:title", content: "Contact — ZYRONEX" },
      { property: "og:description", content: "Sales, support and partnership enquiries for ZYRONEX." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/contact" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/contact" }],
  }),
  component: ContactPage,
});

function ContactPage() {
  const { t } = useI18n();
  const [submitted, setSubmitted] = useState(false);

  return (
    <>
      <PageHero
        eyebrow="Contact"
        title="Talk to the team"
        description="Sales, implementation support, partnerships or just a question — we read every message."
      />

      <SiteSection className="pt-4">
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <Reveal className="glass-panel rounded-3xl p-6 sm:p-8">
            {submitted ? (
              <div className="text-center">
                <h2 className="font-display text-xl font-semibold">{t("Message sent")}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{t("We will get back to you within one business day.")}</p>
                <Button className="mt-6" variant="outline" onClick={() => setSubmitted(false)}>
                  {t("Send another")}
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
                <div className="space-y-2">
                  <Label htmlFor="company">{t("Company")}</Label>
                  <Input id="company" placeholder="Acme Inc." />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="message">{t("Message")}</Label>
                  <Textarea id="message" rows={5} placeholder="Tell us what you are building..." required />
                </div>
                <Button type="submit" className="w-full sm:w-auto">
                  {t("Send message")}
                </Button>
              </form>
            )}
          </Reveal>

          <div className="space-y-4">
            <Reveal delay={80} className="rounded-2xl border bg-card/50 p-5">
              <Mail className="size-5 text-primary" />
              <h3 className="mt-3 font-display text-base font-semibold">{t("Email")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">hello@zyronex.com</p>
            </Reveal>
            <Reveal delay={160} className="rounded-2xl border bg-card/50 p-5">
              <Phone className="size-5 text-primary" />
              <h3 className="mt-3 font-display text-base font-semibold">{t("Phone")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">+966 50 000 0000</p>
            </Reveal>
            <Reveal delay={240} className="rounded-2xl border bg-card/50 p-5">
              <MapPin className="size-5 text-primary" />
              <h3 className="mt-3 font-display text-base font-semibold">{t("Office")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">Riyadh, Saudi Arabia</p>
            </Reveal>
          </div>
        </div>
      </SiteSection>

      <CtaBanner />
    </>
  );
}
