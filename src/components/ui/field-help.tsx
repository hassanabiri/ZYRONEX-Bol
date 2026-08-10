import { useServerFn } from "@tanstack/react-start";
import { HelpCircle, Loader2, Sparkles } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { assistField } from "@/lib/ai-field.functions";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type FieldHelpProps = {
  /** Visible field title. */
  label: string;
  /** 1. What is this field? */
  what?: string;
  /** 2. Required data format. */
  format?: string;
  /** 3. A real example of correct data. */
  example?: string;
  /** Extra project context handed to the AI. */
  context?: string;
  /** Current value, used when generating a better suggestion. */
  value?: string;
  /** When provided, the ✨ button can auto-fill the field. */
  onGenerate?: (value: string) => void;
  htmlFor?: string;
  className?: string;
  children?: ReactNode;
};

/**
 * Field title + contextual micro-copy (? Info) + in-context AI assistant (✨).
 */
export function FieldHelp({
  label,
  what,
  format,
  example,
  context,
  value,
  onGenerate,
  htmlFor,
  className,
  children,
}: FieldHelpProps) {
  const { t, language } = useI18n();
  const ask = useServerFn(assistField);
  const [busy, setBusy] = useState(false);
  const [aiText, setAiText] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function run(mode: "explain" | "generate") {
    setBusy(true);
    setAiText(null);
    if (mode === "explain") setOpen(true);
    try {
      const response = await ask({
        data: {
          mode,
          field: label,
          description: what,
          format,
          example,
          currentValue: value,
          context,
          language,
        },
      });
      if (!response.text) {
        setAiText(t("The assistant is unavailable right now."));
        setOpen(true);
        return;
      }
      if (mode === "generate" && onGenerate) {
        onGenerate(response.text);
      } else {
        setAiText(response.text);
        setOpen(true);
      }
    } catch {
      setAiText(t("The assistant is unavailable right now."));
      setOpen(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("What is this field?")}
            className="text-muted-foreground transition-colors hover:text-primary"
          >
            <HelpCircle className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="glass-panel w-72 space-y-2.5 text-xs leading-relaxed">
          <p className="text-sm font-semibold">{label}</p>
          {what && (
            <p className="text-muted-foreground">
              <span className="text-foreground">{t("What is this?")} </span>
              {what}
            </p>
          )}
          {format && (
            <p className="text-muted-foreground">
              <span className="text-foreground">{t("Required format")}: </span>
              {format}
            </p>
          )}
          {example && (
            <p className="rounded-lg border bg-card/60 p-2 font-mono text-[11px] text-muted-foreground">
              {example}
            </p>
          )}
          {aiText && <p className="border-t pt-2 text-muted-foreground">{aiText}</p>}
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("explain")}
            className="inline-flex items-center gap-1.5 text-primary disabled:opacity-60"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {t("Explain with AI")}
          </button>
        </PopoverContent>
      </Popover>

      {onGenerate && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void run("generate")}
          aria-label={t("Generate with AI")}
          title={t("Generate with AI")}
          className="text-muted-foreground transition-all hover:scale-110 hover:text-primary disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
        </button>
      )}

      {children}
    </div>
  );
}
