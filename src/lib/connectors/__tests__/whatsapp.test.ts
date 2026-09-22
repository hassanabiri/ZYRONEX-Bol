import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { WHATSAPP_API_VERSION, whatsappConnector } from "@/lib/connectors/adapters/whatsapp";
import {
  normalizeWhatsAppMessage,
  normalizeWhatsAppStatus,
  normalizeWhatsAppWebhookEvent,
} from "@/lib/connectors/adapters/whatsapp-map";
import { checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { describeConnectors, getConnector } from "@/lib/connectors/registry";
import { verifyWebhook } from "@/lib/webhooks/verify";

/**
 * WhatsApp Business Cloud connector — production test suite.
 *
 * Covers the same contract Salla, Zid, Shopify and WooCommerce are held to:
 * authentication, messages, templates, media, message/delivery status,
 * contacts, replies, webhooks, duplicate events, idempotency, pagination, rate
 * limits, retries, error normalization, workspace isolation, secret redaction
 * and health checks.
 */

const trace = "trace-whatsapp";
const PHONE_ID = "109876543210987";
const WABA_ID = "102290000000001";
const creds = {
  access_token: "EAAG_permanent_secret_token",
  phone_number_id: PHONE_ID,
  business_account_id: WABA_ID,
};
const APP_SECRET = "meta-app-secret";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function run(
  input: Parameters<typeof runConnectorOperation>[0]["input"],
  fetchImpl: typeof fetch,
  credentials: Record<string, string> = creds,
  extra: Partial<Parameters<typeof runConnectorOperation>[0]> = {},
) {
  return runConnectorOperation({
    adapter: whatsappConnector,
    credentials,
    traceId: trace,
    input,
    fetchImpl,
    sleep: async () => {},
    ...extra,
  });
}

const SEND_OK = {
  messaging_product: "whatsapp",
  contacts: [{ input: "966555000111", wa_id: "966555000111" }],
  messages: [{ id: "wamid.SENT1", message_status: "accepted" }],
};

const INBOUND = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: WABA_ID,
      time: 1_790_000_000,
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "966920000000", phone_number_id: PHONE_ID },
            contacts: [{ profile: { name: "Hassan" }, wa_id: "966555000111" }],
            messages: [
              {
                from: "966555000111",
                id: "wamid.IN1",
                timestamp: "1790000000",
                type: "text",
                text: { body: "مرحبا" },
                context: { id: "wamid.SENT1" },
              },
            ],
          },
        },
      ],
    },
  ],
};

const STATUS_EVENT = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: WABA_ID,
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "966920000000", phone_number_id: PHONE_ID },
            statuses: [
              {
                id: "wamid.SENT1",
                status: "delivered",
                timestamp: "1790000100",
                recipient_id: "966555000111",
                conversation: { id: "conv-1", origin: { type: "service" } },
                pricing: { category: "service" },
              },
            ],
          },
        },
      ],
    },
  ],
};

function verifierInput(raw: string, headers: Record<string, string>) {
  return { raw, headers, payload: JSON.parse(raw) as unknown, secret: APP_SECRET, nowMs: Date.now(), replayWindowMs: 300_000 };
}

