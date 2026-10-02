import { discordConnector } from "@/lib/connectors/adapters/discord";
import { facebookPagesConnector } from "@/lib/connectors/adapters/facebook-pages";
import { gmailConnector } from "@/lib/connectors/adapters/gmail";
import { googleConnector } from "@/lib/connectors/adapters/google";
import { googleDriveConnector } from "@/lib/connectors/adapters/google-drive";
import { httpConnector } from "@/lib/connectors/adapters/http";
import { hubspotConnector } from "@/lib/connectors/adapters/hubspot";
import { instagramConnector } from "@/lib/connectors/adapters/instagram";
import { microsoftGraphConnector } from "@/lib/connectors/adapters/microsoft-graph";
import { messengerConnector } from "@/lib/connectors/adapters/messenger";
import { sallaConnector } from "@/lib/connectors/adapters/salla";
import { shopifyConnector } from "@/lib/connectors/adapters/shopify";
import { slackConnector } from "@/lib/connectors/adapters/slack";
import { telegramConnector } from "@/lib/connectors/adapters/telegram";
import { whatsappConnector } from "@/lib/connectors/adapters/whatsapp";
import { woocommerceConnector } from "@/lib/connectors/adapters/woocommerce";
import { zidConnector } from "@/lib/connectors/adapters/zid";
import type { ConnectorAdapter } from "@/lib/connectors/types";

/**
 * Adapter registry. Adding Salla, Zid, Shopify or WooCommerce later is a single
 * new adapter file plus one line here — the runtime, dispatcher and Integration
 * Center stay untouched.
 */
const ADAPTERS: ConnectorAdapter[] = [
  httpConnector,
  slackConnector,
  googleConnector,
  gmailConnector,
  sallaConnector,
  zidConnector,
  shopifyConnector,
  woocommerceConnector,
  whatsappConnector,
  instagramConnector,
  facebookPagesConnector,
  messengerConnector,
  telegramConnector,
  discordConnector,
  microsoftGraphConnector,
  googleDriveConnector,
  hubspotConnector,
];

const byId = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

/** Catalog provider ids that share a reference adapter (read-only mapping). */
const ALIASES: Record<string, string> = {
  webhook: "http",
  custom_api: "http",
  rest: "http",
  woo: "woocommerce",
  wordpress_woocommerce: "woocommerce",
  google_drive: "google",
  google_sheets: "google",
  gmail: "google",
  google_calendar: "google",
  whatsapp_cloud: "whatsapp",
  whatsapp_business: "whatsapp",
  instagram_business: "instagram",
  instagram_graph: "instagram",
  instagram_messaging: "instagram",
  facebook: "facebook_pages",
  facebook_page: "facebook_pages",
  meta_pages: "facebook_pages",
  facebook_messenger: "messenger",
  messenger_platform: "messenger",
  telegram_bot: "telegram",
  discord_bot: "discord",
  hubspot_crm: "hubspot",
  outlook: "microsoft_graph",
  microsoft_outlook: "microsoft_graph",
  microsoft_365: "microsoft_graph",
  microsoft_calendar: "microsoft_graph",
};

export function registerConnector(adapter: ConnectorAdapter) {
  byId.set(adapter.id, adapter);
}

export function getConnector(id: string): ConnectorAdapter | undefined {
  return byId.get(id) ?? byId.get(ALIASES[id] ?? "");
}

export function listConnectors(): ConnectorAdapter[] {
  return [...byId.values()];
}

/** Client-safe descriptor: capabilities and operations only, never credentials. */
export function describeConnectors() {
  return listConnectors().map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    capabilities: adapter.capabilities,
    operations: adapter.operations,
    authKind: adapter.credentials.kind,
    requiredCredentials: adapter.credentials.required,
  }));
}
