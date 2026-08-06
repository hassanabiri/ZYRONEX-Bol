import { Link, useRouterState } from "@tanstack/react-router";
import { Menu, Moon, Sun, ChevronDown, Globe, ArrowUpRight } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { siteNav } from "@/lib/site/content";
import { cn } from "@/lib/utils";

export function SiteHeader() {
  const { t, language, setLanguage } = useI18n();
  const { theme, setTheme } = useTheme();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [openMobile, setOpenMobile] = useState(false);

  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <Link to="/" className="shrink-0" aria-label="ZYRONEX">
          <span className="flex items-center gap-2">
            <span className="brand-gradient flex size-8 items-center justify-center rounded-lg font-display text-sm font-bold text-primary-foreground">
              Z
            </span>
            <span className="font-display text-lg font-semibold tracking-tight">ZYRONEX</span>
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {siteNav.map((group) => (
            <div key={group.label} className="group relative">
              <button
                type="button"
                className="flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {t(group.label)}
                <ChevronDown className="size-3.5 opacity-60" />
              </button>
              <div className="invisible absolute start-0 top-full z-50 min-w-[240px] translate-y-1 opacity-0 transition-all group-hover:visible group-hover:translate-y-0 group-hover:opacity-100">
                <div className="glass-panel panel-shadow mt-2 rounded-2xl border p-2">
                  {group.items.map((item) => (
                    <Link
                      key={item.to}
                      to={item.to}
                      className={cn(
                        "flex flex-col rounded-xl px-3 py-2.5 transition-colors",
                        isActive(item.to) ? "bg-primary/10 text-foreground" : "hover:bg-surface",
                      )}
                    >
                      <span className="flex items-center gap-2 text-sm font-medium">
                        {t(item.title)}
                        <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover/link:opacity-100" />
                      </span>
                      {item.description && (
                        <span className="text-xs text-muted-foreground">{t(item.description)}</span>
                      )}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          ))}

          <Link
            to="/pricing"
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
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
            className="hidden items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-surface sm:flex"
          >
            <Globe className="size-4" />
            {language === "ar" ? "English" : "العربية"}
          </button>
          <button
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label={t("Toggle theme")}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-surface"
          >
            {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </button>
          <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
            <Link to="/auth">{t("Sign in")}</Link>
          </Button>
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link to="/auth">{t("Start free")}</Link>
          </Button>

          <Sheet open={openMobile} onOpenChange={setOpenMobile}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label={t("Open menu")}>
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side={language === "ar" ? "right" : "left"} className="w-[min(85vw,320px)]">
              <div className="flex h-full flex-col gap-6 pt-6">
                <Link to="/" className="flex items-center gap-2" onClick={() => setOpenMobile(false)}>
                  <span className="brand-gradient flex size-8 items-center justify-center rounded-lg font-display text-sm font-bold text-primary-foreground">
                    Z
                  </span>
                  <span className="font-display text-lg font-semibold">ZYRONEX</span>
                </Link>
                <nav className="flex flex-col gap-1">
                  {siteNav.map((group) => (
                    <div key={group.label} className="space-y-1">
                      <p className="px-2 py-1 text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        {t(group.label)}
                      </p>
                      {group.items.map((item) => (
                        <Link
                          key={item.to}
                          to={item.to}
                          onClick={() => setOpenMobile(false)}
                          className={cn(
                            "block rounded-lg px-2 py-2 text-sm font-medium",
                            isActive(item.to) ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-surface",
                          )}
                        >
                          {t(item.title)}
                        </Link>
                      ))}
                    </div>
                  ))}
                  <Link
                    to="/pricing"
                    onClick={() => setOpenMobile(false)}
                    className={cn(
                      "block rounded-lg px-2 py-2 text-sm font-medium",
                      isActive("/pricing") ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-surface",
                    )}
                  >
                    {t("Pricing")}
                  </Link>
                </nav>
                <div className="mt-auto flex flex-col gap-2">
                  <Button asChild variant="outline" onClick={() => setOpenMobile(false)}>
                    <Link to="/auth">{t("Sign in")}</Link>
                  </Button>
                  <Button asChild onClick={() => setOpenMobile(false)}>
                    <Link to="/auth">{t("Start free")}</Link>
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
