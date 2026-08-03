import { useMemo, useState } from "react";
import { BadgeCheck, Search, Store } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { ProductDialog } from "@/components/marketplace/product-dialog";
import { RatingStars } from "@/components/marketplace/rating-stars";
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
import { useMarketplaceCatalogue, useMarketplaceInstalls } from "@/hooks/use-marketplace";
import {
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_COLLECTIONS,
  MARKETPLACE_LICENSES,
  categoryLabel,
  formatPrice,
  type MarketplaceCollection,
} from "@/lib/developer/catalog";
import { useI18n } from "@/lib/i18n";
import type { MarketplaceProduct } from "@/services/marketplace-service";

/** Public catalogue with search, category/license filters and collections. */
export function MarketplaceBrowser({ workspaceId }: { workspaceId: string | undefined }) {
  const { t } = useI18n();
  const { data: catalogue = [], isLoading } = useMarketplaceCatalogue();
  const { data: installs = [] } = useMarketplaceInstalls(workspaceId);

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [license, setLicense] = useState("all");
  const [collection, setCollection] = useState<MarketplaceCollection>("all");
  const [selected, setSelected] = useState<MarketplaceProduct | null>(null);

  const installedIds = useMemo(
    () => new Set(installs.filter((i) => i.status === "installed").map((i) => i.product_id)),
    [installs],
  );

  const products = useMemo(() => {
    const term = query.trim().toLowerCase();
    let list = catalogue.filter((product) => product.status === "published");
    if (term) {
      list = list.filter((product) =>
        [product.name, product.summary ?? "", product.developer, ...product.tags]
          .join(" ")
          .toLowerCase()
          .includes(term),
      );
    }
    if (category !== "all") list = list.filter((product) => product.category === category);
    if (license !== "all") list = list.filter((product) => product.license === license);
    if (collection === "featured") list = list.filter((product) => product.featured);
    if (collection === "verified") list = list.filter((product) => product.verified);
    if (collection === "trending")
      list = [...list].sort((a, b) => b.install_count - a.install_count);
    if (collection === "recent")
      list = [...list].sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
      );
    return list;
  }, [catalogue, query, category, license, collection]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {MARKETPLACE_COLLECTIONS.map((item) => (
          <Button
            key={item.id}
            variant={collection === item.id ? "default" : "outline"}
            size="sm"
            onClick={() => setCollection(item.id)}
          >
            {t(item.label)}
          </Button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="relative sm:col-span-2">
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            placeholder={t("Search products, developers or tags")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger>
            <SelectValue placeholder={t("Category")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All categories")}</SelectItem>
            {MARKETPLACE_CATEGORIES.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {t(item.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={license} onValueChange={setLicense}>
          <SelectTrigger>
            <SelectValue placeholder={t("License")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("All licenses")}</SelectItem>
            {MARKETPLACE_LICENSES.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {t(item.label)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {!isLoading && products.length === 0 ? (
        <EmptyState
          icon={Store}
          title="Nothing matches yet"
          description="Publish a product or adjust your filters to explore the catalogue."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <Card key={product.id} className="flex flex-col panel-shadow">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="flex items-center gap-1.5 text-base">
                    {product.name}
                    {product.verified && <BadgeCheck className="size-4 text-primary" />}
                  </CardTitle>
                  <Badge variant="outline">{t(categoryLabel(product.category))}</Badge>
                </div>
                <CardDescription className="line-clamp-2">
                  {product.summary ?? t("No summary provided.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <RatingStars value={product.rating_avg} />
                    <span className="text-xs text-muted-foreground">({product.rating_count})</span>
                  </div>
                  <span className="text-sm font-semibold">
                    {formatPrice(product.price_cents, product.currency, product.license)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {product.developer} · {product.install_count} {t("installs")}
                </p>
                <Button className="w-full" variant="outline" onClick={() => setSelected(product)}>
                  {installedIds.has(product.id) ? t("Installed") : t("View details")}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ProductDialog
        product={selected}
        workspaceId={workspaceId}
        installed={selected ? installedIds.has(selected.id) : false}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}
