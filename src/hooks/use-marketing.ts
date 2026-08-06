import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { billingKeys } from "@/hooks/use-billing";
import { useAuth } from "@/lib/auth";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import type { CreditType } from "@/lib/billing/catalog";
import type { CreativeKind } from "@/lib/marketing/catalog";
import {
  marketingService,
  type ApprovalRequest,
  type Campaign,
  type CreativeRequest,
  type MarketingAlert,
} from "@/services/marketing-service";

export const marketingKeys = {
  campaigns: (id: string) => ["workspace", id, "marketing-campaigns"] as const,
  allocations: (id: string) => ["workspace", id, "marketing-allocations"] as const,
  creatives: (id: string) => ["workspace", id, "creative-requests"] as const,
  transfers: (id: string) => ["workspace", id, "credit-transfers"] as const,
  alerts: (id: string) => ["workspace", id, "marketing-alerts"] as const,
  approvals: (id: string) => ["workspace", id, "approval-requests"] as const,
  brand: (id: string) => ["workspace", id, "brand-profile"] as const,
  audit: (id: string) => ["workspace", id, "marketing-audit"] as const,
};

export function useCampaigns(workspaceId: string | undefined) {
  return useQuery({
    queryKey: marketingKeys.campaigns(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => marketingService.listCampaigns(workspaceId!),
  });
}

export function useBudgetAllocations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: marketingKeys.allocations(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => marketingService.listAllocations(workspaceId!),
  });
}

export function useCreativeRequests(workspaceId: string | undefined) {
  return useQuery({
    queryKey: marketingKeys.creatives(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => marketingService.listCreativeRequests(workspaceId!),
  });
}

export function useCreditTransfers(workspaceId: string | undefined) {
  return useQuery({
    queryKey: marketingKeys.transfers(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => marketingService.listTransfers(workspaceId!),
  });
}

export function useMarketingAlerts(workspaceId: string | undefined) {
  return useQuery({
    queryKey: marketingKeys.alerts(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => marketingService.listAlerts(workspaceId!),
  });
}

export function useApprovals(workspaceId: string | undefined) {
  return useQuery({
    queryKey: marketingKeys.approvals(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => marketingService.listApprovals(workspaceId!),
  });
}

export function useBrandProfile(workspaceId: string | undefined) {
  return useQuery({
    queryKey: marketingKeys.brand(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => marketingService.getBrand(workspaceId!),
  });
}

export function useMarketingAudit(workspaceId: string | undefined) {
  return useQuery({
    queryKey: marketingKeys.audit(workspaceId ?? "none"),
    enabled: Boolean(workspaceId),
    queryFn: () => marketingService.listAudit(workspaceId!),
  });
}

export function useMarketingMutations(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const id = workspaceId ?? "";
  const invalidate = (key: readonly unknown[]) =>
    queryClient.invalidateQueries({ queryKey: key as unknown[] });

  return {
    createCampaign: useMutation({
      mutationFn: (input: Omit<TablesInsert<"marketing_campaigns">, "workspace_id">) =>
        marketingService.createCampaign(id, input, user?.id),
      onSuccess: () => invalidate(marketingKeys.campaigns(id)),
    }),
    updateCampaign: useMutation({
      mutationFn: (input: {
        campaign: Campaign;
        patch: TablesUpdate<"marketing_campaigns">;
        reason?: string;
      }) => marketingService.updateCampaign(input.campaign, input.patch, user?.id, input.reason),
      onSuccess: () => invalidate(marketingKeys.campaigns(id)),
    }),
    deleteCampaign: useMutation({
      mutationFn: (campaign: Campaign) => marketingService.deleteCampaign(campaign, user?.id),
      onSuccess: () => invalidate(marketingKeys.campaigns(id)),
    }),
    saveAllocation: useMutation({
      mutationFn: (input: Omit<TablesInsert<"campaign_budget_allocations">, "workspace_id">) =>
        marketingService.saveAllocation(id, input, user?.id),
      onSuccess: () => invalidate(marketingKeys.allocations(id)),
    }),
    updateAllocation: useMutation({
      mutationFn: (input: { id: string; patch: TablesUpdate<"campaign_budget_allocations"> }) =>
        marketingService.updateAllocation(input.id, input.patch),
      onSuccess: () => invalidate(marketingKeys.allocations(id)),
    }),
    deleteAllocation: useMutation({
      mutationFn: (allocationId: string) => marketingService.deleteAllocation(allocationId),
      onSuccess: () => invalidate(marketingKeys.allocations(id)),
    }),
    requestCreative: useMutation({
      mutationFn: (input: {
        kind: CreativeKind;
        title: string;
        brief: string | null;
        campaignId: string | null;
        workerId: string | null;
        variantLabel?: string | null;
        parentRequestId?: string | null;
      }) => marketingService.requestCreative(id, input, user?.id),
      onSuccess: () => invalidate(marketingKeys.creatives(id)),
    }),
    updateCreative: useMutation({
      mutationFn: (input: {
        request: CreativeRequest;
        patch: TablesUpdate<"creative_requests">;
      }) => marketingService.updateCreative(input.request, input.patch, user?.id),
      onSuccess: () => invalidate(marketingKeys.creatives(id)),
    }),
    deleteCreative: useMutation({
      mutationFn: (request: CreativeRequest) => marketingService.deleteCreative(request, user?.id),
      onSuccess: () => invalidate(marketingKeys.creatives(id)),
    }),
    transferCredits: useMutation({
      mutationFn: (input: { from: CreditType; to: CreditType; amount: number; note?: string }) =>
        marketingService.transferCredits(id, input, user?.id),
      onSuccess: () => {
        invalidate(marketingKeys.transfers(id));
        invalidate(billingKeys.balances(id));
        invalidate(billingKeys.transactions(id));
      },
    }),
    purchaseCredits: useMutation({
      mutationFn: (pack: {
        id: string;
        label: string;
        creditType: CreditType;
        amount: number;
        price: number;
      }) => marketingService.purchaseCredits(id, pack, user?.id),
      onSuccess: () => {
        invalidate(billingKeys.balances(id));
        invalidate(billingKeys.transactions(id));
        invalidate(billingKeys.invoices(id));
      },
    }),
    saveAlerts: useMutation({
      mutationFn: (alerts: Omit<TablesInsert<"marketing_alerts">, "workspace_id">[]) =>
        marketingService.saveAlerts(id, alerts),
      onSuccess: () => invalidate(marketingKeys.alerts(id)),
    }),
    resolveAlert: useMutation({
      mutationFn: (alert: MarketingAlert) => marketingService.resolveAlert(alert, user?.id),
      onSuccess: () => invalidate(marketingKeys.alerts(id)),
    }),
    requestApproval: useMutation({
      mutationFn: (input: Omit<TablesInsert<"approval_requests">, "workspace_id">) =>
        marketingService.requestApproval(id, input, user?.id),
      onSuccess: () => invalidate(marketingKeys.approvals(id)),
    }),
    decideApproval: useMutation({
      mutationFn: (input: {
        approval: ApprovalRequest;
        decision: "approve" | "reject";
        note: string | null;
      }) => marketingService.decideApproval(input.approval, input.decision, input.note, user?.id),
      onSuccess: () => invalidate(marketingKeys.approvals(id)),
    }),
    saveBrand: useMutation({
      mutationFn: (patch: Omit<TablesInsert<"brand_profiles">, "workspace_id">) =>
        marketingService.saveBrand(id, patch, user?.id),
      onSuccess: () => invalidate(marketingKeys.brand(id)),
    }),
  };
}
