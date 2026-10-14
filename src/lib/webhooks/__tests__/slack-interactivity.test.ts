import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { redact, redactString } from "@/lib/connectors/errors";
import { handleWebhook, parseSlackForm } from "@/lib/webhooks/core";
import { postSlackResponse, sealSlackResponseUrls } from "@/lib/webhooks/slack-response";
import type { WebhookEndpointRecord, WebhookStore } from "@/lib/webhooks/types";

/** Simulation only — no real Slack workspace is contacted. */

const SECRET = "slack-signing";
const now = 1_790_000_000;
const HOOK = "https://hooks.slack.com/commands/T1/123/abcSECRET";
const FORM = { "content-type": "application/x-www-form-urlencoded" };

function sign(raw: string, secret = SECRET, ts = now) {
  return {
    ...FORM,
    "x-slack-request-timestamp": String(ts),
    "x-slack-signature": `v0=${createHmac("sha256", secret).update(`v0:${ts}:${raw}`).digest("hex")}`,
  };
}
function endpoint(events: string[] = []): WebhookEndpointRecord {
  return { id: "ep", workspaceId: "ws", integrationId: null, workflowId: null, connector: "slack", enabled: true, events, secret: SECRET, replayWindowSeconds: 300, maxAttempts: 3 };
}
function store(opts: { insertFails?: boolean; execDelayMs?: number; execFails?: boolean } = {}) {
  const inserted: { eventId: string; payload: unknown }[] = [];
  const deliveries: unknown[] = [];
  const seen = new Set<string>();
  const s: WebhookStore = {
    findEndpoint: async () => endpoint(),
    insertEvent: async (row) => {
      if (opts.insertFails) throw new Error("db down");
      if (seen.has(row.eventId)) return { duplicate: true, id: "dup" };
      seen.add(row.eventId);
      inserted.push({ eventId: row.eventId, payload: row.payload });
      return { duplicate: false, id: `e${inserted.length}` };
    },
    updateEvent: async () => {},
    recordDelivery: async (r) => void deliveries.push(r),
    startExecution: async () => {
      if (opts.execDelayMs) await new Promise((r) => setTimeout(r, opts.execDelayMs));
      if (opts.execFails) throw new Error("runtime unavailable");
      return { executionId: "x" };
    },
  };
  return { s, inserted, deliveries };
}
const command = new URLSearchParams({ team_id: "T1", command: "/zy", text: "hi", trigger_id: "13345224609.738474920.8088930838d88f008e0", response_url: HOOK, user_id: "U1" }).toString();
const interaction = new URLSearchParams({
  payload: JSON.stringify({ type: "block_actions", team: { id: "T1" }, trigger_id: "tr-9", response_url: HOOK, actions: [{ action_id: "a", action_ts: "1.2" }] }),
}).toString();

