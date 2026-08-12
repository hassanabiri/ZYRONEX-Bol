import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Send, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { askSiteAssistant } from "@/lib/site/assistant.functions";
import { navSections } from "@/lib/navigation";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "What can I do on this page?",
  "Explain this module in simple words",
  "What should I set up next?",
];

/**
 * "Ask ZYRONEX AI" — an in-app help dock for the authenticated shell.
 * UI layer only: it reuses the existing assistant server function.
 */
export function AskZyronexAi() {
  const { t, language } = useI18n();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const ask = useServerFn(askSiteAssistant);
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const pageLabel = useMemo(() => {
    for (const section of navSections) {
      const match = section.items.find((item) => pathname.startsWith(item.to));
      if (match) return match.title;
    }
    return "Workspace";
  }, [pathname]);

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
          page: `${pageLabel} (${pathname})`,
          pageContext:
            "The user is signed in to the ZYRONEX workspace application. Explain the interface, terminology and next steps. Never invent data.",
          history,
          language,
        },
      });
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: result.reply ?? t("Something went wrong. Please try again."),
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
        aria-label={t("Ask ZYRONEX AI")}
        className="brand-gradient panel-shadow fixed bottom-5 end-4 z-50 flex h-12 items-center gap-2 rounded-full px-4 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.03] active:scale-95"
      >
        {open ? <X className="size-4" /> : <Sparkles className="size-4" />}
        <span className="hidden sm:inline">{t("Ask ZYRONEX AI")}</span>
      </button>

      {open ? (
        <div className="glass-panel panel-shadow fixed bottom-20 end-4 z-50 flex h-[min(70vh,560px)] w-[min(94vw,400px)] flex-col overflow-hidden rounded-3xl border">
          <div className="flex items-center gap-3 hairline-b p-4">
            <span className="brand-gradient flex size-9 items-center justify-center rounded-xl text-primary-foreground">
              <Bot className="size-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{t("Ask ZYRONEX AI")}</p>
              <p className="truncate text-xs text-muted-foreground">
                {t("Context")}: {t(pageLabel)}
              </p>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t("Ask anything about this page — I answer with the context of where you are.")}
                </p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((prompt) => (
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
            ) : null}

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

            {pending ? (
              <div className="flex w-fit gap-1.5 rounded-2xl bg-surface px-3.5 py-3">
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
                    style={{ animationDelay: `${dot * 120}ms` }}
                  />
                ))}
              </div>
            ) : null}
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
              placeholder={t("Ask about this page…")}
              className="h-10"
            />
            <Button
              type="submit"
              size="icon"
              className="size-10 shrink-0"
              disabled={pending}
              aria-label={t("Send")}
            >
              <Send className="size-4 rtl:-scale-x-100" />
            </Button>
          </form>
        </div>
      ) : null}
    </>
  );
}
