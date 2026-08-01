import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, Check, ChevronsUpDown, LogOut, Moon, Search, Settings, Sun, User } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";
import { useWorkspace } from "@/lib/workspace";

export function TopBar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const { workspaces, activeWorkspace, setActiveWorkspaceId } = useWorkspace();

  const email = user?.email ?? "";
  const initials = email.slice(0, 2).toUpperCase() || "ZX";

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur-md sm:px-5">
      <SidebarTrigger className="shrink-0" />
      <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-9 max-w-[220px] justify-between gap-2 px-2.5">
            <span className="brand-gradient size-5 shrink-0 rounded-md" />
            <span className="truncate text-sm font-medium">
              {activeWorkspace?.name ?? "No workspace"}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            Workspaces
          </DropdownMenuLabel>
          {workspaces.map((workspace) => (
            <DropdownMenuItem
              key={workspace.id}
              onSelect={() => setActiveWorkspaceId(workspace.id)}
              className="justify-between"
            >
              <span className="truncate">{workspace.name}</span>
              {workspace.id === activeWorkspace?.id && <Check className="size-4" />}
            </DropdownMenuItem>
          ))}
          {!workspaces.length && (
            <DropdownMenuItem disabled>No workspaces available</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate({ to: "/workspace" })}>
            Workspace settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <div className="relative ml-auto hidden w-full max-w-sm md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search workspace…"
          className="h-9 bg-surface pl-9"
          aria-label="Search workspace"
        />
      </div>

      <div className="ml-auto flex items-center gap-1 md:ml-2">
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Search">
          <Search className="size-4" />
        </Button>

        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
              <Bell className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="flex items-center justify-between">
              Notifications
              <Badge variant="secondary">0</Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              No notifications yet.
            </p>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="ml-1 h-9 gap-2 px-1.5">
              <Avatar className="size-7">
                <AvatarFallback className="bg-surface text-[11px] font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Signed in</span>
              <span className="truncate text-xs font-normal text-muted-foreground">{email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
              <User className="mr-2 size-4" /> Profile
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
              <Settings className="mr-2 size-4" /> Settings
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleSignOut}>
              <LogOut className="mr-2 size-4" /> Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
