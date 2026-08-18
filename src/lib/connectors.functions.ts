import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Authenticated RPC surface for the connector layer.
 * Every call proves workspace membership through the caller's own RLS view
 * before any credential is touched, and only redacted results come back.
 */

export const listConnectorCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { describeConnectors } = await import("@/lib/connectors/registry");
    return describeConnectors();
  });

export const checkIntegrationHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ workspaceId: z.string().uuid(), integrationId: z.string().uuid() })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { assertCanExecute } = await import("@/lib/execution/guard.server");
    await assertCanExecute(context.supabase, data.workspaceId, context.userId);
    const { connectorHealth } = await import("@/lib/connectors/run.server");
    return connectorHealth({ workspaceId: data.workspaceId, integrationId: data.integrationId });
  });

export const runConnectorAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        integrationId: z.string().uuid().optional(),
        connectorId: z.string().max(64).optional(),
        operation: z.string().min(1).max(64),
        params: z.record(z.string(), z.unknown()).default({}),
        cursor: z.string().max(4096).nullable().default(null),
        maxPages: z.number().int().min(1).max(10).default(1),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { assertCanExecute } = await import("@/lib/execution/guard.server");
    await assertCanExecute(context.supabase, data.workspaceId, context.userId);
    const { invokeConnector } = await import("@/lib/connectors/run.server");
    return invokeConnector({
      workspaceId: data.workspaceId,
      ...(data.integrationId ? { integrationId: data.integrationId } : {}),
      ...(data.connectorId ? { connectorId: data.connectorId } : {}),
      operation: data.operation,
      params: data.params,
      cursor: data.cursor,
      maxPages: data.maxPages,
    });
  });
