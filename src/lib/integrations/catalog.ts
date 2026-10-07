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

/**
 * Providers that share one underlying authorization. The UI lists capabilities
 * separately while the backend reuses a single secure connection per group.
 */
export type ConnectionGroup = "meta" | "google" | "microsoft" | "tiktok";

export const CONNECTION_GROUP_LABELS: Record<ConnectionGroup, string> = {
  meta: "Meta connection",
  google: "Google connection",
  microsoft: "Microsoft connection",
  tiktok: "TikTok connection",
};

export type ProviderDefinition = {
  id: string;
  name: string;
  category: IntegrationCategory;
  /** Extra categories the provider also appears under (no duplicate connection). */
  secondaryCategories?: IntegrationCategory[];
  authType: IntegrationAuthType;
  description: string;
  scopes: string[];
  credentialFields: CredentialField[];
  /** Non-secret configuration captured in the wizard and stored on the connection row. */
  configFields?: CredentialField[];
  supportsWebhooks?: boolean;
  supportsSync?: boolean;
  /** Capabilities surfaced to agents and workflows. */
  capabilities?: string[];
  connectionGroup?: ConnectionGroup;
  comingSoon?: boolean;
};


const oauth = (extra: CredentialField[] = []): CredentialField[] => [
  { key: "client_id", label: "Client ID", secret: false },
  { key: "client_secret", label: "Client secret", secret: true },
  ...extra,
];

const apiKey = (label = "API key"): CredentialField[] => [{ key: "api_key", label, secret: true }];

