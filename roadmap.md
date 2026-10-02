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
- [x] Phase 14: Discord connector (official API v10 adapter: identity, guilds, channels, messages, replies, edit/delete, embeds, threads, reactions, interaction replies; Ed25519 verifier for Interactions + Webhook Events; 136 tests) — complete
- [ ] Tech debt: Discord Gateway (MESSAGE_CREATE etc.) needs a persistent WebSocket host — not available in the serverless runtime
- [ ] Tech debt: unified ingress cannot return provider-specific bodies (Discord interaction PONG / type 4, 204 for Webhook Events)

## Phase 15 — Slack Connector (done, awaiting approval)
- [x] Official Slack Web API adapter + Events API verifier on the existing framework (944/944 tests)
- Backlog: shared ingress cannot echo Slack url_verification challenge or answer slash/interactive payloads in-body
- Backlog: runtime ignores Retry-After from failed 429 responses (same shared item as Telegram retry_after)

## Phase 16 — Gmail Connector (done, awaiting approval)
- [x] Official Gmail API v1 adapter `google_mail` (messages, reply/forward, threads, labels, drafts, attachments JSON, search, history, watch/stop) + Pub/Sub push verifier; 148 tests
- Backlog: Pub/Sub push OIDC JWT signature (Google JWKS) needs async key fetch — shared verifier contract is sync; audience/issuer/expiry checked
- Backlog: catalog id `gmail` still aliases the generic `google` adapter (pinned by existing tests); switching it to `google_mail` is a one-line change awaiting approval
- Backlog: runtime ignores Retry-After from failed 429 responses (same shared item as Telegram/Slack)

## Phase 17 — Microsoft Graph (Outlook) Connector (done, awaiting approval)
- [x] One official Microsoft Graph v1.0 adapter `microsoft_graph` (aliases outlook / microsoft_365 / microsoft_calendar): identity, mail, folders, drafts, JSON attachments ≤3 MB, search, calendars/events, contacts, delta, subscriptions + clientState notification verifier
- Backlog: shared ingress cannot echo Graph `validationToken` (text/plain within 10s) — subscriptions cannot be validated in production until the ingress supports provider-specific bodies (same item as Slack/Discord)
- Backlog: runtime ignores Retry-After from failed 429 responses (same shared item as Telegram/Slack/Gmail)
- Backlog: rich notifications (encrypted resource data) need certificate management; basic notifications only

## Google Drive Connector (done — awaiting approval)
- Technical debt: `google_drive` catalog alias still resolves to the generic Google connector; the dedicated connector is `google_drive_api` (same pattern as Gmail).
- Technical debt: binary download / binary export / content upload need a binary transport in the shared runtime.
- Technical debt: failed-429 Retry-After not consumed by runtime (shared with Gmail/Slack/Telegram/Graph).
- Technical debt: channel renewal before expiration needs a shared scheduler.

## HubSpot CRM Connector (done — awaiting approval)
- Technical debt: webhook v3 signature needs HTTP method + full URI, not in the shared verifier input; v1 (client secret + body) is verified instead.
- Technical debt: HubSpot refresh-token revocation is DELETE /oauth/v1/refresh-tokens/{token}; shared revoke only supports POST form, so disconnect is local-only.
- Technical debt: portal identity relies on `hub_id` in the token response; otherwise confirm with get_account_details after connect.
- Technical debt: migrate v3/v4 paths to HubSpot date-versioned paths (single version table in the adapter).
- Technical debt: failed-429 Retry-After not consumed by runtime (shared).

## Salesforce CRM Connector (done — awaiting approval)
- [x] Adapter `salesforce` (REST v62.0), OAuth production + sandbox with PKCE, org-bound accounts, 241 tests.
- Technical debt: Salesforce omits `expires_in`; a 1h fallback forces early refresh.
- Technical debt: Outbound Messages need a SOAP <Ack> reply the shared ingress cannot send; Platform Events / CDC / Pub/Sub need a persistent streaming host.
- Technical debt: Retry-After after the final failed 429 (shared runtime item).
