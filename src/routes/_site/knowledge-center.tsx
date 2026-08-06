import { Link, createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { ContentPage } from "@/components/site/content-page";
import { CtaBanner } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_site/knowledge-center")({
  head: () => ({
    meta: [
      { title: "Knowledge Center — ZYRONEX" },
      { name: "description", content: "Guides, tutorials and reference articles for the ZYRONEX platform." },
      { property: "og:title", content: "Knowledge Center — ZYRONEX" },
      { property: "og:description", content: "Guides, tutorials and reference articles for the ZYRONEX platform." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/knowledge-center" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/knowledge-center" }],
  }),
  component: Page,
});

function Page() {
  const { t } = useI18n();

  return (
    <>
      <ContentPage
        eyebrow="Knowledge Center"
        title="Knowledge Center"
        description="Guides, tutorials and reference articles for the ZYRONEX platform."
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