function sign(raw: string, secret = APP_SECRET) {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

/* ------------------------------------------------------------------ */
/* Registry & contract                                                */
/* ------------------------------------------------------------------ */

describe("whatsapp connector registration", () => {
  it("is registered under its id and official aliases", () => {
    expect(getConnector("whatsapp")?.id).toBe("whatsapp");
    expect(getConnector("whatsapp_cloud")?.id).toBe("whatsapp");
    expect(getConnector("whatsapp_business")?.id).toBe("whatsapp");
  });

  it("exposes capabilities without ever exposing credentials", () => {
    const described = describeConnectors().find((entry) => entry.id === "whatsapp");
    expect(described).toMatchObject({ label: "WhatsApp Business Cloud", authKind: "bearer" });
    expect(described?.capabilities).toContain("messaging");
    expect(described?.capabilities).toContain("pagination");
    expect(described?.capabilities).toContain("webhook");
    expect(described?.requiredCredentials).toEqual(["access_token", "phone_number_id"]);
    expect(JSON.stringify(described)).not.toContain("EAAG");
  });

  it("declares the official message, template, media and account operations", () => {
    for (const operation of [
      "send_message",
      "send_template",
      "send_reply",
      "mark_message_read",
      "get_media",
      "delete_media",
      "list_templates",
      "create_template",
      "delete_template",
      "list_phone_numbers",
      "get_phone_number",
      "get_business_profile",
      "update_business_profile",
      "list_subscribed_apps",
      "subscribe_app",
      "unsubscribe_app",
    ])
      expect(whatsappConnector.operations).toContain(operation);
  });

  it("contains no business logic: it only talks to the Graph API", () => {
    const source = whatsappConnector.buildCall.toString() + whatsappConnector.normalize.toString();
    expect(source).not.toMatch(/supabase|workspace|openai|gemini|agent/i);
  });
});

/* ------------------------------------------------------------------ */
/* Authentication                                                      */
/* ------------------------------------------------------------------ */

describe("whatsapp authentication", () => {
  it("sends the bearer token to the official Graph endpoint", async () => {
    let seenUrl = "";
    let seenAuth: string | null = null;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenAuth = new Headers(init?.headers).get("authorization");
      return jsonResponse(SEND_OK);
    });

    const result = await run(
      { operation: "send_message", params: { to: "966555000111", type: "text", text: { body: "hi" } } },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.ok).toBe(true);
    expect(seenUrl).toBe(`https://graph.facebook.com/${WHATSAPP_API_VERSION}/${PHONE_ID}/messages`);
    expect(seenAuth).toBe("Bearer EAAG_permanent_secret_token");
  });

  it("fails fast when the access token is missing", async () => {
    const fetchImpl = vi.fn();
    const result = await run({ operation: "get_phone_number" }, fetchImpl as unknown as typeof fetch, {
      phone_number_id: PHONE_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails fast when the phone number id is missing", async () => {
    const fetchImpl = vi.fn();
    const result = await run({ operation: "send_message", params: { to: "1", type: "text" } }, fetchImpl as unknown as typeof fetch, {
      access_token: "EAAG_x",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses a WABA-scoped operation when the business account id is missing", async () => {
    const fetchImpl = vi.fn();
    const result = await run({ operation: "list_templates" }, fetchImpl as unknown as typeof fetch, {
      access_token: "EAAG_x",
      phone_number_id: PHONE_ID,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("auth");
      expect(result.error.message).toContain("Business Account ID");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an identifier that is not a Meta numeric id", async () => {
    const fetchImpl = vi.fn();
    const result = await run({ operation: "get_phone_number" }, fetchImpl as unknown as typeof fetch, {
      access_token: "EAAG_x",
      phone_number_id: "../../me",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("accepts waba_id as the alternative business account credential", async () => {
    let seenUrl = "";
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse({ data: [] });
    });
    await run({ operation: "list_templates" }, fetchImpl as unknown as typeof fetch, {
      access_token: "EAAG_x",
      phone_number_id: PHONE_ID,
      waba_id: WABA_ID,
    });
    expect(seenUrl).toContain(`/${WABA_ID}/message_templates`);
  });

  it("maps an expired Meta token (code 190) to an auth error", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Session has expired", type: "OAuthException", code: 190 } }, { status: 401 }),
    );
    const result = await run({ operation: "get_phone_number" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("auth");
      expect(result.error.retryable).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Health check                                                        */
/* ------------------------------------------------------------------ */

describe("whatsapp health check", () => {
  it("verifies the connection through the phone number endpoint", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain(`/${PHONE_ID}`);
      return jsonResponse({ id: PHONE_ID, display_phone_number: "+966 92 000 0000", verified_name: "ZYRONEX", quality_rating: "GREEN" });
    });
    const health = await checkConnectorHealth({
      adapter: whatsappConnector,
      credentials: creds,
      traceId: trace,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(health).toMatchObject({ connector: "whatsapp", healthy: true, status: 200 });
  });

  it("reports an unhealthy connection without leaking the token", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Invalid OAuth access token EAAG_permanent_secret_token", code: 190 } }, { status: 401 }),
    );
    const health = await checkConnectorHealth({
      adapter: whatsappConnector,
      credentials: creds,
      traceId: trace,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(health.healthy).toBe(false);
    expect(health.message).not.toContain("EAAG_permanent_secret_token");
  });
});

/* ------------------------------------------------------------------ */
/* Sending messages                                                    */
/* ------------------------------------------------------------------ */

describe("whatsapp messages", () => {
  it("builds the official text message envelope", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(SEND_OK);
    });

    await run(
      { operation: "send_message", params: { to: "966555000111", type: "text", text: { body: "مرحبا" } } },
      fetchImpl as unknown as typeof fetch,
    );

    expect(body).toMatchObject({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "966555000111",
      type: "text",
      text: { body: "مرحبا" },
    });
  });

  it("normalizes the send receipt", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SEND_OK));
    const result = await run(
      { operation: "send_message", params: { to: "966555000111", type: "text", text: { body: "hi" } } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.items[0]).toMatchObject({
        object: "message_receipt",
        source: "whatsapp",
        id: "wamid.SENT1",
        status: "accepted",
        contact_wa_id: "966555000111",
      });
  });

  it("requires a recipient and a message type", async () => {
    const fetchImpl = vi.fn();
    const result = await run({ operation: "send_message", params: { type: "text" } }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_request");
      expect(result.error.message).toContain("`to` is required");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends a media message by link", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(SEND_OK);
    });
    await run(
      {
        operation: "send_message",
        params: { to: "966555000111", type: "image", image: { link: "https://cdn.example/p.jpg", caption: "New" } },
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(body["image"]).toMatchObject({ link: "https://cdn.example/p.jpg", caption: "New" });
  });

  it("sends an interactive message untouched", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(SEND_OK);
    });
    const interactive = { type: "button", body: { text: "Choose" }, action: { buttons: [] } };
    await run(
      { operation: "send_message", params: { to: "966555000111", type: "interactive", interactive } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(body["interactive"]).toEqual(interactive);
  });

  it("drops parameters the Cloud API does not define", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(SEND_OK);
    });
    await run(
      { operation: "send_message", params: { to: "1234567", type: "text", text: { body: "x" }, crm_lead_id: "L1" } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(body["crm_lead_id"]).toBeUndefined();
  });

  it("marks an inbound message as read", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ success: true });
    });
    const result = await run(
      { operation: "mark_message_read", params: { message_id: "wamid.IN1" } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(body).toMatchObject({ messaging_product: "whatsapp", status: "read", message_id: "wamid.IN1" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ success: true });
  });
});

/* ------------------------------------------------------------------ */
/* Replies                                                             */
/* ------------------------------------------------------------------ */

describe("whatsapp replies", () => {
  it("attaches the official reply context", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(SEND_OK);
    });
    await run(
      {
        operation: "send_reply",
        params: { to: "966555000111", type: "text", text: { body: "أهلاً" }, reply_to_message_id: "wamid.IN1" },
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(body["context"]).toEqual({ message_id: "wamid.IN1" });
  });

  it("keeps an explicit context object as provided", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(SEND_OK);
    });
    await run(
      {
        operation: "send_reply",
        params: {
          to: "966555000111",
          type: "text",
          text: { body: "x" },
          reply_to_message_id: "wamid.IN1",
          context: { message_id: "wamid.OTHER" },
        },
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(body["context"]).toEqual({ message_id: "wamid.OTHER" });
  });

  it("requires the message being replied to", async () => {
    const fetchImpl = vi.fn();
    const result = await run(
      { operation: "send_reply", params: { to: "966555000111", type: "text" } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("reply_to_message_id");
  });
});

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

describe("whatsapp templates", () => {
  it("forces the template type on a template send", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(SEND_OK);
    });
    await run(
      {
        operation: "send_template",
        params: {
          to: "966555000111",
          template: { name: "order_update", language: { code: "ar" }, components: [] },
        },
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(body).toMatchObject({ type: "template", messaging_product: "whatsapp" });
    expect(body["template"]).toMatchObject({ name: "order_update" });
  });

  it("lists templates from the business account and normalizes them", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain(`/${WABA_ID}/message_templates`);
      return jsonResponse({
        data: [{ id: "T1", name: "order_update", language: "ar", category: "UTILITY", status: "APPROVED", components: [] }],
      });
    });
    const result = await run({ operation: "list_templates" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.items[0]).toMatchObject({
        object: "message_template",
        source: "whatsapp",
        name: "order_update",
        status: "APPROVED",
      });
  });

  it("creates a template with the documented fields", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({ id: "T2", status: "PENDING", category: "UTILITY" });
    });
    const result = await run(
      {
        operation: "create_template",
        params: { name: "shipping_update", language: "ar", category: "UTILITY", components: [{ type: "BODY", text: "..." }] },
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(body).toMatchObject({ name: "shipping_update", category: "UTILITY" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ id: "T2", status: "PENDING" });
  });

  it("deletes a template by name through the query string", async () => {
    let seenUrl = "";
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      expect(init?.method).toBe("DELETE");
      return jsonResponse({ success: true });
    });
    await run({ operation: "delete_template", params: { name: "shipping_update" } }, fetchImpl as unknown as typeof fetch);
    expect(seenUrl).toContain("name=shipping_update");
  });

  it("rejects a template rejection error as a non-retryable request problem", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Template name already exists", code: 100, error_subcode: 2388023 } }, { status: 400 }),
    );
    const result = await run(
      { operation: "create_template", params: { name: "dup", language: "ar", category: "UTILITY", components: [] } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("invalid_request");
      expect(result.error.retryable).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

describe("whatsapp media", () => {
  it("reads media metadata and normalizes it", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("/MEDIA123");
      return jsonResponse({
        id: "MEDIA123",
        url: "https://lookaside.fbsbx.com/whatsapp/MEDIA123",
        mime_type: "image/jpeg",
        sha256: "abc",
        file_size: 20481,
        messaging_product: "whatsapp",
      });
    });
    const result = await run({ operation: "get_media", params: { media_id: "MEDIA123" } }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.items[0]).toMatchObject({
        object: "media",
        source: "whatsapp",
        id: "MEDIA123",
        mime_type: "image/jpeg",
        file_size: 20481,
      });
  });

  it("deletes media", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe("DELETE");
      return jsonResponse({ success: true });
    });
    const result = await run({ operation: "delete_media", params: { media_id: "MEDIA123" } }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
  });

  it("maps an unknown media id to not_found", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "Unsupported get request", code: 100, error_subcode: 33 } }, { status: 404 }),
    );
    const result = await run({ operation: "get_media", params: { media_id: "nope" } }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("not_found");
  });

  it("requires a media id", async () => {
    const fetchImpl = vi.fn();
    const result = await run({ operation: "get_media" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("media_id");
  });
});

