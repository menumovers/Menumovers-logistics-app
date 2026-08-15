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
| 6 | Delivery method — customer pickup out of rider scope, happy hour surfaced | D5 |
| 7 | Restaurant acknowledgement, with a per-restaurant confirmation style | D3 |
| 8 | Order receipt — numbered kitchen document, printable | D10 |

### Schema impact

Item 5 adds an `order_hold_state` enum and four columns to `orders`
(`hold_state`, `hold_reason`, `held_by_user_id`, `held_at`) plus an index, and
removes `is_parked` / `parked_reason`, which it replaces.

Item 7 adds a `restaurant_acceptance_mode` enum and `restaurants.acceptance_mode`
(default `accept`), plus `orders.restaurant_accepted_at` and
`orders.restaurant_accepted_by_user_id`.

Items 1–4 and 6 add no DDL — their settings are rows in the existing
`system_settings` key/value table.

---

## Part 2 — Applying the schema

Nothing is deployed anywhere yet, so there is no data to preserve and no
migration ceremony. Apply the schema and move on:

```
pnpm --filter @workspace/db run push
```

- [ ] Push applied
- [ ] `pnpm --filter @workspace/db run db:live-drift` reports no delta

The same holds for every change ahead: schema is changed in place and pushed.
No backfills, no deprecation cycles, no compatibility shims — until something
is actually running somewhere, retaining old shapes is pure cost.

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
- [ ] **Send an order with `deliveryMethod: "pickup"`.** It must not appear in
      any rider's open-orders list, and `/assign` on it must return
      `422 NOT_RIDER_DELIVERABLE`. It should show in the dispatch board's
      "Customer pickup" section instead.
- [ ] **Send one with `deliveryMethod: "happy_hour"`.** It stays normal rider
      work and gains a badge on both the dispatch and rider cards.
- [ ] **Confirm an order as restaurant staff** in each acceptance mode. Single
      confirm should record the acknowledgement and leave the pickup time alone;
      choosing "10 min later" should move `pickupTimeRestaurant` and log a
      pickup-time adjustment. Confirming twice must not overwrite who confirmed.
- [ ] **Check the coordinator board** shows "Unconfirmed" on orders the
      restaurant hasn't acknowledged — and that assigning one still works,
      since acknowledgement gates nothing.
- [ ] **Set a pickup time several days out** from the dispatch board, the rider
      screen and the restaurant screen. All three should keep the date you
      chose. This was B1 — previously the date could only ever be today or
      tomorrow, and the wrong value outranked the correct computed one.
- [ ] **Print a receipt** from the restaurant card and from the order detail.
      The app chrome should not appear in the printed output, and item lines
      should be unnumbered with room to write on — the kitchen annotates by
      hand when it labels packaging.
- [ ] **Hide an item, then reprint.** An "items changed after ordering" line
      should appear with the difference; the charged total must not move.
- [ ] **Send a cash order** and confirm the rider sees the amount to collect,
      the storefront's own payment wording, and any change to bring — plus a
      "Cash" badge on the list card before they open it.

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
can be planned rather than discovered. All of it is applied with a plain
`push` — nothing is deployed, so nothing needs preserving.

### D6 — trips

- `trip_stops.completedAt` becomes unused once progress derives from order
  status, and gets dropped with it.

---

## Part 6 — Known gaps

- **No automated tests, and the stand-in scripts rot.** 87 assertions cover the
  pure calculations — pickup times, money arithmetic, date handling, delivery
  method, the state machine, the receipt adjustment. They ran as throwaway
  scripts outside the repository, because there is no runner (`todo.md` H3).

  One of them proved the risk: it covered helpers that were later deleted with
  the compatibility shim, and passed **zero** assertions for several commits
  before a recount noticed. Nothing re-runs them, so nothing complains. Figures
  quoted about coverage should be counted at the time of quoting, not recalled.

  They would port directly if a runner is ever added, and that is the argument
  for adding one.
- **Outbound webhook request signing** does not exist and is a prerequisite for
  enabling the webhook (D7). Not tracked as active work.
- **Documentation corrections for D1** are pending sign-off: `replit.md` §1,
  `architecture-full-technical.md`:32, the SSOT transition table, and a planned
  test line in `todo-roadmap.md` all still describe the strict state machine.
