/**
 * Static content model for the public (marketing) experience.
 * Everything the outer site renders is data-driven so pages stay consistent,
 * translatable and easy to extend. No fabricated metrics or fake testimonials:
 * copy describes product capabilities only.
 */

export type SiteNavItem = { title: string; to: string; description?: string };
export type SiteNavGroup = { label: string; items: SiteNavItem[] };

export const siteNav: SiteNavGroup[] = [
  {
    label: "Platform",
    items: [
      { title: "About ZYRONEX", to: "/about", description: "The AI business operating system." },
      { title: "AI Workers", to: "/ai-workers", description: "Build, deploy and supervise agents." },
      { title: "Integrations", to: "/connectors", description: "Connect the tools you run on." },
      { title: "Security", to: "/security", description: "Isolation, RBAC and audit by default." },
      { title: "System status", to: "/status", description: "Live platform availability." },
    ],
  },
  {
    label: "Solutions",
    items: [
      { title: "Solutions", to: "/solutions", description: "Outcomes ZYRONEX is built for." },
      { title: "Industries", to: "/industries", description: "Tailored operating blueprints." },
      { title: "Partners", to: "/partners", description: "Build and deliver with us." },
    ],
  },
  {
    label: "Developers",
    items: [
      { title: "Developer center", to: "/developers", description: "Projects, SDKs and plugins." },
      { title: "API reference", to: "/api", description: "Scoped keys and REST endpoints." },
      { title: "Changelog", to: "/changelog", description: "What shipped, and when." },
    ],
  },
  {
    label: "Resources",
    items: [
      { title: "Help center", to: "/help", description: "Guides, tickets and AI support." },
      { title: "Knowledge center", to: "/knowledge-center", description: "Deep operating playbooks." },
      { title: "Academy", to: "/academy", description: "Learn the platform end to end." },
      { title: "Blog", to: "/blog", description: "Product and engineering notes." },
      { title: "FAQ", to: "/faq", description: "Straight answers, fast." },
    ],
  },
];

export const siteFooter: SiteNavGroup[] = [
  {
    label: "Product",
    items: [
      { title: "AI Workers", to: "/ai-workers" },
      { title: "Solutions", to: "/solutions" },
      { title: "Industries", to: "/industries" },
      { title: "Integrations", to: "/connectors" },
      { title: "Pricing", to: "/pricing" },
      { title: "Compare plans", to: "/compare" },
    ],
  },
  {
    label: "Developers",
    items: [
      { title: "Developer center", to: "/developers" },
      { title: "API reference", to: "/api" },
      { title: "Changelog", to: "/changelog" },
      { title: "System status", to: "/status" },
    ],
  },
  {
    label: "Resources",
    items: [
      { title: "Help center", to: "/help" },
      { title: "Knowledge center", to: "/knowledge-center" },
      { title: "Academy", to: "/academy" },
      { title: "Blog", to: "/blog" },
      { title: "FAQ", to: "/faq" },
    ],
  },
  {
    label: "Company",
    items: [
      { title: "About", to: "/about" },
      { title: "Partners", to: "/partners" },
      { title: "Careers", to: "/careers" },
      { title: "Press", to: "/press" },
      { title: "Contact", to: "/contact" },
      { title: "See ZYRONEX run on your business", to: "/demo" },
    ],
  },
  {
    label: "Legal",
    items: [
      { title: "Security", to: "/security" },
      { title: "Privacy", to: "/privacy" },
      { title: "Terms", to: "/terms" },
    ],
  },
];

/** Product pillars shown on the homepage. */
export const pillars = [
  {
    title: "Build",
    headline: "Design an AI worker in minutes",
    body: "A guided builder covers identity, purpose, provider, language and review — then versions every change.",
    points: ["Worker builder wizard", "Version snapshots", "Import & export"],
  },
  {
    title: "Operate",
    headline: "Run work through a real execution engine",
    body: "Visual workflows, typed nodes, validation, queueing, retries and a step-by-step execution timeline.",
    points: ["Workflow canvas", "Queue & retries", "Execution timeline"],
  },
  {
    title: "Manage",
    headline: "Govern cost, access and evidence",
    body: "Workspace isolation, custom roles, a permission matrix, credit ledgers, invoices and a full audit log.",
    points: ["RBAC & approvals", "Credit ledgers", "Audit trail"],
  },
];

