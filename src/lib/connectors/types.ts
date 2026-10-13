/**
 * Connector contract.
 *
 * Every provider is an independent adapter that implements this contract; the
 * Server Execution Runtime never contains provider-specific logic. Adding a new
 * provider later (Salla, Zid, Shopify…) means adding one adapter file and
 * registering it — the runtime, dispatcher, lease, retry and idempotency layers
 * stay untouched.
 *
 * This module is client-safe: it holds types only, never credentials.
 */

export type ConnectorCapability =
  | "read"
  | "write"
  | "search"
  | "pagination"
  | "messaging"
  | "files"
  | "calendar"
  | "webhook"
  | "health_check";

export type ConnectorAuthKind = "none" | "api_key" | "bearer" | "basic" | "oauth2" | "custom";

/** Declares which vault fields an adapter needs. Values never leave the server. */
export type ConnectorCredentialSpec = {
  kind: ConnectorAuthKind;
  /** Vault keys that must be present before any request is attempted. */
  required: string[];
  optional?: string[];
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** A provider-agnostic HTTP call produced by an adapter. */
export type ConnectorCall = {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  /** Adapter hint: this operation returns a page of items. */
  paginated?: boolean;
};

export type ConnectorOperationInput = {
  operation: string;
  params?: Record<string, unknown>;
  /** Opaque page cursor produced by a previous normalized response. */
  cursor?: string | null;
  /** Caps how many pages the runtime will follow (default 1). */
  maxPages?: number;
};

export type RateLimitInfo = {
  limit?: number;
  remaining?: number;
  /** Milliseconds the runtime should wait before retrying. */
  retryAfterMs?: number;
  resetAt?: string;
};

/** Context handed to `normalize` so page-number providers can advance. */
export type NormalizeContext = {
  /** The authorized call that produced this payload. */
  call: ConnectorCall;
  /** Cursor that was used for this page (null on the first page). */
  cursor: string | null;
  /** Response headers of this page (optional, read-only; adapters may ignore). */
  headers?: Headers;
};

/** Adapter-normalized page: shape is identical for every provider. */
export type NormalizedPage = {
  items: Record<string, unknown>[];
  cursor?: string | null;
  raw?: unknown;
};

export type ConnectorErrorKind =
  | "auth"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "timeout"
  | "network"
  | "invalid_request"
  | "malformed_response"
  | "provider"
  | "unsupported";

export type ConnectorResult =
  | {
      ok: true;
      connector: string;
      operation: string;
      items: Record<string, unknown>[];
      cursor: string | null;
      pages: number;
      status: number;
      attempts: number;
      durationMs: number;
      rateLimit?: RateLimitInfo;
      traceId: string;
    }
  | {
      ok: false;
      connector: string;
      operation: string;
      error: { kind: ConnectorErrorKind; message: string; status?: number; retryable: boolean; retryAfterMs?: number };
      attempts: number;
      durationMs: number;
      traceId: string;
    };

export type ConnectorHealth = {
  connector: string;
  healthy: boolean;
  status?: number;
  latencyMs: number;
  message: string;
};

/**
 * A provider adapter. Only `id`, `label`, `capabilities`, `credentials` and
 * `buildCall` are mandatory; everything else has a sane default in the runtime.
 */
export type ConnectorAdapter = {
  id: string;
  label: string;
  capabilities: ConnectorCapability[];
  credentials: ConnectorCredentialSpec;
  operations: string[];
  /** Operation used by the runtime for `checkHealth`. */
  healthOperation?: string;
  /** Maps an operation + params (+ cursor) to a provider-agnostic HTTP call. */
  buildCall: (input: ConnectorOperationInput) => ConnectorCall;
  /** Injects credentials into the call. Runs on the server only. */
  authorize: (call: ConnectorCall, credentials: Record<string, string>) => ConnectorCall;
  /**
   * Converts a provider payload into the normalized page shape.
   * `context` carries the call that produced the payload plus the cursor that
   * was used, for providers that page by page number rather than by row id.
   * It is optional and purely additive — adapters may ignore it.
   */
  normalize: (operation: string, payload: unknown, status: number, context?: NormalizeContext) => NormalizedPage;
  /** Optional provider-specific error mapping (e.g. Slack's `ok:false` body). */
  mapError?: (
    status: number,
    payload: unknown,
  ) => { kind: ConnectorErrorKind; message: string; retryable?: boolean } | null;
  /** Optional provider-specific rate-limit header reading. */
  readRateLimit?: (headers: Headers, payload: unknown) => RateLimitInfo | undefined;
};
