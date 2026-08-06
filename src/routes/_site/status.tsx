import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { ContentPage } from "@/components/site/content-page";
import { CtaBanner } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_site/status")({
  head: () => ({
    meta: [
      { title: "Status — ZYRONEX" },
      { name: "description", content: "Check ZYRONEX platform status, uptime and incident history." },
      { property: "og:title", content: "Status — ZYRONEX" },
      { property: "og:description", content: "Check ZYRONEX platform status, uptime and incident history." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/status" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/status" }],
  }),
  component: Page,
});

function Page() {
  const { t } = useI18n();

  return (
    <>
      <ContentPage
        eyebrow="Status"
        title="Status"
        description="Check ZYRONEX platform status, uptime and incident history."
      >
        <p className="text-muted-foreground">
          {t("This page is being prepared with detailed content. In the meantime, explore the platform or talk to the assistant in the corner.")}
        </p>
        <Button asChild className="mt-6 gap-2">
          <Link to="/">
            {t("Back to home")}
            <ArrowRight className="size-4 rtl:rotate-180" />
          </Link>
        </Button>
      </ContentPage>
      <CtaBanner />
    </>
  );
}
