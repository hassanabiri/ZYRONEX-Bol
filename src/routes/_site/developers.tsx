import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { ContentPage } from "@/components/site/content-page";
import { CtaBanner } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_site/developers")({
  head: () => ({
    meta: [
      { title: "Developers — ZYRONEX" },
      { name: "description", content: "Build on ZYRONEX with API keys, OAuth clients, SDKs, webhooks and plugin extensions." },
      { property: "og:title", content: "Developers — ZYRONEX" },
      { property: "og:description", content: "Build on ZYRONEX with API keys, OAuth clients, SDKs, webhooks and plugin extensions." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/developers" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/developers" }],
  }),
  component: Page,
});

function Page() {
  const { t } = useI18n();

  return (
    <>
      <ContentPage
        eyebrow="Developers"
        title="Developers"
        description="Build on ZYRONEX with API keys, OAuth clients, SDKs, webhooks and plugin extensions."
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