describe("Slack slash commands & interactivity", () => {
  it("parses form fields and the interaction payload", () => {
    expect(parseSlackForm(command)["command"]).toBe("/zy");
    expect(parseSlackForm(interaction)["type"]).toBe("block_actions");
    expect(() => parseSlackForm("payload=%7Bnot")).toThrow();
  });

  it("acks a signed slash command with an empty 200 after persisting", async () => {
    const { s, inserted } = store();
    const res = await handleWebhook({ slug: "x", rawBody: command, headers: sign(command), store: s, nowMs: now * 1000 });
    expect(res.status).toBe(200);
    expect(res.raw?.body).toBe("");
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.eventId).toBe("command:T1:13345224609.738474920.8088930838d88f008e0");
  });

  it("acks a signed interaction and types it", async () => {
    const { s, inserted } = store();
    const res = await handleWebhook({ slug: "x", rawBody: interaction, headers: sign(interaction), store: s, nowMs: now * 1000 });
    expect(res.status).toBe(200);
    expect(inserted[0]!.eventId).toBe("interaction:T1:tr-9");
  });

  it("rejects a bad signature before parsing or persisting", async () => {
    const { s, inserted } = store();
    const res = await handleWebhook({ slug: "x", rawBody: command, headers: sign(command, "wrong"), store: s, nowMs: now * 1000 });
    expect(res.status).toBe(401);
    expect(res.raw).toBeUndefined();
    expect(inserted).toHaveLength(0);
  });

  it("rejects a tampered body (signature over raw bytes)", async () => {
    const { s } = store();
    const res = await handleWebhook({ slug: "x", rawBody: command.replace("hi", "ho"), headers: sign(command), store: s, nowMs: now * 1000 });
    expect(res.status).toBe(401);
  });

  it("rejects stale timestamps (replay)", async () => {
    const { s, inserted } = store();
    const res = await handleWebhook({ slug: "x", rawBody: command, headers: sign(command, SECRET, now - 600), store: s, nowMs: now * 1000 });
    expect(res.status).toBe(408);
    expect(inserted).toHaveLength(0);
  });

  it("rejects requests missing required fields", async () => {
    const { s, inserted } = store();
    const raw = new URLSearchParams({ team_id: "T1", command: "/zy" }).toString();
    const res = await handleWebhook({ slug: "x", rawBody: raw, headers: sign(raw), store: s, nowMs: now * 1000 });
    expect(res.body.ok).toBe(false);
    expect(inserted).toHaveLength(0);
  });

  it("deduplicates a resent request and still acks empty", async () => {
    const { s, inserted } = store();
    await handleWebhook({ slug: "x", rawBody: command, headers: sign(command), store: s, nowMs: now * 1000 });
    const again = await handleWebhook({ slug: "x", rawBody: command, headers: sign(command), store: s, nowMs: now * 1000 });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("duplicate");
    expect(inserted).toHaveLength(1);
  });

  it("does not send an ack when persistence fails", async () => {
    const { s } = store({ insertFails: true });
    await expect(handleWebhook({ slug: "x", rawBody: command, headers: sign(command), store: s, nowMs: now * 1000 })).rejects.toThrow();
  });

  it("acks inside Slack's 3 s window when execution start is slow", async () => {
    const { s } = store({ execDelayMs: 5000 });
    const t0 = Date.now();
    const res = await handleWebhook({ slug: "x", rawBody: command, headers: sign(command), store: s, nowMs: now * 1000 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(res.status).toBe(200);
    expect(res.raw?.body).toBe("");
  }, 8000);

  it("still acks (event kept for retry) when execution start fails", async () => {
    const { s } = store({ execFails: true });
    const res = await handleWebhook({ slug: "x", rawBody: command, headers: sign(command), store: s, nowMs: now * 1000 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("failed");
  });

  it("Events API JSON is unchanged", async () => {
    const { s } = store();
    const raw = JSON.stringify({ type: "event_callback", event_id: "Ev1", event: { type: "message" } });
    const { "content-type": _, ...headers } = sign(raw);
    const res = await handleWebhook({ slug: "x", rawBody: raw, headers: { ...headers, "content-type": "application/json" }, store: s, nowMs: now * 1000 });
    expect(res.status).toBe(202);
    expect(res.raw).toBeUndefined();
  });
});

describe("response_url protection", () => {
  it("seals response_url before persistence and drops non-Slack URLs", () => {
    const out = sealSlackResponseUrls({ response_url: HOOK, response_urls: [{ response_url: HOOK, block_id: "b" }] }, () => "SEALED") as Record<string, unknown>;
    expect(JSON.stringify(out)).not.toContain("hooks.slack.com");
    expect(out["response_url_sealed"]).toBe("SEALED");
    const evil = sealSlackResponseUrls({ response_url: "https://evil.example/x" }, () => "S") as Record<string, unknown>;
    expect(evil["response_url_sealed"]).toBeUndefined();
  });

  it("is redacted from logs and error strings", () => {
    expect(JSON.stringify(redact({ response_url: HOOK }))).not.toContain("hooks.slack.com");
    expect(redactString(`failed posting to ${HOOK}`)).not.toContain("abcSECRET");
  });

  it("posts the delayed reply to the official hook only", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string) => (calls.push(url), new Response("ok", { status: 200 }))) as unknown as typeof fetch;
    expect((await postSlackResponse({ responseUrl: HOOK, message: { text: "done" }, fetchImpl })).ok).toBe(true);
    expect((await postSlackResponse({ responseUrl: "https://evil.example/x", message: { text: "x" }, fetchImpl })).ok).toBe(false);
    expect(calls).toEqual([HOOK]);
  });

  it("never echoes the URL in a failure", async () => {
    const fetchImpl = (async () => { throw new Error(`connect ${HOOK} refused`); }) as unknown as typeof fetch;
    const r = await postSlackResponse({ responseUrl: HOOK, message: { text: "x" }, fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.error).not.toContain("abcSECRET");
  });
});
