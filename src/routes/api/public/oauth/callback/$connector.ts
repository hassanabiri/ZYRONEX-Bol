import { createFileRoute } from "@tanstack/react-router";

/**
 * Unified OAuth callback for every connector.
 *
 * Public by necessity (the provider redirects the browser here), but it trusts
 * nothing from the query string: the workspace, integration and redirect URI
 * all come from the single-use state row stored at authorize time.
 */

function page(title: string, message: string, ok: boolean) {
  const safe = (value: string) => value.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] ?? c);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safe(title)}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;background:#0b1120;color:#e2e8f0;display:grid;place-items:center;height:100vh;margin:0}
.card{max-width:26rem;padding:2rem;border-radius:1rem;background:#111c33;border:1px solid #1e293b;text-align:center}
h1{font-size:1.1rem;margin:0 0 .5rem;color:${ok ? "#22d3ee" : "#f87171"}}p{margin:0;color:#94a3b8;font-size:.9rem}</style>
</head><body><div class="card"><h1>${safe(title)}</h1><p>${safe(message)}</p></div>
<script>try{window.opener&&window.opener.postMessage({type:"zyronex:oauth",ok:${ok ? "true" : "false"}},window.location.origin);setTimeout(function(){window.close()},1200)}catch(e){}</script>
</body></html>`;
}

export const Route = createFileRoute("/api/public/oauth/callback/$connector")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const { handleOAuthCallback } = await import("@/lib/oauth/flow.server");
        const outcome = await handleOAuthCallback({
          connector: params.connector,
          state: url.searchParams.get("state"),
          code: url.searchParams.get("code"),
          error: url.searchParams.get("error"),
        });
        return new Response(
          page(outcome.ok ? "Connected" : "Connection failed", outcome.message, outcome.ok),
          {
            status: outcome.ok ? 200 : 400,
            headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
          },
        );
      },
    },
  },
});
