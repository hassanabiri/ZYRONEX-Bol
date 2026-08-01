import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ValidationReport } from "@/lib/execution/validation";
import { useI18n } from "@/lib/i18n";

export function ValidationReportPanel({
  report,
  onSelect,
}: {
  report: ValidationReport;
  onSelect?: (nodeId: string) => void;
}) {
  const { t } = useI18n();

  if (report.valid && !report.warnings.length) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-4 text-xs text-muted-foreground">
        <CheckCircle2 className="size-4 text-[oklch(0.68_0.15_160)]" />
        {t("No issues found. The workflow is ready to publish.")}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Badge variant={report.errors.length ? "destructive" : "secondary"}>
          {report.errors.length} {t("errors")}
        </Badge>
        <Badge variant="outline">
          {report.warnings.length} {t("warnings")}
        </Badge>
      </div>
      <ScrollArea className="max-h-64">
        <ul className="space-y-1.5 pe-2">
          {report.issues.map((issue, index) => (
            <li key={`${issue.code}-${index}`}>
              <button
                type="button"
                disabled={!issue.nodeId}
                onClick={() => issue.nodeId && onSelect?.(issue.nodeId)}
                className="flex w-full items-start gap-2 rounded-lg border bg-card px-3 py-2 text-start text-xs transition enabled:hover:border-primary/60 disabled:cursor-default"
              >
                {issue.level === "error" ? (
                  <XCircle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[oklch(0.78_0.15_75)]" />
                )}
                <span className="min-w-0">
                  <span className="block">{t(issue.message)}</span>
                  <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                    {issue.code.replace(/_/g, " ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </ScrollArea>
    </div>
  );
}
