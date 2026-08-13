import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TermInfo } from "@/components/ui/term-info";
import { ProviderLogo } from "@/components/integrations/provider-logo";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import {
  CONNECTION_GROUP_LABELS,
  INTEGRATION_CATEGORIES,
  PROVIDERS,
  providerCategories,
  type ProviderDefinition,
} from "@/lib/integrations/catalog";
import type { Integration } from "@/services/integration-service";

/** Provider directory grouped by category with search and filtering. */
export function ProviderCatalog({
  integrations,
  onConnect,
}: {
  integrations: Integration[];
  onConnect: (provider: ProviderDefinition) => void;
}) {
  const { t } = useI18n();
  const [term, setTerm] = useState("");
  const [category, setCategory] = useState("all");

  const connectedCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of integrations) {
      if (item.status === "archived") continue;
      counts.set(item.provider, (counts.get(item.provider) ?? 0) + 1);
    }
    return counts;
  }, [integrations]);

  const filtered = useMemo(() => {
    const query = term.trim().toLowerCase();
    return PROVIDERS.filter((provider) => {
      if (!query) return true;
      return (
        provider.name.toLowerCase().includes(query) ||
        provider.description.toLowerCase().includes(query) ||
        (provider.capabilities ?? []).some((item) => item.toLowerCase().includes(query)) ||
        provider.id.includes(query)
      );
    });
  }, [term]);

  const sections = useMemo(() => {
    return INTEGRATION_CATEGORIES.filter((item) => category === "all" || item.id === category)
      .map((item) => ({
        ...item,
        providers: filtered.filter((provider) => providerCategories(provider).includes(item.id)),
      }))
      .filter((item) => item.providers.length > 0);
  }, [filtered, category]);

  const total = useMemo(
    () => sections.reduce((sum, item) => sum + item.providers.length, 0),
    [sections],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            placeholder={t("Search providers")}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="sm:w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All categories")}</SelectItem>
            {INTEGRATION_CATEGORIES.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {t(item.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="-mx-1 flex flex-wrap gap-1.5 px-1">
        <CategoryChip active={category === "all"} onClick={() => setCategory("all")}>
          {t("All categories")}
        </CategoryChip>
        {INTEGRATION_CATEGORIES.map((item) => (
          <CategoryChip
            key={item.id}
            active={category === item.id}
            onClick={() => setCategory(item.id)}
          >
            {t(item.label)}
          </CategoryChip>
        ))}
      </div>

      {sections.map((section) => {
        const Icon = section.icon;
        return (
          <section key={section.id} className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="icon-chip size-8 shrink-0">
                <Icon className="size-4" />
              </span>
              <h3 className="text-sm font-semibold tracking-tight">{t(section.label)}</h3>
              <span className="text-xs text-muted-foreground">{section.providers.length}</span>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {section.providers.map((provider) => {
                const count = connectedCount.get(provider.id) ?? 0;
                return (
                  <Card key={`${section.id}-${provider.id}`} className="flex flex-col">
                    <CardHeader className="space-y-3">
                      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
                        <ProviderLogo provider={provider} />
                        <div className="min-w-0 space-y-1">
                          <CardTitle className="truncate text-base">{provider.name}</CardTitle>
                          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground/70">
                            {t(section.label)}
                          </p>
                        </div>
                        {provider.comingSoon ? (
                          <Badge variant="outline" className="shrink-0">
                            {t("Coming soon")}
                          </Badge>
                        ) : count > 0 ? (
                          <Badge variant="success" className="shrink-0">
                            {count} {t("connected")}
                          </Badge>
                        ) : null}
                      </div>
                      <CardDescription className="line-clamp-2">{provider.description}</CardDescription>
                    </CardHeader>
                    <CardContent className="mt-auto space-y-3">
                      {provider.capabilities?.length ? (
                        <div className="flex flex-wrap gap-1.5">
                          {provider.capabilities.slice(0, 4).map((capability) => (
                            <span
                              key={capability}
                              className="rounded-full bg-muted/70 px-2 py-0.5 text-[11px] text-muted-foreground"
                            >
                              {t(capability)}
                            </span>
                          ))}
                          {provider.capabilities.length > 4 ? (
                            <span className="rounded-full bg-muted/70 px-2 py-0.5 text-[11px] text-muted-foreground">
                              +{provider.capabilities.length - 4}
                            </span>
                          ) : null}
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline">{provider.authType}</Badge>
                        {provider.connectionGroup ? (
                          <Badge variant="secondary">
                            {t(CONNECTION_GROUP_LABELS[provider.connectionGroup])}
                          </Badge>
                        ) : null}
                        {provider.supportsWebhooks ? (
                          <Badge variant="outline">
                            <TermInfo term="Webhooks">{t("Webhooks")}</TermInfo>
                          </Badge>
                        ) : null}
                        {provider.supportsSync ? (
                          <Badge variant="outline">
                            <TermInfo term="Sync">{t("Sync")}</TermInfo>
                          </Badge>
                        ) : null}
                      </div>
                      <Button
                        className="w-full"
                        variant={provider.comingSoon ? "outline" : "default"}
                        disabled={provider.comingSoon}
                        onClick={() => onConnect(provider)}
                      >
                        {provider.comingSoon ? t("Coming soon") : t("Connect")}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </section>
        );
      })}

      {total === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {t("No providers match your filters.")}
        </p>
      )}
    </div>
  );
}

function CategoryChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        active
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border/60 bg-muted/40 text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}
