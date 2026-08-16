# Environment Checklist

> ## This is a parking lot, not a to-do list
>
> Applying the schema, database work and every checkbox below is **end-game
> work, deliberately deferred** by the owner (2026-08-14, restated 2026-08-15):
> *"That is the end game. Do not worry about its checkboxes. Right now we're
> just working on code and architecture."*
>
> **Do not propose any of it as a next step, and do not report the unchecked
> boxes as open risk.** They are unchecked because that is the plan. This file
> exists so the work is not forgotten later — not so it is raised now.
>
> Recorded in `workflow-decisions.md` §G.

What was built in the workflow-alignment work, and what will have to happen in
a real environment before any of it is trustworthy — later, when that is the
task.

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
| 4 | Pickup time works scheduled orders back from the promised delivery time | D4, superseded by D13 |
| 5 | The hold family — parked orders are gated, and coordinators can triage them | D2 |
| 6 | Delivery method — customer pickup out of rider scope, happy hour surfaced | D5 |
| 7 | Restaurant acknowledgement, with a per-restaurant confirmation style | D3 |
| 8 | Order receipt — printable kitchen document | D10 |
| 9 | Trips — rider trip view, progress derived from order status | D6 |
| 10 | Address — components canonical, the source's line kept immutable for audit | D12 |
| 11 | Temporal mapping — two pickup anchors, clock no longer read | D13 |

### Schema impact

Item 5 adds an `order_hold_state` enum and four columns to `orders`
(`hold_state`, `hold_reason`, `held_by_user_id`, `held_at`) plus an index, and
removes `is_parked` / `parked_reason`, which it replaces.

Item 7 adds a `restaurant_acceptance_mode` enum and `restaurants.acceptance_mode`
(default `accept`), plus `orders.restaurant_accepted_at` and
`orders.restaurant_accepted_by_user_id`.

Item 10 **renames** `orders.delivery_address` to `delivery_address_original`.
A rename, not a drop — no data is lost — but `drizzle-kit push` may offer it as
a drop-and-add rather than a rename, which would empty it. Confirm the prompt
before accepting.

Item 9 **drops** `trip_stops.completed_at`. Nothing has ever written it, so
there is no data in it to lose — but see the warning below before running a
drop against anything that has been live.

Item 11 adds no DDL. It replaces the `pickup_travel_override_minutes`
`system_settings` row with `pickup_offset_minutes`, `pickup_within_minutes` and
`pickup_within_set_at`. The old row can simply be deleted; if left, nothing
reads it.

Items 1–4 and 6 add no DDL — their settings are rows in the existing
`system_settings` key/value table.

---

## Part 2 — Applying the schema

Nothing is deployed anywhere yet, so there is no data to preserve and no
migration ceremony. Apply the schema and move on:

```
pnpm --filter @workspace/db run push
```

- [x] Push applied — *ran clean against a fresh local database on 2026-08-15:
      `delivery_address` → `delivery_address_original`, `restaurant_ready_at`
      created, `trip_stops.completed_at` dropped.*
- [ ] `pnpm --filter @workspace/db run db:live-drift` reports no delta

### ⚠ The no-ceremony rule expired on 2026-08-14

For the duration of that session only, the owner's instruction was: *"there is
nothing yet in production, so don't even 1% hold things back trying to retain
something."* Schema was changed in place and pushed — no backfills, no
deprecation cycles, no compatibility shims.

**That authorization was scoped to that conversation and has lapsed.** It is not
a standing rule, and a later session must not read it as one. Before dropping a
column, skipping a backfill or removing a compatibility path, re-confirm that
nothing is running anywhere with data worth keeping. The cost of asking is a
sentence; the cost of assuming is a dropped column.

Recorded in `docs/constraint-overrides.md` O2.

---

## Part 3 — Verify against a live system

> ### Correction, 2026-08-15
>
> This section said for two days that nothing here could be exercised, "there
> is no `DATABASE_URL`". **PostgreSQL 16 was installed in the container the
> whole time.** Nobody checked. Every claim of the form *"verified by types and
> inspection only"* made before this date was a claim about effort not spent,
> not about what was possible.
>
> `./scripts/local-db.sh start` brings up a throwaway instance and prints a
> `DATABASE_URL`. It needs no Docker and no hosted database.

The boxes below are the checks worth running against a **deployed** system.
Several were run against a local instance on 2026-08-15 and are marked `[x]`
with what was observed — those verify the code, not the deployment.

- [ ] **Admin → Settings loads and saves.** This exercises the whole registry
      read/write path. Save the webhook URL, the self-claim toggle and both
      pickup settings; confirm each persists across a reload.
- [ ] **Webhook source label still reads correctly.** It should show `settings`
      when set through the UI, `env` when only `WEBHOOK_URL` is present, and
      `unset` when neither — the registry took over this resolution.
- [ ] **Clearing `pickupWithin`.** Emptying the field should delete the row and
      its `set_at` companion, not store a zero.
- [x] **Send a scheduled test order** with `deliveryTimeType: "later_today"`
      and a `requestedDeliveryTime` several hours out. Pickup must land exactly
      `pickupOffsetMinutes` before it. *Verified locally: delivery 20:00,
      offset 20 → pickup 19:40. Payload `MinPickupTime` values ignored, as D13
      requires.*
- [x] **Send an ASAP order with a `sourceCreatedAt` well in the past**, with
      `pickupWithin` unset. *Verified locally: checkout 17:00, shown 17:45,
      offset 20 → pickup 17:25. Anchored to the delivery time, not the clock.*