export const capabilities = [
  { title: "Workspaces", body: "Every tenant owns its members, workers, data, credits and policies. Isolation is enforced in the database." },
  { title: "AI Workers", body: "Purpose-built agents with knowledge, memory, tools, voice and permissions attached to each worker." },
  { title: "Workflow engine", body: "A visual canvas with start, prompt, decision, HTTP, loop and handoff nodes, validated before it runs." },
  { title: "Knowledge", body: "Bases, sources and documents with an ingestion pipeline and search, assignable per worker." },
  { title: "Memory", body: "Layered persistent memory with stores, entries, timeline and analytics across every run." },
  { title: "Voice", body: "Numbers, provider architecture, voice profiles, recording policy, call logs and analytics." },
  { title: "Integrations", body: "A connection wizard, encrypted credentials, webhooks, sync engine and health monitoring." },
  { title: "Billing & credits", body: "Subscriptions, multi-type credit ledgers, metered usage tracking and invoice generation." },
  { title: "Observability", body: "Executions, activity log, system health and notifications in one mission-control surface." },
];

export const industries = [
  { name: "Financial services", body: "Controlled automation with approvals, audit evidence and strict data isolation." },
  { name: "Healthcare", body: "Document-heavy workflows with knowledge grounding and recorded decisions." },
  { name: "Retail & e-commerce", body: "Campaign, catalogue and support workers coordinated from one workspace." },
  { name: "Real estate", body: "Voice-enabled workers for enquiries, viewings and follow-up pipelines." },
  { name: "Professional services", body: "Research, drafting and reporting workers with shared knowledge bases." },
  { name: "Technology", body: "Developer projects, scoped API keys, plugins and SDK distribution." },
];

export const integrationGroups = [
  { group: "Communication", items: ["Slack", "Microsoft Teams", "Gmail", "Outlook", "WhatsApp Business"] },
  { group: "CRM & sales", items: ["Salesforce", "HubSpot", "Pipedrive", "Zoho CRM"] },
  { group: "Data & storage", items: ["PostgreSQL", "Google Sheets", "Airtable", "Amazon S3", "Google Drive"] },
  { group: "Productivity", items: ["Notion", "Jira", "Asana", "Trello", "Linear"] },
  { group: "Voice & telephony", items: ["Twilio", "Telnyx", "Vonage", "SIP trunking"] },
  { group: "Commerce & finance", items: ["Stripe", "Shopify", "WooCommerce", "QuickBooks"] },
];

export type Plan = {
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
  highlighted?: boolean;
  cta: string;
  to: string;
};

export const plans: Plan[] = [
  {
    name: "Starter",
    price: "$0",
    cadence: "to begin",
    tagline: "Explore the platform with one workspace.",
    features: ["1 workspace", "Up to 3 AI workers", "Workflow canvas", "Community support"],
    cta: "Create account",
    to: "/auth",
  },
  {
    name: "Growth",
    price: "Contact us",
    cadence: "per workspace",
    tagline: "For teams operating agents in production.",
    features: [
      "Unlimited workers",
      "Knowledge & memory engines",
      "Integrations & webhooks",
      "Credit ledgers and usage tracking",
      "Custom roles and approvals",
    ],
    highlighted: true,
    cta: "Design your system with AI",
    to: "/solution-builder",
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "annual",
    tagline: "Governance, scale and dedicated support.",
    features: [
      "Everything in Growth",
      "Voice platform & telephony",
      "SSO and advanced RBAC",
      "Audit exports and retention controls",
      "Named support and onboarding",
    ],
    cta: "Design your system with AI",
    to: "/solution-builder",
  },
];

export const planComparison = {
  rows: [
    { label: "Workspaces", values: ["1", "Unlimited", "Unlimited"] },
    { label: "AI workers", values: ["3", "Unlimited", "Unlimited"] },
    { label: "Workflow engine", values: ["Included", "Included", "Included"] },
    { label: "Knowledge & memory", values: ["Basic", "Full", "Full"] },
    { label: "Integrations", values: ["Limited", "Full catalogue", "Full catalogue"] },
    { label: "Voice platform", values: ["—", "Add-on", "Included"] },
    { label: "Custom roles & approvals", values: ["—", "Included", "Included"] },
    { label: "Audit export", values: ["—", "Included", "Extended retention"] },
    { label: "Support", values: ["Community", "Priority", "Named team"] },
  ],
  columns: ["Starter", "Growth", "Enterprise"],
};

