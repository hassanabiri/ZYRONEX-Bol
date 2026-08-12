import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  ChevronsUpDown,
  Globe,
  LogOut,
  Moon,
  Plus,
  Search,
  Settings,
  Sun,
  User,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CommandPalette } from "@/components/command-palette";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { CreateWorkspaceWizard } from "@/components/workspace/create-workspace-wizard";
import { useProfile } from "@/hooks/use-profile";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { useWorkspace } from "@/lib/workspace";

export function TopBar() {
  const [createOpen, setCreateOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { theme, toggleTheme } = useTheme();
  const { t, language, setLanguage } = useI18n();
  const { signOut } = useAuth();
  const { fullName, email, avatarUrl, initials } = useProfile();
  const { workspaces, activeWorkspace, setActiveWorkspaceId } = useWorkspace();


  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <header className="sticky top-0 z-20 flex h-16 w-full items-center gap-1 overflow-hidden border-b border-border/60 bg-background/70 px-2 shadow-[0_1px_0_0_color-mix(in_oklab,var(--foreground)_6%,transparent)] backdrop-blur-xl sm:gap-2 sm:px-5">
      <SidebarTrigger className="shrink-0" />
      <Separator orientation="vertical" className="mx-1 hidden h-6 sm:block" />


      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-9 min-w-0 max-w-[150px] justify-between gap-1.5 px-2 sm:max-w-[220px] sm:gap-2 sm:px-2.5">

            <span className="brand-gradient size-5 shrink-0 rounded-md" />
            <span className="truncate text-sm font-medium">
              {activeWorkspace?.name ?? t("No workspace")}
            </span>
            <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
            {t("Workspaces")}
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
            <DropdownMenuItem disabled>{t("No workspaces available")}</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)}>
            <Plus className="me-2 size-4" /> {t("Create workspace")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate({ to: "/workspace" })}>
            {t("Workspace settings")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Create workspace")}</DialogTitle>
            <DialogDescription>
              {t("Workspaces isolate your agents, knowledge, members and billing.")}
            </DialogDescription>
          </DialogHeader>
          <CreateWorkspaceWizard
            onCancel={() => setCreateOpen(false)}
            onCreated={(workspaceId) => {
              setCreateOpen(false);
              setActiveWorkspaceId(workspaceId);
              navigate({ to: "/dashboard" });
            }}
          />
        </DialogContent>
      </Dialog>


      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onCreateWorkspace={() => setCreateOpen(true)}
      />

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="relative ml-auto hidden h-9 w-full max-w-sm items-center gap-2 rounded-full border border-border/70 bg-surface/60 px-3.5 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:bg-surface md:flex"
        aria-label={t("Search workspace")}
      >
        <Search className="size-4 shrink-0" />
        <span className="truncate">{t("Search or run a command…")}</span>
        <kbd className="ms-auto rounded border px-1.5 py-0.5 text-[10px] font-medium">⌘K</kbd>
      </button>

      <Button
        variant="ghost"
        size="icon"
        className="ml-auto shrink-0 md:hidden"
        onClick={() => setPaletteOpen(true)}
        aria-label={t("Search workspace")}
      >
        <Search className="size-4" />
      </Button>


      <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1 md:ml-2">


        <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={t("Toggle theme")}>
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="hidden sm:inline-flex" aria-label={t("Language")}>
              <Globe className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel className="text-xs uppercase tracking-[0.14em] text-muted-foreground">
              {t("Language")}
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setLanguage("en")} className="justify-between">
              English
              {language === "en" && <Check className="size-4" />}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLanguage("ar")} className="justify-between">
              العربية
              {language === "ar" && <Check className="size-4" />}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative" aria-label={t("Notifications")}>
              <Bell className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuLabel className="flex items-center justify-between">
              {t("Notifications")}
              <Badge variant="secondary">0</Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {t("No notifications yet.")}
            </p>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-9 shrink-0 gap-2 px-1.5 sm:ml-1">
              <Avatar className="size-7">
                {avatarUrl && <AvatarImage src={avatarUrl} alt={fullName || email} />}
                <AvatarFallback className="bg-surface text-[11px] font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">{fullName || t("Signed in")}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">{email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
              <User className="me-2 size-4" /> {t("Profile")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => navigate({ to: "/settings" })}>
              <Settings className="me-2 size-4" /> {t("Settings")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="sm:hidden"
              onSelect={() => setLanguage(language === "en" ? "ar" : "en")}
            >
              <Globe className="me-2 size-4" /> {language === "en" ? "العربية" : "English"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />

            <DropdownMenuItem onSelect={handleSignOut}>
              <LogOut className="me-2 size-4" /> {t("Sign out")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
