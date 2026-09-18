import { googleConnector } from "@/lib/connectors/adapters/google";
import { httpConnector } from "@/lib/connectors/adapters/http";
import { sallaConnector } from "@/lib/connectors/adapters/salla";
import { shopifyConnector } from "@/lib/connectors/adapters/shopify";
import { slackConnector } from "@/lib/connectors/adapters/slack";
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
  sallaConnector,
  zidConnector,
];

const byId = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

/** Catalog provider ids that share a reference adapter (read-only mapping). */
const ALIASES: Record<string, string> = {
  webhook: "http",
  custom_api: "http",
  rest: "http",
  google_drive: "google",
  google_sheets: "google",
  gmail: "google",
  google_calendar: "google",
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
