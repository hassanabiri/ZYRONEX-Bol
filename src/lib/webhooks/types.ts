/**
 * Webhook Engine — client-safe contracts.
 *
 * One unified ingress serves every connector. A provider never gets its own
 * webhook system: it only contributes a verifier (see `verify.ts`), exactly the
 * way it contributes an adapter to the Connector Architecture.
 */

export type WebhookFailureReason =
  | "unknown_endpoint"
  | "disabled"
  | "missing_secret"
  | "invalid_signature"
  | "replay"
  | "malformed_payload"
  | "unsupported_event";

export type WebhookEventStatus =
  | "received"
  | "queued"
  | "processing"
  | "processed"
  | "failed"
  | "dead_letter"
  | "discarded";

/** Result of a connector-specific verification pass. Never carries the secret. */
export type WebhookVerification = {
  ok: boolean;
  reason?: WebhookFailureReason | undefined;
  message?: string | undefined;
  eventId?: string | undefined;
  eventType?: string | undefined;
  timestampMs?: number | undefined;
};

export type WebhookVerifierInput = {
  raw: string;
  headers: Record<string, string>;
  payload: unknown;
  secret: string | null;
  nowMs: number;
  replayWindowMs: number;
};

export type WebhookVerifier = (input: WebhookVerifierInput) => WebhookVerification;

/** Endpoint as the ingress needs it. `secret` only ever exists server-side. */
export type WebhookEndpointRecord = {
  id: string;
  workspaceId: string;
  integrationId: string | null;
  workflowId: string | null;
  connector: string;
  enabled: boolean;
  events: string[];
  secret: string | null;
  replayWindowSeconds: number;
  maxAttempts: number;
};

export type WebhookEventRecord = {
  id: string;
  workspaceId: string;
  endpointId: string;
  eventId: string;
  eventType: string;
  traceId: string;
  attempts: number;
  maxAttempts: number;
  payload: unknown;
  status: WebhookEventStatus;
};

/** Storage seam so the pipeline can be unit-tested without a database. */
export type WebhookStore = {
  findEndpoint: (slug: string) => Promise<WebhookEndpointRecord | null>;
  /** Inserts the event, or reports a duplicate when (endpoint, event_id) exists. */
  insertEvent: (row: {
    workspaceId: string;
    endpointId: string;
    integrationId: string | null;
    connector: string;
    eventId: string;
    eventType: string;
    traceId: string;
    signatureValid: boolean;
    maxAttempts: number;
    payload: unknown;
    headers: Record<string, string>;
  }) => Promise<{ duplicate: boolean; id: string }>;
  updateEvent: (
    id: string,
    patch: {
      status?: WebhookEventStatus;
      attempts?: number;
      error?: string | null;
      executionId?: string | null;
      nextAttemptAt?: string;
      processedAt?: string;
    },
  ) => Promise<void>;
  recordDelivery: (row: {
    workspaceId: string;
    endpointId: string;
    event: string;
    attempt: number;
    success: boolean;
    signatureValid: boolean;
    statusCode: number;
    latencyMs: number;
    error?: string | null;
    payload?: unknown;
  }) => Promise<void>;
  /** Turns a verified event into a run on the Server Execution Runtime. */
  startExecution: (input: {
    endpoint: WebhookEndpointRecord;
    event: WebhookEventRecord;
  }) => Promise<{ executionId: string } | null>;
  /** Events whose retry timer has elapsed (status `failed`). */
  dueEvents?: (limit: number) => Promise<
    (WebhookEventRecord & { endpoint: WebhookEndpointRecord })[]
  >;
};

export type WebhookResponse = {
  status: number;
  body: {
    ok: boolean;
    status: WebhookEventStatus | "rejected" | "duplicate";
    trace_id: string;
    event_id?: string;
    error?: WebhookFailureReason | "execution_failed";
    message?: string;
  };
};
