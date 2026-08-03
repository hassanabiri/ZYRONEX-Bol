import { useState } from "react";
import { BadgeCheck, Download, Flag, Package, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { RatingStars } from "@/components/marketplace/rating-stars";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/lib/auth";
import {
  useMarketplaceMutations,
  useProductReviews,
  useProductVersions,
} from "@/hooks/use-marketplace";
import { categoryLabel, formatPrice } from "@/lib/developer/catalog";
import { useI18n } from "@/lib/i18n";
import type { MarketplaceProduct } from "@/services/marketplace-service";

/** Product detail view: description, versions, reviews and install action. */
export function ProductDialog({
  product,
  workspaceId,
  installed,
  onClose,
}: {
  product: MarketplaceProduct | null;
  workspaceId: string | undefined;
  installed: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { user } = useAuth();
  const mutations = useMarketplaceMutations(workspaceId);
  const { data: versions = [] } = useProductVersions(product?.id);
  const { data: reviews = [] } = useProductReviews(product?.id);

  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  if (!product) return null;

  async function run(label: string, action: Promise<unknown>) {
    try {
      await action;
      toast.success(t(label));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Action failed"));
    }
  }

  return (
    <Dialog open={Boolean(product)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{product.name}</DialogTitle>
            {product.verified && <BadgeCheck className="size-4 text-primary" />}
            <Badge variant="outline">{t(categoryLabel(product.category))}</Badge>
            <Badge variant="outline">v{product.version}</Badge>
          </div>
          <DialogDescription>{product.summary ?? t("No summary provided.")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {product.developer} · {product.install_count} {t("installs")}
            </p>
            <div className="flex items-center gap-2">
              <RatingStars value={product.rating_avg} />
              <span className="text-xs text-muted-foreground">
                {product.rating_avg.toFixed(1)} ({product.rating_count})
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">
              {formatPrice(product.price_cents, product.currency, product.license)}
            </span>
            <Button
              disabled={installed || !workspaceId}
              onClick={() =>
                void run("Product installed", mutations.installProduct.mutateAsync(product))
              }
            >
              <Download className="me-2 size-4" />
              {installed ? t("Installed") : t("Install")}
            </Button>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">{t("Overview")}</TabsTrigger>
            <TabsTrigger value="versions">{t("Versions")}</TabsTrigger>
            <TabsTrigger value="reviews">{t("Reviews")}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4 text-sm">
            <p className="whitespace-pre-line text-muted-foreground">
              {product.description ?? t("No description provided.")}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("License")}</p>
                <p className="text-sm font-medium">{t(product.license)}</p>
              </div>
              <div className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{t("Compatibility")}</p>
                <p className="text-sm font-medium">{product.compatibility ?? "—"}</p>
              </div>
            </div>
            {product.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {product.tags.map((tag) => (
                  <span key={tag} className="rounded-md border px-2 py-0.5 text-[11px]">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="versions" className="space-y-2">
            {versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No releases published yet.")}</p>
            ) : (
              versions.map((version) => (
                <div key={version.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium">v{version.version}</p>
                    <span className="text-xs text-muted-foreground">
                      {new Date(version.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {version.release_notes ?? t("No release notes.")}
                  </p>
                </div>
              ))
            )}
          </TabsContent>

          <TabsContent value="reviews" className="space-y-4">
            <div className="space-y-3 rounded-xl border p-3">
              <RatingStars value={rating} onChange={setRating} size="md" />
              <Textarea
                rows={3}
                placeholder={t("Share how this performed in your workspace")}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!user}
                onClick={async () => {
                  await run(
                    "Review saved",
                    mutations.saveReview.mutateAsync({
                      productId: product.id,
                      rating,
                      comment: comment.trim() || null,
                      verifiedPurchase: installed,
                    }),
                  );
                  setComment("");
                }}
              >
                {t("Submit review")}
              </Button>
            </div>

            {reviews.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No reviews yet.")}</p>
            ) : (
              reviews.map((review) => (
                <div key={review.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <RatingStars value={review.rating} />
                      {review.verified_purchase && (
                        <Badge variant="outline">{t("Verified")}</Badge>
                      )}
                      {review.reported && <Badge variant="destructive">{t("Reported")}</Badge>}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("Report review")}
                        onClick={() =>
                          void run(
                            "Review reported",
                            mutations.reportReview.mutateAsync({
                              reviewId: review.id,
                              productId: product.id,
                            }),
                          )
                        }
                      >
                        <Flag className="size-4" />
                      </Button>
                      {review.user_id === user?.id && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          aria-label={t("Delete review")}
                          onClick={() =>
                            void run(
                              "Review deleted",
                              mutations.deleteReview.mutateAsync({
                                reviewId: review.id,
                                productId: product.id,
                              }),
                            )
                          }
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{review.comment ?? "—"}</p>
                </div>
              ))
            )}
          </TabsContent>
        </Tabs>

        <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <Package className="size-3.5" />
          {t("Installs are workspace-scoped and can be removed at any time.")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
