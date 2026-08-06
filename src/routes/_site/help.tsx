import { Link, createFileRoute } from "@tanstack/react-router";
import { BookOpen, FileText, HelpCircle, MessageSquare, Search, Ticket } from "lucide-react";

import { Reveal } from "@/components/site/reveal";
import { CtaBanner, PageHero, SiteSection } from "@/components/site/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";

export const Route = createFileRoute("/_site/help")({
  head: () => ({
    meta: [
      { title: "Help Center — ZYRONEX" },
      { name: "description", content: "Search guides, open a support ticket, or chat with the ZYRONEX assistant." },
      { property: "og:title", content: "Help Center — ZYRONEX" },
      { property: "og:description", content: "Guides, support tickets and AI help for ZYRONEX." },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "/help" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "/help" }],
  }),
  component: HelpPage,
});

const RESOURCES = [
  { icon: BookOpen, title: "Getting Started", body: "Set up your first workspace, invite your team and launch an AI worker in minutes." },
  { icon: FileText, title: "Documentation", body: "API references, workflow node guides, RLS examples and integration walkthroughs." },
  { icon: MessageSquare, title: "Community", body: "Join other builders to share workflows, templates and best practices." },
  { icon: Ticket, title: "Support Ticket", body: "Open a ticket and track the conversation from inside your workspace." },
  { icon: HelpCircle, title: "AI Assistant", body: "Ask the floating assistant on any page. It reads the context of where you are." },
  { icon: Search, title: "Search", body: "Find answers across docs, guides and previous support threads." },
];

function HelpPage() {
  const { t } = useI18n();

  return (
    <>
      <PageHero
        eyebrow="Support"
        title="How can we help?"
        description="Search the knowledge base, browse guides, or start a conversation with the assistant."
      />

      <SiteSection className="pt-4">
        <Reveal className="mx-auto max-w-2xl">
          <div className="glass-panel flex items-center gap-2 rounded-2xl p-2">
            <Search className="ms-3 size-4 text-muted-foreground" />
            <Input
              placeholder="Search documentation, guides and FAQs"
              className="border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <Button size="sm">{t("Search")}</Button>
          </div>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RESOURCES.map((resource, index) => (
            <Reveal
              key={resource.title}
              delay={(index % 3) * 80}
              className="rounded-2xl border bg-card/50 p-5 transition-colors hover:border-primary/40"
            >
              <resource.icon className="size-6 text-primary" />
              <h3 className="mt-4 font-display text-base font-semibold">{t(resource.title)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t(resource.body)}</p>
            </Reveal>
          ))}
        </div>

        <Reveal className="mt-12 text-center">
          <p className="text-sm text-muted-foreground">{t("Need direct help?")}</p>
          <Button asChild variant="link" className="mt-1">
            <Link to="/contact">{t("Contact our team")}</Link>
          </Button>
        </Reveal>
      </SiteSection>

      <CtaBanner />
    </>
  );
}
