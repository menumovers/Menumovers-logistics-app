# Architecture — Sources of Truth

This document is the authoritative registry of "the one place where X lives" in the Bestellenbij codebase. If you are about to write business logic, search this file first. If the SSOT exists, use it. If it doesn't, add it here as part of your change.

The structure for each entry: **Name**, **Location**, **What it does**, **Formula or logic** (if applicable), **Callers**, **Do not**.

---

## Calculations

### Effective pickup time (server)
- **Location**: `artifacts/api-server/src/lib/pickup-time.ts` → `resolveEffectivePickupTime`
- **What it does**: Resolves the pickup time the operational UI should display, given the four candidate times stored on the order.
- **Logic**:
  1. If `pickupTimeOverride` (coordinator/admin) is set, return it with source `override`.
  2. Else if `pickupTimeRestaurant` is set, return it with source `restaurant`.
  3. Else if `pickupTimeRider` is set, return it with source `rider`.
  4. Else return `pickupTimeOriginal` with source `undefined`.
- **Callers**: `artifacts/api-server/src/lib/order-serialize.ts` (every order serializer that goes out the API).
- **Do not**: branch on the four pickup fields directly in route handlers or new serializers. Do not introduce a fifth source without updating this function and the schema enum `PickupTimeSource`.

### Effective pickup time (client)
- **Location**: `artifacts/bestellenbij/src/lib/format.ts` → `effectivePickup`
- **What it does**: Mirror of the server resolver, used for orders coming from list endpoints that don't include the `effective*` fields, and as a fallback when they do.
- **Logic**: If the API supplied `effectivePickupTime`, use it; otherwise apply the same priority: override → restaurant → rider → original.
- **Callers**: `pickup-countdown.tsx`, coordinator and rider order pages.
- **Do not**: re-derive pickup priority inline in a component.

### Pickup countdown label
- **Location**: `artifacts/bestellenbij/src/lib/format.ts` → `pickupCountdownLabel`
- **What it does**: Produces the i18n descriptor for the human-readable countdown next to a pickup time.
- **Logic**: Let `m = minutesUntil(iso)`. If `|m| > 30`, return the absolute clock time as a literal. If `m === 0`, return `common.now`. If `m < 0`, return `pickup.late` with `minutes = |m|`. Else return `pickup.in` with `minutes = m`.
- **Callers**: `components/pickup-countdown.tsx`, coordinator and rider list cards.
- **Do not**: manually concatenate "min te laat" — it's localized and the cutoff is centralized.

### Pickup urgency
- **Location**: `artifacts/bestellenbij/src/lib/format.ts` → `urgencyFor`; class map in `artifacts/bestellenbij/src/lib/status.ts` → `URGENCY_CLASS`.
- **What it does**: Maps "minutes until pickup" to a four-state urgency (`neutral`, `warn`, `danger`, `late`) that drives the colored priority indicator.
- **Logic**: `m < 0` → `late`; `m < 5` → `danger`; `m < 20` → `warn`; otherwise `neutral`.
- **Callers**: `pickup-countdown.tsx`.
- **Do not**: invent ad-hoc thresholds like "≤ 10 min".

### Status visuals
- **Location**: `artifacts/bestellenbij/src/lib/status.ts` → `STATUS_CLASS`, `statusI18nKey`
- **What it does**: Single map from `OrderStatus` to (a) the badge Tailwind classes, (b) the i18n key for the localized label.
- **Callers**: `components/status-badge.tsx`, anywhere a status is rendered.
- **Do not**: duplicate the color/label table in another component.

### Order status state machine
- **Location**: `artifacts/api-server/src/lib/state-machine.ts` → `isValidTransition`, `assertValidTransition`
- **What it does**: The authoritative legal-transition graph for `OrderStatus`.
- **Logic**: Pipeline transitions are `pending → driver_assigned → en_route_to_restaurant → picked_up → en_route_to_customer → delivered`. `postponed` is reachable from `en_route_to_restaurant` and `en_route_to_customer` (postpone is en-route only) and resumes back to either `en_route_to_restaurant` or `en_route_to_customer` (rider chooses). `failed` is reachable from any non-failed state including `postponed`. No same-state transitions. No transitions out of terminal states.
- **Callers**: `routes/orders.ts` on every status-changing endpoint; `routes/trips.ts` for trip-driven postpone/resume.
- **Do not**: implement a parallel "can the rider do X here" check in the frontend. The frontend may hide buttons, but the server is the only authority.

