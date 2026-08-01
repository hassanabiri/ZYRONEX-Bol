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

import { EmptyState } from "@/components/empty-state";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useTeamMembers } from "@/hooks/use-workspace-data";
import { useI18n } from "@/lib/i18n";

/**
 * Workspace overview metrics. Values other than team size stay at zero until the
 * corresponding module is implemented — nothing here is simulated.
 */
export function WorkspaceOverview({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: members } = useTeamMembers(workspaceId);

  const cards = [
    { title: "Active AI Workers", icon: Bot, value: "0", caption: "No workers deployed" },
    { title: "Connected Integrations", icon: Plug, value: "0", caption: "No integrations connected" },
    { title: "Knowledge Bases", icon: BookOpen, value: "0", caption: "No knowledge indexed" },
    { title: "Memory Usage", icon: Brain, value: "0 MB", caption: "Vector memory consumed" },
    { title: "Storage Usage", icon: HardDrive, value: "0 MB", caption: "Files stored in workspace" },
    { title: "Voice Numbers", icon: Phone, value: "0", caption: "No numbers provisioned" },
    {
      title: "Team Members",
      icon: Users,
      value: String(members?.length ?? 0),
      caption: "Members with workspace access",
    },
    { title: "API Usage", icon: KeyRound, value: "0", caption: "Calls in the current cycle" },
    { title: "Monthly Requests", icon: BarChart3, value: "0", caption: "Requests this month" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <Card key={card.title} className="panel-shadow">
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
        ))}
      </div>

      <Card className="panel-shadow">
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
    </div>
  );
}
