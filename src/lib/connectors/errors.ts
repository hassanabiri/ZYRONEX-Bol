import type { ConnectorErrorKind, RateLimitInfo } from "@/lib/connectors/types";

/** Uniform connector failure. Never carries credential material. */
export class ConnectorError extends Error {
  readonly kind: ConnectorErrorKind;
  readonly status: number | undefined;
  readonly retryable: boolean;
  /** Provider-requested wait (Retry-After / retry_after) carried by the failed response. */
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: ConnectorErrorKind,
    message: string,
    options: { status?: number; retryable?: boolean; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "ConnectorError";
    this.kind = kind;
    this.status = options.status;
    this.retryable = options.retryable ?? DEFAULT_RETRYABLE.has(kind);
    this.retryAfterMs = options.retryAfterMs;
  }
}

const DEFAULT_RETRYABLE = new Set<ConnectorErrorKind>(["rate_limit", "timeout", "network", "provider"]);

/** Default HTTP → connector error mapping shared by every adapter. */
export function mapHttpStatus(status: number, snippet: string): ConnectorError {
  if (status === 401) return new ConnectorError("auth", `Authentication failed (401): ${snippet}`, { status, retryable: false });
  if (status === 403) return new ConnectorError("forbidden", `Access denied (403): ${snippet}`, { status, retryable: false });
  if (status === 404) return new ConnectorError("not_found", `Resource not found (404): ${snippet}`, { status, retryable: false });
  if (status === 408) return new ConnectorError("timeout", `Provider timed out (408): ${snippet}`, { status });
  if (status === 429) return new ConnectorError("rate_limit", `Rate limited (429): ${snippet}`, { status });
  if (status >= 500) return new ConnectorError("provider", `Provider error (${status}): ${snippet}`, { status });
  if (status >= 400)
    return new ConnectorError("invalid_request", `Request rejected (${status}): ${snippet}`, {
      status,
      retryable: false,
    });
  return new ConnectorError("provider", `Unexpected status ${status}: ${snippet}`, { status });
}

/** Reads the standard rate-limit headers most providers emit. */
export function readStandardRateLimit(headers: Headers): RateLimitInfo | undefined {
  const retryAfter = headers.get("retry-after");
  const limit = headers.get("x-ratelimit-limit") ?? headers.get("ratelimit-limit");
  const remaining = headers.get("x-ratelimit-remaining") ?? headers.get("ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset") ?? headers.get("ratelimit-reset");
  if (!retryAfter && !limit && !remaining && !reset) return undefined;

  const info: RateLimitInfo = {};
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) info.retryAfterMs = Math.max(0, seconds) * 1000;
  }
  if (limit && Number.isFinite(Number(limit))) info.limit = Number(limit);
  if (remaining && Number.isFinite(Number(remaining))) info.remaining = Number(remaining);
  if (reset) info.resetAt = reset;
  return info;
}

const SECRET_KEY_PATTERN =
  /(authorization|api[-_]?key|apikey|token|secret|password|passwd|credential|signature|bearer|client[-_]?secret|refresh[-_]?token)/i;

/**
 * Removes anything that could carry a secret before a value is logged.
 * Applied to every log line and to error snippets, so credentials can never
 * reach `integration_logs`, the browser, or an execution step payload.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[truncated]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redact(item, depth + 1);
    }
    return out;
  }
  return value;
}

const INLINE_SECRET = /\b(?:Bearer|Basic)\s+[\w\-._~+/=]+/gi;
const LONG_TOKEN = /\b(?:sk|xox[abporsu]|ya29|ghp|glpat|zx)[-_][A-Za-z0-9\-._~+/=]{8,}\b/g;

export function redactString(input: string): string {
  return input.replace(INLINE_SECRET, "[redacted]").replace(LONG_TOKEN, "[redacted]").slice(0, 2000);
}

/** Strips any credential values that happen to appear verbatim in a string. */
export function scrubCredentialValues(text: string, credentials: Record<string, string>): string {
  let out = text;
  for (const value of Object.values(credentials)) {
    if (value && value.length >= 6) out = out.split(value).join("[redacted]");
  }
  return out;
}