### Trip bundling and bundled pickup time
- **Location**: schema in `lib/db/src/schema/trips.ts` (`tripsTable`, `tripStopsTable`, `orders.tripId` FK); writes in `artifacts/api-server/src/routes/trips.ts`; bundled pickup computed in `artifacts/api-server/src/lib/order-serialize.ts`.
- **What it does**: Groups orders that share a single rider pickup pass under one `Trip` (`planned | in_progress | completed | dissolved`). For all orders in a trip that share the same `restaurantId`, the serializer surfaces a unified `bundlePickupTime` (the earliest of the effective pickup times in that bundle, so the restaurant prepares in time for the first one) so the restaurant card shows a single time.
- **Trip number**: each trip has a monotonic `tripNumber` (integer) used for human display. Order DTOs include `tripId` (uuid) for joins and `tripNumber` for display.
- **Concurrency safety**: every multi-statement trip mutation in `routes/trips.ts` (`POST /trips`, `PATCH /trips/:id`, `PUT /trips/:id/stops`, `POST /trips/:id/dissolve`) runs inside `db.transaction(async (tx) => …)` and begins by locking the trip row with `SELECT ... FOR UPDATE`. Terminal-state checks (`status in ('dissolved','completed')`) and order-status reads happen inside the same transaction so a concurrent rider advance, dissolve, or rename cannot leave partial stops or partial order linkage.
- **Reassignment in motion**: `PATCH /trips/:id` with a changed `riderId` returns `409 TRIP_IN_MOTION` when any order on the trip is at or past `picked_up`, unless the caller passes `force: true`. The coordinator UI (`pages/coordinator-trip.tsx`) catches that error code, opens a confirmation dialog, and re-issues the same patch with `force: true` on confirm. The server still preserves in-flight order statuses; only the trip's rider is swapped.
- **Callers**: coordinator UI (`pages/coordinator-trip-builder.tsx`, `pages/coordinator-trip.tsx`, `pages/coordinator.tsx` `TripsSection`), rider UI (`pages/rider-order.tsx` trip banner + postpone/resume), restaurant UI (`pages/restaurant.tsx` `BundleCard`).
- **Do not**: render trips by `tripId` UUID in user-facing copy — always use `tripNumber`. Do not compute the bundle pickup time on the client; rely on `bundlePickupTime` from the API. Do not write a trip mutation outside a `db.transaction` — the row-lock invariant is what makes the concurrent-edit guarantees hold. Do not bypass the `TRIP_IN_MOTION` guard at the call site by issuing `force: true` without surfacing the warning to the user.

### Item overrides application
- **Location**: `artifacts/api-server/src/lib/order-serialize.ts` → `applyItemOverrides`
- **What it does**: Applies hide-by-index and add-new overrides to `orders.items` (the JSONB array — `applyItemOverrides(order.items ?? [], overrides)`) to produce the displayed list, while preserving the originals on the order. A separate `order_items` table existed in the schema as an alternate, never-adopted design (nothing ever read or wrote it) and has since been removed — don't confuse the two if you see `order_items` mentioned elsewhere.
- **Callers**: `serializeOrderDetail`, `serializeOrderListItems`.
- **Do not**: mutate `orders.items` directly. Overrides are an additive layer.

### Currency rendering
- **Location**: `artifacts/bestellenbij/src/lib/format.ts` → `formatCurrency`
- **What it does**: Renders a string `numeric` amount as `€ 12,50` (nl) or `€ 12.50` (en). Never converts to `Number`.
- **Callers**: order detail and list views.
- **Do not**: parse the price into a `Number`. The amount is a passthrough string.

### Time / datetime rendering
- **Location**: `artifacts/bestellenbij/src/lib/format.ts` → `formatTime`, `formatDateTime`, `uiLocale`
- **What it does**: Wraps `Intl.DateTimeFormat` with `uiLocale(lang)` so all renders share `nl-NL` / `en-GB` and 24-hour time.
- **Do not**: call `toLocaleString` directly with literal locale strings.

---

## Auth

### Password hashing / verification
- **Location**: `artifacts/api-server/src/lib/auth.ts` → `hashPassword`, `verifyPassword`
- **What it does**: bcryptjs at 10 rounds. Single export so the round count is centralized.
- **Callers**: `routes/auth.ts`, `routes/users.ts`, `scripts/src/seed-admin.ts`.
- **Do not**: import `bcryptjs` from another file.

