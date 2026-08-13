import {
  Bot,
  Boxes,
  Braces,
  CalendarDays,
  CheckSquare,
  CreditCard,
  Database,
  HardDrive,
  Headphones,
  Megaphone,
  MessageSquare,
  Mic,
  Plug,
  Receipt,
  Share2,
  ShoppingCart,
  Terminal,
  Users,
  type LucideIcon,
} from "lucide-react";


import type { Enums } from "@/integrations/supabase/types";

export type IntegrationStatus = Enums<"integration_status">;
export type IntegrationAuthType = Enums<"integration_auth_type">;
export type SyncMode = Enums<"sync_mode">;
export type SyncRunStatus = Enums<"sync_run_status">;
export type WebhookDirection = Enums<"webhook_direction">;
export type IntegrationLogKind = Enums<"integration_log_kind">;
export type MarketplaceListingStatus = Enums<"marketplace_listing_status">;

export type IntegrationCategory =
  | "communication"
  | "social"
  | "advertising"
  | "commerce"
  | "payments"
  | "crm"
  | "support"
  | "productivity"
  | "storage"
  | "tasks"
  | "calendar"
  | "accounting"
  | "databases"
  | "developer"
  | "voice"
  | "ai_providers"
  | "custom";

export const INTEGRATION_CATEGORIES: {
  id: IntegrationCategory;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "communication", label: "Communication & Messaging", icon: MessageSquare },
  { id: "social", label: "Social Media & Content", icon: Share2 },
  { id: "advertising", label: "Advertising & Marketing", icon: Megaphone },
  { id: "commerce", label: "E-Commerce & Stores", icon: ShoppingCart },
  { id: "payments", label: "Payments", icon: CreditCard },
  { id: "crm", label: "CRM & Sales", icon: Users },
  { id: "support", label: "Customer Support", icon: Headphones },
  { id: "productivity", label: "Productivity", icon: Boxes },
  { id: "storage", label: "Files & Storage", icon: HardDrive },
  { id: "tasks", label: "Tasks & Projects", icon: CheckSquare },
  { id: "calendar", label: "Calendar & Scheduling", icon: CalendarDays },
  { id: "accounting", label: "Accounting & Finance", icon: Receipt },
  { id: "databases", label: "Databases", icon: Database },
  { id: "developer", label: "Developer", icon: Terminal },
  { id: "voice", label: "Voice", icon: Mic },
  { id: "ai_providers", label: "AI Providers", icon: Bot },
  { id: "custom", label: "Advanced / Future", icon: Plug },
];


export type CredentialField = {
  key: string;
  label: string;
  /** Secret fields are encrypted server-side and never returned to the browser. */
  secret: boolean;
  optional?: boolean;
  placeholder?: string;
};

export type ProviderDefinition = {
  id: string;
  name: string;
  category: IntegrationCategory;
  authType: IntegrationAuthType;
  description: string;
  scopes: string[];
  credentialFields: CredentialField[];
  /** Non-secret configuration captured in the wizard and stored on the connection row. */
  configFields?: CredentialField[];
  supportsWebhooks?: boolean;
  supportsSync?: boolean;
};

const oauth = (extra: CredentialField[] = []): CredentialField[] => [
  { key: "client_id", label: "Client ID", secret: false },
  { key: "client_secret", label: "Client secret", secret: true },
  ...extra,
];

const apiKey = (label = "API key"): CredentialField[] => [{ key: "api_key", label, secret: true }];