/* ------------------------------------------------------------------ */
/* Account, profile and webhook subscriptions                          */
/* ------------------------------------------------------------------ */

describe("whatsapp business account", () => {
  it("lists the phone numbers of the business account", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [{ id: PHONE_ID, display_phone_number: "+966 92 000 0000", verified_name: "ZYRONEX", quality_rating: "GREEN" }],
      }),
    );
    const result = await run({ operation: "list_phone_numbers" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.items[0]).toMatchObject({ object: "phone_number", verified_name: "ZYRONEX" });
  });

  it("reads and updates the business profile", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("whatsapp_business_profile");
      return jsonResponse({ data: [{ about: "ZYRONEX" }], success: true });
    });
    expect((await run({ operation: "get_business_profile" }, fetchImpl as unknown as typeof fetch)).ok).toBe(true);
    expect(
      (await run({ operation: "update_business_profile", params: { about: "ZYRONEX AI" } }, fetchImpl as unknown as typeof fetch)).ok,
    ).toBe(true);
  });

  it("subscribes and unsubscribes the app for webhook delivery", async () => {
    const methods: (string | undefined)[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toContain(`/${WABA_ID}/subscribed_apps`);
      methods.push(init?.method);
      return jsonResponse({ success: true, data: [] });
    });
    await run({ operation: "subscribe_app" }, fetchImpl as unknown as typeof fetch);
    await run({ operation: "unsubscribe_app" }, fetchImpl as unknown as typeof fetch);
    expect(methods).toEqual(["POST", "DELETE"]);
  });
});

