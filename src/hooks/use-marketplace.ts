import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/lib/auth";
import type { TablesUpdate } from "@/integrations/supabase/types";
import {
  marketplaceService,
  type MarketplaceProduct,
  type MarketplaceProductVersion,
  type ProductDraft,
} from "@/services/marketplace-service";

export const marketplaceKeys = {
  catalogue: ["marketplace", "catalogue"] as const,
  published: (workspaceId: string) => ["workspace", workspaceId, "marketplace-products"] as const,
  installs: (workspaceId: string) => ["workspace", workspaceId, "marketplace-installs"] as const,
  reviews: (productId: string) => ["marketplace", "reviews", productId] as const,
  versions: (productId: string) => ["marketplace", "versions", productId] as const,
};

export function useMarketplaceCatalogue() {
  return useQuery({
    queryKey: marketplaceKeys.catalogue,
    queryFn: () => marketplaceService.listCatalogue(),
  });
}

export function usePublishedProducts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: marketplaceKeys.published(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => marketplaceService.listByWorkspace(workspaceId!),
  });
}

export function useMarketplaceInstalls(workspaceId: string | undefined) {
  return useQuery({
    queryKey: marketplaceKeys.installs(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => marketplaceService.listInstalls(workspaceId!),
  });
}

export function useProductReviews(productId: string | undefined) {
  return useQuery({
    queryKey: marketplaceKeys.reviews(productId ?? "none"),
    enabled: Boolean(productId),
    queryFn: () => marketplaceService.listReviews(productId!),
  });
}

export function useProductVersions(productId: string | undefined) {
  return useQuery({
    queryKey: marketplaceKeys.versions(productId ?? "none"),
    enabled: Boolean(productId),
    queryFn: () => marketplaceService.listVersions(productId!),
  });
}

export function useMarketplaceMutations(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "";

  const invalidateProducts = () => {
    queryClient.invalidateQueries({ queryKey: marketplaceKeys.catalogue });
    queryClient.invalidateQueries({ queryKey: marketplaceKeys.published(id) });
  };

  return {
    createProduct: useMutation({
      mutationFn: (draft: ProductDraft) => marketplaceService.createProduct(id, draft, user?.id),
      onSuccess: invalidateProducts,
    }),
    updateProduct: useMutation({
      mutationFn: (input: { id: string; patch: TablesUpdate<"marketplace_products"> }) =>
        marketplaceService.updateProduct(input.id, input.patch),
      onSuccess: invalidateProducts,
    }),
    publishProduct: useMutation({
      mutationFn: (product: MarketplaceProduct) => marketplaceService.publish(product, user?.id),
      onSuccess: invalidateProducts,
    }),
    unpublishProduct: useMutation({
      mutationFn: (product: MarketplaceProduct) => marketplaceService.unpublish(product),
      onSuccess: invalidateProducts,
    }),
    archiveProduct: useMutation({
      mutationFn: (product: MarketplaceProduct) => marketplaceService.archive(product),
      onSuccess: invalidateProducts,
    }),
    releaseVersion: useMutation({
      mutationFn: (input: { product: MarketplaceProduct; version: string; notes: string }) =>
        marketplaceService.releaseVersion(input.product, input.version, input.notes, user?.id),
      onSuccess: (_data, variables) => {
        invalidateProducts();
        queryClient.invalidateQueries({
          queryKey: marketplaceKeys.versions(variables.product.id),
        });
      },
    }),
    rollbackVersion: useMutation({
      mutationFn: (input: { product: MarketplaceProduct; target: MarketplaceProductVersion }) =>
        marketplaceService.rollback(input.product, input.target),
      onSuccess: invalidateProducts,
    }),
    deleteProduct: useMutation({
      mutationFn: (productId: string) => marketplaceService.removeProduct(productId),
      onSuccess: invalidateProducts,
    }),
    installProduct: useMutation({
      mutationFn: (product: MarketplaceProduct) =>
        marketplaceService.install(product, id, user?.id),
      onSuccess: () => {
        invalidateProducts();
        queryClient.invalidateQueries({ queryKey: marketplaceKeys.installs(id) });
      },
    }),
    uninstallProduct: useMutation({
      mutationFn: (installId: string) => marketplaceService.uninstall(installId),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: marketplaceKeys.installs(id) }),
    }),
    saveReview: useMutation({
      mutationFn: (input: {
        productId: string;
        rating: number;
        comment: string | null;
        verifiedPurchase: boolean;
      }) =>
        marketplaceService.upsertReview({
          productId: input.productId,
          workspaceId: id,
          userId: user!.id,
          rating: input.rating,
          comment: input.comment,
          verifiedPurchase: input.verifiedPurchase,
        }),
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: marketplaceKeys.reviews(variables.productId) });
        invalidateProducts();
      },
    }),
    reportReview: useMutation({
      mutationFn: (input: { reviewId: string; productId: string }) =>
        marketplaceService.reportReview(input.reviewId),
      onSuccess: (_data, variables) =>
        queryClient.invalidateQueries({ queryKey: marketplaceKeys.reviews(variables.productId) }),
    }),
    deleteReview: useMutation({
      mutationFn: (input: { reviewId: string; productId: string }) =>
        marketplaceService.removeReview(input.reviewId),
      onSuccess: (_data, variables) =>
        queryClient.invalidateQueries({ queryKey: marketplaceKeys.reviews(variables.productId) }),
    }),
  };
}
