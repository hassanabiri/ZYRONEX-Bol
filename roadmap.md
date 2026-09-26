# ZYRONEX roadmap

- [x] Phase 7: Shopify connector (adapter, OAuth, webhooks, 41 tests) — complete
- [x] Phase 8: WooCommerce connector (adapter, REST v3 basic auth, webhooks, 52 tests) — complete
- [x] Commerce Connector Framework Audit: contracts/errors/vault/webhooks/registry/runtime verified; shared adapter helpers extracted to adapters/shared.ts; 194/194 tests still green
- [x] Phase 9: WhatsApp Business Cloud connector (official Meta Cloud API adapter, messages/templates/media/status, webhook verifier + subscribe challenge, 78 tests) — complete; 272/272 green
- [x] Phase 10: Instagram connector (official Instagram Graph API adapter, messaging/comments/publishing/insights, OAuth via Facebook Login for Business, X-Hub-Signature-256 verifier with replay protection + dedupe, 85 tests) — complete; 357/357 green
- [x] Phase 11: Facebook Pages connector (official Pages Graph API: discovery, page info, posts, comments, reactions read, insights, subscriptions; feed webhook verifier; 86 tests) — complete; 443/443 green. 
- [x] Phase 12: Messenger connector (official Messenger Platform: Send API text/reply/attachments/templates/sender actions, Attachment Upload, Conversations, User Profile, Messenger Profile, subscriptions; messaging webhook verifier with replay + dedupe; 96 tests) — complete; 539/539 green.
- [x] Phase 13: Telegram connector (official Bot API: getMe/bot profile, send text/reply/media/location/contact/poll, edit/delete, keyboards + callback queries, getFile, chats, getUpdates offset, set/get/delete webhook; secret-token verifier + 24h replay window + update_id dedupe; 146 tests) — complete; 685/685 green. Next connector awaiting approval
- [ ] Technical Debt backlog (deferred by the user, system works without them): unify the idempotency strategy across connectors; unify the store/account key naming (store_url / store_domain / shop_domain); stop re-reading standard rate-limit headers in per-adapter readRateLimit; runtime backoff ignores retry-after carried in error bodies (e.g. Telegram parameters.retry_after)
- [ ] UI polish: make marketing site + internal app far more attractive to convert visitors
