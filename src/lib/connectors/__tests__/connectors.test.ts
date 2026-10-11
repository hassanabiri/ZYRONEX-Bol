import { describe, expect, it, vi } from "vitest";

import { googleConnector } from "@/lib/connectors/adapters/google";
import { httpConnector } from "@/lib/connectors/adapters/http";
import { slackConnector } from "@/lib/connectors/adapters/slack";
import { backoffMs, checkConnectorHealth, runConnectorOperation } from "@/lib/connectors/core";
import { redact, scrubCredentialValues } from "@/lib/connectors/errors";
import { getConnector, describeConnectors } from "@/lib/connectors/registry";

const trace = "trace-test";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

describe("registry", () => {
  it("resolves reference adapters and aliases", () => {
    expect(getConnector("http")?.id).toBe("http");
    expect(getConnector("slack")?.id).toBe("slack");
    expect(getConnector("gmail")?.id).toBe("google");
    expect(getConnector("nope")).toBeUndefined();
  });

  it("never exposes credential values in the client-safe descriptor", () => {
    // Field *names* such as `consumer_secret` are part of the public contract;
    // what must never appear is a credential value.
    const described = JSON.stringify(describeConnectors()).replace(/"[a-z_]*(secret|password)[a-z_]*"/gi, '""');
    expect(described).not.toMatch(/secret|password|xoxb/i);
  });
});

describe("http connector", () => {
  it("rejects non-https targets", async () => {
    const result = await runConnectorOperation({
      adapter: httpConnector,
      credentials: {},
      traceId: trace,
      input: { operation: "request", params: { url: "http://insecure.dev" } },
      fetchImpl: vi.fn(),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("invalid_request");
  });

  it("sends bearer credentials without leaking them into results", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer super-secret");
      return jsonResponse({ data: [{ id: 1 }] });
    }) as unknown as typeof fetch;

    const result = await runConnectorOperation({
      adapter: httpConnector,
      credentials: { bearer_token: "super-secret" },
      traceId: trace,
      input: { operation: "request", params: { url: "https://api.example.com/items" } },
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("super-secret");
  });
});

describe("slack connector", () => {
  it("treats ok:false bodies as errors", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: false, error: "invalid_auth" })) as unknown as typeof fetch;
    const result = await runConnectorOperation({
      adapter: slackConnector,
      credentials: { access_token: "xoxb-token" },
      traceId: trace,
      input: { operation: "post_message", params: { channel: "C1", text: "hi" } },
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("auth");
      expect(result.error.retryable).toBe(false);
    }
  });

  it("follows cursor pagination up to the page budget", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ ok: true, channels: [{ id: "C1" }], response_metadata: { next_cursor: "abc" } })
        : jsonResponse({ ok: true, channels: [{ id: "C2" }], response_metadata: { next_cursor: "" } });
    }) as unknown as typeof fetch;

    const result = await runConnectorOperation({
      adapter: slackConnector,
      credentials: { access_token: "xoxb-token" },
      traceId: trace,
      input: { operation: "list_channels", maxPages: 5 },
      fetchImpl,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items).toHaveLength(2);
      expect(result.pages).toBe(2);
      expect(result.cursor).toBeNull();
    }
  });

  it("retries rate limits and honours retry-after", async () => {
    let call = 0;
    const fetchImpl = vi.fn(async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ ok: false, error: "ratelimited" }, { status: 429, headers: { "retry-after": "1" } })
        : jsonResponse({ ok: true, ts: "1.2" });
    }) as unknown as typeof fetch;

    const result = await runConnectorOperation({
      adapter: slackConnector,
      credentials: { access_token: "xoxb-token" },
      traceId: trace,
      input: { operation: "post_message", params: { channel: "C1", text: "hi" } },
      fetchImpl,
      sleep: async () => undefined,
    });

    expect(call).toBe(2);
    expect(result.ok).toBe(true);
  });

  it("health check uses auth.test", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      expect(String(url)).toContain("auth.test");
      return jsonResponse({ ok: true, user: "zyronex" });
    }) as unknown as typeof fetch;

    const health = await checkConnectorHealth({
      adapter: slackConnector,
      credentials: { access_token: "xoxb-token" },
      traceId: trace,
      fetchImpl,
    });
    expect(health.healthy).toBe(true);
  });
});

describe("google connector", () => {
  it("maps the google error envelope", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { code: 403, message: "Insufficient permission", status: "PERMISSION_DENIED" } }, { status: 403 }),
    ) as unknown as typeof fetch;

    const result = await runConnectorOperation({
      adapter: googleConnector,
      credentials: { access_token: "ya29.token" },
      traceId: trace,
      input: { operation: "list_files" },
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("forbidden");
  });

  it("normalizes pageToken pagination", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ files: [{ id: "f1" }], nextPageToken: "next" }),
    ) as unknown as typeof fetch;

    const result = await runConnectorOperation({
      adapter: googleConnector,
      credentials: { access_token: "ya29.token" },
      traceId: trace,
      input: { operation: "list_files", maxPages: 1 },
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cursor).toBe("next");
  });
});

describe("contract guarantees", () => {
  it("fails fast when required credentials are missing", async () => {
    const result = await runConnectorOperation({
      adapter: slackConnector,
      credentials: {},
      traceId: trace,
      input: { operation: "list_channels" },
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("auth");
  });

  it("backoff grows and stays capped", () => {
    expect(backoffMs(1)).toBeLessThan(backoffMs(6) + 1);
    expect(backoffMs(20)).toBeLessThanOrEqual(8000);
  });

  it("redacts secrets from logs and errors", () => {
    expect(scrubCredentialValues("token=abc123", { access_token: "abc123" })).not.toContain("abc123");
    expect(JSON.stringify(redact({ access_token: "abc123", nested: { password: "p" } }))).not.toContain("abc123");
  });
});

describe("optional response headers in normalize context", () => {
  it("passes headers to adapters without changing existing results", async () => {
    let seen: Headers | undefined;
    const adapter = { ...httpConnector, normalize: (op: string, payload: unknown, status: number, ctx?: { headers?: Headers }) => {
      seen = ctx?.headers;
      return httpConnector.normalize(op, payload, status);
    } };
    const fetchImpl = vi.fn(async () => jsonResponse({ data: [{ id: 1 }] }, { headers: { "x-test": "1" } })) as unknown as typeof fetch;
    const result = await runConnectorOperation({ adapter, credentials: {}, traceId: trace, input: { operation: "request", params: { url: "https://api.example.com" } }, fetchImpl });
    expect(seen?.get("x-test")).toBe("1");
    expect(result.ok && result.items).toEqual([{ id: 1 }]);
  });
});
