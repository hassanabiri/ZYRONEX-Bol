import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { deliverEvent, handleWebhook, processWebhookRetries, retryDelayMs } from "@/lib/webhooks/core";
import { safeHeaders } from "@/lib/webhooks/ingress.server";
import type { WebhookEndpointRecord, WebhookEventRecord, WebhookStore } from "@/lib/webhooks/types";

const SECRET = "whsec_test_secret_value";

function endpoint(overrides: Partial<WebhookEndpointRecord> = {}): WebhookEndpointRecord {
  return {
    id: "ep-1",
    workspaceId: "ws-1",
    integrationId: "int-1",
    workflowId: "wf-1",
    connector: "http",
    enabled: true,
    events: [],
    secret: SECRET,
    replayWindowSeconds: 300,
    maxAttempts: 3,
    ...overrides,
  };
}

type Recorded = { events: Record<string, unknown>[]; deliveries: Record<string, unknown>[]; updates: Record<string, unknown>[] };

function makeStore(options: {
  endpoints: Record<string, WebhookEndpointRecord>;
  execution?: (input: { event: WebhookEventRecord }) => Promise<{ executionId: string } | null>;
}): WebhookStore & { recorded: Recorded } {
  const recorded: Recorded = { events: [], deliveries: [], updates: [] };
  const seen = new Set<string>();
  let counter = 0;
  return {
    recorded,
    findEndpoint: async (slug) => options.endpoints[slug] ?? null,
    insertEvent: async (row) => {
      const key = `${row.endpointId}:${row.eventId}`;
      if (seen.has(key)) return { duplicate: true, id: key };
      seen.add(key);
      recorded.events.push(row as unknown as Record<string, unknown>);
      counter += 1;
      return { duplicate: false, id: `event-${counter}` };
    },
    updateEvent: async (id, patch) => {
      recorded.updates.push({ id, ...patch });
    },
    recordDelivery: async (row) => {
      recorded.deliveries.push(row as unknown as Record<string, unknown>);
    },
    startExecution: async (input) =>
      options.execution ? options.execution(input) : { executionId: "exec-1" },
  };
}

function signed(body: string, at = Date.now()) {
  const t = Math.floor(at / 1000);
  const v1 = createHmac("sha256", SECRET).update(`${t}.${body}`).digest("hex");
  return { "x-zyronex-signature": `t=${t},v1=${v1}`, "content-type": "application/json" };
}

