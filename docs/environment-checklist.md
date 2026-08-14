# Environment Checklist

What was built in the workflow-alignment work, and what still has to happen in
a real environment before any of it is trustworthy.

Code changes are only half of a change. This file tracks the other half: schema
that must reach the database, settings that must be set, and behaviour that
can only be verified against a live system.

Companion to `docs/workflow-decisions.md`, which records *why* each of these
was decided.

---

## Part 1 — Built and pushed

Branch `claude/app-workflow-schema-alignment-n4dnrz`.

| # | Change | Decision |
|---|---|---|
| 1 | `docs/workflow-decisions.md` — nine settled decisions recorded so they stop being re-litigated | — |
| 2 | Settings registry (`api-server/src/lib/settings-registry.ts`) — settings declared once; reads, admin payload and validation derive from it | D9 |
| 3 | Outbound webhook off switch, default off, including gating the retry loop | D7 |
| 4 | Pickup time works scheduled orders back from the promised delivery time | D4 |
| 5 | The hold family — parked orders are gated, and coordinators can triage them | D2 |

### Schema impact

Items 1–4 need **no** `drizzle-kit push`. Their only `lib/db/` change is two
new `SETTING_KEYS` constants; settings are *rows* in the existing
`system_settings` key/value table, written lazily on first save.

**Item 5 does.** It adds a `order_hold_state` enum and four columns to
`orders` (`hold_state`, `hold_reason`, `held_by_user_id`, `held_at`) plus an
index. See Part 2a for the order of operations — it matters.

---

## Part 2a — Applying the hold family (D2)

The push is additive and safe: four nullable columns and a new enum. **Nothing
is dropped**, because `isParked` and `parkedReason` are deliberately retained
in the schema so a push cannot destroy parked rows before they're carried over.

```
pnpm --filter @workspace/db run push
```

**The backfill is optional, not a correctness prerequisite.** Readers fall back
to `isParked` for rows written before the hold family existed, so parked orders
stay gated whether or not it has run. Run it when convenient, to make
`hold_state` the single source of truth:

```sql
UPDATE orders
   SET hold_state  = 'parked',
       hold_reason = parked_reason,
       held_at     = COALESCE(held_at, created_at)
 WHERE is_parked = true
   AND hold_state IS NULL;
```

- [ ] Push applied
- [ ] Backfill run
- [ ] **Verify a parked order no longer appears in a rider's open-orders list.**
      This is the exposure D2 exists to close — before this change, any rider
      could self-claim an untriaged order.
- [ ] Verify the dispatch board shows an "On hold" section with a restaurant
      picker, and that choosing the correct restaurant clears the hold.
- [ ] Verify `/assign` on a held order returns `409 ORDER_ON_HOLD`.

Once the backfill is confirmed, the deprecated `isParked` / `parkedReason`
columns and the fallback in `lib/order-hold.ts` can be removed together. That
removal *is* destructive, so it should be its own deliberate change.

---

## Part 2 — One behaviour change on deploy

**The outbound webhook stops sending.** It now defaults to off, and an absent
setting row means off.

If `system_settings.outbound_webhook_url` currently holds a value in
production, then events *were* being dispatched and will stop the moment this
deploys. That is the intent of D7 — the receiving end doesn't exist yet — but
it is a real change in behaviour and shouldn't be a surprise.

- **To check:** `SELECT key, value FROM system_settings;`
- **To keep it sending:** flip the new toggle on the Admin → Settings screen.
  Note that the outbound POST is still unsigned (D7), so a receiver cannot
  verify it came from this app.

---

## Part 3 — Verify against a live system

None of this could be exercised in the build container: there is no
`DATABASE_URL`, so every database path is verified by types and inspection
only. These are the checks worth running once deployed.

- [ ] **Admin → Settings loads and saves.** This exercises the whole registry
      read/write path. Save the webhook URL, the self-claim toggle and the new
      travel override; confirm each persists across a reload.
- [ ] **Webhook source label still reads correctly.** It should show `settings`
      when set through the UI, `env` when only `WEBHOOK_URL` is present, and
      `unset` when neither — the registry took over this resolution.
- [ ] **Clearing the travel override.** Emptying the field should delete the
      row and fall back to per-order estimates, not store a zero.
- [ ] **Send a scheduled test order** with `deliveryTimeType: "later_today"`
      and a `requestedDeliveryTime` several hours out. The pickup time should
      land *before* the requested time by the travel figure — not 30 minutes
      from now. This is the bug the work exists to fix.
- [ ] **Check the ingestion log line.** Each new order logs
      `"Computed original pickup time"` with `pickupBasis` (`source` / `asap` /
      `scheduled`) and `travelMinutes`. If a pickup time ever looks wrong, this
      is where to look first.
- [ ] **Confirm ASAP orders are unchanged.** They should still be
      `now + travel`, exactly as before.

---

## Part 4 — Environment prerequisites

Pre-existing requirements, not introduced by this work, but each one will
break something if missed.

### Required

| Variable / state | Consequence if missing |
|---|---|
| `DATABASE_URL` | Nothing works. |
| `JWT_SECRET` | Authentication cannot sign or verify tokens. |
| `PORT` and `BASE_PATH` | **Both Vite builds fail outright** — the configs throw rather than defaulting. Tracked as `todo.md` M1. |
| The `unmapped` placeholder restaurant | Inbound orders with an unresolved restaurant code return `503 UNMAPPED_RESTAURANT_NOT_SEEDED` instead of parking. Seed via `scripts/src/seed-unmapped-restaurant.ts`. |
| At least one `api_credentials` row | Inbound ingestion rejects every caller. Provision via `scripts/src/provision-inbound-credential.ts`. |

### Optional

| Variable | Consequence if missing |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push degrades gracefully — the UI reports "not configured". |
| `CORS_ALLOWED_ORIGINS` | Permissive in non-production. Tracked as `todo.md` M4. |
| `WEBHOOK_URL` | Superseded by the admin setting; only a fresh-install fallback. |

### Build gotcha

After any codegen run, `tsc --build lib/api-zod lib/api-client-react` **must**
follow. These are composite packages and consumers resolve types from their
compiled `dist/`, not from source — skipping it means every consumer silently
sees stale types. Recorded in `changelog.md` (2026-08-14); automation tracked
as `todo.md` M6.

---

## Part 5 — Schema work that is coming

The decisions still to be built *do* require database changes. Listed so they
can be planned rather than discovered. (D2 is now built — see Part 2a.)

### D3 — restaurant acceptance

- `restaurants` gains an acceptance-mode column.
- `orders` gains an acknowledgement timestamp and the actor who confirmed.

### D6 — trips

- `trip_stops.completedAt` becomes unused once progress derives from order
  status. Dropping it is optional cleanup, not a requirement.

---

## Part 6 — Known gaps

- **No automated tests.** The pickup formula was verified with 17 assertions
  covering travel precedence, both scheduled branches, ASAP, source-supplied
  times and the deliberately-unclamped case — but they ran as a throwaway
  script and are not in the repository, because there is no test runner
  (`todo.md` H3). They would be worth preserving as the first real test if a
  runner is ever added.
- **Outbound webhook request signing** does not exist and is a prerequisite for
  enabling the webhook (D7). Not tracked as active work.
- **Documentation corrections for D1** are pending sign-off: `replit.md` §1,
  `architecture-full-technical.md`:32, the SSOT transition table, and a planned
  test line in `todo-roadmap.md` all still describe the strict state machine.
