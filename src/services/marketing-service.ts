import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import type { CreditType } from "@/lib/billing/catalog";
import { CREATIVE_KIND_MAP, previewTransfer, type CreativeKind } from "@/lib/marketing/catalog";
import { activityService } from "@/services/activity-service";
import { billingService, type CreditBalance, type UsageRecord } from "@/services/billing-service";

export type Campaign = Tables<"marketing_campaigns">;
export type BudgetAllocation = Tables<"campaign_budget_allocations">;
export type CreativeRequest = Tables<"creative_requests">;
export type CreditTransfer = Tables<"credit_transfers">;
export type MarketingAlert = Tables<"marketing_alerts">;
export type ApprovalRequest = Tables<"approval_requests">;
export type BrandProfile = Tables<"brand_profiles">;
export type MarketingAuditEntry = Tables<"marketing_audit_log">;

export type WalletMetrics = {
  creditType: CreditType;
  granted: number;
  used: number;
  remaining: number;
  dailyBurn: number;
  monthlyBurn: number;
  daysLeft: number | null;
  exhaustionDate: string | null;
};

/**
 * Marketing Command Center data layer. The marketing agent is an orchestrator:
 * it stores campaigns, budgets and creative requests, then delegates execution
 * to the AI workers that already exist in the workspace.
 */
