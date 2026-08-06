import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { askSiteAssistant } from "@/lib/site/assistant.functions";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

const PAGE_CONTEXT: Record<string, { label: string; context: string; prompts: string[] }> = {
  "/": { label: "Homepage", context: "Overview of the platform: build, operate and manage AI workers.", prompts: ["What is ZYRONEX in one minute?", "Which plan fits my team?", "How do I get started?"] },
  "/ai-workers": { label: "AI Workers", context: "The worker builder, lifecycle, knowledge, memory, tools, voice and permissions per worker.", prompts: ["How do I create an AI worker?", "What can a worker connect to?", "How are workers versioned?"] },
  "/connectors": { label: "Integrations", context: "Connection wizard, encrypted credentials, webhooks, sync engine and health monitoring.", prompts: ["How do I connect Slack?", "Are credentials encrypted?", "What happens if a sync fails?"] },
  "/pricing": { label: "Pricing", context: "Starter is free, Growth and Enterprise are quoted. Credits and metered usage sit in the Billing Center.", prompts: ["Which plan should I choose?", "How do credits work?", "What is included in Enterprise?"] },
  "/compare": { label: "Plan comparison", context: "Feature-by-feature comparison of Starter, Growth and Enterprise.", prompts: ["What is the difference between Growth and Enterprise?", "Do I need the voice platform?"] },
  "/security": { label: "Security", context: "Row-level tenant isolation, RBAC, approvals, AES-256-GCM credential encryption and audit logs.", prompts: ["How is my data isolated?", "Can I control who approves actions?", "What is logged?"] },
  "/developers": { label: "Developer center", context: "Developer projects, OAuth clients, environment variables, plugins and SDKs.", prompts: ["How do I get an API key?", "Can I build a plugin?"] },
  "/api": { label: "API reference", context: "REST API with scoped workspace keys, executions, workers, knowledge and webhooks.", prompts: ["How do I trigger an execution?", "How do webhooks work?"] },
  "/help": { label: "Help center", context: "Guides, tickets, issue reports and feature requests.", prompts: ["How do I open a ticket?", "Where do I report a problem?"] },
  "/contact": { label: "Contact", context: "Contact form routed to sales, support or partnerships.", prompts: ["Can I talk to sales?", "How fast do you reply?"] },
  "/demo": { label: "Book a demo", context: "Guided walkthrough request with a specialist.", prompts: ["What is covered in the demo?", "Can you demo the voice platform?"] },
};

const FALLBACK = {
  label: "ZYRONEX",
  context: "General information about the ZYRONEX AI business operating platform.",
  prompts: ["What is ZYRONEX?", "Which plan fits my team?", "How do I get started?"],
};

export function SiteAssistant() {
  const { t, language } = useI18n();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const ask = useServerFn(askSiteAssistant);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const page = useMemo(() => PAGE_CONTEXT[pathname] ?? FALLBACK, [pathname]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    setInput("");
    const history = messages.slice(-8);
    setMessages((current) => [...current, { role: "user", content: question }]);
    setPending(true);
    try {
      const result = await ask({
        data: {
          message: question,
          page: `${page.label} (${pathname})`,
          pageContext: page.context,
          history,
          language,
        },
      });
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content:
            result.reply ??
            t("The assistant is unavailable right now. You can reach the team from the contact page."),
        },
      ]);
    } catch {
      setMessages((current) => [
        ...current,
        { role: "assistant", content: t("Something went wrong. Please try again.") },
      ]);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t("Open the ZYRONEX assistant")}
        className="ring-glow fixed bottom-5 end-5 z-50 flex size-13 min-h-13 min-w-13 items-center justify-center rounded-full brand-gradient text-primary-foreground transition-transform hover:scale-105 active:scale-95"
      >
        {open ? <X className="size-5" /> : <Sparkles className="size-5" />}
      </button>

      {open && (
        <div className="glass-panel panel-shadow fixed bottom-24 end-4 z-50 flex h-[min(70vh,560px)] w-[min(94vw,400px)] flex-col overflow-hidden rounded-3xl">
          <div className="flex items-center gap-3 border-b p-4">
            <span className="flex size-9 items-center justify-center rounded-xl brand-gradient text-primary-foreground">
              <Bot className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{t("ZYRONEX Assistant")}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t("Context")}: {t(page.label)}
              </p>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t("Ask anything about this page — I answer with the context of where you are.")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {page.prompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void send(t(prompt))}
                      className="rounded-full border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                    >
                      {t(prompt)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((message, index) => (
              <div
                key={index}
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  message.role === "user"
                    ? "ms-auto bg-primary text-primary-foreground"
                    : "bg-surface text-foreground",
                )}
              >
                {message.content}
              </div>
            ))}

            {pending && (
              <div className="flex gap-1.5 rounded-2xl bg-surface px-3.5 py-3">
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
                    style={{ animationDelay: `${dot * 120}ms` }}
                  />
                ))}
              </div>
            )}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
            className="flex items-center gap-2 border-t p-3"
          >
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={t("Ask about ZYRONEX…")}
              className="h-10"
            />
            <Button type="submit" size="icon" className="size-10 shrink-0" disabled={pending} aria-label={t("Send")}>
              <Send className="size-4 rtl:-scale-x-100" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