/* ------------------------------------------------------------------ */
/* Pagination                                                          */
/* ------------------------------------------------------------------ */

describe("whatsapp pagination", () => {
  it("follows Graph cursor pagination up to the page budget", async () => {
    let call = 0;
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      call += 1;
      seen.push(String(url));
      return call === 1
        ? jsonResponse({
            data: [{ id: "T1", name: "a" }],
            paging: { cursors: { after: "CURSOR1" }, next: "https://graph.facebook.com/next" },
          })
        : jsonResponse({ data: [{ id: "T2", name: "b" }], paging: { cursors: { after: "CURSOR2" } } });
    });

    const result = await run({ operation: "list_templates", maxPages: 5 }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(2);
      expect(result.pages).toBe(2);
      expect(result.cursor).toBeNull();
    }
    expect(seen[1]).toContain("after=CURSOR1");
  });

  it("stops when Graph returns no next link", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ id: "T1" }], paging: { cursors: { after: "END" } } }));
    const result = await run({ operation: "list_templates", maxPages: 5 }, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (result.ok) expect(result.cursor).toBeNull();
  });

  it("applies the requested page size", async () => {
    let seenUrl = "";
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      seenUrl = String(url);
      return jsonResponse({ data: [] });
    });
    await run({ operation: "list_templates", params: { limit: 5 } }, fetchImpl as unknown as typeof fetch);
    expect(seenUrl).toContain("limit=5");
  });
});