export const PROVIDERS: ProviderDefinition[] = [
  // Communication
  {
    id: "whatsapp",
    name: "WhatsApp",
    category: "communication",
    authType: "api_key",
    description: "WhatsApp Business Cloud messaging channel.",
    scopes: ["messages.read", "messages.send"],
    credentialFields: [
      { key: "access_token", label: "Permanent access token", secret: true },
      { key: "phone_number_id", label: "Phone number ID", secret: false },
    ],
    supportsWebhooks: true,
  },
  {
    id: "telegram",
    name: "Telegram",
    category: "communication",
    authType: "api_key",
    description: "Telegram bot channel with webhook delivery.",
    scopes: ["messages.read", "messages.send"],
    credentialFields: [{ key: "bot_token", label: "Bot token", secret: true }],
    supportsWebhooks: true,
  },
  {
    id: "messenger",
    name: "Messenger",
    category: "communication",
    authType: "oauth2",
    description: "Facebook Messenger conversations.",
    scopes: ["pages_messaging"],
    credentialFields: oauth(),
    supportsWebhooks: true,
  },
  {
    id: "instagram",
    name: "Instagram",
    category: "communication",
    authType: "oauth2",
    description: "Instagram direct messages and comments.",
    scopes: ["instagram_manage_messages"],
    credentialFields: oauth(),
    supportsWebhooks: true,
  },
  {
    id: "facebook_pages",
    name: "Facebook Pages",
    category: "communication",
    authType: "oauth2",
    description: "Page inbox, posts and comment automation.",
    scopes: ["pages_manage_metadata", "pages_read_engagement"],
    credentialFields: oauth(),
    supportsWebhooks: true,
  },
  {
    id: "slack",
    name: "Slack",
    category: "communication",
    authType: "oauth2",
    description: "Slack channels, messages and app events.",
    scopes: ["channels:read", "chat:write"],
    credentialFields: oauth(),
    supportsWebhooks: true,
  },
  {
    id: "discord",
    name: "Discord",
    category: "communication",
    authType: "api_key",
    description: "Discord guild messaging bot.",
    scopes: ["bot", "messages.send"],
    credentialFields: [{ key: "bot_token", label: "Bot token", secret: true }],
    supportsWebhooks: true,
  },
  // Productivity
  {
    id: "gmail",
    name: "Gmail",
    category: "productivity",
    authType: "oauth2",
    description: "Mailbox read and send on behalf of the workspace.",
    scopes: ["gmail.readonly", "gmail.send"],
    credentialFields: oauth(),
    supportsSync: true,
  },
  {
    id: "outlook",
    name: "Outlook",
    category: "productivity",
    authType: "oauth2",
    description: "Outlook mail and calendar access.",
    scopes: ["Mail.Read", "Mail.Send"],
    credentialFields: oauth(),
    supportsSync: true,
  },
  {
    id: "microsoft_365",
    name: "Microsoft 365",
    category: "productivity",
    authType: "oauth2",
    description: "Teams, SharePoint and Graph resources.",
    scopes: ["Files.ReadWrite", "User.Read"],
    credentialFields: oauth([{ key: "tenant_id", label: "Tenant ID", secret: false }]),
    supportsSync: true,
  },
  {
    id: "google_workspace",
    name: "Google Workspace",
    category: "productivity",
    authType: "oauth2",
    description: "Drive, Docs and Calendar for the domain.",
    scopes: ["drive.readonly", "calendar.events"],
    credentialFields: oauth(),
    supportsSync: true,
  },
  {
    id: "zoom",
    name: "Zoom",
    category: "voice",
    authType: "oauth2",
    description: "Meetings, recordings and transcripts.",
    scopes: ["meeting:read", "recording:read"],
    credentialFields: oauth(),
    supportsWebhooks: true,
  },
  {
    id: "google_meet",
    name: "Google Meet",
    category: "voice",
    authType: "oauth2",
    description: "Meet scheduling and recording artifacts.",
    scopes: ["calendar.events", "meetings.space.readonly"],
    credentialFields: oauth(),
  },
  // Commerce
  {
    id: "salla",
    name: "Salla",
    category: "commerce",
    authType: "oauth2",
    description: "Salla store orders, products and customers.",
    scopes: ["orders.read", "products.read"],
    credentialFields: oauth(),
    supportsWebhooks: true,
    supportsSync: true,
  },
  {
    id: "zid",
    name: "Zid",
    category: "commerce",
    authType: "oauth2",
    description: "Zid merchant catalog and order stream.",
    scopes: ["orders.read", "products.read"],
    credentialFields: oauth(),
    supportsWebhooks: true,
    supportsSync: true,
  },
  {
    id: "shopify",
    name: "Shopify",
    category: "commerce",
    authType: "api_key",
    description: "Shopify Admin API storefront operations.",
    scopes: ["read_orders", "read_products"],
    credentialFields: [{ key: "admin_access_token", label: "Admin access token", secret: true }],
    configFields: [{ key: "shop_domain", label: "Shop domain", secret: false, placeholder: "store.myshopify.com" }],
    supportsWebhooks: true,
    supportsSync: true,
  },
  {
    id: "woocommerce",
    name: "WooCommerce",
    category: "commerce",
    authType: "basic",
    description: "WooCommerce REST API over WordPress.",
    scopes: ["read", "write"],
    credentialFields: [
      { key: "consumer_key", label: "Consumer key", secret: false },
      { key: "consumer_secret", label: "Consumer secret", secret: true },
    ],
    configFields: [{ key: "store_url", label: "Store URL", secret: false }],
    supportsSync: true,
  },
  {
    id: "magento",
    name: "Magento",
    category: "commerce",
    authType: "bearer",
    description: "Magento 2 integration tokens.",
    scopes: ["catalog", "sales"],
    credentialFields: [{ key: "access_token", label: "Access token", secret: true }],
    configFields: [{ key: "base_url", label: "Base URL", secret: false }],
    supportsSync: true,
  },
  {
    id: "opencart",
    name: "OpenCart",
    category: "commerce",
    authType: "api_key",
    description: "OpenCart storefront and admin API.",
    scopes: ["catalog", "orders"],
    credentialFields: apiKey(),
    configFields: [{ key: "base_url", label: "Base URL", secret: false }],
    supportsSync: true,
  },
  // Payments
  {
    id: "stripe",
    name: "Stripe",
    category: "payments",
    authType: "api_key",
    description: "Payments, subscriptions and payouts.",
    scopes: ["charges.read", "customers.read"],
    credentialFields: [{ key: "secret_key", label: "Secret key", secret: true }],
    supportsWebhooks: true,
  },
  {
    id: "hyperpay",
    name: "HyperPay",
    category: "payments",
    authType: "bearer",
    description: "HyperPay checkout and payment status.",
    scopes: ["payments.read"],
    credentialFields: [{ key: "access_token", label: "Access token", secret: true }],
    configFields: [{ key: "entity_id", label: "Entity ID", secret: false }],
  },
  {
    id: "moyasar",
    name: "Moyasar",
    category: "payments",
    authType: "api_key",
    description: "Moyasar payments for Saudi merchants.",
    scopes: ["payments.read", "payments.write"],
    credentialFields: [{ key: "secret_key", label: "Secret API key", secret: true }],
    supportsWebhooks: true,
  },
  {
    id: "paytabs",
    name: "PayTabs",
    category: "payments",
    authType: "api_key",
    description: "PayTabs hosted payment pages.",
    scopes: ["payments.read"],
    credentialFields: [{ key: "server_key", label: "Server key", secret: true }],
    configFields: [{ key: "profile_id", label: "Profile ID", secret: false }],
  },
  {
    id: "stc_pay",
    name: "STC Pay",
    category: "payments",
    authType: "api_key",
    description: "STC Pay wallet transactions.",
    scopes: ["payments.read"],
    credentialFields: [{ key: "merchant_secret", label: "Merchant secret", secret: true }],
    configFields: [{ key: "merchant_id", label: "Merchant ID", secret: false }],
  },
  // Developer / custom
  {
    id: "rest_api",
    name: "Custom REST API",
    category: "developer",
    authType: "custom",
    description: "Any HTTP service described by base URL and auth header.",
    scopes: [],
    credentialFields: [{ key: "auth_header", label: "Authorization header value", secret: true, optional: true }],
    configFields: [{ key: "base_url", label: "Base URL", secret: false }],
    supportsSync: true,
  },
  {
    id: "webhook",
    name: "Webhook",
    category: "developer",
    authType: "webhook",
    description: "Inbound or outbound signed webhook channel.",
    scopes: [],
    credentialFields: [{ key: "signing_secret", label: "Signing secret", secret: true }],
    supportsWebhooks: true,
  },
  {
    id: "graphql",
    name: "GraphQL",
    category: "developer",
    authType: "bearer",
    description: "GraphQL endpoint with bearer authentication.",
    scopes: [],
    credentialFields: [{ key: "token", label: "Bearer token", secret: true }],
    configFields: [{ key: "endpoint", label: "Endpoint URL", secret: false }],
  },
  {
    id: "mcp_server",
    name: "MCP Server",
    category: "developer",
    authType: "bearer",
    description: "Model Context Protocol server (reserved for a future release).",
    scopes: ["tools.list", "tools.call"],
    credentialFields: [{ key: "token", label: "Bearer token", secret: true, optional: true }],
    configFields: [{ key: "server_url", label: "Server URL", secret: false }],
  },
  {
    id: "custom_connector",
    name: "Custom Connector",
    category: "custom",
    authType: "custom",
    description: "Connector supplied through the marketplace manifest.",
    scopes: [],
    credentialFields: [{ key: "credentials", label: "Credential blob (JSON)", secret: true, optional: true }],
    configFields: [{ key: "manifest_url", label: "Manifest URL", secret: false, optional: true }],
  },
  // Storage / databases / CRM / AI
  {
    id: "google_drive",
    name: "Google Drive",
    category: "storage",
    authType: "oauth2",
    description: "Drive folders as a document source.",
    scopes: ["drive.readonly"],
    credentialFields: oauth(),
    supportsSync: true,
  },
  {
    id: "s3",
    name: "Amazon S3",
    category: "storage",
    authType: "api_key",
    description: "Object storage buckets.",
    scopes: ["s3:GetObject", "s3:PutObject"],
    credentialFields: [
      { key: "access_key_id", label: "Access key ID", secret: false },
      { key: "secret_access_key", label: "Secret access key", secret: true },
    ],
    configFields: [{ key: "bucket", label: "Bucket", secret: false }],
    supportsSync: true,
  },
  {
    id: "postgres",
    name: "PostgreSQL",
    category: "databases",
    authType: "basic",
    description: "External Postgres database connection.",
    scopes: ["read"],
    credentialFields: [{ key: "connection_string", label: "Connection string", secret: true }],
    supportsSync: true,
  },
  {
    id: "salesforce",
    name: "Salesforce",
    category: "crm",
    authType: "oauth2",
    description: "Accounts, contacts and opportunities.",
    scopes: ["api", "refresh_token"],
    credentialFields: oauth(),
    supportsSync: true,
  },
  {
    id: "hubspot",
    name: "HubSpot",
    category: "crm",
    authType: "oauth2",
    description: "HubSpot CRM objects and pipelines.",
    scopes: ["crm.objects.contacts.read"],
    credentialFields: oauth(),
    supportsSync: true,
  },
  {
    id: "openai_compatible",
    name: "AI Provider (OpenAI-compatible)",
    category: "ai_providers",
    authType: "api_key",
    description: "Reserved slot for a model provider endpoint.",
    scopes: ["models.list", "chat.completions"],
    credentialFields: apiKey(),
    configFields: [{ key: "base_url", label: "Base URL", secret: false, optional: true }],
  },
];

