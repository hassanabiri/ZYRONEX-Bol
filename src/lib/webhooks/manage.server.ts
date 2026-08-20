import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { deliverEvent } from "@/lib/webhooks/core";
import { createSupabaseWebhookStore } from "@/lib/webhooks/ingress.server";
import type { WebhookEndpointRecord, WebhookEventRecord } from "@/lib/webhooks/types";

/** Operator actions on stored webhook events (replay, dead-letter recovery). */

async function admin(): Promise<SupabaseClient<Database>> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin as unknown as SupabaseClient<Database>;
}

/**
 * Re-runs a stored event through the Execution Runtime.
 * The workspace filter is applied on the read, so an event id from another
 * tenant simply does not resolve.
 */
export async function replayEvent(workspaceId: string, eventId: string) {
  const client = await admin();
  const { data, error } = await client
    .from("webhook_events")
    .select("*")
    .eq("id", eventId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Webhook event not found");

  const row = data as Record<string, unknown>;
  const store = createSupabaseWebhookStore();
  const endpoint = await client
    .from("webhook_endpoints")
    .select("*")
    .eq("id", String(row["endpoint_id"]))
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!endpoint.data) throw new Error("Webhook endpoint not found");

  const record: WebhookEventRecord = {
    id: String(row["id"]),
    workspaceId,
    endpointId: String(row["endpoint_id"]),
    eventId: String(row["event_id"]),
    eventType: String(row["event_type"]),
    traceId: String(row["trace_id"]),
    // A manual replay always gets one fresh attempt budget.
    attempts: 0,
    maxAttempts: Number(row["max_attempts"] ?? 5),
    payload: row["payload"],
    status: "received",
  };

  const endpointRecord = await store.findEndpoint(String((endpoint.data as { slug: string }).slug));
  const target: WebhookEndpointRecord =
    endpointRecord ?? {
      id: record.endpointId,
      workspaceId,
      integrationId: null,
      workflowId: null,
      connector: String(row["connector"] ?? "http"),
      enabled: true,
      events: [],
      secret: null,
      replayWindowSeconds: 300,
      maxAttempts: record.maxAttempts,
    };

  const result = await deliverEvent(store, target, record);
  return result.body;
}
