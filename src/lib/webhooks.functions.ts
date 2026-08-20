import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Authenticated management surface for the Webhook Engine.
 * The Integration Center UI is untouched; these functions exist so operators
 * can inspect, replay and drain events through the same RBAC rules as runs.
 */

export const listWebhookEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        status: z.string().max(32).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    // RLS scopes this read to the caller's workspaces.
    let query = context.supabase
      .from("webhook_events")
      .select(
        "id, endpoint_id, integration_id, execution_id, connector, event_id, event_type, trace_id, status, attempts, max_attempts, received_at, processed_at, error",
      )
      .eq("workspace_id", data.workspaceId)
      .order("received_at", { ascending: false })
      .limit(data.limit ?? 100);
    if (data.status) query = query.eq("status", data.status);
    const { data: rows, error } = await query;
    if (error) throw error;
    return rows ?? [];
  });

export const replayWebhookEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ workspaceId: z.string().uuid(), eventId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { assertCanExecute } = await import("@/lib/execution/guard.server");
    await assertCanExecute(context.supabase, data.workspaceId, context.userId);

    const { replayEvent } = await import("@/lib/webhooks/manage.server");
    return replayEvent(data.workspaceId, data.eventId);
  });

/** Drains the retry queue on demand (also safe to call from a scheduler later). */
export const runWebhookRetries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ workspaceId: z.string().uuid(), limit: z.number().int().min(1).max(100).optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { assertCanExecute } = await import("@/lib/execution/guard.server");
    await assertCanExecute(context.supabase, data.workspaceId, context.userId);

    const { runWebhookRetrySweep } = await import("@/lib/webhooks/ingress.server");
    return runWebhookRetrySweep(data.limit ?? 25);
  });
