import { normalizeShopDomain } from "@/lib/connectors/adapters/shopify";
import type { OAuthProviderSpec } from "@/lib/oauth/types";

/** Placeholder host in the Shopify template spec, bound per store at runtime. */
const SHOPIFY_SHOP_TOKEN = "{shop}";

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
  // Zid — official Zid App OAuth2 (Authorization Code).
  zid: {
    connector: "zid",
    label: "Zid",
    authorizationUrl: "https://oauth.zid.sa/oauth/authorize",
    tokenUrl: "https://oauth.zid.sa/oauth/token",
    scopes: ["third_parties_apps_management"],
    refreshable: true,
    // Zid issues the manager JWT next to the access token; both are required on
    // every API call and both stay in the encrypted vault.
    credentialFields: (token) => {
      const authorization = token["authorization"];
      return typeof authorization === "string" && authorization ? { authorization } : {};
    },
    identify: (token) => {
      const store = (token["store"] ?? token["merchant"]) as { id?: string | number; name?: string } | undefined;
      const id = store?.id !== undefined ? String(store.id) : undefined;
      return id ? { accountIdentifier: id, accountLabel: store?.name ?? `Zid store ${id}` } : {};
    },
  },
  // Shopify — official Shopify App OAuth2 (Authorization Code). Every endpoint
  // lives on the merchant's own domain, so this entry is the template and
  // `shopifyOAuthSpec(shop)` binds it to one store at authorize/callback time.
  shopify: {
    connector: "shopify",
    label: "Shopify",
    authorizationUrl: `https://${SHOPIFY_SHOP_TOKEN}/admin/oauth/authorize`,
    tokenUrl: `https://${SHOPIFY_SHOP_TOKEN}/admin/oauth/access_token`,
    scopes: [
      "read_orders",
      "write_orders",
      "read_products",
      "write_products",
      "read_customers",
      "write_customers",
      "read_inventory",
      "write_inventory",
      "read_locations",
    ],
    scopeSeparator: ",",
    // Shopify offline access tokens do not expire and are not refreshable.
    refreshable: false,
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
 * Binds the Shopify template spec to one merchant store.
 *
 * Shopify hosts authorize and token exchange on the store's own domain and
 * never returns the store in the token body, so the domain is injected here and
 * stored as an encrypted credential field the adapter later reads.
 */
export function shopifyOAuthSpec(shopDomain: string): OAuthProviderSpec {
  const shop = normalizeShopDomain(shopDomain);
  if (!shop) throw new Error("A valid Shopify store domain is required");
  const base = SPECS["shopify"]!;
  return {
    ...base,
    authorizationUrl: base.authorizationUrl.replace(SHOPIFY_SHOP_TOKEN, shop),
    tokenUrl: base.tokenUrl.replace(SHOPIFY_SHOP_TOKEN, shop),
    identify: () => ({ accountIdentifier: shop, accountLabel: shop }),
    credentialFields: () => ({ shop_domain: shop }),
  };
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
