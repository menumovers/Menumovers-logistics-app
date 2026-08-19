# Changelog

## 2026-08-19 — Multi-role accounts get a non-destructive production bridge

The production rollout is now explicitly two-stage. Stage one retains the
legacy `users.role` column while adding `user_roles`; authentication and admin
user listings prefer canonical role rows but fall back to the legacy role only
when an account has no rows yet. This keeps every existing account able to sign
in through the first Publish.

Admin → Users now reports whether every account has canonical role rows and
offers an idempotent initialization action. It copies a legacy role only for
accounts with zero rows, so repeating it cannot overwrite multi-role choices or
re-add a stale role to an already-migrated account. The legacy column and this
temporary UI/API bridge are removed only in a separate second Publish after the
panel reports all accounts ready.

## 2026-08-18 — New `subtotal` field (menu items only, receipt data)

`InboundOrderPayload`/`Order` gain `subtotal` — the menu items total,
before delivery fee, tips, SUP/statiegeld or administration costs. Sent by
Babeldish directly (not computed here), matching how the rest of the money
breakdown already works. Threaded through the ingestion mapping in
`routes/orders.ts` and `order-serialize.ts`, and shown as its own line on
the receipt, above the delivery/tip/other breakdown — the same "receipt
data, not operational data" treatment as D10's other breakdown fields.

**Nullable, not required, on `Order`:** unlike the rest of that group,
`subtotal` is nullable at the DB and API level, because real orders already
existed when this field was added — a `NOT NULL` column with no default
would have failed to apply against them. Every order ingested from here on
has one (the source payload requires it), so this is purely a migration
accommodation for historical rows, which show "—" on the receipt rather
than a fabricated number. No backfill script this time — there was nothing
to backfill from; historical orders' `originalPayload` predates Babeldish
sending `subtotal` at all, unlike the `options` gap in D15.

## 2026-08-18 — Item customizations are now structured, not a comma-joined string

The receipt used to split `items[].notes` on `,` to show one line per
selected option (size, extras, etc.). That broke for any option whose own
value contained a comma — there was no way to tell a separator comma from
one that was just part of the text.

**Contract change (coordinated with Babeldish):** `InboundOrderPayload`
gains `items[].options: string[]`, one entry per selected option, sent by
Babeldish instead of a `", "`-joined string. `notes` is unchanged and still
accepted for sources that haven't migrated — shown as a single unsplit line,
never parsed. The receipt and the coordinator order-detail page both now
render `options` as one line per entry, falling back to `notes` only when
`options` is absent. See D15 in `workflow-decisions.md`.

**Rollout note:** a handful of orders landed in the gap between Babeldish
sending `options` and this app's ingestion redeploying to read it — their
`originalPayload` had it, their stored `items` didn't. Fixed going forward;
`scripts/src/backfill-item-options.ts` re-derives `options` from
`originalPayload` for any order still stuck in that state.

## 2026-08-18 — Rider page simplification, and a dashboard availability bug fix