export const faqs = [
  {
    q: "What exactly is ZYRONEX?",
    a: "An AI business operating platform. You build AI workers, give them knowledge, memory, tools and voice, run them through a workflow engine, and govern cost and access from one workspace.",
  },
  {
    q: "Is my data isolated from other companies?",
    a: "Yes. Every record belongs to a workspace and access is enforced with row-level security in the database, not only in the interface.",
  },
  {
    q: "Can I bring my own AI provider?",
    a: "The platform is provider-independent by design: AI, voice and payment providers sit behind replaceable seams so you are never locked into one vendor.",
  },
  {
    q: "How is usage billed?",
    a: "Through credit ledgers per service type with metered usage tracking, subscriptions and generated invoices in the Billing Center.",
  },
  {
    q: "Do I need engineers to start?",
    a: "No. The worker builder and workflow canvas are visual. Engineers get a developer center, scoped API keys, plugins and SDKs when they want to go deeper.",
  },
  {
    q: "Is Arabic supported?",
    a: "Yes, the entire product and site run in Arabic and English with full RTL support.",
  },
];

/** Content-driven secondary pages. */
export type ContentSection = { heading: string; body: string; bullets?: string[] };
export type ContentPage = {
  slug: string;
  eyebrow: string;
  title: string;
  description: string;
  sections: ContentSection[];
  cta?: { label: string; to: string };
};