describe("webhook ingress", () => {
  it("accepts a valid signed webhook and starts an execution", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "order.created" });
    const store = makeStore({ endpoints: { "orders-in": endpoint() } });

    const res = await handleWebhook({ slug: "orders-in", rawBody: body, headers: signed(body), store });

    expect(res.status).toBe(202);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe("processed");
    expect(store.recorded.events[0]?.["eventType"]).toBe("order.created");
    expect(store.recorded.deliveries[0]?.["success"]).toBe(true);
  });

  it("rejects a missing signature without touching storage", async () => {
    const body = JSON.stringify({ id: "evt_2" });
    const store = makeStore({ endpoints: { "orders-in": endpoint() } });

    const res = await handleWebhook({ slug: "orders-in", rawBody: body, headers: {}, store });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_signature");
    expect(store.recorded.events).toHaveLength(0);
  });

  it("rejects a signature that does not match the body", async () => {
    const store = makeStore({ endpoints: { "orders-in": endpoint() } });
    const headers = signed(JSON.stringify({ id: "evt_3" }));

    const res = await handleWebhook({ slug: "orders-in", rawBody: JSON.stringify({ id: "tampered" }), headers, store });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_signature");
  });

  it("blocks a replayed timestamp outside the window", async () => {
    const body = JSON.stringify({ id: "evt_4" });
    const store = makeStore({ endpoints: { "orders-in": endpoint() } });
    const headers = signed(body, Date.now() - 60 * 60 * 1000);

    const res = await handleWebhook({ slug: "orders-in", rawBody: body, headers, store });

    expect(res.status).toBe(408);
    expect(res.body.error).toBe("replay");
    expect(store.recorded.events).toHaveLength(0);
  });

  it("is idempotent: the same event id is never processed twice", async () => {
    const body = JSON.stringify({ id: "evt_5", type: "order.paid" });
    const store = makeStore({ endpoints: { "orders-in": endpoint() } });
    const headers = signed(body);

    const first = await handleWebhook({ slug: "orders-in", rawBody: body, headers, store });
    const second = await handleWebhook({ slug: "orders-in", rawBody: body, headers, store });

    expect(first.body.status).toBe("processed");
    expect(second.body.status).toBe("duplicate");
    expect(store.recorded.events).toHaveLength(1);
  });

  it("rejects a malformed payload only after the signature passes", async () => {
    const raw = "{not-json";
    const store = makeStore({ endpoints: { "orders-in": endpoint() } });

    const res = await handleWebhook({ slug: "orders-in", rawBody: raw, headers: signed(raw), store });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("malformed_payload");
  });

  it("keeps an unknown slug indistinguishable from another workspace's slug", async () => {
    const body = JSON.stringify({ id: "evt_6" });
    const store = makeStore({ endpoints: { "tenant-a": endpoint({ workspaceId: "ws-a" }) } });

    const res = await handleWebhook({ slug: "tenant-b", rawBody: body, headers: signed(body), store });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("unknown_endpoint");
    expect(res.body.message).toBe("Webhook endpoint not found");
  });

  it("marks a failed execution for retry and dead-letters it when attempts run out", async () => {
    const store = makeStore({
      endpoints: {},
      execution: async () => {
        throw new Error("runtime unavailable");
      },
    });
    const record: WebhookEventRecord = {
      id: "event-1",
      workspaceId: "ws-1",
      endpointId: "ep-1",
      eventId: "evt_7",
      eventType: "order.created",
      traceId: "trace-1",
      attempts: 0,
      maxAttempts: 2,
      payload: {},
      status: "received",
    };

    const first = await deliverEvent(store, endpoint(), record);
    expect(first.body.status).toBe("failed");

    const second = await deliverEvent(store, endpoint(), { ...record, attempts: 1 });
    expect(second.body.status).toBe("dead_letter");
  });

  it("dead-letters immediately when the failure is not retryable", async () => {
    const store = makeStore({
      endpoints: {},
      execution: async () => {
        const error = new Error("workflow missing");
        (error as { retryable?: boolean }).retryable = false;
        throw error;
      },
    });

    const res = await deliverEvent(store, endpoint(), {
      id: "event-2",
      workspaceId: "ws-1",
      endpointId: "ep-1",
      eventId: "evt_8",
      eventType: "order.created",
      traceId: "trace-2",
      attempts: 0,
      maxAttempts: 5,
      payload: {},
      status: "received",
    });

    expect(res.body.status).toBe("dead_letter");
  });

  it("retries due events through the sweep", async () => {
    const store = makeStore({ endpoints: {} });
    const due: (WebhookEventRecord & { endpoint: WebhookEndpointRecord })[] = [
      {
        id: "event-3",
        workspaceId: "ws-1",
        endpointId: "ep-1",
        eventId: "evt_9",
        eventType: "order.created",
        traceId: "trace-3",
        attempts: 1,
        maxAttempts: 5,
        payload: {},
        status: "failed",
        endpoint: endpoint(),
      },
    ];
    const withDue: WebhookStore = { ...store, dueEvents: async () => due };

    const report = await processWebhookRetries(withDue, 10);
    expect(report).toEqual({ retried: 1, processed: 1, deadLettered: 0 });
  });

  it("uses bounded exponential backoff", () => {
    expect(retryDelayMs(1)).toBeGreaterThanOrEqual(24_000);
    expect(retryDelayMs(20)).toBeLessThanOrEqual(3_600_000 * 1.2);
  });

  it("never stores credential-bearing headers", () => {
    const stored = safeHeaders({
      Authorization: "Bearer super-secret-token",
      "X-Zyronex-Signature": "t=1,v1=abc",
      "X-Api-Key": "key_live_123",
      "content-type": "application/json",
    });

    expect(stored["authorization"]).toBe("[redacted]");
    expect(stored["x-zyronex-signature"]).toBe("[redacted]");
    expect(stored["x-api-key"]).toBe("[redacted]");
    expect(stored["content-type"]).toBe("application/json");
    expect(JSON.stringify(stored)).not.toContain("super-secret-token");
  });

  it("verifies Slack signatures and its replay window", async () => {
    const body = JSON.stringify({ event_id: "Ev1", event: { type: "message" } });
    const ts = Math.floor(Date.now() / 1000);
    const sig = `v0=${createHmac("sha256", SECRET).update(`v0:${ts}:${body}`).digest("hex")}`;
    const store = makeStore({ endpoints: { slack: endpoint({ connector: "slack" }) } });

    const ok = await handleWebhook({
      slug: "slack",
      rawBody: body,
      headers: { "x-slack-signature": sig, "x-slack-request-timestamp": String(ts) },
      store,
    });
    expect(ok.body.status).toBe("processed");

    const stale = await handleWebhook({
      slug: "slack",
      rawBody: body,
      headers: { "x-slack-signature": sig, "x-slack-request-timestamp": String(ts - 4000) },
      store,
    });
    expect(stale.body.error).toBe("replay");
  });
});
