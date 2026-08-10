import { useNavigate } from "@tanstack/react-router";
import { Moon, Plus, Sparkles, Sun } from "lucide-react";
import { useEffect } from "react";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useI18n } from "@/lib/i18n";
import { navSections } from "@/lib/navigation";
import { useTheme } from "@/lib/theme";

export function CommandPalette({
  open,
  onOpenChange,
  onCreateWorkspace,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateWorkspace?: () => void;
}) {
  const navigate = useNavigate();
  const { t, language, setLanguage } = useI18n();
  const { theme, toggleTheme } = useTheme();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  function go(to: string) {
    onOpenChange(false);
    navigate({ to });
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={t("Search pages, settings or run a command…")} />
      <CommandList>
        <CommandEmpty>{t("No results found.")}</CommandEmpty>
        {navSections.map((section) => (
          <CommandGroup key={section.label} heading={t(section.label)}>
            {section.items.map((item) => (
              <CommandItem
                key={item.to}
                value={`${t(item.title)} ${item.title} ${item.to}`}
                onSelect={() => go(item.to)}
              >
                <item.icon className="me-2 size-4" />
                {t(item.title)}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        <CommandSeparator />
        <CommandGroup heading={t("Actions")}>
          {onCreateWorkspace && (
            <CommandItem
              value="create workspace إنشاء مساحة عمل"
              onSelect={() => {
                onOpenChange(false);
                onCreateWorkspace();
              }}
            >
              <Plus className="me-2 size-4" />
              {t("Create workspace")}
            </CommandItem>
          )}
          <CommandItem value="theme toggle dark light السمة" onSelect={() => toggleTheme()}>
            {theme === "dark" ? <Sun className="me-2 size-4" /> : <Moon className="me-2 size-4" />}
            {t("Toggle theme")}
          </CommandItem>
          <CommandItem
            value="language arabic english اللغة"
            onSelect={() => setLanguage(language === "ar" ? "en" : "ar")}
          >
            <Sparkles className="me-2 size-4" />
            {language === "ar" ? "English" : "العربية"}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
