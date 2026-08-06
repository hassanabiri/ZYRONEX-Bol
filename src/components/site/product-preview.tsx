import { Activity, Bot, CheckCircle2, Cpu, Workflow } from "lucide-react";
import { useEffect, useState } from "react";

import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Interactive product preview used on the homepage. It is an illustrative
 * rendering of the real console surfaces (mission control, workflow, runs).
 */
const STEPS = [
  { key: "plan", label: "Planning", node: "Intake → Classify", icon: Cpu },
  { key: "knowledge", label: "Grounding", node: "Knowledge lookup", icon: Bot },
  { key: "act", label: "Acting", node: "CRM update · Email", icon: Workflow },
  { key: "report", label: "Reporting", node: "Timeline + audit entry", icon: Activity },
];

export function ProductPreview() {
  const { t } = useI18n();
  const [active, setActive] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setActive((value) => (value + 1) % STEPS.length), 2600);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="glass-panel panel-shadow relative overflow-hidden rounded-3xl">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px overflow-hidden">
        <span className="sweep-line block h-px w-1/3 bg-linear-to-r from-transparent via-primary to-transparent" />
      </div>

      <div className="flex items-center gap-2 border-b px-4 py-3">
        <span className="size-2.5 rounded-full bg-destructive/70" />
        <span className="size-2.5 rounded-full bg-warning/70" />
        <span className="size-2.5 rounded-full bg-success/70" />
        <p className="ms-2 truncate text-xs text-muted-foreground">zyronex.app / {t("Mission Control")}</p>
      </div>

      <div className="grid gap-4 p-4 sm:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3">
          <div className="rounded-2xl border bg-card/60 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t("Active workers")}</p>
            <p className="mt-1 font-display text-2xl font-semibold tabular-nums">12</p>
            <div className="mt-3 space-y-1.5">
              {["Support", "Marketing", "Finance"].map((name, index) => (
                <div key={name} className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">{t(name)}</span>
                  <span className="h-1.5 w-20 overflow-hidden rounded-full bg-surface">
                    <span
                      className="block h-full brand-gradient transition-all duration-700"
                      style={{ width: `${[82, 64, 47][index]}%` }}
                    />
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border bg-card/60 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t("Governance")}</p>
            <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
              {["Row-level isolation", "Approvals enforced", "Audit log streaming"].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="size-3.5 shrink-0 text-success" />
                  <span className="truncate">{t(item)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="rounded-2xl border bg-card/60 p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t("Live execution")}</p>
            <span className="flex items-center gap-1.5 text-[11px] text-success">
              <span className="size-1.5 animate-pulse rounded-full bg-success" />
              {t("Running")}
            </span>
          </div>

          <ol className="mt-3 space-y-2">
            {STEPS.map((step, index) => {
              const state = index === active ? "active" : index < active ? "done" : "idle";
              return (
                <li
                  key={step.key}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all duration-500",
                    state === "active" && "border-primary/50 bg-primary/8 ring-glow",
                    state === "done" && "opacity-80",
                    state === "idle" && "opacity-45",
                  )}
                >
                  <span
                    className={cn(
                      "flex size-8 shrink-0 items-center justify-center rounded-lg",
                      state === "active"
                        ? "brand-gradient text-primary-foreground"
                        : "bg-surface text-muted-foreground",
                    )}
                  >
                    <step.icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium">{t(step.label)}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{t(step.node)}</p>
                  </div>
                  {state === "done" && <CheckCircle2 className="ms-auto size-4 shrink-0 text-success" />}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
