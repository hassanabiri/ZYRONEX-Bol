import {
  ConnectorError,
  mapHttpStatus,
  readStandardRateLimit,
  redactString,
  scrubCredentialValues,
} from "@/lib/connectors/errors";
import type {
  ConnectorAdapter,
  ConnectorCall,
  ConnectorHealth,
  ConnectorOperationInput,
  ConnectorResult,
  NormalizeContext,
  NormalizedPage,
  RateLimitInfo,
} from "@/lib/connectors/types";

/**
 * Connector runtime core.
 *
 * Transport-level concerns live here once, for every provider: credential
 * validation, timeouts, retries with exponential backoff, rate-limit honouring,
 * pagination, response normalization and error mapping. Adapters only describe
 * *what* to call and *how to read* the answer.
 *
 * Deliberately dependency-injected (`fetchImpl`, `sleep`) so the contract is
 * testable without network access. No secret is ever logged or returned.
 */

export type ConnectorRunOptions = {
  adapter: ConnectorAdapter;
  credentials: Record<string, string>;
  input: ConnectorOperationInput;
  traceId: string;
  timeoutMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Redacted breadcrumb sink (integration_logs in production). */
  onEvent?: (event: ConnectorEvent) => void;
};

export type ConnectorEvent = {
  level: "info" | "warn" | "error";
  connector: string;
  operation: string;
  traceId: string;
  message: string;
  status?: number;
  attempt?: number;
  durationMs?: number;
};

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_BACKOFF_MS = 8_000;
const MAX_PAGES = 20;

export function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_BACKOFF_MS);
  const base = Math.min(MAX_BACKOFF_MS, 300 * 2 ** (attempt - 1));
  // Jitter is applied first, then capped, so the ceiling is never exceeded.
  return Math.min(MAX_BACKOFF_MS, Math.round(base * (0.75 + Math.random() * 0.5)));
}

function assertCredentials(adapter: ConnectorAdapter, credentials: Record<string, string>) {
  const missing = adapter.credentials.required.filter(
    (key) => !credentials[key] || String(credentials[key]).trim() === "",
  );
  if (missing.length > 0)
    throw new ConnectorError("auth", `Missing credentials: ${missing.join(", ")}`, { retryable: false });
}

