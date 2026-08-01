import type { LucideIcon } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

export type ModuleCapability = {
  title: string;
  description: string;
  icon: LucideIcon;
};

export function ModulePage({
  title,
  description,
  icon: Icon,
  capabilities,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  capabilities: ModuleCapability[];
}) {
  const { t } = useI18n();

  return (
    <div className="space-y-8">
      <PageHeader
        title={t(title)}
        description={t(description)}
        actions={<Badge variant="outline">{t("Not configured")}</Badge>}
      />

      <Card className="border-dashed">
        <CardHeader className="flex-row items-center gap-4 space-y-0">
          <span className="flex size-11 items-center justify-center rounded-xl bg-surface text-primary">
            <Icon className="size-5" />
          </span>
          <div className="space-y-1">
            <CardTitle className="text-base">{t("Module scaffold ready")}</CardTitle>
            <CardDescription>
              {t(
                "Structure, routing and access control are in place. Implementation lands in a later phase.",
              )}
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {capabilities.map((capability) => (
          <Card key={capability.title} className="panel-shadow">
            <CardHeader className="space-y-3">
              <span className="flex size-9 items-center justify-center rounded-lg bg-surface text-muted-foreground">
                <capability.icon className="size-4" />
              </span>
              <div className="space-y-1">
                <CardTitle className="text-sm font-semibold">{t(capability.title)}</CardTitle>
                <CardDescription className="text-sm">{t(capability.description)}</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                <div className="h-full w-0 rounded-full bg-primary" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
