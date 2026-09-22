# ZYRONEX roadmap

- [x] Phase 7: Shopify connector (adapter, OAuth, webhooks, 41 tests) — complete
- [x] Phase 8: WooCommerce connector (adapter, REST v3 basic auth, webhooks, 52 tests) — complete
- [x] Commerce Connector Framework Audit: contracts/errors/vault/webhooks/registry/runtime verified; shared adapter helpers extracted to adapters/shared.ts; 194/194 tests still green
- [x] Phase 9: WhatsApp Business Cloud connector (official Meta Cloud API adapter, messages/templates/media/status, webhook verifier + subscribe challenge, 78 tests) — complete; 272/272 green
- [ ] Technical Debt backlog (deferred by the user, system works without them): unify the idempotency strategy across connectors; unify the store/account key naming (store_url / store_domain / shop_domain); stop re-reading standard rate-limit headers in per-adapter readRateLimit
- [ ] UI polish: make marketing site + internal app far more attractive to convert visitors