- [x] **Set `pickupWithin` to 10, then send one ASAP and one scheduled order.**
      *Verified locally: ASAP → 17:10, earlier than the 17:25 the offset rule
      gives. Scheduled → 19:40, unchanged.*
- [x] **Set `pickupWithin` to 60 and send an ASAP order.** *Verified locally:
      pickup 18:00 — later than 17:25, the same setting moving it both ways.*
- [ ] **Leave `pickupWithin` set overnight.** After 03:00 Amsterdam it should be
      gone from the admin screen without anyone touching it — and the stored row
      should be empty, not merely ignored.
- [ ] **Check the lead-time log field.** A short-notice order should show a small
      `leadMinutes` and still be accepted.
- [ ] **Check the ingestion log line.** Each new order logs
      `"Computed original pickup time"` with `pickupBasis` (`within` /
      `offset`), `pickupMinutes`, `pickupAnchor` (`order_arrival` /
      `delivery_time`), `leadMinutes` and `sourceCreatedAt`. If a pickup time ever looks wrong, this
      is where to look first.
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
- [ ] **Build a two-order trip and assign it to a rider.** The trip should
      appear on that rider's dashboard and nowhere else — check a second
      rider's dashboard doesn't show it.
- [ ] **Walk one order through to delivered.** The trip's progress must move on
      its own, with the rider tapping nothing on the trip screen: its pickup
      stop turns done at `picked_up`, its dropoff at `delivered`. This was B4 —
      progress used to sit at 0% forever.
- [ ] **Fail the other order.** Both of its stops should read as skipped, not
      done, and the trip should then show no outstanding stops.
- [ ] **Reorder the stops from the coordinator screen** on a part-finished
      trip. Progress must survive the reorder — it is read from the orders, and
      replacing stops no longer has anything to carry across.

- [x] **Correct an address** via `POST /orders/:id/contact`. *Verified locally:
      derived line became "Hoofdstraat 99, 1017 CD Amsterdam" while
      `deliveryAddressOriginal` stayed "Kade 5, 1011 AB Amsterdam".*
- [x] **Search for the old address** afterwards. *Verified locally: the order is
      found by both the corrected street and the original one.*
- [ ] **Replay an order** through inbound ingestion. `delivery_address_original`
      must not move, matching `pickup_time_original`.

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

*Nothing pending.* D6 was the last decision carrying a schema change, and it is
built — its column drop is folded into Part 1's schema impact above.

---

## Part 5b — Verified against a real database, 2026-08-15

Run with `./scripts/local-db.sh start`, the built API server, and `curl`. Not a
deployment test — it verifies the code, not the environment.

| Decision | Checked | Result |
|---|---|---|
| Schema | `drizzle-kit push` against an empty database | Clean. Rename applied as a rename; dropped column gone. |
| D13 | ASAP, offset rule | checkout 17:00, shown 17:45 → **17:25** |
| D13 | scheduled | shown 20:00 → **19:40** |
| D13 | `pickupWithin` 10 (quiet) | → **17:10**, earlier than the offset rule |
| D13 | `pickupWithin` 60 (busy) | → **18:00**, later — same knob, both directions |
| D13 | `pickupWithin` on a scheduled order | → **19:40**, ignored, as designed |
| D12 | address correction | derived line changed, original unchanged |
| D12 | order search | found by both the corrected and the original address |
| D14 | `POST /orders/:id/ready` | `restaurantReadyAt` set; **both pickup times unchanged** |
| D2 | assign a held order | `422 ORDER_ON_HOLD` |
| D2 | release, then assign | `driver_assigned`, rider attached |
| D1 | `allowedTransitions` | serialized, and excludes the rider-coupled statuses |

The D14 row is the one worth keeping: it is the exact bug — a status update
overwriting a negotiated pickup time — shown fixed against real rows rather
than asserted.

---

## Part 6 — Known gaps

- **No automated tests, and the stand-in scripts rot.** 162 assertions across
  nine scripts cover the pure calculations — pickup times (23), money arithmetic
  (21), date handling (13), delivery method (5), the state machine (23), the
  receipt adjustment (9), trip progress (25), address formatting (21), the daily
  reset including both DST transitions (22). All nine were re-run and re-counted
  on 2026-08-15.

  Worth naming after today: **a passing count says the code matches the rule it
  was written against, never that the rule is right.** Four pickup formulas had
  green assertions before the fifth turned out to be the correct one. They live as throwaway scripts outside the
  repository, because there is no runner (`todo.md` H3).

  One of them proved the risk: it covered helpers that were later deleted with
  the compatibility shim, and passed **zero** assertions for several commits
  before a recount noticed. Nothing re-runs them, so nothing complains. Figures
  quoted about coverage should be counted at the time of quoting, not recalled.

  They would port directly if a runner is ever added, and that is the argument
  for adding one.
- **Outbound webhook request signing** does not exist and is a prerequisite for
  enabling the webhook (D7). Not tracked as active work.
- **Documentation is reconciled at the end of the work stream, not per
  decision** (`workflow-decisions.md` §G). Docs that still describe the
  project's older intentions are expected, and are not a gap to report.

  The D1 corrections *were* made — `replit.md` §1, `architecture-full-technical.md`,
  the SSOT registry and the `todo-roadmap.md` test line all describe
  status-as-report now. This entry previously called them "pending sign-off",
  which was both stale and the wrong frame: it treated one decision inside a
  contained process as if it needed its own approval gate.
