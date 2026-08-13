# External Services

This document is the single source of truth for every external connection this app has — what each partner sends, what we send back, how authentication works, and which env vars control the behaviour.

**Status:** partially populated. Only the inbound distribution service (below) has been verified and written up so far, as part of the Bestellenbij integration plan. The remaining services PM6 (`docs/todo.md`) calls for — PostgreSQL, outbound webhooks, Web Push/VAPID, JWT, CORS allowlist — still need their own sections; don't assume this file is complete just because it's no longer a blank placeholder.

---

## Inbound distribution service (babeldish)

**Direction:** Inbound only — babeldish (the distribution middleware) pushes orders to us.

**Status: planned/stub in production.** Code and schema are fully built and verified locally end-to-end (credentialed ingest, idempotent replay, parked-order fallback, invalid-credential rejection). No source has actually been switched over to it in the live environment yet — see the Bestellenbij integration plan for the current phase status.

### Endpoint

```
POST /api/inbound/orders
```

### Authentication

Callers send their raw per-source secret as the `x-inbound-secret` header. The secret is hashed (SHA-256) and looked up in `api_credentials` (one row per source, e.g. `source: "bestellenbij"`); the matched row's `source` is what the order is attributed to — the caller never declares its own source in the payload.

### What happens to orders

The payload's `externalRestaurantId` is resolved against `restaurant_external_ids` (scoped to the matched source) to find the internal restaurant. If it doesn't resolve, the order is **not rejected** — it's stored against a placeholder "Unmapped" restaurant with `isParked: true` and a `parkedReason` explaining what didn't match, so it's queryable rather than lost.

### Env vars / provisioning

| Variable / mechanism | Required | Purpose |
|---|---|---|
| `api_credentials` table row | Yes, per source | Hashed secret + source identifier; provisioned via `scripts/src/provision-inbound-credential.ts` |
| Placeholder "Unmapped" restaurant row | Yes | Holds parked orders whose `externalRestaurantId` doesn't resolve |
| `restaurant_external_ids` rows | Per onboarded restaurant | Maps a source's external restaurant ID to the internal restaurant |

---

## Not yet documented (PM6, `docs/todo.md`)

- PostgreSQL (connection, migrations)
- Outbound webhooks to babeldish (status updates) — `replit.md` currently describes this as already live; that claim hasn't been independently verified as part of this pass, only the inbound side above was
- Web Push / VAPID
- JWT (auth tokens, revocation)
- CORS allowlist