const BASE_PROVIDERS: ProviderDefinition[] = [
  // Communication
  {
    id: "whatsapp",
    name: "WhatsApp",
    category: "communication",
    authType: "api_key",
    description: "WhatsApp Business Cloud messaging channel (official Meta Cloud API).",
    scopes: ["whatsapp_business_messaging", "whatsapp_business_management"],
    credentialFields: [
      { key: "access_token", label: "Permanent access token", secret: true },
      { key: "phone_number_id", label: "Phone number ID", secret: false },
      { key: "business_account_id", label: "WhatsApp Business Account ID (WABA)", secret: false },
      { key: "app_secret", label: "Meta app secret (webhook signature)", secret: true },
      { key: "verify_token", label: "Webhook verify token", secret: true },
    ],
    supportsWebhooks: true,
  },
  {
    id: "telegram",
    name: "Telegram",
    category: "communication",
    authType: "api_key",
    description: "Official Telegram Bot API: messages, replies, media, keyboards, callback queries and webhook updates.",
    scopes: ["messages.read", "messages.send"],
    credentialFields: [
      { key: "bot_token", label: "Bot token", secret: true },
      { key: "webhook_secret_token", label: "Webhook secret token", secret: true },
    ],
    supportsWebhooks: true,
  },
  {
    id: "messenger",
    name: "Messenger",
    category: "communication",
    authType: "oauth2",
    description: "Page conversations, replies, attachments and delivery/read events (official Messenger Platform).",
    scopes: ["pages_show_list", "pages_messaging", "pages_manage_metadata", "pages_read_engagement"],
    credentialFields: [
      { key: "access_token", label: "Page access token", secret: true },
      { key: "page_id", label: "Facebook Page ID", secret: false },
      { key: "app_secret", label: "Meta app secret", secret: true },
      { key: "verify_token", label: "Webhook verify token", secret: true },
    ],
    supportsWebhooks: true,
  },
  {
    id: "instagram",
    name: "Instagram",
    category: "communication",
    authType: "oauth2",
    description: "Instagram messages, comments, publishing and insights (official Instagram Graph API).",
    scopes: [
      "instagram_basic",
      "instagram_manage_messages",
      "instagram_manage_comments",
      "instagram_content_publish",
      "instagram_manage_insights",
    ],
    credentialFields: [
      { key: "access_token", label: "Access token", secret: true },
      { key: "instagram_account_id", label: "Instagram professional account ID", secret: false },
      { key: "page_id", label: "Linked Facebook Page ID", secret: false },
      { key: "app_secret", label: "Meta app secret (webhook signature)", secret: true },
      { key: "verify_token", label: "Webhook verify token", secret: true },
    ],
    supportsWebhooks: true,
  },
  {
    id: "facebook_pages",
    name: "Facebook Pages",
    category: "communication",
    authType: "oauth2",
    description: "Page posts, comments, reactions, insights and webhooks (official Meta Pages API).",
    scopes: [
      "pages_show_list",
      "pages_read_engagement",
      "pages_read_user_content",
      "pages_manage_posts",
      "pages_manage_engagement",
      "pages_manage_metadata",
      "read_insights",
    ],
    credentialFields: [
      { key: "access_token", label: "Page access token", secret: true },
      { key: "page_id", label: "Facebook Page ID", secret: false },
      { key: "user_access_token", label: "User access token (page discovery)", secret: true },
      { key: "app_secret", label: "Meta app secret (webhook signature)", secret: true },
      { key: "verify_token", label: "Webhook verify token", secret: true },
    ],
    supportsWebhooks: true,
  },
  {
    id: "slack",
    name: "Slack",
    category: "communication",
    authType: "oauth2",
    description: "Official Slack Web API: workspace identity, users, conversations, messages, threads, reactions, file metadata and signed Events API webhooks.",
    scopes: ["channels:read", "channels:history", "chat:write", "reactions:write", "users:read", "team:read", "files:read"],
    credentialFields: [...oauth(), { key: "signing_secret", label: "Slack signing secret (Events API)", secret: true }],
    supportsWebhooks: true,
  },
  {
    id: "discord",
    name: "Discord",
    category: "communication",
    authType: "api_key",
    description: "Official Discord API v10: guilds, channels, messages, replies, embeds, threads, reactions and signed interaction/webhook events.",
    scopes: ["bot", "applications.commands"],
    credentialFields: [
      { key: "bot_token", label: "Bot token", secret: true },
      { key: "application_id", label: "Application ID", secret: false },
      { key: "public_key", label: "Application public key (event signatures)", secret: false },
    ],
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
    description: "Outlook mail, calendar and contacts through Microsoft Graph.",
    scopes: ["User.Read", "Mail.ReadWrite", "Mail.Send", "Calendars.ReadWrite", "Contacts.ReadWrite", "offline_access"],
    credentialFields: oauth([{ key: "client_state", label: "Change notification clientState", secret: true, optional: true }]),
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
    authType: "oauth2",
    description: "Shopify orders, products, customers and inventory through the official Admin API.",
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
    credentialFields: oauth(),
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
    category: "custom",
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
  // Social media & content
  {
    id: "tiktok",
    name: "TikTok",
    category: "social",
    authType: "oauth2",
    description: "TikTok content publishing, comments and engagement analytics.",
    scopes: ["video.publish", "video.list", "user.info.basic"],
    credentialFields: oauth(),
    connectionGroup: "tiktok",
    supportsWebhooks: true,
  },
  {
    id: "x_twitter",
    name: "X",
    category: "social",
    authType: "oauth2",
    description: "Post, schedule and monitor engagement on X.",
    scopes: ["tweet.read", "tweet.write", "users.read"],
    credentialFields: oauth(),
    supportsWebhooks: true,
  },
  {
    id: "youtube",
    name: "YouTube",
    category: "social",
    authType: "oauth2",
    description: "Video uploads, metadata, comments and channel analytics.",
    scopes: ["youtube.upload", "youtube.readonly"],
    credentialFields: oauth(),
    connectionGroup: "google",
    supportsSync: true,
  },
  // Advertising & marketing
  {
    id: "google_ads",
    name: "Google Ads",
    category: "advertising",
    authType: "oauth2",
    description: "Campaigns, ad groups, keywords, budgets and performance reporting.",
    scopes: ["adwords"],
    credentialFields: oauth([{ key: "developer_token", label: "Developer token", secret: true }]),
    configFields: [{ key: "customer_id", label: "Customer ID", secret: false }],
    connectionGroup: "google",
    supportsSync: true,
  },
  {
    id: "meta_ads",
    name: "Meta Ads",
    category: "advertising",
    authType: "oauth2",
    description: "Facebook and Instagram ad sets, creatives, audiences and insights.",
    scopes: ["ads_management", "ads_read"],
    credentialFields: oauth(),
    configFields: [{ key: "ad_account_id", label: "Ad account ID", secret: false }],
    connectionGroup: "meta",
    supportsSync: true,
  },
  {
    id: "tiktok_ads",
    name: "TikTok Ads",
    category: "advertising",
    authType: "oauth2",
    description: "TikTok campaigns, ad groups, creatives and conversion reporting.",
    scopes: ["ads.management", "ads.read"],
    credentialFields: oauth(),
    configFields: [{ key: "advertiser_id", label: "Advertiser ID", secret: false }],
    connectionGroup: "tiktok",
    supportsSync: true,
  },
  // Customer support
  {
    id: "zendesk",
    name: "Zendesk",
    category: "support",
    authType: "oauth2",
    description: "Tickets, customers, comments and agent assignment.",
    scopes: ["read", "write"],
    credentialFields: oauth(),
    configFields: [{ key: "subdomain", label: "Subdomain", secret: false }],
    supportsWebhooks: true,
    supportsSync: true,
  },
  {
    id: "freshdesk",
    name: "Freshdesk",
    category: "support",
    authType: "api_key",
    description: "Freshdesk tickets, contacts and status automation.",
    scopes: ["tickets.read", "tickets.write"],
    credentialFields: apiKey(),
    configFields: [{ key: "domain", label: "Helpdesk domain", secret: false }],
    supportsWebhooks: true,
    supportsSync: true,
  },
  {
    id: "intercom",
    name: "Intercom",
    category: "support",
    authType: "oauth2",
    description: "Conversations, contacts, companies, notes and tags.",
    scopes: [],
    credentialFields: oauth(),
    supportsWebhooks: true,
    supportsSync: true,
  },
  // CRM
  {
    id: "pipedrive",
    name: "Pipedrive",
    category: "crm",
    authType: "api_key",
    description: "Deals, leads, contacts and activity tracking.",
    scopes: ["deals:read", "deals:write"],
    credentialFields: apiKey(),
    configFields: [{ key: "company_domain", label: "Company domain", secret: false }],
    supportsWebhooks: true,
    supportsSync: true,
  },
  // Files & storage
  {
    id: "onedrive",
    name: "OneDrive",
    category: "storage",
    authType: "oauth2",
    description: "OneDrive and SharePoint files and folder events.",
    scopes: ["Files.ReadWrite.All"],
    credentialFields: oauth([{ key: "tenant_id", label: "Tenant ID", secret: false, optional: true }]),
    connectionGroup: "microsoft",
    supportsSync: true,
  },
  {
    id: "dropbox",
    name: "Dropbox",
    category: "storage",
    authType: "oauth2",
    description: "Dropbox files, folders and change notifications.",
    scopes: ["files.content.read", "files.content.write"],
    credentialFields: oauth(),
    supportsWebhooks: true,
    supportsSync: true,
  },
  // Tasks & projects
  {
    id: "trello",
    name: "Trello",
    category: "tasks",
    authType: "api_key",
    description: "Boards, lists and cards with due dates and comments.",
    scopes: ["read", "write"],
    credentialFields: [
      { key: "api_key", label: "API key", secret: true },
      { key: "token", label: "Token", secret: true },
    ],
    supportsWebhooks: true,
    supportsSync: true,
  },
  {
    id: "asana",
    name: "Asana",
    category: "tasks",
    authType: "oauth2",
    description: "Projects, tasks, assignees and status updates.",
    scopes: ["tasks:read", "tasks:write"],
    credentialFields: oauth(),
    supportsWebhooks: true,
    supportsSync: true,
  },
  {
    id: "jira",
    name: "Jira",
    category: "tasks",
    authType: "oauth2",
    description: "Issues, sprints, transitions and comments.",
    scopes: ["read:jira-work", "write:jira-work"],
    credentialFields: oauth(),
    configFields: [{ key: "site_url", label: "Site URL", secret: false }],
    supportsWebhooks: true,
    supportsSync: true,
  },
  // Calendar & scheduling
  {
    id: "google_calendar",
    name: "Google Calendar",
    category: "calendar",
    authType: "oauth2",
    description: "Events, reminders and meeting scheduling.",
    scopes: ["calendar.events"],
    credentialFields: oauth(),
    connectionGroup: "google",
    supportsSync: true,
  },
  {
    id: "microsoft_calendar",
    name: "Microsoft Calendar",
    category: "calendar",
    authType: "oauth2",
    description: "Outlook calendar events and meeting scheduling.",
    scopes: ["Calendars.ReadWrite"],
    credentialFields: oauth([{ key: "tenant_id", label: "Tenant ID", secret: false, optional: true }]),
    connectionGroup: "microsoft",
    supportsSync: true,
  },
  // Accounting & finance
  {
    id: "quickbooks",
    name: "QuickBooks",
    category: "accounting",
    authType: "oauth2",
    description: "Customers, invoices, payments and transactions.",
    scopes: ["com.intuit.quickbooks.accounting"],
    credentialFields: oauth(),
    configFields: [{ key: "realm_id", label: "Realm ID", secret: false }],
    supportsSync: true,
  },
  {
    id: "xero",
    name: "Xero",
    category: "accounting",
    authType: "oauth2",
    description: "Xero contacts, invoices and payment status.",
    scopes: ["accounting.transactions", "accounting.contacts"],
    credentialFields: oauth(),
    supportsSync: true,
  },
];

/**
 * Non-breaking metadata layer: capabilities, cross-category placement and shared
 * authorization groups. Existing provider definitions are untouched.
 */
const PROVIDER_META: Record<string, Partial<ProviderDefinition>> = {
  whatsapp: { capabilities: ["Messages", "Conversations", "Media", "Notifications", "Webhooks"] },
  telegram: { capabilities: ["Messages", "Replies", "Media", "Automation", "Webhooks"] },
  messenger: {
    capabilities: ["Messages", "Conversations", "Replies", "Automation", "Webhooks"],
    connectionGroup: "meta",
  },
  instagram: {
    secondaryCategories: ["social"],
    capabilities: ["Messages", "Comments", "Replies", "Publishing", "Scheduling", "Media", "Analytics"],
    connectionGroup: "meta",
  },
  facebook_pages: {
    secondaryCategories: ["social"],
    capabilities: ["Messages", "Comments", "Publishing", "Scheduling", "Engagement", "Analytics"],
    connectionGroup: "meta",
  },
  slack: { capabilities: ["Messages", "Threads", "Channels", "Reactions", "Files", "Webhooks"] },
  discord: { capabilities: ["Messages", "Channels", "Notifications"] },
  tiktok: { capabilities: ["Publishing", "Scheduling", "Videos", "Comments", "Analytics"] },
  x_twitter: { capabilities: ["Publishing", "Scheduling", "Media", "Replies", "Analytics"] },
  youtube: { capabilities: ["Videos", "Publishing", "Comments", "Analytics"] },
  google_ads: {
    capabilities: ["Campaigns", "Ad groups", "Keywords", "Budgets", "Conversions", "Reporting"],
  },
  meta_ads: {
    capabilities: ["Campaigns", "Ad sets", "Creatives", "Audiences", "Budgets", "Reporting"],
  },
  tiktok_ads: { capabilities: ["Campaigns", "Ad groups", "Creatives", "Targeting", "Reporting"] },
  salla: { capabilities: ["Orders", "Products", "Customers", "Inventory", "Webhooks", "Sync"] },
  zid: { capabilities: ["Orders", "Products", "Customers", "Inventory", "Webhooks", "Sync"] },
  shopify: { capabilities: ["Orders", "Products", "Customers", "Inventory", "Shipping", "Sync"] },
  woocommerce: { capabilities: ["Orders", "Products", "Customers", "Inventory", "Sync"] },
  magento: { capabilities: ["Orders", "Products", "Customers", "Sync"] },
  opencart: { capabilities: ["Orders", "Products", "Customers", "Sync"] },
  stripe: { capabilities: ["Payments", "Customers", "Refunds", "Payouts", "Webhooks"] },
  hyperpay: { capabilities: ["Payments", "Payment status", "Refunds"] },
  moyasar: { capabilities: ["Payments", "Payment status", "Refunds", "Webhooks"] },
  paytabs: { capabilities: ["Payments", "Payment status"] },
  stc_pay: { capabilities: ["Payments", "Payment status"] },
  salesforce: { capabilities: ["Contacts", "Leads", "Deals", "Activities", "Sync"] },
  hubspot: { capabilities: ["Contacts", "Leads", "Deals", "Tasks", "Notes", "Sync"] },
  pipedrive: { capabilities: ["Contacts", "Leads", "Deals", "Activities", "Webhooks"] },
  zendesk: { capabilities: ["Tickets", "Comments", "Users", "Organizations", "Search", "Webhooks"] },
  freshdesk: { capabilities: ["Tickets", "Contacts", "Comments", "Status", "Notifications"] },
  intercom: { capabilities: ["Conversations", "Contacts", "Companies", "Notes", "Tags", "Webhooks"] },
  gmail: { capabilities: ["Email", "Notifications", "Sync"], connectionGroup: "google" },
  outlook: {
    capabilities: ["Email", "Calendar", "Notifications", "Sync"],
    connectionGroup: "microsoft",
  },
  microsoft_365: {
    capabilities: ["Teams", "SharePoint", "Files", "Documents", "Calendar"],
    connectionGroup: "microsoft",
  },
  google_workspace: {
    capabilities: ["Email", "Files", "Documents", "Calendar"],
    connectionGroup: "google",
  },
  zoom: { secondaryCategories: ["productivity"], capabilities: ["Meetings", "Recordings", "Notifications"] },
  google_meet: {
    secondaryCategories: ["productivity"],
    capabilities: ["Meetings", "Scheduling", "Recordings"],
    connectionGroup: "google",
  },
  google_drive: {
    capabilities: ["Upload", "Download", "Folders", "File events", "Sync"],
    connectionGroup: "google",
  },
  onedrive: { capabilities: ["Upload", "Download", "Folders", "File events", "Sync"] },
  dropbox: { capabilities: ["Upload", "Download", "Move", "Copy", "Folders", "Sync"] },
  s3: { capabilities: ["Upload", "Download", "Read", "Write", "Sync"] },
  trello: { capabilities: ["Create task", "Update task", "Assign", "Comments", "Projects"] },
  asana: { capabilities: ["Create task", "Update task", "Assign", "Status", "Projects"] },
  jira: { capabilities: ["Create task", "Update task", "Assign", "Status", "Comments"] },
  google_calendar: {
    capabilities: ["Create event", "Update event", "Cancel event", "Reminders"],
  },
  microsoft_calendar: {
    capabilities: ["Create event", "Update event", "Cancel event", "Reminders"],
  },
  quickbooks: { capabilities: ["Customers", "Invoices", "Payments", "Transactions", "Sync"] },
  xero: { capabilities: ["Customers", "Invoices", "Payments", "Sync"] },
  rest_api: { capabilities: ["Custom requests", "Sync"] },
  webhook: { capabilities: ["Inbound events", "Outbound events", "Signing"] },
  graphql: { capabilities: ["Queries", "Mutations"] },
  postgres: { capabilities: ["Read", "Write", "Sync"] },
  custom_connector: { capabilities: ["Marketplace manifest", "Custom actions"] },
  openai_compatible: { capabilities: ["Models", "Chat completions", "Embeddings"] },
  mcp_server: { capabilities: ["Tools", "Resources"], comingSoon: true },
};

export const PROVIDERS: ProviderDefinition[] = BASE_PROVIDERS.map((provider) => ({
  ...provider,
  ...(PROVIDER_META[provider.id] ?? {}),
}));

/** Categories a provider is listed under (primary + secondary). */
export function providerCategories(provider: ProviderDefinition): IntegrationCategory[] {
  return [provider.category, ...(provider.secondaryCategories ?? [])];
}

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