/* ------------------------------------------------------------------ */
/* Rate limits, retries and backoff                                    */
/* ------------------------------------------------------------------ */

describe("whatsapp rate limits and retries", () => {
  it("reads the business use case usage header", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(SEND_OK, {
        headers: {
          "x-business-use-case-usage": JSON.stringify({
            [WABA_ID]: [{ type: "whatsapp", call_count: 90, estimated_time_to_regain_access: 0 }],
          }),
        },
      }),
    );
    const result = await run(
      { operation: "send_message", params: { to: "1", type: "text", text: { body: "x" } } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rateLimit).toMatchObject({ limit: 100, remaining: 10 });
  });

  it("survives a malformed quota header", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SEND_OK, { headers: { "x-business-use-case-usage": "not-json" } }));
    const result = await run(
      { operation: "send_message", params: { to: "1", type: "text", text: { body: "x" } } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(true);
  });

  it("retries a throttled send and succeeds", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ error: { message: "Rate limit hit", code: 130429 } }, { status: 429, headers: { "retry-after": "1" } })
        : jsonResponse(SEND_OK);
    });
    const result = await run(
      { operation: "send_message", params: { to: "1", type: "text", text: { body: "x" } } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(call).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.attempts).toBe(2);
  });

  it("treats the application-level rate limit code as retryable even on 400", async () => {
    const mapped = whatsappConnector.mapError?.(400, { error: { message: "too many calls", code: 4 } });
    expect(mapped).toMatchObject({ kind: "rate_limit", retryable: true });
  });

  it("retries a Graph 500 and gives up after the attempt budget", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "Temporary failure", code: 1 } }, { status: 500 }));
    const result = await run(
      { operation: "send_message", params: { to: "1", type: "text", text: { body: "x" } } },
      fetchImpl as unknown as typeof fetch,
      creds,
      { maxAttempts: 3 },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("provider");
  });

  it("does not retry a non-retryable failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "Bad parameter", code: 100 } }, { status: 400 }));
    const result = await run(
      { operation: "send_message", params: { to: "1", type: "text", text: { body: "x" } } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });

  it("maps a timeout", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("The operation was aborted");
    });
    const result = await run({ operation: "get_phone_number" }, fetchImpl as unknown as typeof fetch, creds, {
      maxAttempts: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("timeout");
  });
});

