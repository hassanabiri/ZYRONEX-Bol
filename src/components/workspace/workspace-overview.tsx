import { useMemo } from "react";
import {
  Activity,
  BarChart3,
  Bot,
  BookOpen,
  Brain,
  HardDrive,
  KeyRound,
  Phone,
  Plug,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useDashboardLayout } from "@/hooks/use-dashboard-layout";
import { useTeamMembers } from "@/hooks/use-workspace-data";
import { useI18n } from "@/lib/i18n";
import type { LayoutItem } from "@/services/layout-service";

type MetricCard = {
  id: string;
  title: string;
  icon: LucideIcon;
  value: string;
  caption: string;
};

const DEFAULT_LAYOUT: LayoutItem[] = [
  { id: "workers", size: 1 },
  { id: "integrations", size: 1 },
  { id: "knowledge", size: 1 },
  { id: "memory", size: 1 },
  { id: "storage", size: 1 },
  { id: "voice", size: 1 },
  { id: "team", size: 1 },
  { id: "api", size: 1 },
  { id: "requests", size: 1 },
  { id: "activity", size: 3 },
];

/**
 * Workspace overview metrics. Values other than team size stay at zero until the
 * corresponding module is implemented — nothing here is simulated.
 * Card order, size and visibility are saved per user via `useDashboardLayout`.
 */
export function WorkspaceOverview({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: members } = useTeamMembers(workspaceId);
  const { layout, setLayout, reset, isSaving } = useDashboardLayout(workspaceId, DEFAULT_LAYOUT);

  const metrics: MetricCard[] = [
    { id: "workers", title: "Active AI Workers", icon: Bot, value: "0", caption: "No workers deployed" },
    {
      id: "integrations",
      title: "Connected Integrations",
      icon: Plug,
      value: "0",
      caption: "No integrations connected",
    },
    { id: "knowledge", title: "Knowledge Bases", icon: BookOpen, value: "0", caption: "No knowledge indexed" },
    { id: "memory", title: "Memory Usage", icon: Brain, value: "0 MB", caption: "Vector memory consumed" },
    { id: "storage", title: "Storage Usage", icon: HardDrive, value: "0 MB", caption: "Files stored in workspace" },
    { id: "voice", title: "Voice Numbers", icon: Phone, value: "0", caption: "No numbers provisioned" },
    {
      id: "team",
      title: "Team Members",
      icon: Users,
      value: String(members?.length ?? 0),
      caption: "Members with workspace access",
    },
    { id: "api", title: "API Usage", icon: KeyRound, value: "0", caption: "Calls in the current cycle" },
    { id: "requests", title: "Monthly Requests", icon: BarChart3, value: "0", caption: "Requests this month" },
  ];

  const cards = useMemo(() => {
    const map: Record<string, { title: string; node: React.ReactNode }> = {};
    for (const card of metrics) {
      map[card.id] = {
        title: t(card.title),
        node: (
          <Card className="panel-shadow h-full">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {t(card.title)}
              </CardTitle>
              <card.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-1">
              <p className="font-display text-2xl font-semibold">{card.value}</p>
              <p className="text-xs text-muted-foreground">{t(card.caption)}</p>
            </CardContent>
          </Card>
        ),
      };
    }

    map["activity"] = {
      title: t("Recent Activity"),
      node: (
        <Card className="panel-shadow h-full">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-base">{t("Recent Activity")}</CardTitle>
              <CardDescription>
                {t("Audit trail across agents, workflows and members.")}
              </CardDescription>
            </div>
            <Activity className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <EmptyState
              icon={Activity}
              compact
              title="No activity recorded"
              description="Events will appear here once agents and workflows are running in this workspace."
            />
          </CardContent>
        </Card>
      ),
    };

    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, members?.length]);

  return (
    <DashboardGrid
      layout={layout}
      cards={cards}
      onChange={setLayout}
      onReset={reset}
      isSaving={isSaving}
    />
  );
}
