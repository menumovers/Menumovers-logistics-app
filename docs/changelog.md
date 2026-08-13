# Changelog

## 2026-08-13 — Per-source inbound credentials replace the single shared secret

The inbound order endpoint (`POST /api/inbound/orders`) previously authenticated every caller against one static `INBOUND_SHARED_SECRET`, with no way to tell which upstream system sent an order — a design that couldn't distinguish Bestellenbij from any future second source. Added an `api_credentials` table (hashed per-source secret → source identifier) and switched the endpoint to authenticate against it via the `x-inbound-secret` header, deriving `source` from the matched credential row rather than trusting the request body. The old shared-secret path stays live until Bestellenbij's credential is provisioned and Babeldish switches over, then gets retired.

## 2026-08-13 — Unresolved restaurants park orders instead of being rejected

Added a `restaurant_external_ids` table (source + external ID → internal restaurant) and a placeholder "Unmapped" restaurant row. An inbound order whose `externalRestaurantId` doesn't resolve is now stored against the placeholder with `isParked: true` and a `parkedReason`, instead of the previous hard 400 rejection. No dispatch/visibility mechanics were designed beyond making parked orders queryable — see `docs/todo-out-of-scope.md`, "Bestellenbij Integration" section.

## 2026-08-13 — Removed the dead order_items table

`lib/db/src/schema/order-items.ts` was created in the founding commit alongside `orders.items` (JSONB) as an alternate normalized design, but was never adopted — nothing in the codebase has ever read or written it; the item-overrides mechanism that's actually wired up everywhere indexes directly into `orders.items`. Removed the schema definition. The live table itself still needs to be dropped once confirmed empty, as part of the next database push.