/* ------------------------------------------------------------------ */
/* Error normalization                                                 */
/* ------------------------------------------------------------------ */

describe("whatsapp error normalization", () => {
  const cases: { status: number; code: number; kind: string }[] = [
    { status: 401, code: 190, kind: "auth" },
    { status: 403, code: 10, kind: "forbidden" },
    { status: 404, code: 803, kind: "not_found" },
    { status: 400, code: 100, kind: "invalid_request" },
    { status: 429, code: 80007, kind: "rate_limit" },
    { status: 500, code: 2, kind: "provider" },
  ];

  for (const entry of cases)
    it(`maps HTTP ${entry.status} / code ${entry.code} to ${entry.kind}`, async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "x", code: entry.code } }, { status: entry.status }));
      const result = await run({ operation: "get_phone_number" }, fetchImpl as unknown as typeof fetch, creds, {
        maxAttempts: 1,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe(entry.kind);
    });

  it("treats an error envelope returned with HTTP 200 as a failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: "Unsupported request", code: 100 } }));
    const result = await run({ operation: "get_phone_number" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_request");
  });

  it("rejects an unsupported operation before any call", async () => {
    const fetchImpl = vi.fn();
    const result = await run({ operation: "send_carrier_pigeon" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unsupported");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a malformed list response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ unexpected: true }));
    const result = await run({ operation: "list_templates" }, fetchImpl as unknown as typeof fetch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed_response");
  });

  it("rejects an empty response body", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    const result = await run(
      { operation: "send_message", params: { to: "1", type: "text", text: { body: "x" } } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("malformed_response");
  });
});

/* ------------------------------------------------------------------ */
/* Idempotency                                                         */
/* ------------------------------------------------------------------ */

describe("whatsapp idempotency", () => {
  it("carries the runtime key on the official callback data field", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(SEND_OK);
    });
    await run(
      {
        operation: "send_message",
        params: { to: "1", type: "text", text: { body: "x" }, idempotency_key: "exec-42:node-7" },
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(body["biz_opaque_callback_data"]).toBe("exec-42:node-7");
  });

  it("never overrides callback data the caller already set", async () => {
    let body: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(SEND_OK);
    });
    await run(
      {
        operation: "send_message",
        params: { to: "1", type: "text", text: { body: "x" }, idempotency_key: "k1", biz_opaque_callback_data: "k2" },
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(body["biz_opaque_callback_data"]).toBe("k2");
  });

  it("produces an identical request for an identical send", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return jsonResponse(SEND_OK);
    });
    const input = {
      operation: "send_message",
      params: { to: "1", type: "text", text: { body: "x" }, idempotency_key: "same-key" },
    };
    await run(input, fetchImpl as unknown as typeof fetch);
    await run(input, fetchImpl as unknown as typeof fetch);
    expect(bodies[0]).toBe(bodies[1]);
  });
});

/* ------------------------------------------------------------------ */
/* Webhooks                                                            */
/* ------------------------------------------------------------------ */

