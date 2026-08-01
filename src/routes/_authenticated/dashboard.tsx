import { createFileRoute } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  BookOpen,
  Bot,
  CreditCard,
  HeartPulse,
  Plug,
  Server,
  AudioLines,
  Building2,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useWorkspace } from "@/lib/workspace";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Workspace Dashboard — ZYRONEX" },
      {
        name: "description",
        content:
          "Operational overview of your ZYRONEX workspace: agents, resources, integrations and system health.",
      },
      { property: "og:title", content: "Workspace Dashboard — ZYRONEX" },
      {
        property: "og:description",
        content: "Operational overview of agents, resources, integrations and system health.",
      },
    ],
  }),
  component: DashboardPage,
});

type MetricCard = {
  title: string;
  icon: LucideIcon;
  value: string;
  caption: string;
  status?: string;
};

const metrics: MetricCard[] = [
  {
    title: "Workspace Status",
    icon: Building2,
    value: "Operational",
    caption: "All workspace services reachable",
    status: "Healthy",
  },
  { title: "Agents", icon: Bot, value: "—", caption: "No agents provisioned yet" },
  { title: "Resources", icon: Server, value: "—", caption: "Compute and runtime pools" },
  { title: "Integrations", icon: Plug, value: "—", caption: "Connected external systems" },
  { title: "Knowledge", icon: BookOpen, value: "—", caption: "Indexed knowledge sources" },
  { title: "Voice", icon: AudioLines, value: "—", caption: "Voice channels configured" },
  { title: "Billing", icon: CreditCard, value: "—", caption: "Current cycle consumption" },
];

export default function DashboardPage() {
  const { activeWorkspace } = useWorkspace();

  return (
    <div className="space-y-8">
      <PageHeader
        title={activeWorkspace?.name ?? "Workspace"}
        description="Operational overview of your agent estate. Modules are scaffolded and awaiting configuration."
        actions={
          <>
            <Badge variant="outline" className="capitalize">
              {activeWorkspace?.plan ?? "free"} plan
            </Badge>
            <Button variant="outline" size="sm">
              Configure workspace
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.title} className="panel-shadow">
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {metric.title}
              </CardTitle>
              <metric.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="font-display text-2xl font-semibold">{metric.value}</p>
              <p className="text-xs text-muted-foreground">{metric.caption}</p>
              {metric.status && (
                <Badge variant="secondary" className="mt-1 text-[11px]">
                  {metric.status}
                </Badge>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="panel-shadow lg:col-span-2">
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <div className="space-y-1">
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <CardDescription>Audit trail across agents, workflows and members.</CardDescription>
            </div>
            <Activity className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex h-52 flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
              <p className="text-sm font-medium">No activity recorded</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Events will appear here once agents and workflows are running in this workspace.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card className="panel-shadow">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">System Health</CardTitle>
              <HeartPulse className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3">
              {["API", "Database", "Realtime", "Storage"].map((service, index) => (
                <div key={service}>
                  {index > 0 && <Separator className="mb-3" />}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{service}</span>
                    <span className="flex items-center gap-2 font-medium">
                      <span className="size-1.5 rounded-full bg-success" />
                      Nominal
                    </span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="panel-shadow">
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Notifications</CardTitle>
              <Bell className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                You're all caught up.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
