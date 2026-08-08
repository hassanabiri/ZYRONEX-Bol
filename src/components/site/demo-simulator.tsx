import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  CircleDot,
  Cpu,
  Headphones,
  Layers,
  Loader2,
  Megaphone,
  Play,
  RotateCcw,
  Settings2,
  Sparkles,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n";
import { BUSINESS_TYPES, FOCUS_AREAS, SCENARIOS } from "@/lib/site/simulation";
import type { SimulationResult } from "@/lib/site/simulation";
import { runZyronexSimulation } from "@/lib/site/simulation.functions";
import { cn } from "@/lib/utils";

const AGENT_ICONS: Record<string, typeof Bot> = {
  executive: Cpu,
  sales: TrendingUp,
  marketing: Megaphone,
  support: Headphones,
  operations: Settings2,
  analyst: BarChart3,
};

type Phase = "discovery" | "building" | "workspace";

export function DemoSimulator({ mode = "simulation" }: { mode?: "simulation" | "solution" }) {
  const { t, language } = useI18n();
  const run = useServerFn(runZyronexSimulation);

  const [phase, setPhase] = useState<Phase>("discovery");
  const [business, setBusiness] = useState("");
  const [focus, setFocus] = useState("");
  const [details, setDetails] = useState("");
  const [scenario, setScenario] = useState(SCENARIOS[0]!.prompt);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(0);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);

  const canStart = business.trim().length > 0 || details.trim().length > 0;

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    if (!playing || !result) return;
    if (visible >= result.timeline.length) {
      setPlaying(false);
      return;
    }
    timer.current = setTimeout(() => setVisible((v) => v + 1), 900);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, visible, result]);

  async function start() {
    if (!canStart) return;
    setPhase("building");
    setError(null);
    setResult(null);
    setVisible(0);
    try {
      const response = await run({
        data: { business, focus, details, scenario, language, mode },
      });
      setResult(response.result);
      setPhase("workspace");
      requestAnimationFrame(() => workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch {
      setError(t("The simulation could not be generated. Try again."));
      setPhase("discovery");
    }
  }

  function reset() {
    setPhase("discovery");
    setResult(null);
    setVisible(0);
    setPlaying(false);
  }

  const heading = mode === "solution" ? "Design your system with AI" : "Do not watch a ZYRONEX demo";
  const sub =
    mode === "solution"
      ? "Tell the AI what you want ZYRONEX to run for you, and it designs the environment, modules and integrations for your business."
      : "Tell the AI about your business and let it build a live simulation of how your company could run with ZYRONEX.";

  return (
    <div className="space-y-6">
      <div className="glass-panel panel-shadow relative overflow-hidden rounded-3xl p-6 sm:p-9">
        <div className="aurora opacity-70" aria-hidden="true" />
        <div className="relative space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-primary">
            <Sparkles className="size-3.5" />
            {t(mode === "solution" ? "AI Solution Builder" : "AI Live Simulation")}
          </span>
          <h1 className="text-balance-tight font-display text-3xl font-semibold leading-tight sm:text-5xl">
            {t(heading)}
            {mode === "simulation" && (
              <>
                <br />
                <span className="brand-text">{t("Let ZYRONEX run in front of you.")}</span>
              </>
            )}
          </h1>
          <p className="max-w-2xl text-base leading-relaxed text-muted-foreground">{t(sub)}</p>
        </div>
      </div>

      {phase === "discovery" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="glass-panel rounded-3xl p-5 sm:p-7">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl brand-gradient text-primary-foreground">
                <Bot className="size-5" />
              </span>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {t(
                  "Welcome to ZYRONEX. Instead of explaining what the platform can do, let me show you how it would work inside your business.",
                )}
              </p>
            </div>

            <div className="mt-7 space-y-6">
              <Field label={t("What kind of business do you run?")}>
                <div className="flex flex-wrap gap-2">
                  {BUSINESS_TYPES.map((item) => (
                    <Chip key={item} active={business === t(item)} onClick={() => setBusiness(t(item))}>
                      {t(item)}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label={t("What do you most want to improve right now?")}>
                <div className="flex flex-wrap gap-2">
                  {FOCUS_AREAS.map((item) => (
                    <Chip key={item} active={focus === t(item)} onClick={() => setFocus(t(item))}>
                      {t(item)}
                    </Chip>
                  ))}
                </div>
              </Field>

              {mode === "simulation" && (
                <Field label={t("Pick a scenario to simulate")}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {SCENARIOS.map((item) => (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => setScenario(item.prompt)}
                        className={cn(
                          "rounded-2xl border p-3 text-start transition-colors",
                          scenario === item.prompt ? "border-primary bg-primary/5" : "bg-card/40 hover:border-primary/40",
                        )}
                      >
                        <p className="text-sm font-medium">{t(item.label)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{t(item.prompt)}</p>
                      </button>
                    ))}
                  </div>
                </Field>
              )}

              <Field label={t("Describe your business in your own words")}>
                <textarea
                  value={details}
                  onChange={(event) => setDetails(event.target.value)}
                  rows={3}
                  placeholder={t("I run an online store selling food products and I want to manage sales, marketing, customer service and operations…")}
                  className="w-full resize-none rounded-2xl border bg-background/60 p-3.5 text-sm outline-none transition-colors focus:border-primary"
                />
              </Field>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <Button size="lg" className="w-full gap-2 sm:w-auto" disabled={!canStart} onClick={() => void start()}>
                <Zap className="size-4" />
                {t(mode === "solution" ? "Design my system" : "Start the AI simulation")}
              </Button>
            </div>
          </div>

          <aside className="space-y-3">
            {[
              { icon: Layers, title: "One connected AI business team", body: "Executive, sales, marketing, service, operations and analytics capabilities working as one system." },
              { icon: Activity, title: "Live operational chain", body: "You see the events, decisions and follow-ups as they happen, not a slide deck." },
              { icon: BarChart3, title: "A tailored blueprint", body: "The AI proposes the modules, integrations and plan that match your business." },
            ].map((card) => (
              <div key={card.title} className="rounded-2xl border bg-card/50 p-5">
                <card.icon className="size-5 text-primary" />
                <h3 className="mt-3 font-display text-base font-semibold">{t(card.title)}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t(card.body)}</p>
              </div>
            ))}
          </aside>
        </div>
      )}

      {phase === "building" && (
        <div className="glass-panel flex min-h-[320px] flex-col items-center justify-center gap-4 rounded-3xl p-10 text-center">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="font-display text-lg font-semibold">{t("Building your ZYRONEX environment…")}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("Reading your business, selecting AI capabilities, wiring integrations and preparing the simulation.")}
          </p>
        </div>
      )}

      {phase === "workspace" && result && (
        <div ref={workspaceRef} className="space-y-4">
          <div className="glass-panel rounded-3xl p-5 sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-[0.18em] text-primary">{t("Your simulated workspace")}</p>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{result.businessSummary}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-success">
                  <CircleDot className="size-3 animate-pulse" />
                  {t("Live")}
                </span>
                <Button variant="ghost" size="sm" className="gap-1.5" onClick={reset}>
                  <RotateCcw className="size-3.5" />
                  {t("Restart")}
                </Button>
              </div>
            </div>

            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {result.agents.map((agent) => {
                const Icon = AGENT_ICONS[agent.key] ?? Bot;
                return (
                  <div key={agent.name} className="rounded-2xl border bg-card/50 p-4 transition-colors hover:border-primary/40">
                    <div className="flex items-center gap-2.5">
                      <span className="flex size-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="size-4" />
                      </span>
                      <p className="truncate text-sm font-semibold">{agent.name}</p>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{agent.role}</p>
                    <p className="mt-2 text-xs text-primary">{agent.firstAction}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="glass-panel rounded-3xl p-5 sm:p-7">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-display text-lg font-semibold">{t("Live operation timeline")}</h2>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setVisible(0);
                    setPlaying(true);
                  }}
                  disabled={playing}
                >
                  <Play className="size-3.5" />
                  {t(playing ? "Running…" : "Run the simulation")}
                </Button>
              </div>

              <ol className="mt-6 space-y-3">
                {result.timeline.map((step, index) => {
                  const shown = index < visible;
                  return (
                    <li
                      key={`${step.title}-${index}`}
                      className={cn(
                        "relative rounded-2xl border p-4 transition-all duration-500",
                        shown ? "translate-y-0 border-primary/30 bg-card/60 opacity-100" : "translate-y-2 opacity-35",
                      )}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                          {step.actor}
                        </span>
                        <p className="text-sm font-semibold">{step.title}</p>
                        <span className="ms-auto text-[11px] text-muted-foreground">{step.metric}</span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.detail}</p>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div className="space-y-4">
              <div className="glass-panel rounded-3xl p-5">
                <h3 className="font-display text-base font-semibold">{t("Signals")}</h3>
                <div className="mt-4 space-y-3">
                  {result.kpis.map((kpi) => (
                    <div key={kpi.label} className="rounded-2xl border bg-card/50 p-3.5">
                      <p className="text-xs text-muted-foreground">{kpi.label}</p>
                      <p className="mt-1 font-display text-xl font-semibold">{kpi.value}</p>
                      <p className="text-xs text-success">{kpi.delta}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="glass-panel rounded-3xl p-5">
                <h3 className="font-display text-base font-semibold">{t("AI insight")}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{result.opportunity}</p>
              </div>
            </div>
          </div>

          <div className="glass-panel rounded-3xl p-5 sm:p-7">
            <h2 className="font-display text-lg font-semibold">{t("How ZYRONEX would work inside your business")}</h2>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border bg-card/40 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("Today")}</p>
                <ul className="mt-3 space-y-2">
                  {result.today.map((item) => (
                    <li key={item} className="text-sm text-muted-foreground">
                      • {item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-primary">{t("With ZYRONEX")}</p>
                <ul className="mt-3 space-y-2">
                  {result.withZyronex.map((item) => (
                    <li key={item} className="flex gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-5 text-sm text-muted-foreground">
              {t("These are not just AI tools. This is an intelligent operating layer for your business.")}
            </p>
          </div>

          <div className="glass-panel ring-glow rounded-3xl p-5 sm:p-7">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
              <div>
                <h2 className="font-display text-lg font-semibold">{t("Proposed ZYRONEX configuration")}</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("AI capabilities")}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {result.modules.map((item) => (
                        <span key={item} className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("Integrations")}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {result.integrations.map((item) => (
                        <span key={item} className="rounded-full border px-3 py-1 text-xs text-muted-foreground">
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border bg-card/50 p-5">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{t("Recommended plan")}</p>
                <p className="mt-1 font-display text-2xl font-semibold">{t(result.recommendedPlan)}</p>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{result.planReason}</p>
                <Button asChild className="mt-4 w-full gap-2">
                  <Link to="/auth">
                    {t("Start with this configuration")}
                    <ArrowRight className="size-4 rtl:rotate-180" />
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm" className="mt-2 w-full">
                  <Link to="/pricing">{t("See plans")}</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <p className="text-sm font-medium">{label}</p>
      {children}
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3.5 py-1.5 text-xs transition-colors",
        active ? "border-primary bg-primary/10 text-foreground" : "text-muted-foreground hover:border-primary/40",
      )}
    >
      {children}
    </button>
  );
}

export { Input };