export const contentPages: Record<string, ContentPage> = {
  about: {
    slug: "/about",
    eyebrow: "Company",
    title: "An operating system for AI-run business",
    description: "ZYRONEX exists so a company can build, operate and govern its AI workforce from a single control plane instead of a pile of disconnected tools.",
    sections: [
      { heading: "Why we built it", body: "Most AI tooling stops at a chat box. Real companies need identity, permissions, budgets, workflows, evidence and support around every automated action. ZYRONEX puts that operating layer first." },
      { heading: "How it is organised", body: "Three layers keep the platform coherent as it grows.", bullets: ["Layer 1 — Platform core: workspaces, workers, runtime, memory, workflow, security, observability.", "Layer 2 — Expandable services: voice, billing, integrations, knowledge, developer platform.", "Layer 3 — Business layer: marketplace, solutions and industry blueprints."] },
      { heading: "The agent lifecycle", body: "Every worker follows the same path: build, configure, deploy, operate, monitor, learn, improve, replace. Nothing runs outside that lifecycle." },
    ],
    cta: { label: "Explore AI Workers", to: "/ai-workers" },
  },
  solutions: {
    slug: "/solutions",
    eyebrow: "Solutions",
    title: "Outcomes, not features",
    description: "Assemble workers, knowledge and workflows around the result you need — then measure it.",
    sections: [
      { heading: "Customer operations", body: "Voice and messaging workers handle enquiries, escalate with approvals and log every interaction for review.", bullets: ["Voice numbers and profiles", "Knowledge-grounded answers", "Escalation with approvals"] },
      { heading: "Revenue and marketing", body: "A marketing manager worker plans strategy, coordinates specialist workers and reports ROI, ROAS, CAC and CPA from real campaign data.", bullets: ["Campaign and budget board", "Creative delegation", "Executive reporting"] },
      { heading: "Back office automation", body: "Document ingestion, structured extraction and multi-step workflows with retries, validation and a complete audit trail.", bullets: ["Knowledge pipeline", "Workflow validation", "Audit log"] },
    ],
    cta: { label: "See pricing", to: "/pricing" },
  },
  industries: {
    slug: "/industries",
    eyebrow: "Industries",
    title: "Operating blueprints per sector",
    description: "The same core platform, configured for the controls and workflows each sector expects.",
    sections: industries.map((industry) => ({ heading: industry.name, body: industry.body })),
    cta: { label: "See ZYRONEX run on your business", to: "/demo" },
  },
  developers: {
    slug: "/developers",
    eyebrow: "Developers",
    title: "Build on ZYRONEX",
    description: "Projects, OAuth clients, environment variables, plugins and SDKs — all scoped to your workspace.",
    sections: [
      { heading: "Developer projects", body: "Create a project, issue scoped credentials and manage environment variables per environment." },
      { heading: "Plugins", body: "Extend workers with plugins that register tools and handlers inside the execution engine." },
      { heading: "SDKs", body: "Typed clients for the public API so your services can create runs and read results directly." },
    ],
    cta: { label: "Read the API reference", to: "/api" },
  },
  api: {
    slug: "/api",
    eyebrow: "Reference",
    title: "API reference",
    description: "A REST surface secured with scoped, workspace-bound API keys.",
    sections: [
      { heading: "Authentication", body: "Send your workspace API key as a bearer token. Keys carry explicit scopes and can be rotated or revoked at any time." },
      { heading: "Core resources", body: "Workers, workflows, executions, knowledge bases, documents, memory stores and usage records.", bullets: ["GET /v1/workers", "POST /v1/executions", "GET /v1/executions/{id}", "POST /v1/knowledge/documents"] },
      { heading: "Webhooks", body: "Subscribe to execution and integration events with signed payloads and delivery logs." },
    ],
    cta: { label: "Open developer center", to: "/developers" },
  },
  changelog: {
    slug: "/changelog",
    eyebrow: "Product",
    title: "Changelog",
    description: "Every meaningful change to the platform, in order.",
    sections: [
      { heading: "Developer platform & marketplace", body: "Developer projects, OAuth clients, environment variables, SDK distribution, plugins and the marketplace with reviews and installs." },
      { heading: "Voice & billing platforms", body: "Numbers, providers, voice profiles, call analytics, subscriptions, multi-type credit ledgers, metered usage and invoices." },
      { heading: "Integration hub", body: "Connection wizard, encrypted credentials, webhooks, sync engine, health monitoring and logs." },
      { heading: "Knowledge & memory engines", body: "Knowledge bases, ingestion pipeline, search, layered memory, prompt library and analytics." },
      { heading: "Execution engine", body: "Workflow canvas, typed nodes, validation, queue manager, retries and execution timelines." },
    ],
  },
  partners: {
    slug: "/partners",
    eyebrow: "Ecosystem",
    title: "Partner with ZYRONEX",
    description: "Implementation, technology and reseller partners building on the platform.",
    sections: [
      { heading: "Implementation partners", body: "Deliver workspaces, workers and workflows for customers with shared blueprints and enablement." },
      { heading: "Technology partners", body: "Publish connectors, plugins and templates to the marketplace and reach every workspace." },
      { heading: "Resellers", body: "Package ZYRONEX with your services under agreed commercial terms." },
    ],
    cta: { label: "Contact the partner team", to: "/contact" },
  },
  status: {
    slug: "/status",
    eyebrow: "Reliability",
    title: "System status",
    description: "Availability of the platform surfaces, published transparently.",
    sections: [
      { heading: "Application", body: "Workspace, dashboard, worker builder and workflow canvas." },
      { heading: "Execution engine", body: "Queue processing, runtime workers and execution timelines." },
      { heading: "Integrations", body: "Connections, webhook delivery and synchronisation jobs." },
      { heading: "Incident history", body: "Incidents and maintenance windows are published here with timestamps and resolutions." },
    ],
  },
  security: {
    slug: "/security",
    eyebrow: "Trust",
    title: "Security by construction",
    description: "Isolation, least privilege and evidence are structural properties of the platform, not add-ons.",
    sections: [
      { heading: "Tenant isolation", body: "Every table enforces row-level security scoped to the workspace. There is no shared read path between tenants." },
      { heading: "Access control", body: "Custom roles, a permission matrix grouped by module, member suspension and approval flows for sensitive actions." },
      { heading: "Credential protection", body: "Integration credentials are encrypted with AES-256-GCM and never returned to the browser." },
      { heading: "Evidence", body: "Activity and audit logs record who did what, when, and against which resource." },
    ],
    cta: { label: "Read the privacy policy", to: "/privacy" },
  },
  privacy: {
    slug: "/privacy",
    eyebrow: "Legal",
    title: "Privacy policy",
    description: "What we collect, why we collect it and the control you keep over it.",
    sections: [
      { heading: "Data we process", body: "Account details, workspace content you create, and operational telemetry needed to run and secure the service." },
      { heading: "Purpose", body: "Providing the platform, billing usage, securing accounts and supporting you. We do not sell personal data." },
      { heading: "Your controls", body: "Export or delete workspace content, manage members and roles, and rotate or revoke credentials at any time." },
      { heading: "Contact", body: "Privacy questions can be sent through the contact page and are routed to the responsible team." },
    ],
  },
  terms: {
    slug: "/terms",
    eyebrow: "Legal",
    title: "Terms of service",
    description: "The agreement that governs use of ZYRONEX.",
    sections: [
      { heading: "Your account", body: "You are responsible for the accuracy of account information and for activity performed under your credentials." },
      { heading: "Acceptable use", body: "The platform may not be used for unlawful activity, to infringe rights, to distribute malware, or to send unsolicited communications." },
      { heading: "Termination", body: "Either party may terminate the workspace subscription. Your content remains exportable for a reasonable period after cancellation." },
      { heading: "Limitation of liability", body: "ZYRONEX is provided as-is within the limits described in the service agreement. Automated decisions remain your responsibility to review." },
    ],
  },
  careers: {
    slug: "/careers",
    eyebrow: "Join us",
    title: "Careers at ZYRONEX",
    description: "Help build the operating system for AI-run business.",
    sections: [
      { heading: "Engineering", body: "Platform, infrastructure, AI runtime and security. We value craft, ownership and clear writing." },
      { heading: "Product & design", body: "Product managers, designers and researchers shaping a complex product for everyday clarity." },
      { heading: "Solutions", body: "Implementation, enablement and customer success for teams adopting AI workers at scale." },
    ],
    cta: { label: "Contact us", to: "/contact" },
  },
  press: {
    slug: "/press",
    eyebrow: "Media",
    title: "Press kit",
    description: "Brand assets, product facts and contact information for journalists.",
    sections: [
      { heading: "About ZYRONEX", body: "ZYRONEX is the AI business operating platform: workspaces, workers, workflow engine, knowledge, memory, voice, integrations and billing in one control plane." },
      { heading: "Brand assets", body: "Logo, wordmark and colour guidance are available on request." },
      { heading: "Press contact", body: "Media enquiries are routed through the contact page." },
    ],
  },
  academy: {
    slug: "/academy",
    eyebrow: "Learn",
    title: "ZYRONEX Academy",
    description: "Structured paths that take you from first workspace to production operations.",
    sections: [
      { heading: "Foundations", body: "Workspaces, members, roles and the permission matrix. Your first AI worker end to end." },
      { heading: "Operating agents", body: "Workflows, nodes, validation, queues, retries and reading execution timelines." },
      { heading: "Scaling", body: "Knowledge pipelines, memory layers, integrations, credits and cost governance." },
    ],
    cta: { label: "Browse the help center", to: "/help" },
  },
  blog: {
    slug: "/blog",
    eyebrow: "Writing",
    title: "Blog",
    description: "Notes on building an operating platform for AI workers.",
    sections: [
      { heading: "Designing the execution engine", body: "Why agent work belongs in a validated graph with queues, retries and timelines instead of ad-hoc calls." },
      { heading: "Governing AI spend", body: "Credit ledgers per service type, metered usage and why forecasting burn beats hard limits." },
      { heading: "Multi-tenancy that holds", body: "Row-level security as the default posture, and what that changes in product design." },
    ],
  },
  "knowledge-center": {
    slug: "/knowledge-center",
    eyebrow: "Resources",
    title: "Knowledge center",
    description: "Operating playbooks for teams running AI workers in production.",
    sections: [
      { heading: "Worker design playbook", body: "Scope, purpose, guardrails and the review checklist before a worker is deployed." },
      { heading: "Knowledge grounding", body: "Choosing sources, structuring bases and assigning them to the right workers." },
      { heading: "Cost governance", body: "Budget allocation, alerts and the monthly review loop for credits and invoices." },
    ],
    cta: { label: "Open the academy", to: "/academy" },
  },
};
