import { useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useI18n } from "@/lib/i18n";
import {
  INTEGRATION_CATEGORIES,
  PROVIDERS,
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
      if (category !== "all" && provider.category !== category) return false;
      if (!query) return true;
      return (
        provider.name.toLowerCase().includes(query) ||
        provider.description.toLowerCase().includes(query) ||
        provider.id.includes(query)
      );
    });
  }, [term, category]);

  return (
    <div className="space-y-4">
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
          <SelectTrigger className="sm:w-56">
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((provider) => {
          const count = connectedCount.get(provider.id) ?? 0;
          return (
            <Card key={provider.id} className="flex flex-col">
              <CardHeader className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{provider.name}</CardTitle>
                  {count > 0 && <Badge variant="secondary">{count} {t("connected")}</Badge>}
                </div>
                <CardDescription>{provider.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{provider.authType}</Badge>
                  {provider.supportsWebhooks && <Badge variant="outline">{t("Webhooks")}</Badge>}
                  {provider.supportsSync && <Badge variant="outline">{t("Sync")}</Badge>}
                </div>
                <Button className="w-full" onClick={() => onConnect(provider)}>
                  {t("Connect")}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {t("No providers match your filters.")}
        </p>
      )}
    </div>
  );
}
