# Changelog

## 2026-08-15 — The address components become canonical; the source's line becomes a receipt

The source sends an address twice, independently: one display line and six
structured components. We stored both and treated the line as canonical, while
`POST /orders/:id/contact` wrote only the line — so the first coordinator
correction made the two disagree permanently, with nothing recording which was
current (`todo-bugs.md` B5).

Nothing had chosen that arrangement. The components were added in Phase 2 with
a commit message saying they *"replace reliance on a single deliveryAddress
string"*, and the second half of that change never happened. The string won by
being there first.

The components are now canonical for everything operational — what a
coordinator edits, what order search queries, what the displayed line is built
from. `orders.delivery_address` is renamed `delivery_address_original` and made
immutable, holding the source's own line for audit only. Same pattern as
`pickupTimeOriginal`, and the same reasoning as D11: keep the original so a
question can be answered later, without letting it pretend to be the record.

**What removes the drift is that there is now one writable copy**, not better
synchronisation between two.

`lib/address.ts` builds the display line on every read; it is never stored.
Screens are unchanged — they still render `deliveryAddress` — but the value now
reflects corrections. `UpdateOrderContactRequest` drops `deliveryAddress` in
favour of the components, which the generated types turned into a compile error
at the single call site. Order search matches the components joined via
`concat_ws`, so "Hoofdstraat 12" still matches across two columns, and still
matches the original line so an order stays findable by the address it arrived
with.

The cost: we now punctuate addresses ourselves and can get it wrong. Joining
five fields means a missing one can print `Hoofdstraat , Amsterdam`. Note that
`street`, `postalCode` and `city` are `NOT NULL` but can still hold an empty
string, so a non-null column is not proof there is something to print. It can
only look wrong, never lose anything — the source's line is still stored. Most
of the 21 assertions are there to catch stray and doubled separators.

Resolves the deferred "Legacy `deliveryAddress` text column" note in
`todo-out-of-scope.md`. Rationale in `docs/workflow-decisions.md` D12.

## 2026-08-15 — Trip progress derives from order status

`trip_stops.completed_at` was read in four places to compute the coordinator's
trip progress bar, and **nothing in the codebase had ever written it**. Every
trip displayed 0% permanently (`todo-bugs.md` B4). Riders, meanwhile, had no
trip view at all — no route, no page, only a banner on the order screen.

Rather than add the missing write, the column is dropped and progress is read
off the record the rider already maintains. `lib/trip-progress.ts` is the only
place that decides what "done" means: a pickup stop is done once its order
reads `picked_up` or later, a dropoff once it reads `delivered`.

A failed order marks both of its stops **`skipped`** — a third state, not a
flavour of done. `orders.status` is last-write-wins, so after a failure there is
no way to tell whether the pickup happened first; `skipped` says what is known
(settled, not completed) instead of guessing. Outstanding work is therefore
`stopCount - doneStopCount - skippedStopCount`, and a failure never counts as
progress.

The API changed shape with it: `TripStop.completedAt` → `TripStop.state`
(`upcoming` / `done` / `skipped`), `TripListItem.completedStopCount` →
`doneStopCount` + `skippedStopCount`. `TripStopWithOrder` also gained
`restaurantAddress` and `customerPhone`, so a rider running a trip has somewhere
to go and someone to call without opening each order.

New rider view at `/rider/trips/:id`, reachable from a trips section on the
rider dashboard. It deliberately has **no controls of its own** — each stop
links through to the order screen, where status is already advanced. A tick box
here would have recreated the second record this change removes.

One consequence worth naming: `PUT /trips/:id/stops` used to carry `completedAt`
across by `(orderId, kind)` so a reorder wouldn't lose progress. Stops are now
replaced wholesale, because they record what to do and in what order, never
whether it happened. Rationale in `docs/workflow-decisions.md` D6.

## 2026-08-14 — Order status is a report, not a gate

Reverses a founding decision. The order state machine enforced a strictly
linear transition table and returned `422 INVALID_TRANSITION` on any deviation,
which `replit.md` §1 described as "strict server-validated state transitions".

That was actively blocking riders: one who forgot to tap "en route to
restaurant", arrived, and tapped "picked up" was refused while standing outside
the restaurant, with no way to express the skip — the rider UI only ever
rendered the single next step.

Status is now an observation reported by whoever is present. Skipping ahead and
correcting a mis-tap are both accepted, and the audit trail records the jump
that actually happened rather than inventing the steps in between. Three
invariants survive, because each is about data consistency rather than workflow
order: `pending` and `driver_assigned` stay coupled to `riderId` and are written
only by `/assign`; `delivered` and `failed` remain terminal, with the
intentional `delivered → failed` exception; and a transition must move the
order, which the route's atomic guard depends on.