export const marketingService = {
  /* ---------------------------------------------------------------- audit */

  async audit(
    workspaceId: string,
    entry: Omit<TablesInsert<"marketing_audit_log">, "workspace_id">,
  ) {
    await supabase
      .from("marketing_audit_log")
      .insert({ ...entry, workspace_id: workspaceId })
      .then(undefined, () => undefined);
  },

  async listAudit(workspaceId: string, limit = 200): Promise<MarketingAuditEntry[]> {
    const { data, error } = await supabase
      .from("marketing_audit_log")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data ?? [];
  },

  /* ------------------------------------------------------------ campaigns */

  async listCampaigns(workspaceId: string): Promise<Campaign[]> {
    const { data, error } = await supabase
      .from("marketing_campaigns")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async createCampaign(
    workspaceId: string,
    input: Omit<TablesInsert<"marketing_campaigns">, "workspace_id">,
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("marketing_campaigns")
      .insert({ ...input, workspace_id: workspaceId, owner_user_id: userId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    await marketingService.audit(workspaceId, {
      actor_user_id: userId ?? null,
      action: "campaign.created",
      entity_type: "campaign",
      entity_id: data.id,
      reason: data.objective,
    });
    await activityService.log(workspaceId, {
      entity_type: "campaign",
      entity_id: data.id,
      action: "marketing.campaign.created",
      detail: data.name,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async updateCampaign(
    campaign: Campaign,
    patch: TablesUpdate<"marketing_campaigns">,
    userId?: string,
    reason?: string,
  ) {
    const { data, error } = await supabase
      .from("marketing_campaigns")
      .update(patch)
      .eq("id", campaign.id)
      .select("*")
      .single();
    if (error) throw error;
    await marketingService.audit(campaign.workspace_id, {
      actor_user_id: userId ?? null,
      action: "campaign.updated",
      entity_type: "campaign",
      entity_id: campaign.id,
      reason: reason ?? null,
      metadata: patch as never,
    });
    return data;
  },

  async deleteCampaign(campaign: Campaign, userId?: string) {
    const { error } = await supabase
      .from("marketing_campaigns")
      .delete()
      .eq("id", campaign.id);
    if (error) throw error;
    await marketingService.audit(campaign.workspace_id, {
      actor_user_id: userId ?? null,
      action: "campaign.deleted",
      entity_type: "campaign",
      entity_id: campaign.id,
    });
  },

  /* -------------------------------------------------------------- budgets */

  async listAllocations(workspaceId: string): Promise<BudgetAllocation[]> {
    const { data, error } = await supabase
      .from("campaign_budget_allocations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data ?? [];
  },

  async saveAllocation(
    workspaceId: string,
    input: Omit<TablesInsert<"campaign_budget_allocations">, "workspace_id">,
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("campaign_budget_allocations")
      .insert({ ...input, workspace_id: workspaceId })
      .select("*")
      .single();
    if (error) throw error;
    await marketingService.audit(workspaceId, {
      actor_user_id: userId ?? null,
      action: "budget.allocated",
      entity_type: "budget",
      entity_id: data.id,
      metadata: { channel: data.channel, allocated: data.allocated } as never,
    });
    return data;
  },

  async updateAllocation(id: string, patch: TablesUpdate<"campaign_budget_allocations">) {
    const { data, error } = await supabase
      .from("campaign_budget_allocations")
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async deleteAllocation(id: string) {
    const { error } = await supabase.from("campaign_budget_allocations").delete().eq("id", id);
    if (error) throw error;
  },

  /**
   * Suggests a budget split across channels weighted by realised ROI, falling
   * back to an even split when a campaign has no measured return yet.
   */
  smartDistribution(total: number, allocations: BudgetAllocation[], revenueByChannel: Map<string, number>) {
    if (!allocations.length) return [];
    const weights = allocations.map((row) => {
      const revenue = revenueByChannel.get(row.channel) ?? 0;
      const spent = Number(row.spent) || 0;
      const roi = spent > 0 ? revenue / spent : 1;
      return Math.max(roi, 0.2);
    });
    const sum = weights.reduce((acc, value) => acc + value, 0);
    return allocations.map((row, index) => ({
      id: row.id,
      channel: row.channel,
      current: Number(row.allocated),
      suggested: Number(((weights[index]! / sum) * total).toFixed(2)),
    }));
  },

  /* ------------------------------------------------------ creative studio */

  async listCreativeRequests(workspaceId: string): Promise<CreativeRequest[]> {
    const { data, error } = await supabase
      .from("creative_requests")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  /** Opens a creative task and hands it to the specialised worker. */
  async requestCreative(
    workspaceId: string,
    input: {
      kind: CreativeKind;
      title: string;
      brief: string | null;
      campaignId: string | null;
      workerId: string | null;
      variantLabel?: string | null;
      parentRequestId?: string | null;
    },
    userId?: string,
  ) {
    const definition = CREATIVE_KIND_MAP.get(input.kind);
    const { data, error } = await supabase
      .from("creative_requests")
      .insert({
        workspace_id: workspaceId,
        campaign_id: input.campaignId,
        kind: input.kind,
        title: input.title,
        brief: input.brief,
        assigned_worker_id: input.workerId,
        variant_label: input.variantLabel ?? null,
        parent_request_id: input.parentRequestId ?? null,
        status: input.workerId ? "queued" : "draft",
        credit_cost: definition?.unitCost ?? 0,
        credit_type: definition?.creditType ?? "ai_credits",
        created_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    await marketingService.audit(workspaceId, {
      actor_user_id: userId ?? null,
      action: "creative.requested",
      entity_type: "creative_request",
      entity_id: data.id,
      reason: input.brief,
      metadata: { kind: input.kind, worker: input.workerId } as never,
    });
    await activityService.log(workspaceId, {
      entity_type: "creative_request",
      entity_id: data.id,
      action: "marketing.creative.requested",
      detail: `${input.kind} · ${input.title}`,
      result: "success",
      actor_id: userId ?? null,
    });
    return data;
  },

  async updateCreative(
    request: CreativeRequest,
    patch: TablesUpdate<"creative_requests">,
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("creative_requests")
      .update(patch)
      .eq("id", request.id)
      .select("*")
      .single();
    if (error) throw error;
    await marketingService.audit(request.workspace_id, {
      actor_user_id: userId ?? null,
      action: "creative.updated",
      entity_type: "creative_request",
      entity_id: request.id,
      metadata: patch as never,
    });
    return data;
  },

  /** Meters the creative task against the workspace ledger once it completes. */
  async completeCreative(
    request: CreativeRequest,
    output: Record<string, unknown>,
    durationMs: number,
    userId?: string,
  ) {
    const updated = await marketingService.updateCreative(
      request,
      { status: "review", output: output as never, duration_ms: durationMs },
      userId,
    );
    await billingService
      .recordUsage(request.workspace_id, {
        category: "worker",
        quantity: 1,
        unit: "asset",
        unit_cost: Number(request.credit_cost),
        total_cost: Number(request.credit_cost),
        reference_type: "creative_request",
        reference_id: request.id,
        metadata: { kind: request.kind, title: request.title } as never,
      })
      .catch(() => undefined);
    return updated;
  },

  async deleteCreative(request: CreativeRequest, userId?: string) {
    const { error } = await supabase.from("creative_requests").delete().eq("id", request.id);
    if (error) throw error;
    await marketingService.audit(request.workspace_id, {
      actor_user_id: userId ?? null,
      action: "creative.deleted",
      entity_type: "creative_request",
      entity_id: request.id,
    });
  },

  /* ------------------------------------------------------------- wallet */

  /** Derives burn rate and exhaustion forecast from metered usage records. */
  wallet(balances: CreditBalance[], usage: UsageRecord[], windowDays = 30): WalletMetrics[] {
    const since = Date.now() - windowDays * 86_400_000;
    const consumed = new Map<string, number>();
    for (const record of usage) {
      const at = new Date(record.occurred_on ?? record.created_at).getTime();
      if (at < since) continue;
      const key = record.category === "voice" ? "voice_minutes" : record.category === "storage" ? "storage" : record.category === "knowledge" ? "knowledge" : record.category === "api" || record.category === "integration" ? "integrations" : "ai_credits";
      consumed.set(key, (consumed.get(key) ?? 0) + Number(record.quantity));
    }

    return balances.map((balance) => {
      const granted = Number(balance.granted);
      const used = Number(balance.used);
      const remaining = granted - used;
      const windowUsed = consumed.get(balance.credit_type) ?? 0;
      const dailyBurn = Number((windowUsed / windowDays).toFixed(4));
      const monthlyBurn = Number((dailyBurn * 30).toFixed(2));
      const daysLeft = dailyBurn > 0 ? Math.floor(remaining / dailyBurn) : null;
      const exhaustionDate =
        daysLeft !== null && daysLeft >= 0
          ? new Date(Date.now() + daysLeft * 86_400_000).toISOString()
          : null;
      return {
        creditType: balance.credit_type,
        granted,
        used,
        remaining,
        dailyBurn,
        monthlyBurn,
        daysLeft,
        exhaustionDate,
      };
    });
  },

  /* ---------------------------------------------------------- transfers */

  async listTransfers(workspaceId: string): Promise<CreditTransfer[]> {
    const { data, error } = await supabase
      .from("credit_transfers")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  /** Moves credits between ledgers, applying the policy rate and fee. */
  async transferCredits(
    workspaceId: string,
    input: { from: CreditType; to: CreditType; amount: number; note?: string },
    userId?: string,
  ) {
    const preview = previewTransfer(input.from, input.to, input.amount);
    if (!preview) throw new Error("This transfer is not allowed by your plan policy.");

    await billingService.adjustCredits(
      workspaceId,
      input.from,
      input.amount,
      "consumption",
      `Transfer to ${input.to}`,
      userId,
    );
    await billingService.adjustCredits(
      workspaceId,
      input.to,
      preview.converted,
      "adjustment",
      `Transfer from ${input.from}`,
      userId,
    );

    const { data, error } = await supabase
      .from("credit_transfers")
      .insert({
        workspace_id: workspaceId,
        from_type: input.from,
        to_type: input.to,
        from_amount: input.amount,
        to_amount: preview.converted,
        rate: preview.rate,
        fee: preview.fee,
        status: "completed",
        note: input.note ?? null,
        created_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    await marketingService.audit(workspaceId, {
      actor_user_id: userId ?? null,
      action: "credits.transferred",
      entity_type: "credit_transfer",
      entity_id: data.id,
      reason: input.note ?? null,
      metadata: { from: input.from, to: input.to, amount: input.amount } as never,
    });
    return data;
  },

  /** Buys a credit pack: tops the ledger up and issues an invoice line. */
  async purchaseCredits(
    workspaceId: string,
    pack: { id: string; label: string; creditType: CreditType; amount: number; price: number },
    userId?: string,
  ) {
    await billingService.adjustCredits(
      workspaceId,
      pack.creditType,
      pack.amount,
      "purchase",
      pack.label,
      userId,
    );

    const number = `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(
      Math.random() * 9000 + 1000,
    )}`;
    const { data: invoice, error } = await supabase
      .from("invoices")
      .insert({
        workspace_id: workspaceId,
        number,
        status: "open",
        currency: "USD",
        subtotal: pack.price,
        total: pack.price,
        issued_at: new Date().toISOString(),
        created_by: userId ?? null,
      })
      .select("*")
      .single();
    if (error) throw error;

    await supabase.from("invoice_items").insert({
      workspace_id: workspaceId,
      invoice_id: invoice.id,
      description: pack.label,
      quantity: 1,
      unit_price: pack.price,
      amount: pack.price,
    });

    await marketingService.audit(workspaceId, {
      actor_user_id: userId ?? null,
      action: "credits.purchased",
      entity_type: "invoice",
      entity_id: invoice.id,
      metadata: { pack: pack.id, amount: pack.amount } as never,
    });
    return invoice;
  },

  /* ------------------------------------------------------------- alerts */

  async listAlerts(workspaceId: string): Promise<MarketingAlert[]> {
    const { data, error } = await supabase
      .from("marketing_alerts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return data ?? [];
  },

  async saveAlerts(workspaceId: string, alerts: Omit<TablesInsert<"marketing_alerts">, "workspace_id">[]) {
    if (!alerts.length) return [];
    const { data, error } = await supabase
      .from("marketing_alerts")
      .insert(alerts.map((alert) => ({ ...alert, workspace_id: workspaceId })))
      .select("*");
    if (error) throw error;
    return data ?? [];
  },

  async resolveAlert(alert: MarketingAlert, userId?: string) {
    const { error } = await supabase
      .from("marketing_alerts")
      .update({ resolved: true })
      .eq("id", alert.id);
    if (error) throw error;
    await marketingService.audit(alert.workspace_id, {
      actor_user_id: userId ?? null,
      action: "alert.resolved",
      entity_type: "alert",
      entity_id: alert.id,
    });
  },

  /* ---------------------------------------------------------- approvals */

  async listApprovals(workspaceId: string): Promise<ApprovalRequest[]> {
    const { data, error } = await supabase
      .from("approval_requests")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async requestApproval(
    workspaceId: string,
    input: Omit<TablesInsert<"approval_requests">, "workspace_id">,
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("approval_requests")
      .insert({ ...input, workspace_id: workspaceId, requested_by: userId ?? null })
      .select("*")
      .single();
    if (error) throw error;
    await marketingService.audit(workspaceId, {
      actor_user_id: userId ?? null,
      action: "approval.requested",
      entity_type: "approval",
      entity_id: data.id,
      reason: data.details,
    });
    return data;
  },

  async decideApproval(
    approval: ApprovalRequest,
    decision: "approve" | "reject",
    note: string | null,
    userId?: string,
  ) {
    const approved = decision === "approve" ? approval.levels_approved + 1 : approval.levels_approved;
    const status =
      decision === "reject"
        ? "rejected"
        : approved >= approval.levels_required
          ? "approved"
          : "pending";
    const { data, error } = await supabase
      .from("approval_requests")
      .update({ levels_approved: approved, status, decided_by: userId ?? null, decision_note: note })
      .eq("id", approval.id)
      .select("*")
      .single();
    if (error) throw error;
    await marketingService.audit(approval.workspace_id, {
      actor_user_id: userId ?? null,
      action: `approval.${decision}d`,
      entity_type: "approval",
      entity_id: approval.id,
      reason: note,
    });
    return data;
  },

  /* -------------------------------------------------------- brand memory */

  async getBrand(workspaceId: string): Promise<BrandProfile | null> {
    const { data, error } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  async saveBrand(
    workspaceId: string,
    patch: Omit<TablesInsert<"brand_profiles">, "workspace_id">,
    userId?: string,
  ) {
    const { data, error } = await supabase
      .from("brand_profiles")
      .upsert({ ...patch, workspace_id: workspaceId }, { onConflict: "workspace_id" })
      .select("*")
      .single();
    if (error) throw error;
    await marketingService.audit(workspaceId, {
      actor_user_id: userId ?? null,
      action: "brand.updated",
      entity_type: "brand_profile",
      entity_id: data.id,
    });
    return data;
  },
};
