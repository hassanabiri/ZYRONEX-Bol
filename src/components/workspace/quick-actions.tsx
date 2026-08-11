import { useNavigate } from "@tanstack/react-router";
import { Bot, CreditCard, Code2, Plug, Upload, UserPlus, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

type QuickAction = {
  label: string;
  icon: LucideIcon;
  to: string;
  search?: Record<string, string>;
};

const actions: QuickAction[] = [
  { label: "Create AI Worker", icon: Bot, to: "/agents" },
  { label: "Connect Integration", icon: Plug, to: "/integrations" },
  { label: "Upload Knowledge", icon: Upload, to: "/knowledge" },
  { label: "Invite Team Member", icon: UserPlus, to: "/workspace" },
  { label: "Open Billing", icon: CreditCard, to: "/billing" },
  { label: "Developer Center", icon: Code2, to: "/developer" },
];

/** Primary entry points into the workspace modules. */
export function QuickActions() {
  const { t } = useI18n();
  const navigate = useNavigate();

  return (
    <Card className="elevated-card">
      <CardHeader className="space-y-1 pb-3">
        <CardTitle className="text-base">{t("Quick Actions")}</CardTitle>
        <CardDescription>{t("Jump straight into the most common workspace tasks.")}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
        {actions.map((action) => (
          <Button
            key={action.label}
            variant="outline"
            className="group h-auto justify-start gap-3 rounded-xl border-border/70 bg-surface/40 px-3 py-3 text-start transition-colors hover:border-primary/40 hover:bg-primary/5"
            onClick={() => navigate({ to: action.to })}
          >
            <span className="icon-chip size-9 shrink-0 transition-transform group-hover:scale-105">
              <action.icon className="size-4" />
            </span>
            <span className="truncate text-sm font-medium">{t(action.label)}</span>
          </Button>
        ))}
      </CardContent>
    </Card>
  );
}
