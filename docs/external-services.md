# External Services

This document is the single source of truth for every external connection this app has — what each partner sends, what we send back, how authentication works, and which env vars control the behaviour.

**Status:** partially populated. Only the inbound distribution service (below) has been verified and written up so far, as part of the Bestellenbij integration plan. The remaining services PM6 (`docs/todo.md`) calls for — PostgreSQL, outbound webhooks, Web Push/VAPID, JWT, CORS allowlist — still need their own sections; don't assume this file is complete just because it's no longer a blank placeholder.

---

## Inbound distribution service (babeldish)

**Direction:** Inbound only — babeldish (the distribution middleware) pushes orders to us.

**Status on this app's side: operational.** The endpoint, schema, active Bestellenbij credential, direct `restaurantNameCode` lookup, and unresolved-order fallback are present in the live development database. Credentialed ingest, idempotent replay, unmatched/absent restaurant codes, and invalid-credential rejection are covered by the smoke flow. Whether Babeldish is currently sending live traffic is external state and cannot be inferred from this repository.

### Endpoint

```
POST /api/inbound/orders
```

### Authentication

Callers send their raw per-source secret as the `x-inbound-secret` header. The secret is hashed (SHA-256) and looked up in `api_credentials` (one row per source, e.g. `source: "bestellenbij"`); the matched row's `source` is what the order is attributed to — the caller never declares its own source in the payload.

### What happens to orders

The payload's optional `restaurantNameCode` is matched directly and case-sensitively against `restaurants.nameCode`. If the field is absent or doesn't match any known restaurant, the order is **not rejected** — it is stored against the "Unmapped" restaurant with `holdState: "parked"`, a `holdReason`, and `heldAt`. Parked orders are visible to coordinators but excluded from new rider assignment until a coordinator resolves the restaurant.

### Env vars / provisioning

| Variable / mechanism | Required | Purpose |
|---|---|---|
| `api_credentials` table row | Yes, per source | Hashed secret + source identifier; provisioned via `scripts/src/provision-inbound-credential.ts` |
| Placeholder "Unmapped" restaurant row | Yes | Holds parked orders whose `restaurantNameCode` doesn't resolve; provisioned via `scripts/src/seed-unmapped-restaurant.ts` |
| `restaurants.nameCode` values | Per onboarded restaurant | The value the caller places in `restaurantNameCode`; must match exactly (case-sensitive) |

---

## Not yet documented (PM6, `docs/todo.md`)

- PostgreSQL (connection, migrations)
- Outbound webhooks to babeldish (status updates) — `replit.md` currently describes this as already live; that claim hasn't been independently verified as part of this pass, only the inbound side above was
- Web Push / VAPID
- JWT (auth tokens, revocation)
- CORS allowlist
