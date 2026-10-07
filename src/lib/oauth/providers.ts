import { INSTAGRAM_API_VERSION } from "@/lib/connectors/adapters/instagram";
import { assertSalesforceInstanceUrl } from "@/lib/connectors/adapters/salesforce";
import { parseSalesforceIdentityUrl } from "@/lib/connectors/adapters/salesforce-map";
import { assertPipedriveApiDomain } from "@/lib/connectors/adapters/pipedrive";
import { pipedriveCompanyDomain } from "@/lib/connectors/adapters/pipedrive-map";
import { normalizeShopDomain } from "@/lib/connectors/adapters/shopify";
import { zendeskSubdomain } from "@/lib/connectors/adapters/zendesk-map";
import type { OAuthProviderSpec } from "@/lib/oauth/types";

/** Placeholder host in the Shopify template spec, bound per store at runtime. */
const SHOPIFY_SHOP_TOKEN = "{shop}";
const ZENDESK_SUB_TOKEN = "{subdomain}";

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
  google_mail: {
    connector: "google_mail",
    label: "Gmail",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    // Least privilege: gmail.modify covers read, send, drafts, labels and trash.
    // Permanent delete needs https://mail.google.com/, requested only per connection when asked.
    scopes: ["openid", "email", "https://www.googleapis.com/auth/gmail.modify"],
    usePkce: true,
    refreshable: true,
    authorizationParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    identify: (token) => {
      const email = typeof token["email"] === "string" ? (token["email"] as string) : undefined;
      if (email) return { accountIdentifier: email, accountLabel: email };
      const idToken = typeof token["id_token"] === "string" ? (token["id_token"] as string) : "";
      try {
        const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
        const mail = typeof claims["email"] === "string" ? claims["email"] : undefined;
        const sub = typeof claims["sub"] === "string" ? claims["sub"] : undefined;
        return mail ? { accountIdentifier: mail, accountLabel: mail } : sub ? { accountIdentifier: sub, accountLabel: sub } : {};
      } catch {
        return {};
      }
    },
  },
  slack: {
    connector: "slack",
    label: "Slack",
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    revokeUrl: "https://slack.com/api/auth.revoke",
    // Official bot-token scopes for the Slack connector operations.
    scopes: [
      "channels:read", "channels:history", "channels:manage", "channels:join",
      "groups:read", "groups:history", "groups:write", "im:read", "im:history", "im:write", "mpim:read", "mpim:history",
      "chat:write", "reactions:read", "reactions:write", "users:read", "users:read.email", "team:read", "files:read", "files:write",
    ],
    scopeSeparator: ",",
    // Slack returns a refresh token only when token rotation is enabled.
    refreshable: true,
    // Bot/app ids are identifiers, not secrets; kept with the vault token set.
    credentialFields: (token) => {
      const out: Record<string, string> = {};
      if (typeof token["bot_user_id"] === "string") out["bot_user_id"] = token["bot_user_id"];
      if (typeof token["app_id"] === "string") out["app_id"] = token["app_id"];
      return out;
    },
    identify: (token) => {
      const team = token["team"] as { id?: string; name?: string } | undefined;
      const enterprise = token["enterprise"] as { id?: string; name?: string } | undefined;
      if (team?.id) return { accountIdentifier: team.id, accountLabel: team.name ?? team.id };
      return enterprise?.id ? { accountIdentifier: enterprise.id, accountLabel: enterprise.name ?? enterprise.id } : {};
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
  // Instagram — official Facebook Login for Business (Instagram professional
  // accounts). Meta issues long-lived tokens through the documented
  // `fb_exchange_token` grant, not an OAuth2 refresh token, so the account is
  // re-authorized rather than refreshed.
  instagram: {
    connector: "instagram",
    label: "Instagram",
    authorizationUrl: `https://www.facebook.com/${INSTAGRAM_API_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${INSTAGRAM_API_VERSION}/oauth/access_token`,
    scopes: [
      "instagram_basic",
      "instagram_manage_messages",
      "instagram_manage_comments",
      "instagram_content_publish",
      "instagram_manage_insights",
      "pages_show_list",
      "pages_manage_metadata",
    ],
    scopeSeparator: ",",
    refreshable: false,
    // Meta long-lived user tokens last 60 days when the response omits it.
    defaultExpiresInSeconds: 60 * 24 * 60 * 60,
    identify: (token) => {
      const id = token["user_id"] ?? token["instagram_account_id"];
      return id !== undefined && id !== null
        ? { accountIdentifier: String(id), accountLabel: `Instagram account ${String(id)}` }
        : {};
    },
  },
  // Facebook Pages — official Facebook Login for Business. The exchanged token
  // is a user token; Page tokens are discovered through `/me/accounts`.
  facebook_pages: {
    connector: "facebook_pages",
    label: "Facebook Pages",
    authorizationUrl: `https://www.facebook.com/${INSTAGRAM_API_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${INSTAGRAM_API_VERSION}/oauth/access_token`,
    scopes: [
      "pages_show_list",
      "pages_read_engagement",
      "pages_read_user_content",
      "pages_manage_posts",
      "pages_manage_engagement",
      "pages_manage_metadata",
      "read_insights",
    ],
    scopeSeparator: ",",
    refreshable: false,
    defaultExpiresInSeconds: 60 * 24 * 60 * 60,
    // Keep the user token for page discovery; the page token is bound later.
    credentialFields: (token) => {
      const value = token["access_token"];
      return typeof value === "string" && value ? { user_access_token: value } : {};
    },
    identify: (token) => {
      const id = token["page_id"] ?? token["user_id"];
      return id !== undefined && id !== null
        ? { accountIdentifier: String(id), accountLabel: `Facebook Page ${String(id)}` }
        : {};
    },
  },
  // Messenger — official Facebook Login for Business with pages_messaging.
  // The exchanged token is a user token; the Page token is bound per Page.
  messenger: {
    connector: "messenger",
    label: "Messenger",
    authorizationUrl: `https://www.facebook.com/${INSTAGRAM_API_VERSION}/dialog/oauth`,
    tokenUrl: `https://graph.facebook.com/${INSTAGRAM_API_VERSION}/oauth/access_token`,
    scopes: ["pages_show_list", "pages_messaging", "pages_manage_metadata", "pages_read_engagement"],
    scopeSeparator: ",",
    refreshable: false,
    defaultExpiresInSeconds: 60 * 24 * 60 * 60,
    credentialFields: (token) => {
      const value = token["access_token"];
      return typeof value === "string" && value ? { user_access_token: value } : {};
    },
    identify: (token) => {
      const id = token["page_id"] ?? token["user_id"];
      return id !== undefined && id !== null
        ? { accountIdentifier: String(id), accountLabel: `Messenger Page ${String(id)}` }
        : {};
    },
  },
  // Google Drive — official Google OAuth 2.0 (auth code + PKCE). Registered as
  // `google_drive_api`; the `google_drive` alias keeps resolving to generic Google.
  google_drive_api: {
    connector: "google_drive_api",
    label: "Google Drive",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    // Least privilege by default: metadata reads + per-file access for app-created files.
    // drive.readonly (export / shared drives) and drive (arbitrary file writes) are requested per connection only.
    scopes: ["openid", "email", "https://www.googleapis.com/auth/drive.metadata.readonly", "https://www.googleapis.com/auth/drive.file"],
    usePkce: true,
    refreshable: true,
    authorizationParams: { access_type: "offline", prompt: "consent", include_granted_scopes: "true" },
    identify: (token) => {
      const claims = microsoftClaims(token);
      const email = typeof token["email"] === "string" ? (token["email"] as string) : typeof claims["email"] === "string" ? (claims["email"] as string) : undefined;
      const sub = typeof claims["sub"] === "string" ? (claims["sub"] as string) : undefined;
      // Google `sub` is the stable account id; email is the label.
      return sub ? { accountIdentifier: sub, accountLabel: email ?? sub } : email ? { accountIdentifier: email, accountLabel: email } : {};
    },
  },
  // HubSpot — official OAuth 2.0 authorization code flow. HubSpot does not
  // document PKCE for public apps, so state protection is the CSRF guard.
  // Scopes are least-privilege reads; write scopes are requested per connection.
  hubspot: {
    connector: "hubspot",
    label: "HubSpot",
    authorizationUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: ["oauth", "crm.objects.contacts.read", "crm.objects.companies.read", "crm.objects.deals.read"],
    usePkce: false,
    refreshable: true,
    // Portal (hub) id is an identifier, not a secret; kept with the vault token set.
    credentialFields: (token) => {
      const hub = token["hub_id"] ?? token["hubId"];
      return hub !== undefined && hub !== null && hub !== "" ? { portal_id: String(hub) } : {};
    },
    identify: (token) => {
      const hub = token["hub_id"] ?? token["hubId"];
      if (hub === undefined || hub === null || hub === "") return {};
      const domain = typeof token["hub_domain"] === "string" ? (token["hub_domain"] as string) : undefined;
      return { accountIdentifier: `hub:${String(hub)}`, accountLabel: domain ?? `HubSpot portal ${String(hub)}` };
    },
  },
  // Salesforce — official OAuth 2.0 web server flow with PKCE. Production orgs
  // authorize at login.salesforce.com, sandboxes at test.salesforce.com; both
  // map to the same `salesforce` connector and the org's own instance_url.
  salesforce: salesforceSpec("login.salesforce.com", "Salesforce"),
  salesforce_sandbox: salesforceSpec("test.salesforce.com", "Salesforce (Sandbox)"),
  // Pipedrive — official OAuth 2.0 authorization code flow (no PKCE documented;
  // state is the CSRF guard). Scopes are configured on the Marketplace app, not
  // per request. Client credentials go in the Basic header as documented.
  pipedrive: {
    connector: "pipedrive",
    label: "Pipedrive",
    authorizationUrl: "https://oauth.pipedrive.com/oauth/authorize",
    tokenUrl: "https://oauth.pipedrive.com/oauth/token",
    revokeUrl: "https://oauth.pipedrive.com/oauth/revoke",
    scopes: [],
    usePkce: false,
    clientAuth: "basic",
    refreshable: true,
    credentialFields: (token) => {
      try {
        return { api_domain: assertPipedriveApiDomain(token["api_domain"]) };
      } catch {
        return {};
      }
    },
    identify: (token) => {
      const company = pipedriveCompanyDomain(token["api_domain"]);
      return company ? { accountIdentifier: `company:${company}`, accountLabel: `${company}.pipedrive.com` } : {};
    },
  },
  // Zendesk — official OAuth 2.0 authorization code flow with PKCE on the
  // account's own subdomain. `zendeskOAuthSpec(subdomain)` binds the endpoints;
  // this base entry only carries a placeholder host and is never called as-is.
  zendesk: {
    connector: "zendesk",
    label: "Zendesk",
    authorizationUrl: `https://${ZENDESK_SUB_TOKEN}.zendesk.com/oauth/authorizations/new`,
    tokenUrl: `https://${ZENDESK_SUB_TOKEN}.zendesk.com/oauth/tokens`,
    // Least privilege by default; write scopes are requested per connection.
    scopes: ["read"],
    usePkce: true,
    // Shared refresh resolves the token endpoint statically; per-subdomain
    // refresh is tracked as technical debt, so tokens are not auto-refreshed.
    refreshable: false,
  },
  // Intercom — official OAuth authorization code flow. Permissions are set on
  // the app in the Developer Hub (no scope parameter); no PKCE, refresh or
  // revoke endpoint is documented. Tokens are issued by the US auth host.
  intercom: {
    connector: "intercom",
    label: "Intercom",
    authorizationUrl: "https://app.intercom.com/oauth",
    tokenUrl: "https://api.intercom.io/auth/eagle/token",
    scopes: [],
    usePkce: false,
    refreshable: false,
    // The token response carries no workspace id; binding uses /me (see roadmap debt).
  },
  // Microsoft Graph — official Microsoft identity platform v2.0 (auth code + PKCE).
  // The `common` authority serves every Entra ID tenant and personal accounts;
  // the tenant is read per account from the id_token (`tid`), never assumed.
  microsoft_graph: {
    connector: "microsoft_graph",
    label: "Microsoft (Outlook)",
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // Least privilege for the supported operations; offline_access issues the refresh token.
    scopes: ["openid", "profile", "email", "offline_access", "User.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Contacts.ReadWrite"],
    usePkce: true,
    refreshable: true,
    authorizationParams: { response_mode: "query", prompt: "select_account" },
    credentialFields: (token) => {
      const tid = microsoftClaims(token)["tid"];
      return typeof tid === "string" && tid ? { tenant_id: tid } : {};
    },
    identify: (token) => {
      const claims = microsoftClaims(token);
      const tid = typeof claims["tid"] === "string" ? claims["tid"] : undefined;
      const oid = typeof claims["oid"] === "string" ? claims["oid"] : typeof claims["sub"] === "string" ? claims["sub"] : undefined;
      const label = [claims["preferred_username"], claims["email"], claims["name"]].find((v) => typeof v === "string") as string | undefined;
      // tenant + object id: the same person in two tenants is two accounts.
      return oid ? { accountIdentifier: tid ? `${tid}:${oid}` : oid, accountLabel: label ?? oid } : {};
    },
  },
};

/** Aliases mirror the connector registry so catalog ids resolve to one spec. */
const ALIASES: Record<string, string> = {
  gmail: "google",
  google_drive: "google",
  google_sheets: "google",
  google_calendar: "google",
  instagram_business: "instagram",
  instagram_graph: "instagram",
  instagram_messaging: "instagram",
  facebook: "facebook_pages",
  facebook_page: "facebook_pages",
  meta_pages: "facebook_pages",
  facebook_messenger: "messenger",
  messenger_platform: "messenger",
  hubspot_crm: "hubspot",
  salesforce_crm: "salesforce",
  pipedrive_crm: "pipedrive",
  zendesk_support: "zendesk",
  intercom_support: "intercom",
  outlook: "microsoft_graph",
  microsoft_outlook: "microsoft_graph",
  microsoft_365: "microsoft_graph",
  microsoft_calendar: "microsoft_graph",
};

/** Reads the unverified id_token payload returned by the token endpoint over TLS. */
function microsoftClaims(token: Record<string, unknown>): Record<string, unknown> {
  const idToken = typeof token["id_token"] === "string" ? (token["id_token"] as string) : "";
  try {
    const claims = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as unknown;
    return claims && typeof claims === "object" ? (claims as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

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

export function zendeskOAuthSpec(subdomain: string): OAuthProviderSpec {
  const sub = zendeskSubdomain(subdomain);
  if (!sub) throw new Error("A valid Zendesk subdomain is required");
  const base = SPECS["zendesk"]!;
  return {
    ...base,
    authorizationUrl: base.authorizationUrl.replace(ZENDESK_SUB_TOKEN, sub),
    tokenUrl: base.tokenUrl.replace(ZENDESK_SUB_TOKEN, sub),
    identify: () => ({ accountIdentifier: `subdomain:${sub}`, accountLabel: `${sub}.zendesk.com` }),
    credentialFields: () => ({ subdomain: sub }),
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

/**
 * Salesforce OAuth spec for one login host. Salesforce omits `expires_in`
 * (session lifetime is an org setting), so a conservative 1h fallback forces
 * an early refresh instead of a 401. instance_url and the identity URL are
 * identifiers, stored with the vault token set; the account is bound to the
 * official org id + user id so every org is an independent connection.
 */
function salesforceSpec(loginHost: string, label: string): OAuthProviderSpec {
  return {
    connector: "salesforce",
    label,
    authorizationUrl: `https://${loginHost}/services/oauth2/authorize`,
    tokenUrl: `https://${loginHost}/services/oauth2/token`,
    revokeUrl: `https://${loginHost}/services/oauth2/revoke`,
    scopes: ["api", "refresh_token", "id"],
    usePkce: true,
    refreshable: true,
    defaultExpiresInSeconds: 3600,
    credentialFields: (token) => {
      const out: Record<string, string> = {};
      try {
        out["instance_url"] = assertSalesforceInstanceUrl(token["instance_url"]);
      } catch {
        // An invalid or missing instance_url is never stored; calls then fail with an auth error.
      }
      const identity = parseSalesforceIdentityUrl(token["id"]);
      if (identity) Object.assign(out, { identity_url: String(token["id"]), org_id: identity.orgId, user_id: identity.userId });
      return out;
    },
    identify: (token) => {
      const identity = parseSalesforceIdentityUrl(token["id"]);
      if (!identity) return {};
      let host = "";
      try {
        host = new URL(String(token["instance_url"])).hostname;
      } catch {
        host = "";
      }
      return { accountIdentifier: `org:${identity.orgId}:user:${identity.userId}`, accountLabel: host ? `${host} (${identity.orgId})` : `Salesforce org ${identity.orgId}` };
    },
  };
}