function withQuery(call: ConnectorCall): string {
  if (!call.query) return call.url;
  const url = new URL(call.url);
  for (const [key, value] of Object.entries(call.query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function readPayload(response: Response): Promise<{ payload: unknown; text: string }> {
  const text = await response.text();
  if (!text) return { payload: null, text: "" };
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("json") || text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
    try {
      return { payload: JSON.parse(text) as unknown, text };
    } catch {
      throw new ConnectorError("malformed_response", "Provider returned malformed JSON", {
        status: response.status,
        retryable: false,
      });
    }
  }
  return { payload: text, text };
}

/** Single HTTP round-trip with timeout + provider error mapping. */
async function performCall(options: {
  call: ConnectorCall;
  adapter: ConnectorAdapter;
  credentials: Record<string, string>;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<{ payload: unknown; status: number; rateLimit: RateLimitInfo | undefined }> {
  const { adapter, call, credentials, fetchImpl, timeoutMs } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(withQuery(call), {
      method: call.method,
      headers: call.headers,
      ...(call.body === undefined
        ? {}
        : { body: typeof call.body === "string" ? call.body : JSON.stringify(call.body) }),
      signal: controller.signal,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (controller.signal.aborted || /abort/i.test(message))
      throw new ConnectorError("timeout", `Request timed out after ${timeoutMs}ms`);
    throw new ConnectorError("network", `Network failure: ${sanitize(message, credentials)}`);
  } finally {
    clearTimeout(timer);
  }

  const { payload, text } = await readPayload(response);
  const rateLimit = adapter.readRateLimit?.(response.headers, payload) ?? readStandardRateLimit(response.headers);

  const mapped = adapter.mapError?.(response.status, payload);
  if (mapped) {
    throw new ConnectorError(mapped.kind, sanitize(mapped.message, credentials), {
      status: response.status,
      ...(mapped.retryable === undefined ? {} : { retryable: mapped.retryable }),
    });
  }

  if (!response.ok) {
    const error = mapHttpStatus(response.status, sanitize(text.slice(0, 300), credentials));
    throw error;
  }

  return { payload, status: response.status, rateLimit };
}

function sanitize(text: string, credentials: Record<string, string>): string {
  return redactString(scrubCredentialValues(text, credentials));
}

function normalizeSafely(
  adapter: ConnectorAdapter,
  operation: string,
  payload: unknown,
  status: number,
  context: NormalizeContext,
): NormalizedPage {
  let page: NormalizedPage;
  try {
    page = adapter.normalize(operation, payload, status, context);
  } catch (error) {
    throw new ConnectorError(
      "malformed_response",
      `Response could not be normalized: ${error instanceof Error ? error.message : String(error)}`,
      { status, retryable: false },
    );
  }
  if (!page || !Array.isArray(page.items))
    throw new ConnectorError("malformed_response", "Adapter returned a non-conforming page", {
      status,
      retryable: false,
    });
  return page;
}

/**
 * Executes one connector operation end to end, following pagination up to
 * `maxPages`, retrying retryable failures with exponential backoff.
 */
export async function runConnectorOperation(options: ConnectorRunOptions): Promise<ConnectorResult> {
  const {
    adapter,
    credentials,
    input,
    traceId,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    fetchImpl = fetch,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    onEvent,
  } = options;

  const startedAt = Date.now();
  const emit = (event: Omit<ConnectorEvent, "connector" | "operation" | "traceId">) =>
    onEvent?.({ connector: adapter.id, operation: input.operation, traceId, ...event });

  let attempts = 0;
  const items: Record<string, unknown>[] = [];
  let pages = 0;
  let cursor = input.cursor ?? null;
  let lastStatus = 0;
  let lastRateLimit: RateLimitInfo | undefined;

  try {
    if (!adapter.operations.includes(input.operation))
      throw new ConnectorError("unsupported", `Operation "${input.operation}" is not supported by ${adapter.label}`, {
        retryable: false,
      });
    assertCredentials(adapter, credentials);

    const pageBudget = Math.min(Math.max(input.maxPages ?? 1, 1), MAX_PAGES);

    while (pages < pageBudget) {
      const call = adapter.authorize(adapter.buildCall({ ...input, cursor }), credentials);

      let outcome: Awaited<ReturnType<typeof performCall>> | null = null;
      let attempt = 0;
      // Retry loop is per page, so a rate limit mid-pagination does not lose work.
      for (;;) {
        attempt += 1;
        attempts += 1;
        try {
          outcome = await performCall({ adapter, call, credentials, timeoutMs, fetchImpl });
          break;
        } catch (error) {
          const failure =
            error instanceof ConnectorError
              ? error
              : new ConnectorError("provider", sanitize(String(error), credentials));
          if (!failure.retryable || attempt >= maxAttempts) throw failure;
          const delay = backoffMs(attempt, failure.kind === "rate_limit" ? lastRateLimit?.retryAfterMs : undefined);
          emit({
            level: "warn",
            message: `Attempt ${attempt} failed (${failure.kind}); retrying in ${delay}ms`,
            ...(failure.status === undefined ? {} : { status: failure.status }),
            attempt,
          });
          await sleep(delay);
        }
      }

      lastStatus = outcome!.status;
      lastRateLimit = outcome!.rateLimit ?? lastRateLimit;
      const page = normalizeSafely(adapter, input.operation, outcome!.payload, outcome!.status, { call, cursor });
      items.push(...page.items);
      pages += 1;
      cursor = page.cursor ?? null;

      if (!cursor) break;
      // Respect a provider that is close to its quota before the next page.
      if (lastRateLimit?.remaining === 0 && lastRateLimit.retryAfterMs)
        await sleep(Math.min(lastRateLimit.retryAfterMs, MAX_BACKOFF_MS));
    }

    const result: ConnectorResult = {
      ok: true,
      connector: adapter.id,
      operation: input.operation,
      items,
      cursor,
      pages,
      status: lastStatus,
      attempts,
      durationMs: Date.now() - startedAt,
      traceId,
      ...(lastRateLimit ? { rateLimit: lastRateLimit } : {}),
    };
    emit({ level: "info", message: `Completed with ${items.length} item(s)`, status: lastStatus, durationMs: result.durationMs });
    return result;
  } catch (error) {
    const failure =
      error instanceof ConnectorError ? error : new ConnectorError("provider", sanitize(String(error), credentials));
    const durationMs = Date.now() - startedAt;
    emit({
      level: "error",
      message: failure.message,
      ...(failure.status === undefined ? {} : { status: failure.status }),
      durationMs,
    });
    return {
      ok: false,
      connector: adapter.id,
      operation: input.operation,
      error: {
        kind: failure.kind,
        message: failure.message,
        ...(failure.status === undefined ? {} : { status: failure.status }),
        retryable: failure.retryable,
      },
      attempts,
      durationMs,
      traceId,
    };
  }
}

/** Contract-level health check: one cheap call through the same pipeline. */
export async function checkConnectorHealth(
  options: Omit<ConnectorRunOptions, "input"> & { operation?: string },
): Promise<ConnectorHealth> {
  const operation = options.operation ?? options.adapter.healthOperation ?? options.adapter.operations[0]!;
  const result = await runConnectorOperation({
    ...options,
    maxAttempts: 1,
    input: { operation, maxPages: 1 },
  });
  return result.ok
    ? {
        connector: options.adapter.id,
        healthy: true,
        status: result.status,
        latencyMs: result.durationMs,
        message: "Connection verified with the provider",
      }
    : {
        connector: options.adapter.id,
        healthy: false,
        ...(result.error.status === undefined ? {} : { status: result.error.status }),
        latencyMs: result.durationMs,
        message: result.error.message,
      };
}