### JWT signing / verification
- **Location**: `artifacts/api-server/src/lib/auth.ts` → `signToken`, `verifyToken`
- **What it does**: HS256, 7-day TTL, JTI included for revocation. Reads `JWT_SECRET` lazily.
- **Callers**: `routes/auth.ts`, `requireAuth` middleware.
- **Do not**: call `jsonwebtoken` from anywhere else.

### Auth middlewares
- **Location**: `artifacts/api-server/src/lib/auth.ts` → `requireAuth`, `requireRole`, `requireInboundCredential`
- **What it does**: `requireAuth` validates the bearer token (or `auth_token` cookie), checks revocation, loads the user, and resolves `riderId` for rider users. `requireRole(...roles)` gates by role. `requireInboundCredential` matches the `x-inbound-secret` header against a hashed per-source secret in `api_credentials` and sets `req.inboundSource` from the matched row — the caller's source comes from which credential matched, never from the request body. This replaced an earlier single-shared-secret mechanism (`requireInboundSecret` / `INBOUND_SHARED_SECRET`) in a direct swap, not an addition alongside it — there's no fallback to the old secret once this code is deployed.
- **Do not**: implement role checks inline in handlers. Do not protect inbound endpoints with `requireAuth`.

### JTI revocation
- **Location**: `artifacts/api-server/src/lib/auth.ts` → `isJtiRevoked`, `revokeJti`; table `lib/db/src/schema/revoked-tokens.ts`.
- **What it does**: Logout writes the current JTI into `revoked_tokens` with the original `expiresAt`. `requireAuth` rejects revoked JTIs.
- **Do not**: skip the revocation check.

### User serialization
- **Location**: `artifacts/api-server/src/lib/auth.ts` → `sanitizeUser`
- **What it does**: Strips `passwordHash` from a `User` row before serializing.
- **Do not**: spread a user row directly into a JSON response.

---

## Time / Locale

### Active locale
- **Location**: `artifacts/bestellenbij/src/lib/i18n.ts` → init + `applyProfileLocale`
- **What it does**: Initializes i18next using a priority chain: authenticated `user.preferredLocale` (server-persisted) > `localStorage.bb_locale` > `navigator.language` mapped to `nl` or `en` > `nl`. The `AuthProvider` calls `applyProfileLocale(user.preferredLocale)` after sign-in/refresh; profile is canonical and is not mirrored back to `localStorage`. `locale-switch.tsx` writes localStorage for unauthed users and additionally `PATCH /users/me/locale` when authed.
- **Do not**: read `navigator.language` directly in components. Do not write `bb_locale` from the AuthProvider path.

### Locale-aware UI mapping
- **Location**: `artifacts/bestellenbij/src/lib/format.ts` → `uiLocale(lang)` (`nl` → `nl-NL`, `en` → `en-GB`)
- **Do not**: hard-code `"nl-NL"` in components.

---

## External Services

### Outbound webhook dispatch + retry
- **Location**: `artifacts/api-server/src/lib/webhook.ts` → `enqueueOutboundEvent`, `startRetryLoop`, `getOutboundWebhookUrl`
- **What it does**: Persists outbound events to `webhook_retry_queue` (with optional `correlationId`), attempts immediate delivery, schedules retries with exponential backoff (`30 s → 2 min → 5 min`, max 4 attempts), retries on 5xx / 408 / 429 / network error, gives up on other 4xx. The retry loop logs include `correlationId` so a delivery can be traced back to the originating HTTP request.
- **Resolution order for the URL**: `system_settings.outbound_webhook_url` first (admin-configurable), then `process.env.WEBHOOK_URL` as fallback. `routes/settings.ts` `readWebhookUrl` mirrors this and returns the `source` (`settings` | `env` | `unset`) for the admin UI.
- **Callers**: `routes/orders.ts` on creation, assignment, status changes, pickup-time updates — every call threads `String(req.id)` as `correlationId`.
- **Do not**: `fetch` upstream from a route handler. Do not bypass the queue "just for this one event". Do not omit `correlationId` from new call sites.

### Revoked-token janitor
- **Location**: `artifacts/api-server/src/lib/janitor.ts` → `startJanitor`
- **What it does**: Every 5 minutes, deletes rows from `revoked_tokens` whose `expiresAt` has passed. Bounds the table size linearly with logout volume rather than session lifetime.
- **Wiring**: started from `index.ts` next to `startRetryLoop`. Logs `{ deleted }` per sweep.
- **Do not**: prune revoked rows from a route handler or on the request path.