Any order a rider can see now opens the detail page — previously only their
own assigned orders linked through; open/unclaimed orders were plain cards.
Editing (status transitions, postpone, fail, suggest a pickup time) is gated
to orders actually assigned to the viewing rider; for anything else the
detail page shows "Claim this delivery" instead (moved there from the
overview page's open-order cards). The overview page lost its "My route"
header and its 3-button availability grid, now a colored status pill
(online/offline/backup, fixed hex backgrounds) plus a small "Change" button.
Order cards on the overview page are now one shared compact layout
(countdown + restaurant, pickup time + address) instead of two different
card designs for assigned vs. open orders.

**Bug fix:** riders had no way to read their own current availability —
`GET /riders` (the only place the old UI read it from) is admin/coordinator
-only, so a rider's own status highlighting always silently failed. Added
`availabilityStatus` to `GET /auth/me` (role-scoped: rider only, null
otherwise) — `useSetOwnAvailability`'s success handler already invalidated
that exact query, so it was clearly the intended read path, just never wired.

## 2026-08-18 — Admin overhaul (Add tab, expandable entity tables) and original payload viewer

The admin page's Riders/Restaurants/Users tabs were rebuilt as one consistent
pattern: a table (Name [+ Name code, or Type for Users] + Details) whose row
expands in place into a full edit form, one row open at a time, instead of
three differently-shaped card layouts. Every field the API actually supports
is now editable — previously each card exposed only a subset. Action row is
Save + whatever the entity supports: Restaurants have no `accountStatus`
field yet (Save + Delete only), Riders have no delete endpoint at all, likely
deliberate given order history ties to rider id (Save + Disable only), Users
get all three. The three "Add" forms moved off those tabs onto their own
dedicated **Add** tab — admin is for overview/editing far more than adding.
On mobile, Orders/Riders/Restaurants keep text tab labels; Users/Add/System
switch to icon-only (👤 / +++ / 🔧) to save width, with the tab strip
scrolling as one unit when it overflows.

**API change:** `OrderDetail` now includes `originalPayload` — the orders
table has always stored the full raw upstream webhook payload
(`original_payload`, "kept for forensic/replay use" per its own column
comment), but nothing ever put it on the wire. Added to the OpenAPI spec and
`serializeOrderDetail`; the coordinator order-detail page now has a
collapsed-by-default "Original payload" card at the bottom with
pretty-printed JSON and a copy button.

## 2026-08-17 — Admin Orders tab, searchable filters, and a dropdown viewport bug

The admin page gained an **Orders** tab (tabs reordered: Orders, Riders,
Restaurants, Users, System) — every order, sortable by pickup time / estimated
delivery time / creation time / order number, with a multi-select quick
filter (active-within-1h/2h, future today/all, completed today, past
today/all — OR'd together, keyed off effective pickup time) and an advanced
filter mirroring the coordinator page's search/status/restaurant/rider
fields. Each row links into the existing `/coordinator/orders/:id` detail
page — no new route needed.

**New shared pattern:** `components/searchable-select.tsx` (`SearchableSelect`)
— a `Popover` + `Command` combobox for filter lists long enough that
scrolling to one entry stops being practical. Swapped in for the
Restaurant/Rider filters on both the coordinator dispatch board and the
admin Orders tab's advanced filter. Registered in
`architecture-sources-of-truth.md` §Frontend Plumbing.

**Bug fix worth recording because it was silent:** the shared `Select`
popup's content had `max-h-[--radix-select-content-available-height]`
instead of `max-h-[var(--radix-select-content-available-height)]` — the bare
custom-property reference doesn't resolve to anything, so Tailwind emitted no
working `max-height` at all. A long option list (e.g. every restaurant)
could render past the edge of the viewport, most visibly when Radix flipped
the popup upward for lack of room below. Fixed in `Select` and the identical
copy-pasted bug in `ContextMenu` (unused today, same file lineage);
`Popover` gained the same cap ahead of `SearchableSelect` needing it.

## 2026-08-15 — Pickup times: two anchors, never combined

Closes the question that opened this audit: *why is anything computing from
`now`?* Nothing does. But the answer took four discarded designs to reach, and
the reason is worth more than the formula.

**The default rule anchors to the delivery time the customer was shown.**
`requestedDeliveryTime` is badly named — nothing is "requested" on an ASAP order
— but it already carries the restaurant's opening hours and prep time, because
the source applied them before promising the customer anything. Anchoring there
inherits all of it. Counting forward from checkout instead, which an earlier
version did, reconstructs that calculation without the opening hours and fails
whenever a kitchen is shut at the moment someone orders.

**`pickupWithinMinutes` is the second anchor, and it counts the other way.**
When a coordinator says *"it's quiet, we can do it in ten"*, the ten runs from
the order arriving — get moving, stop sitting idle. So a small value moves
pickup earlier and a large one later, with no comparison logic at all. ASAP
only; "we can be there in ten" says nothing about next Tuesday.

The two settings measure different things from different anchors and **never
combine**. Whichever applies simply is the answer. Every attempt to reconcile
them — a floor, a `MAX`, a fallback chain — was a category error.

Neither is clamped. Everything available to clamp against is a guesstimate, and
a coordinator setting a value can see whether restaurants are open. An order
placed at 17:20 for 17:30 is still accepted: feasibility is Bestellenbij's, and
a pickup time in the past is a true statement about what happened upstream. The
lead time is logged so someone can go and ask.

Terminology, because three words were doing damage. **"Travel time"** implies
something measured; nothing measures the journey, so the setting is
`pickupOffset`. **"Lead time"** meant two things and now names one: the
observation `requestedDeliveryTime − sourceCreatedAt`. **"Minimum"** invited a
floor, which is not what `pickupWithin` is — it replaces, it does not bound.

All six `*Min*Time` duration fields and `sourceRestaurantReadyTime` are
audit-only. `pickupTravelOverrideMinutes` is gone; it overrode a quantity that
no longer exists.

The daily reset **clears** the value rather than expiring it on read, so the
stored row always says what is in effect — the same stored-versus-true
divergence D12 removed from the address. It runs on the existing five-minute
janitor rather than an 03:00 cron, which makes it self-healing after downtime.
`lib/daily-reset.ts` resolves the boundary through `Intl`: Amsterdam observes
DST, so consecutive resets are 23 or 25 hours apart.

**The process, which cost more than the code.** Four formulas were built and
discarded, each internally consistent and each with passing assertions —
proving only that an invented rule had been applied consistently. Every one came
from filling a gap in understanding with something plausible, because code will
not compile around a gap. The rule that came out of it is in `replit.md` §5:
state the spec back and wait, and stop at gaps rather than filling them.

Supersedes D4. Rationale in `docs/workflow-decisions.md` D13.

## 2026-08-15 — The address components become canonical; the source's line becomes a receipt

The source keeps the address as components, sends them to us as-is, and also
sends its own `buildFullAddress()` rendering of them as one line. Both come
from a single record. We stored both as writable and treated the line as
canonical, while `POST /orders/:id/contact` wrote only the line — so the first
coordinator
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

The cost is almost nothing. Since the source builds its line from the same
components, we are doing what it already does with our own formatter — there is
no information to drop. Gaps are symmetric, and `formatAddress` omits blank
parts rather than leaving a stray comma. What is real: we chose our own ordering
and punctuation, so the line may read slightly differently from the source's,
and we own a small function that could have bugs. 21 assertions cover it.

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
