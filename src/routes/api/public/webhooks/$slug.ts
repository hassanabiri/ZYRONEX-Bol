import { createFileRoute } from "@tanstack/react-router";

/**
 * Unified webhook ingress: `/api/public/webhooks/{slug}`.
 *
 * Every provider posts here. Verification, idempotency, persistence and the
 * hand-off to the Server Execution Runtime happen in the engine — this route
 * only moves bytes and returns a uniform, secret-free response body.
 */

const MAX_BODY_BYTES = 1_000_000;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const Route = createFileRoute("/api/public/webhooks/$slug")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES)
          return json(413, { ok: false, status: "rejected", error: "malformed_payload", message: "Payload too large" });

        const headers: Record<string, string> = {};
        request.headers.forEach((value, key) => {
          headers[key.toLowerCase()] = value;
        });

        try {
          const { receiveWebhook } = await import("@/lib/webhooks/ingress.server");
          const result = await receiveWebhook({ slug: params.slug, rawBody: raw, headers });
          return json(result.status, result.body);
        } catch {
          // Uniform failure: never surface stack traces or provider internals.
          return json(500, { ok: false, status: "rejected", message: "Webhook could not be processed" });
        }
      },
      GET: async () => json(405, { ok: false, status: "rejected", message: "Use POST" }),
    },
  },
});