The transition table is gone — the rules are short enough to express directly,
and `nextStatusesFor()` derives the reportable set from them. That set is
serialized onto every order as `allowedTransitions`, which removed the two
hand-maintained client copies that had drifted from the server and from each
other (`todo-bugs.md` B6). The rider keeps a one-tap primary button for the
expected next step — presentation, not validity — and can report any other
accepted status from a secondary list.

Documentation updated in step: `replit.md` §1, `architecture-full-technical.md`,
and the SSOT registry, which now carries an explicit "do not keep a transition
table in a client". Rationale in `docs/workflow-decisions.md` D1.

## 2026-08-14 — Inbound restaurant lookup switched from external-ID table to nameCode

Replaced the `restaurant_external_ids` indirection table with a direct `restaurants.nameCode` lookup. The inbound payload field is now `restaurantNameCode` (optional string) instead of `externalRestaurantId` (required string). If the field is absent or doesn't match any restaurant, the order is parked exactly as before. The `restaurant_external_ids` table was confirmed empty and dropped from the live database; its Drizzle schema file was removed. Matches the approach used by MenuMovers on Babeldish.

## 2026-08-14 — Live database schema applied (tasks 20/21 catch-up)

All schema work from earlier tasks that had never been pushed to the live database was applied: `name_code` columns on `restaurants` and `riders`, ~30 new `orders` columns (structured address, payment/tip/time-source fields, `is_parked`/`parked_reason`), new `api_credentials` and `restaurant_external_ids` tables, and the dead `order_items` table dropped. The task 21 agent had committed only a `.replit` change without running `drizzle-kit push`. Applied manually via raw SQL after truncating test rows; post-push drift check confirmed zero delta.

## 2026-08-14 — Composite TypeScript packages must be rebuilt after source changes

`lib/api-client-react` and `lib/api-zod` are TypeScript composite projects (`composite: true`, `emitDeclarationOnly`). TypeScript consumers resolve types from their compiled `.d.ts` output in `dist/`, not from the source. After Task #11 added `nameCode` to the OpenAPI spec and regenerated source files, nobody ran `tsc --build` on these packages — their `.d.ts` files remained stale and every consumer saw incorrect types (no `nameCode` on `Restaurant`, `CreateRestaurantRequest`, etc.). Fixed by running `tsc --build` in both packages. **Pattern established:** any task that runs codegen (`pnpm --filter @workspace/api-spec run codegen`) or edits source in a composite lib package must follow with `tsc --build` in that package before committing. See `docs/todo.md` M6 for the automation track.

## 2026-08-13 — Per-source inbound credentials replace the single shared secret

The inbound order endpoint (`POST /api/inbound/orders`) previously authenticated every caller against one static `INBOUND_SHARED_SECRET`, with no way to tell which upstream system sent an order — a design that couldn't distinguish Bestellenbij from any future second source. Added an `api_credentials` table (hashed per-source secret → source identifier) and switched the endpoint to authenticate against it via the `x-inbound-secret` header, deriving `source` from the matched credential row rather than trusting the request body. **This was a direct swap, not an addition** — `requireInboundSecret` was replaced by `requireInboundCredential` in the same code slot, so the old shared secret stopped working the moment this code deploys, with no fallback and no grace period. `INBOUND_SHARED_SECRET` retiring as an env var afterward is just cleanup of an already-dead value, not the actual cutover point.

## 2026-08-13 — Unresolved restaurants park orders instead of being rejected

Added a `restaurant_external_ids` table (source + external ID → internal restaurant) and a placeholder "Unmapped" restaurant row. An inbound order whose `externalRestaurantId` doesn't resolve is now stored against the placeholder with `isParked: true` and a `parkedReason`, instead of the previous hard 400 rejection. No dispatch/visibility mechanics were designed beyond making parked orders queryable — see `docs/todo-out-of-scope.md`, "Bestellenbij Integration" section.

## 2026-08-13 — Removed the dead order_items table

`lib/db/src/schema/order-items.ts` was created in the founding commit alongside `orders.items` (JSONB) as an alternate normalized design, but was never adopted — nothing in the codebase has ever read or written it; the item-overrides mechanism that's actually wired up everywhere indexes directly into `orders.items`. Removed the schema definition. The live table itself still needs to be dropped once confirmed empty, as part of the next database push.
