import { Link, useRouterState } from "@tanstack/react-router";

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
import { navSections } from "@/lib/navigation";
import { useWorkspace } from "@/lib/workspace";

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (router) => router.location.pathname });
  const { activeWorkspace } = useWorkspace();

  return (
    <Sidebar collapsible="icon" className="border-r">
      <SidebarHeader className="h-16 justify-center px-3">
        <Link to="/dashboard" className="flex items-center gap-2.5 overflow-hidden">
          <span className="brand-gradient flex size-8 shrink-0 items-center justify-center rounded-lg font-display text-sm font-bold text-primary-foreground">
            Z
          </span>
          {!collapsed && (
            <span className="flex flex-col leading-none">
              <span className="font-display text-sm font-semibold tracking-[0.18em]">ZYRONEX</span>
              <span className="mt-1 text-[11px] text-muted-foreground">Agent Operating Platform</span>
            </span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="px-1">
        {navSections.map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              {section.label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={pathname === item.to} tooltip={item.title}>
                      <Link to={item.to} className="flex items-center gap-2.5">
                        <item.icon className="size-4 shrink-0" />
                        <span className="truncate">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="px-3 pb-4">
        {!collapsed && (
          <div className="rounded-lg border bg-surface px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Plan</p>
            <p className="mt-0.5 truncate text-sm font-medium capitalize">
              {activeWorkspace?.plan ?? "—"}
            </p>
          </div>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