describe("whatsapp webhooks", () => {
  it("accepts a correctly signed inbound message", () => {
    const raw = JSON.stringify(INBOUND);
    const outcome = verifyWebhook("whatsapp", verifierInput(raw, { "x-hub-signature-256": sign(raw) }));
    expect(outcome).toMatchObject({ ok: true, eventId: "wamid.IN1", eventType: "message.received" });
  });

  it("rejects a tampered payload", () => {
    const raw = JSON.stringify(INBOUND);
    const outcome = verifyWebhook(
      "whatsapp",
      verifierInput(raw, { "x-hub-signature-256": sign(JSON.stringify({ ...INBOUND, object: "other" })) }),
    );
    expect(outcome).toMatchObject({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a delivery signed with another app secret", () => {
    const raw = JSON.stringify(INBOUND);
    const outcome = verifyWebhook("whatsapp", verifierInput(raw, { "x-hub-signature-256": sign(raw, "other-secret") }));
    expect(outcome.ok).toBe(false);
  });

  it("rejects a delivery with no signature header", () => {
    const raw = JSON.stringify(INBOUND);
    expect(verifyWebhook("whatsapp", verifierInput(raw, {})).reason).toBe("invalid_signature");
  });

  it("reports a missing app secret instead of accepting the delivery", () => {
    const raw = JSON.stringify(INBOUND);
    const outcome = verifyWebhook("whatsapp", {
      ...verifierInput(raw, { "x-hub-signature-256": sign(raw) }),
      secret: null,
    });
    expect(outcome).toMatchObject({ ok: false, reason: "missing_secret" });
  });

  it("derives a stable event id for a status delivery", () => {
    const raw = JSON.stringify(STATUS_EVENT);
    const outcome = verifyWebhook("whatsapp", verifierInput(raw, { "x-hub-signature-256": sign(raw) }));
    expect(outcome).toMatchObject({ ok: true, eventType: "message.status" });
    expect(outcome.eventId).toBe("wamid.SENT1:delivered:1790000100");
  });

  it("gives a redelivered event the same id, so the engine deduplicates it", () => {
    const raw = JSON.stringify(INBOUND);
    const first = verifyWebhook("whatsapp", verifierInput(raw, { "x-hub-signature-256": sign(raw) }));
    const second = verifyWebhook("whatsapp", verifierInput(raw, { "x-hub-signature-256": sign(raw) }));
    expect(first.eventId).toBe(second.eventId);
  });

  it("distinguishes the sent, delivered and read statuses of one message", () => {
    const ids = ["sent", "delivered", "read"].map((status) => {
      const payload = JSON.parse(JSON.stringify(STATUS_EVENT)) as typeof STATUS_EVENT;
      const target = payload.entry[0]!.changes[0]!.value.statuses![0]!;
      target.status = status;
      const raw = JSON.stringify(payload);
      return verifyWebhook("whatsapp", verifierInput(raw, { "x-hub-signature-256": sign(raw) })).eventId;
    });
    expect(new Set(ids).size).toBe(3);
  });

  it("is resolved through the registry aliases too", () => {
    const raw = JSON.stringify(INBOUND);
    expect(verifyWebhook("whatsapp_cloud", verifierInput(raw, { "x-hub-signature-256": sign(raw) })).ok).toBe(true);
  });

  it("normalizes an inbound message envelope", () => {
    const event = normalizeWhatsAppWebhookEvent(INBOUND);
    expect(event).toMatchObject({
      event: "message.received",
      field: "messages",
      business_account_id: WABA_ID,
      phone_number_id: PHONE_ID,
    });
    expect(event.contacts[0]).toMatchObject({ object: "contact", wa_id: "966555000111", name: "Hassan", phone: "+966555000111" });
    expect(event.messages[0]).toMatchObject({
      object: "message",
      direction: "inbound",
      from: "966555000111",
      type: "text",
      text: "مرحبا",
      reply_to: "wamid.SENT1",
      to: "966920000000",
    });
    expect(event.messages[0]?.timestamp).toBe(new Date(1_790_000_000 * 1000).toISOString());
  });

  it("normalizes a delivery/read status envelope", () => {
    const event = normalizeWhatsAppWebhookEvent(STATUS_EVENT);
    expect(event.event).toBe("message.status");
    expect(event.statuses[0]).toMatchObject({
      object: "message_status",
      message_id: "wamid.SENT1",
      status: "delivered",
      recipient: "966555000111",
      conversation_id: "conv-1",
      pricing_category: "service",
    });
  });

  it("normalizes a media message and an interactive reply", () => {
    const media = normalizeWhatsAppMessage({
      id: "wamid.M1",
      from: "966555000111",
      type: "image",
      timestamp: "1790000000",
      image: { id: "MEDIA123", mime_type: "image/jpeg", sha256: "abc", caption: "فاتورة" },
    });
    expect(media.media).toMatchObject({ id: "MEDIA123", mime_type: "image/jpeg" });
    expect(media.text).toBe("فاتورة");

    const interactive = normalizeWhatsAppMessage({
      id: "wamid.M2",
      from: "966555000111",
      type: "interactive",
      interactive: { type: "button_reply", button_reply: { id: "yes", title: "نعم" } },
    });
    expect(interactive.text).toBe("نعم");
  });

  it("surfaces webhook-level errors without inventing a message", () => {
    const event = normalizeWhatsAppWebhookEvent({
      entry: [{ id: WABA_ID, changes: [{ field: "messages", value: { errors: [{ code: 131026, title: "Undeliverable" }] } }] }],
    });
    expect(event.messages).toHaveLength(0);
    expect(event.errors[0]).toMatchObject({ code: "131026", title: "Undeliverable" });
  });

  it("normalizes a failed status with its error details", () => {
    const status = normalizeWhatsAppStatus({
      id: "wamid.F1",
      status: "failed",
      recipient_id: "966555000111",
      timestamp: "1790000200",
      errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "Outside 24h window" } }],
    });
    expect(status.status).toBe("failed");
    expect(status.errors[0]).toMatchObject({ code: "131047", details: "Outside 24h window" });
  });

  it("tolerates an empty envelope instead of throwing", () => {
    expect(normalizeWhatsAppWebhookEvent({}).messages).toEqual([]);
    expect(normalizeWhatsAppWebhookEvent(null).statuses).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* Workspace isolation & secret redaction                              */
/* ------------------------------------------------------------------ */

describe("whatsapp workspace isolation and redaction", () => {
  it("sends each workspace's request with its own number and its own token", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return jsonResponse(SEND_OK);
    });

    const params = { to: "1", type: "text", text: { body: "x" } };
    await run({ operation: "send_message", params }, fetchImpl as unknown as typeof fetch);
    await run({ operation: "send_message", params }, fetchImpl as unknown as typeof fetch, {
      access_token: "EAAG_other_workspace",
      phone_number_id: "200000000000001",
    });

    expect(seen[0]?.url).toContain(PHONE_ID);
    expect(seen[1]?.url).toContain("200000000000001");
    expect(seen[0]?.auth).not.toBe(seen[1]?.auth);
  });

  it("never returns the access token in a result", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SEND_OK));
    const result = await run(
      { operation: "send_message", params: { to: "1", type: "text", text: { body: "x" } } },
      fetchImpl as unknown as typeof fetch,
    );
    expect(JSON.stringify(result)).not.toContain("EAAG_permanent_secret_token");
  });

  it("scrubs the token out of a network error message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connect failed using EAAG_permanent_secret_token");
    });
    const result = await run({ operation: "get_phone_number" }, fetchImpl as unknown as typeof fetch, creds, {
      maxAttempts: 1,
    });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("EAAG_permanent_secret_token");
  });

  it("keeps the trace id on every logged breadcrumb", async () => {
    const events: { traceId: string; level: string }[] = [];
    const fetchImpl = vi.fn(async () => jsonResponse(SEND_OK));
    await run(
      { operation: "send_message", params: { to: "1", type: "text", text: { body: "x" } } },
      fetchImpl as unknown as typeof fetch,
      creds,
      { onEvent: (event) => events.push({ traceId: event.traceId, level: event.level }) },
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.traceId === trace)).toBe(true);
  });

  it("logs a warning breadcrumb when a throttled call is retried", async () => {
    let call = 0;
    const events: string[] = [];
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1 ? jsonResponse({ error: { code: 130429, message: "throttled" } }, { status: 429 }) : jsonResponse(SEND_OK);
    });
    await run(
      { operation: "send_message", params: { to: "1", type: "text", text: { body: "x" } } },
      fetchImpl as unknown as typeof fetch,
      creds,
      { onEvent: (event) => events.push(event.level) },
    );
    expect(events).toContain("warn");
  });
});
