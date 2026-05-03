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
- **Logic**: Pipeline transitions are `pending → driver_assigned → en_route_to_restaurant → picked_up → en_route_to_customer → delivered`. `failed` is reachable from any non-failed state. No same-state transitions. No transitions out of terminal states.
- **Callers**: `routes/orders.ts` on every status-changing endpoint.
- **Do not**: implement a parallel "can the rider do X here" check in the frontend. The frontend may hide buttons, but the server is the only authority.

### Item overrides application
- **Location**: `artifacts/api-server/src/lib/order-serialize.ts` → `applyItemOverrides`
- **What it does**: Applies hide-by-index and add-new overrides to the original `order_items` to produce the displayed list, while preserving the originals on the order.
- **Callers**: `serializeOrderDetail`, `serializeOrderListItems`.
- **Do not**: mutate `order_items`. Overrides are an additive layer.

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
- **Location**: `artifacts/api-server/src/lib/auth.ts` → `requireAuth`, `requireRole`, `requireInboundSecret`
- **What it does**: `requireAuth` validates the bearer token (or `auth_token` cookie), checks revocation, loads the user, and resolves `riderId` for rider users. `requireRole(...roles)` gates by role. `requireInboundSecret` matches `x-inbound-secret` against `INBOUND_SHARED_SECRET`.
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
- **Location**: `artifacts/bestellenbij/src/lib/i18n.ts`
- **What it does**: Initializes i18next with `lng = localStorage.getItem("bb_locale") || "nl"`. Persists on `languageChanged`.
- **Do not**: introduce browser-language detection. Do not read `navigator.language` in product code.

### Locale-aware UI mapping
- **Location**: `artifacts/bestellenbij/src/lib/format.ts` → `uiLocale(lang)` (`nl` → `nl-NL`, `en` → `en-GB`)
- **Do not**: hard-code `"nl-NL"` in components.

---

## External Services

### Outbound webhook dispatch + retry
- **Location**: `artifacts/api-server/src/lib/webhook.ts` → `enqueueOutbound`, `startRetryLoop`, `getOutboundWebhookUrl`
- **What it does**: Persists outbound events to `webhook_retry_queue`, attempts immediate delivery, schedules retries with exponential backoff (`30 s → 2 min → 5 min`, max 4 attempts), retries on 5xx / 408 / 429 / network error, gives up on other 4xx.
- **Resolution order for the URL**: `process.env.WEBHOOK_URL` first, then `system_settings.outbound_webhook_url`.
- **Callers**: `routes/orders.ts` on creation, assignment, status changes, pickup-time updates.
- **Do not**: `fetch` upstream from a route handler. Do not bypass the queue "just for this one event".

### Push notification dispatch
- **Location**: `artifacts/api-server/src/lib/push.ts`
- **What it does**: Lazy-configures VAPID. Sends to a list of user IDs (resolved from role + per-order audience). Auto-deletes 410/404 subscriptions. Silently no-ops when VAPID is unset.
- **Callers**: `routes/orders.ts`.
- **Do not**: import `web-push` elsewhere.

### Push audiences
- **Location**: `artifacts/api-server/src/lib/push-triggers.ts`
- **What it does**: Returns the audience descriptor for each event type — `audienceForNewOrder`, `audienceForAssignment`, `audienceForStatus(status)`. Audiences include role lists plus the per-order flags `notifyAssignedRider` and `notifyOrderRestaurantStaff`.
- **Do not**: enumerate roles inline at the call site.

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
- **Location**: `artifacts/bestellenbij/src/lib/auth.tsx` → `AuthProvider`, `useAuth`
- **What it does**: Reads `bb_token`, runs `useGetCurrentUser`, redirects on 401, provides `signOut` and `applyToken`.
- **Do not**: call `useGetCurrentUser` from random components for auth — use `useAuth`.

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

Per-endpoint rate limits are applied in `app.ts` before the main router: `/api/auth` → `authLimiter`, `/api/inbound/orders` → `inboundLimiter`.

---

## Change Log

- **2026-05-03** — Initial documentation pass. Captured all SSOTs that exist today: pickup-time priority (server + client), state machine, status visuals, urgency thresholds, push audiences, webhook retry, auth, order serialization, formatters. Noted no gaps below — items that should be centralized but aren't yet are tracked in `docs/todo.md`.
