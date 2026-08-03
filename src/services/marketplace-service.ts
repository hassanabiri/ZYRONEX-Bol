import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesUpdate } from "@/integrations/supabase/types";
import type { MarketplaceCategory, MarketplaceLicense } from "@/lib/developer/catalog";
import { randomToken, slugify } from "@/lib/utils";
import { activityService } from "@/services/activity-service";

export type MarketplaceProduct = Tables<"marketplace_products">;
export type MarketplaceProductVersion = Tables<"marketplace_product_versions">;
export type MarketplaceReview = Tables<"marketplace_reviews">;
export type MarketplaceInstall = Tables<"marketplace_installs">;

export type ProductDraft = {
  name: string;
  category: MarketplaceCategory;
  developer: string;
  summary?: string | null;
  description?: string | null;
  license: MarketplaceLicense;
  priceCents: number;
  currency: string;
  compatibility?: string | null;
  releaseNotes?: string | null;
  version?: string;
  tags: string[];
};

/**
 * Marketplace data layer. Products are published from a workspace (the
 * developer) and installed into any workspace the member belongs to.
 */
export const marketplaceService = {
  /** Everything the signed-in user may see: published catalogue + own drafts. */
  async listCatalogue(): Promise<MarketplaceProduct[]> {
    const { data, error } = await supabase
      .from("marketplace_products")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listByWorkspace(workspaceId: string): Promise<MarketplaceProduct[]> {
    const { data, error } = await supabase
      .from("marketplace_products")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listInstalls(workspaceId: string): Promise<MarketplaceInstall[]> {
    const { data, error } = await supabase
      .from("marketplace_installs")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listReviews(productId: string): Promise<MarketplaceReview[]> {
    const { data, error } = await supabase
      .from("marketplace_reviews")
      .select("*")
      .eq("product_id", productId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listVersions(productId: string): Promise<MarketplaceProductVersion[]> {
    const { data, error } = await supabase
      .from("marketplace_product_versions")
      .select("*")
      .eq("product_id", productId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createProduct(workspaceId: string, draft: ProductDraft, userId?: string) {
    const version = draft.version?.trim() || "1.0.0";
    const { data, error } = await supabase
      .from("marketplace_products")
      .insert({
        workspace_id: workspaceId,
        name: draft.name,
        slug: `${slugify(draft.name)}-${randomToken(2)}`,
        category: draft.category,
        developer: draft.developer,
        summary: draft.summary ?? null,
        description: draft.description ?? null,
        license: draft.license,
        price_cents: draft.priceCents,
        currency: draft.currency,
        compatibility: draft.compatibility ?? null,
        release_notes: draft.releaseNotes ?? null,
        version,
        tags: draft.tags,
        created_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;
    await marketplaceService.snapshotVersion(data, userId);
    return data;
  },

  async updateProduct(id: string, patch: TablesUpdate<"marketplace_products">) {
    const { data, error } = await supabase
      .from("marketplace_products")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async snapshotVersion(product: MarketplaceProduct, userId?: string) {
    const { error } = await supabase.from("marketplace_product_versions").insert({
      product_id: product.id,
      workspace_id: product.workspace_id,
      version: product.version,
      release_notes: product.release_notes,
      snapshot: {
        name: product.name,
        summary: product.summary,
        description: product.description,
        license: product.license,
        price_cents: product.price_cents,
        compatibility: product.compatibility,
      },
      created_by: userId ?? null,
    });
    if (error) throw error;
  },

  /** Publish (or re-publish) a product and archive the previous version. */
  async publish(product: MarketplaceProduct, userId?: string) {
    const updated = await marketplaceService.updateProduct(product.id, {
      status: "published",
      published_at: new Date().toISOString(),
    });
    await marketplaceService.snapshotVersion(updated, userId);
    await activityService.log(product.workspace_id, {
      entity_type: "marketplace_product",
      entity_id: product.id,
      action: "product.published",
      detail: `${product.name} ${product.version}`,
      result: "success",
      actor_id: userId ?? null,
    });
    return updated;
  },

  async unpublish(product: MarketplaceProduct) {
    return marketplaceService.updateProduct(product.id, { status: "draft" });
  },

  async archive(product: MarketplaceProduct) {
    return marketplaceService.updateProduct(product.id, { status: "rejected" });
  },

  /** Ship a new version: bumps the semver and stores release notes. */
  async releaseVersion(product: MarketplaceProduct, version: string, notes: string, userId?: string) {
    const updated = await marketplaceService.updateProduct(product.id, {
      version,
      release_notes: notes,
    });
    await marketplaceService.snapshotVersion(updated, userId);
    return updated;
  },

  async rollback(product: MarketplaceProduct, target: MarketplaceProductVersion) {
    const snapshot = (target.snapshot ?? {}) as Record<string, unknown>;
    return marketplaceService.updateProduct(product.id, {
      version: target.version,
      release_notes: target.release_notes,
      summary: (snapshot["summary"] as string | null) ?? product.summary,
      description: (snapshot["description"] as string | null) ?? product.description,
    });
  },

  async removeProduct(id: string) {
    const { error } = await supabase.from("marketplace_products").delete().eq("id", id);
    if (error) throw error;
  },

  async install(product: MarketplaceProduct, workspaceId: string, userId?: string) {
    const { data, error } = await supabase
      .from("marketplace_installs")
      .upsert(
        {
          product_id: product.id,
          workspace_id: workspaceId,
          version: product.version,
          license: product.license,
          installed_by: userId ?? null,
        },
        { onConflict: "product_id,workspace_id" },
      )
      .select("*")
      .single();
    if (error) throw error;
    await supabase
      .from("marketplace_products")
      .update({
        install_count: product.install_count + 1,
        revenue_cents: product.revenue_cents + product.price_cents,
      })
      .eq("id", product.id);
    await activityService.log(workspaceId, {
      entity_type: "marketplace_product",
      entity_id: product.id,
      action: "product.installed",
      detail: product.name,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async uninstall(installId: string) {
    const { error } = await supabase.from("marketplace_installs").delete().eq("id", installId);
    if (error) throw error;
  },

  async upsertReview(input: {
    productId: string;
    workspaceId: string;
    userId: string;
    rating: number;
    comment: string | null;
    verifiedPurchase: boolean;
  }) {
    const { data, error } = await supabase
      .from("marketplace_reviews")
      .upsert(
        {
          product_id: input.productId,
          workspace_id: input.workspaceId,
          user_id: input.userId,
          rating: input.rating,
          comment: input.comment,
          verified_purchase: input.verifiedPurchase,
        },
        { onConflict: "product_id,user_id" },
      )
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  /** Abuse reports go through a definer RPC so nobody can edit another review. */
  async reportReview(reviewId: string) {
    const { error } = await supabase.rpc("report_marketplace_review", { _review_id: reviewId });
    if (error) throw error;
  },

  async removeReview(reviewId: string) {
    const { error } = await supabase.from("marketplace_reviews").delete().eq("id", reviewId);
    if (error) throw error;
  },
};
