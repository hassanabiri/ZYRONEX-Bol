import { Copy } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { API_POLICIES, API_SURFACES, DOC_SECTIONS, SDKS } from "@/lib/developer/catalog";
import { useI18n } from "@/lib/i18n";

/** Static developer surface: API transports, policies, SDKs and documentation. */
export function SdkPanel() {
  const { t } = useI18n();

  function copy(value: string) {
    void navigator.clipboard.writeText(value);
    toast.success(t("Copied to clipboard"));
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t("API surfaces")}</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {API_SURFACES.map((surface) => (
            <Card key={surface.id} className="panel-shadow">
              <CardHeader className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex size-9 items-center justify-center rounded-lg bg-surface text-muted-foreground">
                    <surface.icon className="size-4" />
                  </span>
                  <Badge variant={surface.state === "live" ? "default" : "outline"}>
                    {t(surface.state)}
                  </Badge>
                </div>
                <CardTitle className="text-base">{t(surface.label)}</CardTitle>
                <CardDescription>{t(surface.description)}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t("Platform policies")}</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {API_POLICIES.map((policy) => (
            <div key={policy.label} className="rounded-xl border p-4">
              <p className="text-sm font-medium">{t(policy.label)}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t(policy.detail)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t("SDKs")}</h3>
        <div className="grid gap-4 md:grid-cols-2">
          {SDKS.map((sdk) => (
            <Card key={sdk.id} className="panel-shadow">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <sdk.icon className="size-4 text-muted-foreground" />
                    <CardTitle className="text-base">{t(sdk.label)}</CardTitle>
                  </div>
                  <Badge variant={sdk.state === "ready" ? "default" : "outline"}>
                    {t(sdk.state)}
                  </Badge>
                </div>
                <CardDescription>{sdk.language}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md border bg-surface px-3 py-2 text-xs">
                    {sdk.install}
                  </code>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={t("Copy install command")}
                    onClick={() => copy(sdk.install)}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
                <pre className="overflow-x-auto rounded-md border bg-surface p-3 text-[11px] leading-relaxed">
                  <code>{sdk.snippet}</code>
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-sm font-semibold">{t("Documentation")}</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {DOC_SECTIONS.map((section) => (
            <Card key={section.id} className="panel-shadow">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <section.icon className="size-4 text-muted-foreground" />
                  <CardTitle className="text-base">{t(section.title)}</CardTitle>
                </div>
                <CardDescription>{t(section.description)}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-1.5">
                {section.topics.map((topic) => (
                  <span
                    key={topic}
                    className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {t(topic)}
                  </span>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
