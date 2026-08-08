import { Link, useRouterState } from "@tanstack/react-router";
import {
  ArrowRight,
  Blocks,
  BookOpen,
  Bot,
  Building2,
  ChevronDown,
  CircuitBoard,
  Code2,
  Compass,
  FileText,
  Globe,
  GraduationCap,
  Handshake,
  HelpCircle,
  Activity,
  LifeBuoy,
  Menu,
  Moon,
  Newspaper,
  ShieldCheck,
  Sparkles,
  Sun,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { ZyronexLogo } from "@/components/site/logo";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { siteNav } from "@/lib/site/content";
import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  "/about": Building2,
  "/ai-workers": Bot,
  "/connectors": Blocks,
  "/security": ShieldCheck,
  "/status": Activity,
  "/solutions": Compass,
  "/industries": CircuitBoard,
  "/partners": Handshake,
  "/developers": Terminal,
  "/api": Code2,
  "/changelog": FileText,
  "/help": LifeBuoy,
  "/knowledge-center": BookOpen,
  "/academy": GraduationCap,
  "/blog": Newspaper,
  "/faq": HelpCircle,
};

/** Featured card shown inside each mega-menu panel. */
const FEATURED: Record<string, { title: string; body: string; to: string; cta: string }> = {
  Platform: {
    title: "One control plane for your AI workforce",
    body: "Build a worker, run it through the execution engine, and govern cost and access from a single workspace.",
    to: "/ai-workers",
    cta: "Explore AI Workers",
  },
  Solutions: {
    title: "Outcomes, not features",
    body: "Assemble workers, knowledge and workflows around the result you need — then measure it.",
    to: "/solutions",
    cta: "See solutions",
  },
  Developers: {
    title: "Build on ZYRONEX",
    body: "Scoped API keys, plugins and typed SDKs so your services can create runs and read results.",
    to: "/developers",
    cta: "Open developer center",
  },
  Resources: {
    title: "Learn the platform end to end",
    body: "Playbooks, guided paths and straight answers for teams operating AI workers in production.",
    to: "/academy",
    cta: "Open the academy",
  },
};

