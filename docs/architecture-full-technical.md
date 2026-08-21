# Bestellenbij — Full Technical Reference

A reference document for new contributors. For day-to-day rule enforcement see `replit.md` and `docs/architecture-sources-of-truth.md`.

## Table of Contents

1. Business context and product scope
2. System overview
3. Technology stack
4. Component structure
5. Critical business flows
6. External integrations
7. Authentication and authorization
8. Known limitations and design trade-offs
9. Future development areas

---

## 1. Business context and product scope

Bestellenbij is the internal logistics platform for a Dutch food-delivery cooperative of the same name. It sits in the middle of a delivery chain. An upstream **distribution service** receives consumer orders (from third-party storefronts) and forwards them into Bestellenbij over HTTPS. From there, **coordinators** dispatch orders to **riders**, **restaurant staff** confirm pickup readiness, and the system reports every state change back to the distribution service via webhooks.

The platform is used predominantly on mobile devices (riders on phones, restaurant staff on tablets, coordinators on phones or laptops), so it is delivered as a Progressive Web App with installability and Web Push.

The business language is Dutch (`nl-NL`); English is supported as a secondary locale. Code, identifiers, and API field names stay in English.

## 2. System overview

What the system does:

- Ingests orders from the distribution service (idempotent, authenticated by a hashed per-source credential).
- Tracks every order through a reported status lifecycle. The expected order of events is `pending → rider_assigned → rider_accepted → en_route_to_restaurant → arrived_at_restaurant → picked_up → en_route_to_customer → delivered`, but status is a *report* of where things stand rather than a gate: skipping ahead and correcting a mis-tap are both accepted, and the audit trail records the jump that actually happened. Four invariants remain — `pending` and `rider_assigned` are coupled to `riderId` and written only by `POST /orders/:id/assign`; `rider_accepted` is reportable only from `rider_assigned` (otherwise, like `pending`/`rider_assigned`, it's reachable solely via `POST /orders/:id/assign` — a rider self-claiming an open order, or a trip assigning one, lands directly on `rider_accepted`, skipping the coordinator-assign step entirely); `delivered` and `failed` are terminal (only `delivered → failed` leaves); and a transition must actually move the order. See `docs/workflow-decisions.md` D1 and D16.
- Treats postponement as reversible status reporting: `POST /orders/:id/resume`
  restores the status captured by the real postpone audit transition, returning
  unassigned work to `pending` and preserving the rider on assigned/in-motion
  work. Admins and coordinators can resume any eligible order; riders can
  resume only their own assigned work.
- Lets coordinators bundle multiple orders into a `Trip` so one rider executes them as a single pickup pass; restaurants see a unified bundled pickup time per trip. Trip membership can be edited after creation (orders added or removed, not just create-time-only), and a trip completes itself once every order on it is delivered or failed.
- Lets coordinators and admins assign riders atomically, override pickup times, override delivery contact info, and add or hide items per order. Once an order is past `pending`, a separate reassign/unassign endpoint lets a coordinator swap in a different rider or unassign back to `pending`, at any non-terminal, non-held stage.
- Gives restaurant and rider apps a paginated order history (delivered/failed orders, 10/page, date-range filterable), with customer name, phone, and full address redacted server-side once 24 hours have passed since delivery.
- Lets admins archive an order out of day-to-day operations without losing its
  audit history, restore it later, or permanently delete it only after archival
  and an exact external-order-ID confirmation.
- Lets riders self-claim unassigned orders, propose a pickup time, and advance status from their device.
- Lets restaurant staff see only their own restaurant's orders, acknowledge them according to the restaurant's acceptance mode, adjust the restaurant-side pickup time when applicable, and report that food is ready.
- Notifies the right audiences via Web Push on every significant event.
- Reports every assignment, status change, and pickup-time change back to the distribution service via outbound webhooks with persistent retry.

What the system explicitly does not do:

- It does not compute money. Amounts are passthrough strings.
- It does not run customer-facing tracking (no public status page yet — see `docs/todo-roadmap.md`).
- It does not optimize routes or do dispatching automatically — assignment is human.
- It does not host the storefront or the distribution service.

## 3. Technology stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Runtime | Node 24 | Required by `package.json` engines and Vite 7 |
| Language | TypeScript ~5.9 | Strict |
| Monorepo | pnpm workspaces | `pnpm-workspace.yaml` |
| API | Express 5 | Single process, single Postgres |
| Logging | Pino + pino-http | `req.log` carries requestId, userId, role |
| Database | PostgreSQL | Replit-managed in dev |
| ORM | Drizzle | Schema in `lib/db/src/schema/` |
| Validation | Zod (`zod/v4`), drizzle-zod | Schemas regenerated by Orval |
| API contract | OpenAPI 3 | `lib/api-spec/openapi.yaml`; codegen via Orval |
| Frontend | React 18, Vite 7 | |
| Routing (web) | Wouter | `base = import.meta.env.BASE_URL` |
| Data | TanStack Query | Hooks generated by Orval |
| UI | Tailwind, shadcn (Radix primitives), framer-motion, lucide-react | |
| i18n | react-i18next 17 | nl default, en secondary |
| PWA | Hand-rolled SW + two static manifests | `vite-plugin-pwa` is used with `strategies: "injectManifest"` to bundle our SW. Manifests live as static files (`public/manifest-rider.webmanifest`, `public/manifest-restaurant.webmanifest`); the plugin's manifest emit is disabled (`manifest: false`). `main.tsx` swaps the active `<link rel="manifest">` href on boot per path. |
| Push | web-push (VAPID) | Operator-configured keys |
| Auth | bcryptjs + jsonwebtoken (HS256) | 7-day tokens, JTI revocation |
| Rate limiting | express-rate-limit | Auth and inbound endpoints |
| Build | esbuild (api-server CJS bundle), Vite (web) | |

## 4. Component structure

```
.
├── artifacts/
│   ├── api-server/        Express API. Single deployable.
│   │   └── src/
│   │       ├── app.ts             Express setup (CORS, pino-http, rate limits, error handler)
│   │       ├── index.ts           Boot. Reads PORT. Starts retry loop, token janitor,
│   │       │                       and daily settings reset.
│   │       ├── routes/            One file per resource. All mounted at /api.
│   │       │                       (auth, health, orders, riders, restaurants, users,
│   │       │                        settings, push, trips, order-items)
│   │       ├── middlewares/       error-handler.ts, rate-limit.ts
│   │       └── lib/               auth, errors, logger, state-machine, pickup-time,
│   │                              push, push-triggers, webhook, order-serialize,
│   │                              trip-completion (completeTripIfDone),
│   │                              janitor (revoked-token sweeper),
│   │                              settings-readers (typed system_settings reads)
│   ├── bestellenbij/      The web PWA. Single deployable; two installable PWAs.
│   │   ├── public/                sw.js, manifest-rider.webmanifest,
│   │   │                          manifest-restaurant.webmanifest, icons
│   │   └── src/
│   │       ├── App.tsx, main.tsx  main.tsx swaps the active manifest by path
│   │       ├── lib/               api, auth, app-context, format, status,
│   │       │                       i18n, role-homes, utils
│   │       ├── pages/             landing, login, admin, coordinator,
│   │       │                       coordinator-order, coordinator-trip,
│   │       │                       coordinator-trip-builder, rider, rider-order,
│   │       │                       rider-trip, rider-history, restaurant,
│   │       │                       restaurant-order, restaurant-history,
│   │       │                       order-receipt, settings, not-found
│   │       ├── components/        layout, status-badge, acceptance-status-badge,
│   │       │                       pickup-countdown, delivery-expectation,
│   │       │                       acknowledge-card, payment-panel, order-history,
│   │       │                       pickup-time-input, searchable-select,
│   │       │                       locale-switch, push-opt-in, ui/* (shadcn)
│   │       └── locales/           nl/translation.json, en/translation.json
│   └── mockup-sandbox/    Vite preview server for canvas iframes (design only).
├── lib/
│   ├── api-spec/          OpenAPI source + Orval config
│   ├── api-client-react/  Generated React Query hooks
│   ├── api-zod/           Generated Zod schemas
│   └── db/                Drizzle schema + client
├── scripts/               One-off scripts (seed-admin, demo seed)
└── docs/                  This documentation set
```

## 5. Critical business flows

### 5.1 Inbound order ingestion

1. Distribution service `POST`s to `/api/inbound/orders` with `x-inbound-secret`.
2. `inboundLimiter` (60/min) and `requireInboundCredential` gate the request — the secret is matched against a per-source hashed credential in `api_credentials`, and the matched row's source becomes `req.inboundSource`.
3. The Zod schema `IngestOrderBody` validates the body.
4. The handler resolves the restaurant by matching `payload.restaurantNameCode` against `restaurants.nameCode` directly. If the field is absent or doesn't match any known restaurant, the order is **not rejected** — it is stored against the "Unmapped" placeholder with `holdState: "parked"`, a `holdReason`, and `heldAt`; this blocks new rider assignment until a coordinator resolves the restaurant.
5. `resolveOriginalPickupTime` computes the immutable original pickup time. ASAP orders use `sourceCreatedAt + pickupWithinMinutes` when that setting is present; every other case uses `requestedDeliveryTime − pickupOffsetMinutes`. The source's `*MinDeliveryTime`, `*MinPickupTime`, `*MinPrepTime`, and `sourceRestaurantReadyTime` fields are audit-only.
6. The handler inserts a new order or updates mutable fields on an existing row by `orderId` (idempotent). `pickup_time_original`, `source_created_at`, and `delivery_address_original` are written only on insert; `original_payload` is refreshed on replay.
7. `audienceForNewOrder()` resolves to coordinators + admins + the order's restaurant staff. `push.ts` sends a push to each.
8. `enqueueOutboundEvent("order.created", ...)` writes the event to `webhook_retry_queue` and immediately attempts delivery when outbound webhooks are enabled.
9. The handler responds 200 with the serialized order.

### 5.2 Atomic rider assignment

1. A coordinator/admin assigns a rider, or a rider self-claims when `allowRiderSelfClaim` is enabled, by calling `POST /api/orders/:id/assign` with `riderId`. Riders may claim only their own rider record.
2. The handler runs one conditional update that sets `riderId` and a resulting `status` only while the order is still pending, unassigned, not held, and rider-deliverable. The resulting status depends on who's calling: `rider_assigned` for a coordinator/admin assignment (the rider still needs to accept), `rider_accepted` for a rider self-claim (claiming for yourself already implies acceptance — see D16). Customer-pickup orders return `422 NOT_RIDER_DELIVERABLE`; held/parked orders return `409 ORDER_ON_HOLD`; an already-claimed order returns `409 ALREADY_ASSIGNED`.
3. A `rider_assignments` row is inserted; an `order_status_logs` row is written via `assertValidTransition`.
4. `audienceForAssignment()` (the assigned rider + the order's restaurant staff) receives a push.
5. `enqueueOutbound("order.assigned", ...)` fires.

### 5.2a Rider reassignment and unassignment

1. Once an order is past `pending`, `/assign` can no longer touch its rider — a coordinator/admin instead calls `POST /api/orders/:id/reassign` with an optional `riderId`. Rejected outright for terminal (`delivered`/`failed`) or held orders, and if the order has no rider to begin with (that's what `/assign` is for) or the target rider matches the current one.
2. Passing a `riderId` swaps in that rider. If the order is still pre-flight (`rider_assigned`/`rider_accepted`), it's treated as a fresh assignment and lands on `rider_accepted` (same accept-skip convention as trip creation and `PATCH /trips/:id`'s in-motion swap). Once en route or later, only `riderId` changes — the reported status is preserved rather than rewound.
3. Omitting `riderId` (or passing `null`) unassigns back to `pending`, at any non-terminal, non-held stage — no additional status cutoff. See D18 for why an earlier, more conservative version of this was deliberately loosened.
4. Either way, a `rider_assignments` row is written (`outcome: "reassigned"` or `"unassigned"`) and, if the status actually changed, an `order_status_logs` row too.
5. The coordinator order detail's rider card reflects whichever state applies: "Assign rider" while `pending`, "Reassign rider" (pick someone else, or unassign) once a rider is attached.

### 5.3 Status transition

1. An authorized caller hits `POST /api/orders/:id/status` with the reported target status. Riders may update only their own assigned orders; restaurant staff cannot use this endpoint.
2. The handler calls `assertValidTransition(from, to)`. Status is a report rather than a strict linear gate: skipping ahead and corrections are allowed. Same-state changes are rejected; `rider_assigned` must go through `/assign`; `rider_accepted` is only accepted here when `from` is `rider_assigned`; terminal-state invariants still apply.
3. The update is guarded by the previously-read status so concurrent changes return `409 STATE_CONFLICT`. The accepted transition is logged in `order_status_logs` with actor, role, from/to status, timestamp, and any note/failure reason. Landing on `en_route_to_customer` also stamps `enRouteToCustomerAt` (an "underway since" anchor independent of `updatedAt` — see the SSOT entry).
4. If the new status is `delivered` or `failed` and the order is on a trip, `completeTripIfDone(order.tripId)` re-checks whether the trip's other orders are also all terminal and, if so, moves the trip to `completed` (see 5.8).
5. `audienceForStatus(to)` resolves the audience (e.g. coordinators+admins for `picked_up`, all coordinators+admins for `failed`); `push.ts` sends.
6. `enqueueOutbound("order.status_changed", ...)` fires.

### 5.3a Postponement and resume

- `postponed` is a delivery status, not a record-retention state. The initial
  postpone writes an `order_status_logs` row containing the status it replaced.
- `POST /api/orders/:id/resume` is available to admins/coordinators for any
  eligible order and to riders only when the order remains assigned to their
  rider record. It locates the latest genuine transition *to* `postponed`,
  ignoring same-status audit events such as forced in-motion trip reassignment.
- The endpoint restores that logged `fromStatus` rather than deriving a new
  status from current trip membership. Consequently an unassigned postponed
  order returns to `pending`, while an assigned/in-motion order keeps its
  `riderId` and returns to its prior status.
- Resume validates the rider/status pairing both before and inside the guarded
  update. It refuses an inconsistent pairing instead of producing `pending`
  with a rider or active work without one, then writes its own status-log row
  and emits the normal status event.

### 5.3b Archive, restore, and permanent deletion

- Archive is a separate axis from delivery status: `orders.archivedAt` and
  `archivedByUserId` remove a record from active operational reads without
  rewriting its status, rider, trip link, history, or original payload.
- `POST /api/orders/:id/archive` and `POST /api/orders/:id/restore` are
  admin-only and use conditional writes so concurrent archive-state changes
  return a conflict instead of overwriting one another.
- Active lists, non-admin detail/subresources, trip detail/list/build/reassign/
  stop-replacement/dissolution paths, rider workload counts, and bundled-pickup
  calculations all exclude archived orders. Admins can list with
  `archived=true` and inspect archived detail/original items; coordinators,
  riders, and restaurant staff receive the same not-found boundary as for any
  out-of-scope order.
- `DELETE /api/orders/:id` is admin-only and is intentionally not a shortcut:
  it succeeds only for an already archived record after the request repeats the
  order's exact `externalOrderId`. Foreign-key actions remove dependent
  order-owned data; webhook retry rows retain their event but lose the deleted
  order reference. Inbound idempotency replays never clear archive metadata or
  revive an archived order.

### 5.4 Pickup time priority and updates

- Four candidate fields exist on the order: `pickupTimeOriginal`, `pickupTimeRider`, `pickupTimeRestaurant`, `pickupTimeOverride`.
- `resolveEffectivePickupTime` returns the highest-priority value: override → restaurant → rider → original.
- Updates write only the source-specific field. The original is never mutated.
- An `order.pickup_time_updated` outbound event is enqueued on every change.

### 5.5 Item overrides

- A coordinator can hide an item by index (the kitchen is out) or add a new item.
- The original `orders.items` (JSONB array) is immutable. Overrides go in `item_overrides` with `type ∈ {hide, add}`, referencing an item by its index into that array. (A separate `order_items` table existed in the schema as an alternate, never-adopted design — nothing ever read or wrote it — and has since been removed. Don't confuse it with `orders.items` if you see it mentioned elsewhere.)
- `applyItemOverrides` produces the displayed list at serialize time.

### 5.6 Outbound webhooks with retry

- Every event becomes a `webhook_retry_queue` row with `eventType`, `orderId`, `payload`, `attempts`, `nextAttemptAt`.
- `attemptDelivery` posts JSON with a 10-second `AbortSignal.timeout`. 2xx → row deleted. 5xx, 408, 429, network error → retry scheduled with delay `[30 s, 2 min, 5 min]`. 4xx other → permanent failure logged, row marked.
- `startRetryLoop` polls every 10 s for `nextAttemptAt <= now()` and retries. The loop survives restarts because the queue is in Postgres.

### 5.7 Web Push

- VAPID keys come from env. If missing, `push.ts` no-ops with a debug log.
- Each user device subscribes via `/api/push/subscribe`; the subscription is stored in `push_subscriptions`.
- `push.ts` resolves recipient user ids from a `PushAudience` (roles plus per-order flags) and sends to all their subscriptions in parallel. 410/404 responses prune the subscription.

### 5.8 Trip bundling, reassignment, and dissolution

1. A coordinator opens the trip builder (`pages/coordinator-trip-builder.tsx`), selects 2+ pending or assigned orders, and `POST /api/trips` with `{ name?, riderId?, orderIds[] }`. The handler runs inside `db.transaction(...)` with `SELECT ... FOR UPDATE` on the involved orders: it inserts the `trips` row (auto-assigning `tripNumber`), seeds `trip_stops` (all pickups in ascending effective-pickup-time order, then dropoffs in `orderIds` order), and stamps `orders.tripId`. If a rider is assigned at create time, pending orders move straight to `rider_accepted` — trip assignment is coordinator-driven like a plain assign, but skips the `rider_assigned` accept step rather than inventing a trip-level accept UI (D16) — and `audienceForTripAssigned` fires push.
2. `PATCH /api/trips/:id` (admin/coordinator) renames the trip or reassigns its rider. The transaction starts with `SELECT ... FOR UPDATE` on the trip row and refuses if `status` is `dissolved` or `completed` (422 `TRIP_TERMINAL`). When `riderId` changes and any order on the trip is at or past `picked_up`, the handler returns `409 TRIP_IN_MOTION` unless the request body includes `force: true`. The frontend (`pages/coordinator-trip.tsx`) intercepts that error code, opens a confirmation dialog, and re-issues the same patch with `force: true` on confirm. Pre-flight orders (`pending`/`rider_assigned`/`rider_accepted` — `trips.ts`'s `PRE_FLIGHT_STATUSES`) get the new rider and land on `rider_accepted`, same as trip creation; in-flight orders keep their status and existing rider — only the trip's nominal rider is swapped.
3. `PUT /api/trips/:id/stops` (admin/coordinator) replaces the stop list within a transaction, validating that every supplied `orderId` is currently on the trip. Stops are replaced wholesale with nothing carried across: they record what to do and in what order, never whether it happened. Progress is derived from each order's status (D6), which this endpoint does not touch, so a re-order cannot lose it.
4. `POST /api/trips/:id/dissolve` (admin/coordinator/own-rider) runs in a transaction. Pre-flight orders (`pending`/`rider_assigned`/`rider_accepted`) are reverted to `pending` with `riderId` and `tripId` cleared and a `rider_assignments` row written for audit; in-flight orders keep their status and rider but lose their `tripId`. The trip moves to `dissolved`. `audienceForTripDissolved` fires push to coordinators, the previously-assigned rider, and restaurant staff for the affected orders.
5. `audienceForOpenTrip` exists for surfacing unclaimed trips to coordinators; rider-side discovery of open trips uses the regular trip list, gated by `system_settings.allow_rider_self_claim`.
6. Archived orders are excluded at every operational trip boundary. They cannot
   be added, reassigned, have stops replaced, or influence a trip's pickup
   calculation; trip detail and rider-facing trip progress omit them. An archive
   does not rewrite the remaining trip or its other orders.
7. The order state machine extension that powers trip-driven postpone is
   documented in section 5.3a above and in the SSOT — `postponed` is reachable
   from `en_route_to_restaurant` and `en_route_to_customer`, resumes back to
   either, and accepts `failed` from there.
8. `POST /api/trips/:id/orders` (admin/coordinator) adds more bundleable orders
   to an already-created trip — the trip is no longer a fixed set decided at
   creation time. Eligibility matches trip creation (pending or assigned,
   untripped, unarchived orders); the transaction takes `SELECT ... FOR
   UPDATE` on the trip and the incoming orders, appends new `trip_stops` after
   the trip's current maximum sequence, and stamps `orders.tripId`, sharing
   the `attachOrdersToTrip` helper with `POST /api/trips`'s create path.
   `DELETE /api/trips/:id/orders/:orderId` removes a single order the same way
   dissolve does per-order — a pre-flight order reverts to `pending` with
   `riderId`/`tripId` cleared and an audit `rider_assignments` row, an
   in-flight order just loses `tripId` and keeps its status and rider — via
   the shared `detachOrderFromTrip` helper, then calls `completeTripIfDone`
   (§5.3 point 4) since removing a trip's last active order can itself
   complete it. Both endpoints refuse on a terminal trip (`dissolved` or
   `completed`), same as `PATCH /api/trips/:id`. The frontend
   (`pages/coordinator-trip.tsx`) exposes this as an `AddOrdersCard` and a
   per-order remove button, both hidden once `data.status === "completed" ||
   data.status === "dissolved"` — as are the rename/reassign and dissolve
   controls, now that a trip can actually reach `completed` (D19).
9. A trip completes itself rather than staying `planned`/`in_progress`
   forever once its last order finishes. `completeTripIfDone`
   (`lib/trip-completion.ts`) loads a trip's orders and, if every one is
   terminal (`delivered`, `failed`, or archived/detached away) and the trip
   isn't already `completed`/`dissolved`, sets `status = "completed"`. It is
   called from both `POST /orders/:id/status`'s transition handler (when an
   order lands on `delivered` or `failed` while still on a trip) and from the
   remove-order endpoint above (§5.3 point 4, D19) — the two ways a trip's
   last order can stop being active.

### 5.9 Frontend polling

- The web client polls every 30 s using TanStack Query `refetchInterval`. Push notifications are a low-latency supplement, not a replacement.

### 5.10 Receipt rendering and print flow

- The receipt route is `/orders/:id/receipt`, protected for admin,
  coordinator, and restaurant-staff roles. `pages/order-receipt.tsx` renders a
  kitchen document from the order detail plus the matching restaurant record.
  It is not the customer's tax invoice; the storefront remains responsible for
  that.
- The receipt page owns the print presentation. Its `@media print` rules hide
  the application chrome and leave the receipt sheet, while the page's manual
  Print button remains available for normal receipt navigation. The restaurant
  order detail (`pages/restaurant-order.tsx`) links with the one-shot
  `?autoprint=true` query when staff choose **Bon/Receipt**.
- Auto-print is readiness-gated. The page must have both the order and a
  restaurant row matching `order.restaurantId` before it schedules printing.
  This prevents the browser dialog from opening with a missing restaurant name
  or address when the two queries resolve in different orders. Once ready,
  `lib/receipt-autoprint.ts` schedules the print callback for the next
  animation frame, after the complete receipt has committed to the DOM.
- Before calling `window.print()`, the page removes the one-shot query with
  `history.replaceState`. Cancelling the dialog or refreshing the receipt then
  does not trigger another automatic print. A restaurant lookup error does not
  auto-print an incomplete sheet; the ordinary page remains available with its
  manual fallback.
- This is a frontend-only interaction change: it adds no API endpoint, schema
  field, or generated client contract. The race guard is covered by
  `src/lib/receipt-autoprint.test.ts`, which verifies that an order resolving
  before the restaurant does not schedule `window.print()` until both are ready.

### 5.11 Order history and privacy redaction

- `GET /orders/history` (restaurant-staff and rider roles) is registered
  ahead of `GET /orders/:id` in `orders.ts` so the literal `history` segment
  isn't swallowed by the `:id` param route. It returns `OrderHistoryPage` —
  10 orders per page (`page`/`pageSize` query params), filterable by an
  optional `from`/`to` date-time range, scoped the same way the live overview
  is scoped (a restaurant sees its own orders, a rider sees orders assigned
  to them), and ordered newest-first by pickup time.
- Redaction is computed at read time, not stored: each `OrderHistoryItem` is
  built from the same order row as the live views, but if more than 24 hours
  have passed since `updatedAt` on a `delivered` or `failed` order,
  `customerName`/`customerPhone` are nulled and `deliveryAddress` is reduced
  to postal code + city. Orders newer than the 24-hour cutoff, or not yet
  terminal, pass through unredacted. This reuses `updatedAt` as a trustworthy
  "when did this become terminal" timestamp — see "`updatedAt` as a terminal
  timestamp" in the SSOT — the same reasoning the delivered-clock-time
  countdown display relies on.
- `OrderHistoryItem` is a standalone schema in the OpenAPI spec rather than an
  `allOf` extension of `OrderListItem`, because re-declaring a field's type
  inside an `allOf` branch intersects with the base schema instead of
  overriding it — a nullable override would generate as non-nullable
  `string`, not `string | null`. See the SSOT "Order history and PII
  redaction" entry and D20 for the full reasoning.
- The frontend is a shared `components/order-history.tsx` list plus two thin
  route wrappers, `pages/rider-history.tsx` and
  `pages/restaurant-history.tsx`, both reachable from the header nav
  (`components/layout.tsx`). A date-range filter converts `YYYY-MM-DD` inputs
  to UTC instants at local-timezone day boundaries via
  `lib/format.ts`'s `localDayBoundaryIso`, matching how the rest of the app
  already converts local date/time input to ISO instants
  (`combineDateAndTime`).

## 6. External integrations

| Integration | Direction | Auth | Failure handling |
| --- | --- | --- | --- |
| Distribution service inbound | They → us | Header `x-inbound-secret` matched against a per-source hashed credential in `api_credentials` (not a single shared secret — see §7 Inbound); rate-limited 60/min | 4xx on bad secret / validation; idempotent on duplicate orderId |
| Distribution service outbound | Us → them | None (URL is operator-configured); payload is JSON | Persistent queue with 30 s / 2 min / 5 min backoff, max 4 attempts; 4xx is permanent |
| Web Push (browser push services) | Us → user device | VAPID JWT; `web-push` library | Auto-prune 410/404 subscriptions; silent no-op when VAPID unset |
| PostgreSQL | Us | Connection string `DATABASE_URL` | Errors bubble; no retry layer (single primary) |

## 7. Authentication and authorization

### Authentication

- Single login API, `POST /api/auth/login`. Body validated by Zod (`AuthSession` body schema).
- Login accepts `username` and `password`. `users.username` is unique and is
  normalized to lowercase when accounts are created, edited, or authenticated;
  the account identifier is not required to be email-shaped. Order contact
  addresses may still carry a separate `customerEmail` field.
- The frontend exposes two distinct login pages backed by the same API: `/rider/login` (rider PWA — admin, coordinator, rider) and `/restaurant/login` (restaurant PWA — restaurant_staff). Each login refuses cross-app role mismatches client-side (token discarded, "wrong app" message shown) and offers a link to the other login. The legacy `/login` URL is preserved as a rider-variant alias. Role partitioning, the path → context map, and the login target for each context are centralized in `src/lib/app-context.ts`.
- bcryptjs at 10 rounds verifies the password.
- On success a JWT is signed with `JWT_SECRET` (HS256, 7-day TTL, includes `sub`, `roles`, `restaurantId`, `jti`, `exp`). Login requires at least one current role assignment. The token is returned in the response body and also set as a `auth_token` HttpOnly cookie. The web client stores the token in `localStorage.bb_token`.
- `requireAuth` extracts the token from `Authorization: Bearer ...` first, then from the cookie. It verifies the JWT, checks JTI revocation, loads the user, ensures `accountStatus === 'active'`, then reloads the account's current role rows from the database and resolves `riderId` when `rider` is among them. The request-time database read, rather than the signed role claim, is authoritative after an account is edited.
- Logout writes the JTI into `revoked_tokens`.

### Authorization

- `user_roles` is the only role source. Each row grants one of `admin`, `coordinator`, `rider`, or `restaurant_staff`, and an account may hold several rows. The legacy `users.role` column and all compatibility fallback were removed from the codebase.
- `requireRole(...roles)` gates by intersection: it allows a request when any current account role appears in the route's explicit allowlist. There is no inherited role hierarchy in this helper; routes include `admin` explicitly wherever an admin is allowed.
- `POST /users` creates the account and its role rows in one transaction. `PATCH /users/:id` locks that account row before reading and replacing role rows, so concurrent edits cannot calculate a role diff from stale assignments. The API exposes `roles[]`, never a legacy or singular role field.
- Restaurant staff queries are scoped by `req.auth.restaurantId` in the SQL `WHERE` clause, ANDed with `notHeld()` so an order on hold is invisible to the restaurant it belongs to (D2 — holds are admin/coordinator triage only). Riders are scoped by `req.auth.riderId`. The filtering happens at the database layer, not in JS.
- Archived-order access is stricter than active-order access: an admin may list
  and inspect archived records for audit and restore/delete them; all other
  roles are denied archived lists and receive 404 for archived detail and
  operational subresources. This prevents a coordinator's otherwise-valid
  active-order permission from becoming historical-record access.
- Frontend has a `RequireRole` guard component in `App.tsx` for direct-URL navigation safety, but the server is the only authority.

### Inbound

- `requireInboundCredential` matches the `x-inbound-secret` header against a hashed per-source secret in `api_credentials`, and sets `req.inboundSource` from the matched row — the caller's identity comes from which credential matched, never from the request body. No JWT involved. This replaced an earlier single-shared-secret mechanism (`requireInboundSecret` / `INBOUND_SHARED_SECRET`) in a direct swap, not an addition alongside it — there is no fallback to the old secret once this code is deployed.

## 8. Known limitations and design trade-offs

1. **No real-time channel.** The frontend polls every 30 s. This is intentional — pushed-only architectures fail when sockets drop and dispatchers miss orders. Push notifications supplement polling for latency-sensitive events. A WebSocket layer is on the roadmap but not built.
2. **`vite-plugin-pwa` is in use, but only for service-worker bundling.** We use `strategies: "injectManifest"` so the plugin precaches our hand-written `public/sw.js` while we keep full control over its source. Manifest emission is disabled (`manifest: false`) because we ship two static manifests (rider + restaurant) that need to coexist; the plugin would only emit one. Trade-off: no plugin-managed Workbox-style caching policy, but a service worker we can read in 50 lines and two PWAs that install cleanly side-by-side.
3. **Browser-language detection is part of the locale priority chain, but it is the lowest tier.** Order: authenticated `user.preferredLocale` > `localStorage.bb_locale` > `navigator.language` (mapped to `nl`/`en`) > `nl`. Operators who don't touch the dropdown still get a sensible default; once they pick a language it persists per-account. See `lib/i18n.ts` for the full chain.
4. **No timezone per restaurant.** Server is UTC, client renders in the active locale. DST transitions work because we render with `Intl.DateTimeFormat` from a UTC instant, but if the cooperative ever expands beyond Europe/Amsterdam this will need per-restaurant timezone storage. See `docs/todo-roadmap.md` item 5.
5. **Single global outbound webhook URL.** A natural evolution is per-restaurant or per-brand targets. Today, all outbound events go to one URL pulled from env or `system_settings`.
6. **Money is a string everywhere.** This is by design (see Hard Policy 2). It means we cannot show "subtotals" without trusting the upstream payload — which is correct, the cooperative is a passthrough.
7. **No full automated test suite or CI gate yet.** The API has a runnable
   `smoke.mjs` flow that seeds isolated data and covers critical order lifecycle,
   trip, archive/restore/delete, and authorization behavior against a running
   server, but it is not a unit/integration test runner. Broader repeatable
   coverage remains deferred (see `docs/todo.md` and `docs/todo-roadmap.md`).
8. **`as unknown as` casts are forbidden.** Where a shape mismatch shows up, the fix is to widen the canonical model, not cast around it. Example: `AvailabilityRow` (`rider.tsx`) used to read a rider's own status by fetching the full rider list and filtering (`useListRiders.find`) — which is `admin`/`coordinator`-only server-side, so it silently 403'd for actual riders and the status pill never highlighted correctly. Fixed by adding a role-scoped `availabilityStatus` to `CurrentUser` (`GET /auth/me`, null for non-riders) instead of working around the gap.
9. **The web client and the API are deployed as separate artifacts behind a path-based proxy.** This is a workspace convention, not a hard architectural choice — a single Express server could serve both in production.

## 9. Future development areas

This section is intentionally short — `docs/todo-roadmap.md` is the detailed register. The thematic areas:

- **Quality and reliability**: automated test suite, expanded structured logging, centralized error response shape (mostly done), rate-limit tuning, timezone modeling.
- **Operations and admin**: CSV export of filtered order lists, order duplication, per-restaurant or per-brand outbound webhooks, an admin analytics dashboard, rider shift scheduling.
- **UX**: a step-by-step rider mobile flow, a customer-facing public status page, per-user notification preferences.
- **Architecture**: a real-time channel (WebSockets or SSE) supplementing the 30-second polling.

See `docs/todo-roadmap.md` for one-paragraph descriptions of each item, and `docs/todo.md` for smaller deferred engineering work.