### Typed runtime settings readers
- **Location**: `artifacts/api-server/src/lib/settings-readers.ts`
- **What it does**: Single place for typed reads of `system_settings` rows that are consulted on the request path. Currently exports `getAllowRiderSelfClaim()` (default `true`). Add new typed readers here rather than re-parsing the row at the call site.
- **Callers**: `routes/orders.ts` rider self-claim guard. UI gate is the auth-only `GET /settings/flags` endpoint (`{ allowRiderSelfClaim }`), consumed by `pages/rider.tsx` via `useGetSettingsFlags`. The full `GET /settings` stays admin-only because it exposes the outbound webhook URL.
- **Do not**: read `system_settings` directly from a route when a typed reader exists or could exist. Do not call admin-only `GET /settings` from non-admin UI surfaces — use `/settings/flags` for any rider/coordinator/restaurant-facing flag reads.

### Push notification dispatch
- **Location**: `artifacts/api-server/src/lib/push.ts`
- **What it does**: Lazy-configures VAPID. Sends to a list of user IDs (resolved from role + per-order audience). Auto-deletes 410/404 subscriptions. Silently no-ops when VAPID is unset.
- **Callers**: `routes/orders.ts`.
- **Do not**: import `web-push` elsewhere.

### Push audiences
- **Location**: `artifacts/api-server/src/lib/push-triggers.ts`
- **What it does**: Returns the audience descriptor for each event type. Order-level: `audienceForNewOrder`, `audienceForAssignment`, `audienceForStatus(status)`. Trip-level: `audienceForTripAssigned` (coordinators + admins + the assigned rider when one is set), `audienceForTripDissolved` (coordinators + admins + the previously-assigned rider + restaurant staff for the affected orders), `audienceForOpenTrip` (coordinators + admins; rider-side discovery is via the regular list and the self-claim flag). Audiences include role lists plus the per-order flags `notifyAssignedRider` and `notifyOrderRestaurantStaff`.
- **Callers**: order events from `routes/orders.ts`; trip events from `routes/trips.ts` (`PATCH /trips/:id` on rider change → `audienceForTripAssigned`; `POST /trips/:id/dissolve` → `audienceForTripDissolved`).
- **Do not**: enumerate roles inline at the call site. Do not add a new trip event without a matching audience helper here.

---

## Data Access

### Drizzle client
- **Location**: `lib/db/src/index.ts` → `db`, `pool`
- **What it does**: Single Drizzle client. Reads `DATABASE_URL` at module load.
- **Do not**: instantiate a second pool.

### Order serialization
- **Location**: `artifacts/api-server/src/lib/order-serialize.ts`
- **What it does**: `serializeOrderDetail`, `serializeOrderListItems` — produces the wire shape (effective pickup, applied items, status logs, rider/restaurant joins).
- **Do not**: serialize an order ad hoc in a route. Add a new serializer here if you need a new shape.

### HTTP errors
- **Location**: `artifacts/api-server/src/lib/errors.ts` → `AppError`, `httpError(status, code, message)`
- **What it does**: Typed errors with a stable `code`. Caught and rendered consistently by `middlewares/error-handler.ts` as `{ error, code, requestId, [details] }`.
- **Do not**: `res.status(...).json(...)` for an error case. Throw `httpError(...)` and let the handler render it.

### Logger
- **Location**: `artifacts/api-server/src/lib/logger.ts` → `logger`; HTTP-scoped via `pino-http` in `app.ts` exposes `req.log`.
- **Do not**: `console.log` in server code. Prefer `req.log` inside a request, `logger` outside.

### Rate limits
- **Location**: `artifacts/api-server/src/middlewares/rate-limit.ts` → `authLimiter`, `inboundLimiter`
- **What it does**: 60/min on inbound, 30/min on auth. Wired in `app.ts`.

---

## Frontend Plumbing

### API client configuration
- **Location**: `artifacts/bestellenbij/src/lib/api.ts` → `configureApi`, `getToken`, `setToken`
- **What it does**: Sets the orval client base to `import.meta.env.BASE_URL` (without trailing slash) and registers a token getter from `localStorage.bb_token`. Orval-generated paths already include `/api`.
- **Do not**: append `/api` to the base. Do not write your own `fetch` wrapper.

