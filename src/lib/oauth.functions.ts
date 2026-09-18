import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Authenticated RPC surface for OAuth and connected accounts.
 * Membership is proven through the caller's own RLS view before any credential
 * is touched, and no response ever carries token material.
 */

const workspaceInput = z.object({ workspaceId: z.string().uuid() });

export const listOAuthProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { describeOAuthProviders } = await import("@/lib/oauth/providers");
    return describeOAuthProviders();
  });

export const listConnectionAccounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => workspaceInput.parse(data))
  .handler(async ({ data, context }) => {
    const { assertCanExecute } = await import("@/lib/execution/guard.server");
    await assertCanExecute(context.supabase, data.workspaceId, context.userId);
    const { listConnectionAccountsFor } = await import("@/lib/oauth/accounts.server");
    return listConnectionAccountsFor(data.workspaceId);
  });

export const startOAuthConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    workspaceInput
      .extend({
        connector: z.string().min(1).max(64),
        provider: z.string().min(1).max(64).optional(),
        integrationId: z.string().uuid().nullable().default(null),
        scopes: z.array(z.string().max(200)).max(50).optional(),
        // Connector-specific start values (e.g. Shopify's store domain).
        params: z.record(z.string(), z.string().max(255)).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { assertCanExecute } = await import("@/lib/execution/guard.server");
    await assertCanExecute(context.supabase, data.workspaceId, context.userId);
    const request = getRequest();
    const origin = new URL(request.url).origin;
    const { startAuthorization } = await import("@/lib/oauth/flow.server");
    return startAuthorization({
      workspaceId: data.workspaceId,
      connector: data.connector,
      integrationId: data.integrationId,
      origin,
      userId: context.userId,
      ...(data.provider ? { provider: data.provider } : {}),
      ...(data.scopes ? { scopes: data.scopes } : {}),
      ...(data.params ? { params: data.params } : {}),
    });
  });

export const disconnectConnectionAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => workspaceInput.extend({ accountId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { assertCanExecute } = await import("@/lib/execution/guard.server");
    await assertCanExecute(context.supabase, data.workspaceId, context.userId);
    const { disconnectConnection } = await import("@/lib/oauth/flow.server");
    return disconnectConnection(data.workspaceId, data.accountId);
  });

export const verifyConnectionAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => workspaceInput.extend({ accountId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { assertCanExecute } = await import("@/lib/execution/guard.server");
    await assertCanExecute(context.supabase, data.workspaceId, context.userId);
    const { verifyConnection } = await import("@/lib/oauth/flow.server");
    return verifyConnection(data.workspaceId, data.accountId);
  });
