import { useState } from "react";
import { Archive, Rocket, Send, Tag, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useMarketplaceMutations, usePublishedProducts } from "@/hooks/use-marketplace";
import {
  MARKETPLACE_CATEGORIES,
  MARKETPLACE_LICENSES,
  formatPrice,
  type MarketplaceCategory,
  type MarketplaceLicense,
} from "@/lib/developer/catalog";
import { useI18n } from "@/lib/i18n";
import type { MarketplaceProduct } from "@/services/marketplace-service";

/** Publishing workflow: draft → submit → publish, with versioned releases. */
export function PublisherPanel({
  workspaceId,
  canManage,
}: {
  workspaceId: string | undefined;
  canManage: boolean;
}) {
  const { t } = useI18n();
  const { data: products = [], isLoading } = usePublishedProducts(workspaceId);
  const mutations = useMarketplaceMutations(workspaceId);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [developer, setDeveloper] = useState("");
  const [category, setCategory] = useState<MarketplaceCategory>("workers");
  const [license, setLicense] = useState<MarketplaceLicense>("free");
  const [price, setPrice] = useState("0");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");

  const [release, setRelease] = useState<MarketplaceProduct | null>(null);
  const [version, setVersion] = useState("1.0.0");
  const [notes, setNotes] = useState("");

  async function run(label: string, action: Promise<unknown>) {
    try {
      await action;
      toast.success(t(label));
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
      return false;
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("Your products")}</h3>
          <p className="text-xs text-muted-foreground">
            {t("Publish workers, workflows and packs, then ship versioned releases.")}
          </p>
        </div>
        {canManage && <Button onClick={() => setOpen(true)}>{t("New product")}</Button>}
      </div>

      {!isLoading && products.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="Nothing published yet"
          description="Create a product to list it in the ZYRONEX marketplace."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {products.map((product) => (
            <Card key={product.id} className="flex flex-col panel-shadow">
              <CardHeader>
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{product.name}</CardTitle>
                  <Badge variant={product.status === "published" ? "default" : "outline"}>
                    {t(product.status)}
                  </Badge>
                </div>
                <CardDescription className="line-clamp-2">
                  {product.summary ?? t("No summary provided.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-3">
                <p className="text-xs text-muted-foreground">
                  v{product.version} · {formatPrice(product.price_cents, product.currency, product.license)} ·{" "}
                  {product.install_count} {t("installs")}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("Revenue")}: ${(product.revenue_cents / 100).toFixed(2)}
                </p>
                {canManage && (
                  <div className="flex flex-wrap gap-2">
                    {product.status === "published" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          void run(
                            "Product unpublished",
                            mutations.unpublishProduct.mutateAsync(product),
                          )
                        }
                      >
                        <Undo2 className="me-2 size-4" />
                        {t("Unpublish")}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() =>
                          void run(
                            "Product published",
                            mutations.publishProduct.mutateAsync(product),
                          )
                        }
                      >
                        <Send className="me-2 size-4" />
                        {t("Publish")}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setRelease(product);
                        setVersion(product.version);
                        setNotes("");
                      }}
                    >
                      <Tag className="me-2 size-4" />
                      {t("Release")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("Archive")}
                      onClick={() =>
                        void run(
                          "Product archived",
                          mutations.archiveProduct.mutateAsync(product),
                        )
                      }
                    >
                      <Archive className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive"
                      aria-label={t("Delete")}
                      onClick={() =>
                        void run(
                          "Product deleted",
                          mutations.deleteProduct.mutateAsync(product.id),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("New product")}</DialogTitle>
            <DialogDescription>
              {t("Products start as drafts and stay private until you publish them.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="product-name">{t("Name")}</Label>
                <Input id="product-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-dev">{t("Developer")}</Label>
                <Input
                  id="product-dev"
                  value={developer}
                  onChange={(e) => setDeveloper(e.target.value)}
                />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label>{t("Category")}</Label>
                <Select
                  value={category}
                  onValueChange={(value) => setCategory(value as MarketplaceCategory)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKETPLACE_CATEGORIES.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {t(item.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("License")}</Label>
                <Select
                  value={license}
                  onValueChange={(value) => setLicense(value as MarketplaceLicense)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKETPLACE_LICENSES.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {t(item.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="product-price">{t("Price (USD)")}</Label>
                <Input
                  id="product-price"
                  inputMode="decimal"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-summary">{t("Summary")}</Label>
              <Input
                id="product-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-desc">{t("Description")}</Label>
              <Textarea
                id="product-desc"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="product-tags">{t("Tags")}</Label>
              <Input
                id="product-tags"
                placeholder="support, arabic, crm"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={!name.trim() || !developer.trim()}
              onClick={async () => {
                const ok = await run(
                  "Product created",
                  mutations.createProduct.mutateAsync({
                    name: name.trim(),
                    developer: developer.trim(),
                    category,
                    license,
                    priceCents: Math.max(0, Math.round(Number(price) * 100) || 0),
                    currency: "USD",
                    summary: summary.trim() || null,
                    description: description.trim() || null,
                    tags: tags
                      .split(",")
                      .map((tag) => tag.trim())
                      .filter(Boolean),
                  }),
                );
                if (ok) {
                  setOpen(false);
                  setName("");
                  setDeveloper("");
                  setSummary("");
                  setDescription("");
                  setTags("");
                  setPrice("0");
                }
              }}
            >
              {t("Create")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(release)} onOpenChange={(next) => !next && setRelease(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Release version")}</DialogTitle>
            <DialogDescription>
              {t("A snapshot of the product is stored so you can roll back later.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="release-version">{t("Version")}</Label>
              <Input
                id="release-version"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="release-notes">{t("Release notes")}</Label>
              <Textarea
                id="release-notes"
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRelease(null)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={!version.trim()}
              onClick={async () => {
                if (!release) return;
                const ok = await run(
                  "Version released",
                  mutations.releaseVersion.mutateAsync({
                    product: release,
                    version: version.trim(),
                    notes: notes.trim(),
                  }),
                );
                if (ok) setRelease(null);
              }}
            >
              {t("Release")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