### Auth context
- **Location**: `artifacts/bestellenbij/src/lib/auth.tsx` → `AuthProvider`, `useAuth`, `RequireRole`
- **What it does**: Reads `bb_token`, runs `useGetCurrentUser`, clears the token on a 401, provides `applyToken`. `signOut` is context-aware: it reads `window.location.pathname`, asks `getContextForPath`, and navigates to that context's login (`/rider/login` or `/restaurant/login`). `RequireRole` redirects unauthenticated callers to the same context-appropriate login, and authenticated callers with the wrong role to `ROLE_HOMES[user.role]`.
- **Do not**: call `useGetCurrentUser` from random components for auth — use `useAuth`. Do not hard-code `/login` as the post-logout destination — go through `getLoginPath`.

### App context (rider vs restaurant)
- **Location**: `artifacts/bestellenbij/src/lib/app-context.ts`
- **What it does**: The runtime view of which of the two PWAs the user is in. Exports `AppContext = "rider" | "restaurant"`, the role allowlists (`RIDER_ROLES = [admin, coordinator, rider]`, `RESTAURANT_ROLES = [restaurant_staff]`), `getContextForPath` (path → context — restaurant iff path is `/restaurant` or `/restaurant/...`), `getContextForRole` (role → context — `restaurant_staff` is restaurant, everyone else is rider), `getLoginPath`, and `getAllowedRolesForContext`.
- **Callers**: `lib/auth.tsx` (signOut + RequireRole redirect targets), `pages/login.tsx` (variant role gating + cross-link), `pages/landing.tsx` (link targets), `main.tsx` (manifest selection).
- **Do not**: introduce a third app variant without updating this module first. Do not duplicate the role partitioning at a call site (`role === "restaurant_staff" ? …`) — call `getContextForRole`. Do not let a login page accept a role outside `getAllowedRolesForContext(variant)`.

### Web app manifests
- **Location**: `artifacts/bestellenbij/public/manifest-rider.webmanifest`, `artifacts/bestellenbij/public/manifest-restaurant.webmanifest`; runtime selection in `artifacts/bestellenbij/src/main.tsx`.
- **What it does**: Bestellenbij ships as two independently-installable PWAs from one bundle. Rider PWA: `scope = "/"`, `start_url = "/rider/login"`, `id = "/?app=rider"`. Restaurant PWA: `scope = "/restaurant/"`, `start_url = "/restaurant/login"`, `id = "/?app=restaurant"`. `index.html` declares one `<link rel="manifest" id="app-manifest">` defaulting to the rider manifest; on boot, `main.tsx` reads the path, calls `getContextForPath`, and rewrites the `href` before React mounts.
- **Do not**: add a second `<link rel="manifest">` to `index.html`. Do not turn manifest generation back on in `vite.config.ts` (it would emit a third file that conflicts with these two — `manifest: false` is intentional). Do not change `id` on either manifest without coordinating an OS-level reinstall — Chrome and iOS key the installed app on `id`. Do not narrow the rider scope without a route audit; admin/coordinator/rider routes (`/admin`, `/coordinator`, `/rider`, `/settings`) all live at root and rely on the rider PWA's `/` scope to capture them.

### Generated API hooks and Zods
- **Location**: `lib/api-client-react` and `lib/api-zod` — generated from `lib/api-spec/openapi.yaml` by `pnpm --filter @workspace/api-spec run codegen`.
- **Do not**: hand-write a fetcher for an endpoint that exists in the spec. Add it to the spec and regenerate.

### Orval naming gotcha
Orval auto-generates a Zod response schema named `<OperationId>Response` for every operation. Do NOT name an OpenAPI component schema with the same suffix — they collide on export. We already use `AuthSession` (not `LoginResponse`) for the login operation's body schema.

---

## Route Modules

All routes are mounted under `/api` (see `artifacts/api-server/src/app.ts` → `app.use("/api", router)`). Each module exports an `IRouter` and is registered in `routes/index.ts`.

| Module | File | Mounted at | Notable endpoints |
| --- | --- | --- | --- |
| Health | `routes/health.ts` | `/api/healthz` | GET healthz |
| Auth | `routes/auth.ts` | `/api/auth/*` | POST login, POST logout, GET me |
| Orders | `routes/orders.ts` | `/api/orders/*`, `/api/inbound/orders` | POST inbound (shared-secret), GET list, GET by id, POST assign, POST status, POST pickup-time, POST items hide/add, POST contact, POST rider-notification |
| Riders | `routes/riders.ts` | `/api/riders/*` | GET list, POST create, PATCH availability, POST suspend |
| Restaurants | `routes/restaurants.ts` | `/api/restaurants/*` | GET list, POST create, PATCH, DELETE |
| Users | `routes/users.ts` | `/api/users/*` | GET, POST, PATCH, DELETE |
| Settings | `routes/settings.ts` | `/api/settings/*` | GET, PATCH (admin only) |
| Push | `routes/push.ts` | `/api/push/*` | GET vapid-public-key, POST subscribe, POST unsubscribe |
| Trips | `routes/trips.ts` | `/api/trips/*` | GET list (role-scoped: riders see own, restaurant_staff see none), GET by id, POST create (admin/coordinator), PATCH rename/reassign (admin/coordinator; returns 409 `TRIP_IN_MOTION` unless `force: true`), PUT replace stops (admin/coordinator), POST dissolve (admin/coordinator/own-rider). All multi-statement mutations run inside `db.transaction(...)` with `SELECT ... FOR UPDATE`. |

