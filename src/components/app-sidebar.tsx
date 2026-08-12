import { Link, useRouterState } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useI18n } from "@/lib/i18n";
import { navSections } from "@/lib/navigation";
import { useWorkspace } from "@/lib/workspace";

const FAVORITES_KEY = "zyronex.sidebar.favorites";

export function AppSidebar() {
  const { state, isMobile, setOpenMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const { activeWorkspace } = useWorkspace();
  const { t, dir } = useI18n();

  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false);
  };

  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITES_KEY);
      if (raw) setFavorites(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleFavorite = useCallback((to: string) => {
    setFavorites((current) => {
      const next = current.includes(to)
        ? current.filter((item) => item !== to)
        : [...current, to];
      try {
        window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const sections = useMemo(() => {
    const favoriteItems = navSections
      .flatMap((section) => section.items)
      .filter((item) => favorites.includes(item.to));
    return favoriteItems.length
      ? [{ label: "Favorites", items: favoriteItems }, ...navSections]
      : navSections;
  }, [favorites]);


  return (
    <Sidebar
      collapsible="icon"
      side={dir === "rtl" ? "right" : "left"}
      className="border-r border-border/60 bg-sidebar/80 backdrop-blur-xl"
    >
      <SidebarHeader className="hairline-b h-16 justify-center px-3">
        <Link
          to="/dashboard"
          onClick={closeOnMobile}
          className="flex items-center gap-2.5 overflow-hidden rounded-lg transition-opacity hover:opacity-90"
        >
          <span className="brand-gradient flex size-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold text-primary-foreground shadow-sm">
            Z
          </span>
          {!collapsed && (
            <span className="flex flex-col leading-none">
              <span className="font-display text-sm font-semibold tracking-[0.18em]">ZYRONEX</span>
              <span className="mt-1 text-[11px] text-muted-foreground">{t("Agent Operating Platform")}</span>
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-1.5 py-1">
        {sections.map((section) => (
          <SidebarGroup key={section.label} className="py-1">
            <SidebarGroupLabel className="px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/70">
              {t(section.label)}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {section.items.map((item) => {
                  const active = pathname === item.to;
                  return (
                    <SidebarMenuItem key={`${section.label}-${item.to}`} className="group/menu-item relative">
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={t(item.title)}
                        className="h-9 rounded-lg pe-8 font-medium data-[active=true]:bg-primary/12 data-[active=true]:text-primary"
                      >
                        <Link
                          to={item.to}
                          onClick={closeOnMobile}
                          className="relative flex items-center gap-2.5"
                        >
                          {active && !collapsed ? (
                            <span
                              aria-hidden="true"
                              className="absolute inset-y-1.5 -start-1.5 w-[3px] rounded-full bg-primary"
                            />
                          ) : null}
                          <item.icon
                            className={`size-4 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`}
                          />
                          <span className="truncate">{t(item.title)}</span>
                        </Link>
                      </SidebarMenuButton>
                      {!collapsed ? (
                        <button
                          type="button"
                          aria-label={t(favorites.includes(item.to) ? "Remove from favorites" : "Add to favorites")}
                          onClick={() => toggleFavorite(item.to)}
                          className={`absolute inset-y-0 end-1 my-auto flex size-7 items-center justify-center rounded-md text-muted-foreground/50 opacity-0 transition-opacity hover:text-primary focus-visible:opacity-100 group-hover/menu-item:opacity-100 ${
                            favorites.includes(item.to) ? "text-primary opacity-100" : ""
                          }`}
                        >
                          <Star
                            className={`size-3.5 ${favorites.includes(item.to) ? "fill-current" : ""}`}
                          />
                        </button>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="px-3 pb-4">
        {!collapsed && (
          <div className="rounded-xl border border-border/70 bg-surface/60 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
              {t("Plan")}
            </p>
            <p className="mt-0.5 truncate text-sm font-semibold capitalize">
              {activeWorkspace?.subscription_plan ?? "—"}
            </p>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
