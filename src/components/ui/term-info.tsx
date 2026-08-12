import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Plain-language explanations for technical terms shown in the product. */
export const GLOSSARY: Record<string, string> = {
  Webhook: "An automatic notification that tells ZYRONEX when something happens in a connected service.",
  Webhooks: "Automatic notifications that tell ZYRONEX when something happens in a connected service.",
  Sync: "Scheduled data refresh between ZYRONEX and the connected service.",
  OAuth: "A secure sign-in method that connects an account without sharing its password.",
  "API key": "A private key that lets ZYRONEX talk to another service on your behalf.",
  Credits: "The usage balance consumed when workers run, speak or process documents.",
  Execution: "One complete run of a workflow or worker, with its steps and results.",
  Memory: "What a worker remembers across conversations and runs.",
  Knowledge: "Documents and sources a worker can read to answer accurately.",
  RBAC: "Role-based access control: who is allowed to do what inside the workspace.",
  Latency: "How long the system takes to respond, in milliseconds.",
  Throughput: "How much work the system completes in a given period.",
};

/**
 * Inline ⓘ indicator that explains a technical term without changing it.
 * Presentation only — the underlying term and system stay identical.
 */
export function TermInfo({
  term,
  description,
  className,
  children,
}: {
  term: string;
  description?: string;
  className?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const text = description ?? GLOSSARY[term];
  if (!text) return <>{children ?? term}</>;

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {children ?? term}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`${t("What is this?")} ${t(term)}`}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-primary"
          >
            <Info className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-64 space-y-1 rounded-xl p-3 text-start"
          onClick={(event) => event.stopPropagation()}
        >
          <p className="text-xs font-semibold">{t(term)}</p>
          <p className="text-xs leading-relaxed text-muted-foreground">{t(text)}</p>
        </PopoverContent>
      </Popover>
    </span>
  );
}
