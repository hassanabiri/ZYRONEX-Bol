import { Building2, CalendarDays, Crown, ShieldCheck } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useTeamMembers } from "@/hooks/use-workspace-data";
import { useI18n } from "@/lib/i18n";
import type { Workspace } from "@/services/types";

function formatDate(value?: string | null, locale = "en") {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(locale === "ar" ? "ar" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Identity header of the active workspace: logo, name, plan, status, created date and owner. */
export function WorkspaceHeader({ workspace }: { workspace: Workspace | null }) {
  const { t, language } = useI18n();
  const { data: members } = useTeamMembers(workspace?.id);

  if (!workspace) {
    return <Skeleton className="h-32 w-full rounded-xl" />;
  }

  const owner = members?.find((member) => member.user_id === workspace.owner_user_id);
  const ownerName = owner?.profile?.full_name || owner?.profile?.email || t("You");
  const initials = workspace.name.slice(0, 2).toUpperCase();

  const facts = [
    { icon: ShieldCheck, label: t("Status"), value: t(workspace.status) },
    { icon: CalendarDays, label: t("Created"), value: formatDate(workspace.created_at, language) },
    { icon: Crown, label: t("Owner"), value: ownerName },
    { icon: Building2, label: t("Slug"), value: workspace.slug },
  ];

  return (
    <Card className="elevated-card relative overflow-hidden">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(38rem_14rem_at_0%_0%,color-mix(in_oklab,var(--primary)_14%,transparent),transparent_65%)]"
      />
      <CardContent className="relative flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar className="size-14 shrink-0 rounded-2xl ring-1 ring-border/60">
            {workspace.logo && <AvatarImage src={workspace.logo} alt={workspace.name} />}
            <AvatarFallback className="brand-gradient rounded-2xl text-base font-semibold text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-1.5">
            <h1 className="truncate font-display text-xl font-semibold tracking-[-0.02em] sm:text-2xl lg:text-[1.75rem]">
              {workspace.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full capitalize">{t(workspace.subscription_plan)}</Badge>
              <Badge variant="outline" className="rounded-full capitalize">
                {t(workspace.status)}
              </Badge>
            </div>
          </div>
        </div>

        <div className="grid w-full grid-cols-2 gap-3 sm:gap-4 lg:w-auto lg:grid-cols-4">
          {facts.map((fact) => (
            <div
              key={fact.label}
              className="min-w-0 space-y-1 rounded-xl border border-border/60 bg-surface/40 px-3 py-2 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0"
            >
              <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">
                <fact.icon className="size-3.5 shrink-0" />
                <span className="truncate">{fact.label}</span>
              </p>
              <p className="truncate text-sm font-medium capitalize">{fact.value}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