Per-endpoint rate limits are applied in `app.ts` before the main router: `/api/auth` → `authLimiter`, `/api/inbound/orders` → `inboundLimiter`.

---

## Change Log

- **2026-05-03** — Initial documentation pass. Captured all SSOTs that exist today: pickup-time priority (server + client), state machine, status visuals, urgency thresholds, push audiences, webhook retry, auth, order serialization, formatters. Noted no gaps below — items that should be centralized but aren't yet are tracked in `docs/todo.md`.
- **2026-05-03** — SSOT centralization pass. (1) Active locale resolution is now a priority chain (profile > localStorage > navigator > `nl`); `applyProfileLocale` is the only path the AuthProvider uses, and `PATCH /users/me/locale` persists the per-user override (`users.preferred_locale`). (2) Outbound webhook URL precedence inverted: admin-configurable `system_settings.outbound_webhook_url` wins, env is fallback. Every `enqueueOutboundEvent` call threads `correlationId` (request id), persisted on `webhook_retry_queue.correlation_id` and surfaced in retry logs. (3) New `lib/janitor.ts` prunes expired `revoked_tokens` every 5 minutes. (4) New `lib/settings-readers.ts` for typed runtime settings; `allow_rider_self_claim` (default true) gates rider self-claim on `POST /orders/:id/assign`.
- **2026-05-03** — Trip bundling end-to-end (Task #5). New `trips` and `trip_stops` tables; `orders.tripId` FK. `routes/trips.ts` exposes `/api/trips/*` (list, detail, create, rename/reassign, replace-stops, dissolve). `order-serialize.ts` surfaces `bundlePickupTime` for same-trip + same-restaurant orders. New `audienceForTripAssigned`, `audienceForTripDissolved`, `audienceForOpenTrip` push audiences. Order state machine extended with `postponed` (reachable from `en_route_to_restaurant` / `en_route_to_customer`; resumable to either or to `failed`). Frontend pages `coordinator-trip.tsx`, `coordinator-trip-builder.tsx`, restaurant `BundleCard`, coordinator `TripsSection`, rider trip banner.
- **2026-05-03** — Trip mutations made safe under concurrent edits (Task #6). Every multi-statement mutation in `routes/trips.ts` (create, patch, replace-stops, dissolve) now runs inside `db.transaction(async (tx) => …)` and starts with `SELECT ... FOR UPDATE` on the trip row. Terminal-state checks and order-status reads happen inside the same transaction so a concurrent rider advance, rename, or dissolve cannot leave a trip with partial stops or partial order linkage. Resolves `docs/todo.md` L5.
- **2026-05-03** — Reassignment of in-motion trips behind explicit confirmation (Task #7). `PATCH /api/trips/:id` returns `409 TRIP_IN_MOTION` when the assigned rider changes and any order on the trip is at or past `picked_up`. The coordinator UI (`pages/coordinator-trip.tsx`) catches that error code, opens a confirmation dialog, and re-issues the patch with `force: true` on confirm. Server preserves in-flight order statuses; only the trip's rider is swapped. Resolves `docs/todo.md` L6.
- **2026-05-03** — Dual-PWA split. The web artifact is now two independently-installable PWAs from one bundle: rider (internal — admin/coordinator/rider, scope `/`) and restaurant (external — restaurant_staff, scope `/restaurant/`). New SSOT `lib/app-context.ts` partitions roles, paths, and login targets. New SSOT entry "Web app manifests" registers the two static manifests and the runtime swap in `main.tsx`. `signOut` and `RequireRole` redirect to context-appropriate logins. Frontend routes added: `/` (landing with two role-pick buttons), `/rider/login` (rider-app login, gates to `RIDER_ROLES`), `/restaurant/login` (restaurant-app login, gates to `RESTAURANT_ROLES`). Legacy `/login` retained as a rider-variant alias for old bookmarks.
