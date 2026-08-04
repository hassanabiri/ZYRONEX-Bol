# ZYRONEX — Architecture Alignment v1.0

Alignment-only sprint. No pages rebuilt, no UI redesigned, no features removed,
no database changes, no business logic touched. The platform is now explicitly
described by three declarative modules:

- `src/lib/platform/core.ts` — Platform Core domains, Agent Lifecycle, provider seams
- `src/lib/platform/capabilities.ts` — reusable capabilities + Company Intelligence sources
- `src/lib/platform/layers.ts` — three layers, BUILD/OPERATE/MANAGE pillars, module map

## 1. Layers

| Layer | Contents |
| --- | --- |
| 1 — Platform Core | Workspace, Agent Builder, Runtime, Memory, Workflow, Decision Engine, Security, Observability (Mission Control, Workers, Agents, Workflow, Executions, Knowledge, Memory, Administration, Settings) |
| 2 — Expandable Services | Voice, Integrations, Resources, Billing, Developer APIs, AI providers, Learning services |
| 3 — Business Layer | Marketplace, Solutions, Templates, Pricing, Packages, Industry Solutions |

Dependency direction is one-way: 3 → 2 → 1. Core never imports from Layers 2/3.

## 2. Agent Lifecycle

Build → Configure → Deploy → Operate → Monitor → Learn → Improve → Replace.
Every module in `MODULE_MAP` declares the stages it serves; new features must
declare at least one.

## 3. Mission Control

`/dashboard` is classified as Mission Control — the operational command center
grounded in Workspace + Observability. Conceptual/architectural only; the UI and
navigation are unchanged.

## 4. BUILD / OPERATE / MANAGE

- BUILD: Workers, Agents, Workflow, Knowledge, Memory, Developer
- OPERATE: Mission Control, Executions, Voice, Integrations
- MANAGE: Workspace, Resources, Billing, Marketplace, Administration, Settings

## 5. Provider independence

Core touches no provider SDK. External systems enter only through:
node-handler registry (AI), voice catalog + service, payment provider slots,
integration catalog with encrypted credentials.

## Final report

### Already aligned
- Workspace is the tenancy root for every table and service (RLS enforced).
- Runtime is the single execution entry point; nothing runs a worker directly.
- Node handlers are registered, so AI providers are already replaceable.
- Integration credentials are encrypted and provider-neutral.
- Activity log is a single central audit trail for engine actions.
- Marketplace already sits outside core and only consumes it.

### Improved this sprint
- Platform Core is now explicit and typed, with each domain mapped to its files.
- Three layers formalized with a one-way dependency rule.
- Agent Lifecycle adopted as the primary philosophy and attached per module.
- Reusable capability registry introduced (agents assemble, not re-implement).
- Company Intelligence declared: learning is organizational, not per-agent.
- Dashboard classified as Mission Control; every module classified BUILD/OPERATE/MANAGE.
- Provider seams documented so future services plug in instead of coupling.

### Remaining future enhancements
- Attach capabilities to agents as data (worker ↔ capability link) instead of per-tab wiring.
- Register real AI/voice node handlers through the runtime registry (Layer 2).
- Promote the Decision Engine from validation-only to runtime branching/routing.
- Add a lint or CI rule enforcing the 3 → 2 → 1 import direction.
- Emit the documented engine lifecycle events (webhooks) from the runtime.
- Package Solutions/Templates as a distinct Layer 3 surface over the marketplace.
- Feed usage + execution signals into a shared Company Intelligence view.