export function SiteHeader() {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [openMobile, setOpenMobile] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileGroup, setMobileGroup] = useState<string | null>(siteNav[0]?.label ?? null);

  useEffect(() => {
    setOpenGroup(null);
    setOpenMobile(false);
  }, [pathname]);

  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  return (
    <header
      className="sticky top-0 z-40 w-full border-b bg-background/70 backdrop-blur-xl"
      onMouseLeave={() => setOpenGroup(null)}
    >
      <div className="mx-auto flex h-20 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Link to="/" className="shrink-0" aria-label="ZYRONEX">
          <ZyronexLogo size="md" />
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {siteNav.map((group) => {
            const open = openGroup === group.label;
            return (
              <button
                key={group.label}
                type="button"
                onMouseEnter={() => setOpenGroup(group.label)}
                onClick={() => setOpenGroup(open ? null : group.label)}
                aria-expanded={open}
                className={cn(
                  "type-nav flex items-center gap-1.5 rounded-xl px-3.5 py-2.5 transition-colors",
                  open ? "bg-surface text-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(group.label)}
                <ChevronDown
                  className={cn("size-3.5 transition-transform duration-200", open && "rotate-180")}
                />
              </button>
            );
          })}

          <Link
            to="/pricing"
            className={cn(
              "type-nav rounded-xl px-3.5 py-2.5 transition-colors",
              isActive("/pricing") ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t("Pricing")}
          </Link>
        </nav>

        <div className="ms-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLanguage(language === "ar" ? "en" : "ar")}
            aria-label={language === "ar" ? "Switch to English" : "التبديل إلى العربية"}
            className="type-label flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            <Globe className="size-4" />
            <span className="sm:hidden">{language === "ar" ? "EN" : "ع"}</span>
            <span className="hidden sm:inline">{language === "ar" ? "English" : "العربية"}</span>

          </button>

          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={t("Toggle theme")}
            className="rounded-xl p-2.5 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <Button asChild variant="ghost" size="sm" className="hidden text-muted-foreground hover:text-foreground sm:inline-flex">
            <Link to="/auth">{t("Sign in")}</Link>
          </Button>
          <Button asChild size="sm" className="hidden rounded-xl px-4 font-semibold sm:inline-flex">
            <Link to="/auth">{t("Start free")}</Link>
          </Button>

          <Sheet open={openMobile} onOpenChange={setOpenMobile}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t("Open menu")}>
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side={language === "ar" ? "right" : "left"}
              className="w-[min(92vw,400px)] overflow-y-auto p-0"
            >
              <div className="flex min-h-full flex-col gap-8 px-5 pb-8 pt-6">
                <Link to="/" onClick={() => setOpenMobile(false)}>
                  <ZyronexLogo size="sm" />
                </Link>

                <nav className="flex flex-col gap-3">
                  {siteNav.map((group) => {
                    const open = mobileGroup === group.label;
                    return (
                      <div key={group.label} className="overflow-hidden rounded-2xl border bg-card/60">
                        <button
                          type="button"
                          onClick={() => setMobileGroup(open ? null : group.label)}
                          className="flex w-full items-center justify-between px-4 py-3.5 text-start"
                        >
                          <span className="font-display text-base font-bold tracking-tight">
                            {t(group.label)}
                          </span>
                          <ChevronDown
                            className={cn(
                              "size-4 text-muted-foreground transition-transform duration-200",
                              open && "rotate-180",
                            )}
                          />
                        </button>
                        {open && (
                          <div className="mega-panel-in grid gap-2 px-3 pb-3">
                            {group.items.map((item) => {
                              const Icon = ICONS[item.to] ?? Sparkles;
                              return (
                                <Link
                                  key={item.to}
                                  to={item.to}
                                  onClick={() => setOpenMobile(false)}
                                  className={cn(
                                    "flex items-start gap-3 rounded-xl border border-transparent p-3 transition-colors",
                                    isActive(item.to)
                                      ? "border-primary/25 bg-primary/10"
                                      : "hover:border-border hover:bg-surface",
                                  )}
                                >
                                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary">
                                    <Icon className="size-4.5" />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="type-label block text-foreground">{t(item.title)}</span>
                                    {item.description && (
                                      <span className="type-caption mt-0.5 block">{t(item.description)}</span>
                                    )}
                                  </span>
                                </Link>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  <Link
                    to="/pricing"
                    onClick={() => setOpenMobile(false)}
                    className="rounded-2xl border bg-card/60 px-4 py-3.5 font-display text-base font-bold tracking-tight"
                  >
                    {t("Pricing")}
                  </Link>
                </nav>

                <div className="mt-auto grid gap-2.5">
                  <div className="grid grid-cols-2 gap-2 rounded-2xl border bg-card/60 p-1.5">
                    {(["en", "ar"] as const).map((code) => (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setLanguage(code)}
                        className={cn(
                          "flex items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
                          language === code
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:bg-surface hover:text-foreground",
                        )}
                      >
                        <Globe className="size-4" />
                        {code === "en" ? "English" : "العربية"}
                      </button>
                    ))}
                  </div>

                  <Button asChild size="lg" className="rounded-xl font-semibold">
                    <Link to="/auth" onClick={() => setOpenMobile(false)}>
                      {t("Start free")}
                    </Link>
                  </Button>
                  <Button asChild variant="outline" size="lg" className="rounded-xl">
                    <Link to="/auth" onClick={() => setOpenMobile(false)}>
                      {t("Sign in")}
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="lg" className="rounded-xl text-muted-foreground">
                    <Link to="/demo" onClick={() => setOpenMobile(false)}>
                      {t("Start the AI simulation")}
                    </Link>
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Desktop mega menu */}
      {siteNav.map((group) => {
        if (openGroup !== group.label) return null;
        const featured = FEATURED[group.label];
        return (
          <div
            key={group.label}
            className="absolute inset-x-0 top-full hidden lg:block"
            onMouseEnter={() => setOpenGroup(group.label)}
          >
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <div className="mega-panel-in glass-panel panel-shadow mt-3 grid gap-8 rounded-3xl border p-7 lg:grid-cols-[1.55fr_1fr]">
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {group.items.map((item) => {
                    const Icon = ICONS[item.to] ?? Sparkles;
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        className={cn(
                          "group/card flex items-start gap-3.5 rounded-2xl border border-transparent p-3.5 transition-all duration-200",
                          isActive(item.to)
                            ? "border-primary/25 bg-primary/10"
                            : "hover:-translate-y-0.5 hover:border-border hover:bg-surface",
                        )}
                      >
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary transition-colors group-hover/card:bg-primary group-hover/card:text-primary-foreground">
                          <Icon className="size-5" />
                        </span>
                        <span className="min-w-0">
                          <span className="type-label flex items-center gap-1.5 text-foreground">
                            {t(item.title)}
                            <ArrowRight className="size-3.5 -translate-x-1 opacity-0 transition-all group-hover/card:translate-x-0 group-hover/card:opacity-100 rtl:rotate-180" />
                          </span>
                          {item.description && (
                            <span className="type-caption mt-1 block">{t(item.description)}</span>
                          )}
                        </span>
                      </Link>
                    );
                  })}
                </div>

                {featured && (
                  <div className="relative overflow-hidden rounded-2xl border bg-surface p-6">
                    <div
                      aria-hidden
                      className="brand-gradient pointer-events-none absolute -end-16 -top-16 size-44 rounded-full opacity-25 blur-3xl"
                    />
                    <div className="grid-backdrop pointer-events-none absolute inset-0 opacity-[0.35]" />
                    <div className="relative">
                      <span className="type-eyebrow">{t(group.label)}</span>
                      <h3 className="mt-3 font-display text-xl font-extrabold leading-tight tracking-tight">
                        {t(featured.title)}
                      </h3>
                      <p className="type-caption mt-2.5">{t(featured.body)}</p>
                      <div className="mt-5 flex flex-wrap gap-2">
                        <Button asChild size="sm" className="rounded-xl font-semibold">
                          <Link to={featured.to}>{t(featured.cta)}</Link>
                        </Button>
                        <Button asChild size="sm" variant="outline" className="rounded-xl">
                          <Link to="/demo">{t("Start the AI simulation")}</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </header>
  );
}