export const PROVIDER_MAP = new Map(PROVIDERS.map((provider) => [provider.id, provider]));

export function getProvider(id: string): ProviderDefinition | undefined {
  return PROVIDER_MAP.get(id);
}

export const HEALTHY_STATUSES: IntegrationStatus[] = ["healthy"];
export const FAILING_STATUSES: IntegrationStatus[] = [
  "disconnected",
  "expired",
  "auth_error",
  "rate_limited",
];

export const STATUS_LABELS: Record<IntegrationStatus, string> = {
  pending: "Pending",
  healthy: "Healthy",
  warning: "Warning",
  disconnected: "Disconnected",
  expired: "Expired",
  auth_error: "Authentication error",
  rate_limited: "Rate limited",
  paused: "Paused",
  archived: "Archived",
};

export const STATUS_TONE: Record<IntegrationStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  healthy: "default",
  warning: "secondary",
  disconnected: "destructive",
  expired: "destructive",
  auth_error: "destructive",
  rate_limited: "secondary",
  paused: "outline",
  archived: "outline",
};

export const API_SCOPES = [
  "workflows.read",
  "workflows.write",
  "workers.read",
  "workers.write",
  "executions.read",
  "executions.write",
  "knowledge.read",
  "knowledge.write",
  "memory.read",
  "memory.write",
  "integrations.read",
  "integrations.write",
  "webhooks.manage",
] as const;

export const CONFLICT_STRATEGIES = ["source_wins", "target_wins", "newest_wins", "manual"] as const;

/** Platform events a webhook endpoint can subscribe to. */
export const WEBHOOK_EVENTS: string[] = [
  "execution.queued",
  "execution.started",
  "execution.completed",
  "execution.failed",
  "workflow.published",
  "worker.created",
  "worker.updated",
  "knowledge.document.indexed",
  "integration.connected",
  "integration.failed",
  "sync.completed",
  "sync.failed",
];
