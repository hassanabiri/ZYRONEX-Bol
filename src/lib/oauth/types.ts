/**
 * OAuth + Connection Account contracts.
 *
 * Client-safe: types only. No token, client secret or code verifier value is
 * ever described here in a way that can reach the browser — the concrete
 * values live exclusively in the AES-256-GCM vault on the server.
 */

/** Lifecycle of a connected provider account, as shown in ZYRONEX. */
export type ConnectionStatus =
  | "connected"
  | "expired"
  | "reauth_required"
  | "revoked"
  | "error"
  | "disconnected";

export type OAuthFailureKind =
  | "invalid_state"
  | "state_expired"
  | "state_replayed"
  | "provider_denied"
  | "token_exchange_failed"
  | "refresh_failed"
  | "revoked"
  | "not_found"
  | "unsupported"
  | "workspace_mismatch";

export class OAuthError extends Error {
  readonly kind: OAuthFailureKind;
  readonly retryable: boolean;

  constructor(kind: OAuthFailureKind, message: string, retryable = false) {
    super(message);
    this.name = "OAuthError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

/**
 * Everything a connector declares about its OAuth behaviour. A new provider
 * (Salla, Zid, Shopify…) contributes one of these — the flow itself never
 * changes.
 */
export type OAuthProviderSpec = {
  connector: string;
  label: string;
  authorizationUrl: string;
  tokenUrl: string;
  /** Optional provider revoke endpoint; disconnect still works without it. */
  revokeUrl?: string;
  scopes: string[];
  scopeSeparator?: string;
  usePkce?: boolean;
  /** Some providers only return a refresh token when asked explicitly. */
  authorizationParams?: Record<string, string>;
  /** `basic` sends client credentials in the Authorization header. */
  clientAuth?: "body" | "basic";
  refreshable?: boolean;
  /** Fallback lifetime when the provider omits `expires_in`. */
  defaultExpiresInSeconds?: number;
  /** Reads the provider account id/label out of the token response. */
  identify?: (tokenResponse: Record<string, unknown>) => {
    accountIdentifier?: string;
    accountLabel?: string;
  };
  /**
   * Extra credential values a provider issues alongside the access token
   * (e.g. Zid's manager JWT). Stored encrypted with the token set and handed to
   * the connector adapter — never returned to the browser.
   */
  credentialFields?: (tokenResponse: Record<string, unknown>) => Record<string, string>;
};

export type OAuthClientCredentials = { clientId: string; clientSecret: string };

/** Token material. Only ever handled inside server modules. */
export type OAuthTokenSet = {
  accessToken: string;
  refreshToken?: string | undefined;
  tokenType?: string | undefined;
  scopes: string[];
  expiresAt: string | null;
  raw?: Record<string, unknown>;
};

export type ConnectionAccount = {
  id: string;
  workspaceId: string;
  integrationId: string | null;
  provider: string;
  connector: string;
  accountIdentifier: string;
  accountLabel: string | null;
  status: ConnectionStatus;
  credentialRef: string | null;
  scopes: string[];
  expiresAt: string | null;
  lastVerifiedAt: string | null;
  lastError: string | null;
  refreshFailures: number;
};

/** Client-safe projection: never includes tokens or credential material. */
export type ConnectionAccountView = Omit<ConnectionAccount, "credentialRef"> & {
  hasRefreshToken: boolean;
};

export type PendingAuthorization = {
  workspaceId: string;
  integrationId: string | null;
  provider: string;
  connector: string;
  redirectUri: string;
  codeVerifier: string | null;
  scopes: string[];
  createdBy: string | null;
};

/**
 * Storage contract. The Supabase implementation lives in
 * `accounts.server.ts`; tests supply an in-memory one.
 */
export type OAuthStore = {
  saveState: (input: PendingAuthorization & { stateHash: string; expiresAt: string }) => Promise<void>;
  /** Read-only lookup used to resolve the workspace before consuming. */
  peekState?: (stateHash: string, nowMs: number) => Promise<PendingAuthorization | null>;
  /** Atomically consumes a state: a second call for the same state must fail. */
  consumeState: (stateHash: string, nowMs: number) => Promise<PendingAuthorization | null>;
  upsertAccount: (
    input: Omit<ConnectionAccount, "id" | "refreshFailures"> & { tokens: OAuthTokenSet },
  ) => Promise<ConnectionAccount>;
  getAccount: (workspaceId: string, accountId: string) => Promise<ConnectionAccount | null>;
  readTokens: (accountId: string) => Promise<OAuthTokenSet | null>;
  writeTokens: (accountId: string, tokens: OAuthTokenSet) => Promise<void>;
  updateAccount: (accountId: string, patch: Partial<ConnectionAccount>) => Promise<void>;
  /** Returns false when another worker already holds the refresh lock. */
  acquireRefreshLock: (accountId: string, owner: string, ttlMs: number) => Promise<boolean>;
  releaseRefreshLock: (accountId: string, owner: string) => Promise<void>;
};
