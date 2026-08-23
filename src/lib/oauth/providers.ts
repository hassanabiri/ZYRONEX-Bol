import type { OAuthProviderSpec } from "@/lib/oauth/types";

/**
 * OAuth specs bound to the Connector Registry.
 *
 * A connector declares its auth kind through its adapter; here it declares how
 * that auth is obtained. Salla, Zid, Shopify and WooCommerce will each add one
 * entry to this map — the authorize/callback/refresh/revoke flow is shared.
 */

const SPECS: Record<string, OAuthProviderSpec> = {
  google: {
    connector: "google",
    label: "Google",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    scopes: ["openid", "email", "profile"],
    usePkce: true,
    refreshable: true,
    // Google only returns a refresh token on the first consent unless asked.
    authorizationParams: { access_type: "offline", prompt: "consent" },
    identify: (token) => {
      const email = typeof token["email"] === "string" ? (token["email"] as string) : undefined;
      return email ? { accountIdentifier: email, accountLabel: email } : {};
    },
  },
  slack: {
    connector: "slack",
    label: "Slack",
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    revokeUrl: "https://slack.com/api/auth.revoke",
    scopes: ["channels:read", "chat:write"],
    refreshable: true,
    identify: (token) => {
      const team = token["team"] as { id?: string; name?: string } | undefined;
      return team?.id ? { accountIdentifier: team.id, accountLabel: team.name ?? team.id } : {};
    },
  },
  // Salla — official Salla App OAuth2 (Authorization Code, "Easy mode" off).
  salla: {
    connector: "salla",
    label: "Salla",
    authorizationUrl: "https://accounts.salla.sa/oauth2/auth",
    tokenUrl: "https://accounts.salla.sa/oauth2/token",
    revokeUrl: "https://accounts.salla.sa/oauth2/token/revoke",
    scopes: ["offline_access", "settings.read", "orders.read_write", "products.read_write", "customers.read_write"],
    usePkce: true,
    refreshable: true,
    // Salla only issues a refresh token when offline access is requested.
    authorizationParams: { access_type: "offline" },
    identify: (token) => {
      const store = (token["store"] ?? token["merchant"]) as { id?: string | number; name?: string } | string | undefined;
      if (typeof store === "string") return { accountIdentifier: store, accountLabel: store };
      const id = store?.id !== undefined ? String(store.id) : undefined;
      return id ? { accountIdentifier: id, accountLabel: store?.name ?? `Salla store ${id}` } : {};
    },
  },
};

/** Aliases mirror the connector registry so catalog ids resolve to one spec. */
const ALIASES: Record<string, string> = {
  gmail: "google",
  google_drive: "google",
  google_sheets: "google",
  google_calendar: "google",
};

export function registerOAuthProvider(spec: OAuthProviderSpec) {
  SPECS[spec.connector] = spec;
}

export function getOAuthProvider(connector: string): OAuthProviderSpec | undefined {
  return SPECS[connector] ?? SPECS[ALIASES[connector] ?? ""];
}

/**
 * Generic OAuth2 spec for a self-declared provider. Lets a workspace connect an
 * arbitrary OAuth2 service without shipping code for it.
 */
export function customOAuthProvider(input: {
  connector: string;
  label?: string;
  authorizationUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  scopes?: string[];
  usePkce?: boolean;
}): OAuthProviderSpec {
  return {
    connector: input.connector,
    label: input.label ?? input.connector,
    authorizationUrl: input.authorizationUrl,
    tokenUrl: input.tokenUrl,
    ...(input.revokeUrl ? { revokeUrl: input.revokeUrl } : {}),
    scopes: input.scopes ?? [],
    usePkce: input.usePkce ?? true,
    refreshable: true,
  };
}

/** Client-safe listing for the Integration Center. */
export function describeOAuthProviders() {
  return Object.values(SPECS).map((spec) => ({
    connector: spec.connector,
    label: spec.label,
    scopes: spec.scopes,
    refreshable: spec.refreshable !== false,
    revocable: Boolean(spec.revokeUrl),
  }));
}
