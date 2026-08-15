# Changelog

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
