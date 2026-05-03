# Bestellenbij

## Overview

Bestellenbij is an internal food-delivery logistics PWA for a Dutch delivery cooperative. An upstream distribution service posts orders into the inbound endpoint; coordinators and admins dispatch them to riders; restaurant staff confirm pickup readiness; riders advance the status to delivered. The system tracks a strict order state machine, a multi-source pickup-time priority, item overrides, outbound webhooks with retry, and Web Push notifications.

In scope: order ingestion and lifecycle, role-based UIs (admin, coordinator, rider, restaurant_staff), pickup-time management, item overrides, push, outbound webhooks, local auth.
Out of scope: payments, customer-facing tracking, financial calculations, marketing site, route optimization, real-time map. The system is a passthrough for money — never compute totals from items.

## Hard Policies

These are non-negotiable. They are derived from the product and the code, not preferences.

1. **`pickup_time_original` is immutable after insert.** It is the upstream-calculated ASAP time. Never overwrite it. All other pickup times are stored separately and resolved by priority at read time.
2. **No floating-point money.** Amounts are PostgreSQL `numeric` and travel as strings end to end. The system does no arithmetic on money — it is a passthrough. Do not parse a price into `Number`.
3. **Status transitions are validated.** Every write that changes `orders.status` must go through `assertValidTransition` (`artifacts/api-server/src/lib/state-machine.ts`). No direct status update without it.
4. **Rider assignment is atomic.** Use the conditional `UPDATE ... WHERE status = 'pending'` pattern. Do not read-then-write.
5. **Inbound endpoint is shared-secret + rate-limited.** `x-inbound-secret` matched against `INBOUND_SHARED_SECRET`, plus `inboundLimiter`. Auth endpoints likewise rate-limited.
6. **Role-based filtering happens in the SQL query**, not in JS after the fetch. Restaurant staff queries must be scoped by `restaurantId`, rider queries by `riderId`, in the `WHERE` clause.
7. **Inbound payloads are idempotent.** Same `orderId` arriving twice updates, never duplicates. Preserve the raw upstream body in `orders.originalPayload` (jsonb).
8. **Operator-configured externals.** The outbound webhook URL and VAPID keys are runtime configuration (`WEBHOOK_URL` / system_settings, and `VAPID_*` env). Never hardcode.
9. **No emojis in product surfaces** (UI copy, locale files, code comments meant for end users). The product is for professional dispatch.
10. **`data-testid` on every interactive or assertable element.** This is a tested precondition, not a nice-to-have.

## The Bestellenbij Guardian

**Title:** Lead Architect for Bestellenbij.
**Mission:** Prevent plausible-looking tech debt from creeping into a small, fast-moving logistics codebase by enforcing centralized utilities, a strict status state machine, and operator-configured externals. The failure mode we are guarding against is parallel re-implementations of pickup-time priority, status colors, role checks, or webhook retry that drift apart and silently corrupt operational data.

### 1. Reuse the centralized utilities. Do not re-implement.
- **Pickup-time priority**: `resolveEffectivePickupTime` in `artifacts/api-server/src/lib/pickup-time.ts` (server) and `effectivePickup` in `artifacts/bestellenbij/src/lib/format.ts` (client). New code that reads pickup time goes through these.
- **Status state machine**: `isValidTransition` / `assertValidTransition` in `artifacts/api-server/src/lib/state-machine.ts`. Never branch on status strings to decide legality.
- **Status visuals and i18n keys**: `STATUS_CLASS`, `URGENCY_CLASS`, `statusI18nKey` in `artifacts/bestellenbij/src/lib/status.ts`.
- **Time and currency formatting**: `formatTime`, `formatDateTime`, `formatCurrency`, `pickupCountdownLabel`, `urgencyFor`, `minutesUntil` in `artifacts/bestellenbij/src/lib/format.ts`. The countdown formatter returns an `i18n` descriptor — render with `t()`, do not concatenate strings.
- **Push audiences**: `audienceForNewOrder`, `audienceForAssignment`, `audienceForStatus` in `artifacts/api-server/src/lib/push-triggers.ts`. Trigger rules live there, not in route handlers.

### 2. Auth and authorization rules.
- Use `requireAuth` and `requireRole(...roles)` from `artifacts/api-server/src/lib/auth.ts`. Do not hand-roll role checks inside handlers.
- Inbound endpoints use `requireInboundSecret`, never `requireAuth`.
- JWT signing/verifying lives in `auth.ts`. Do not call `jsonwebtoken` directly from route code.
- Frontend `RequireRole` guard in `App.tsx` enforces role boundaries; new pages must be wrapped.

### 3. Time and locale.
- The product locale defaults to `nl`. `bb_locale` (localStorage) is the truth. Do not introduce a second source.
- Times are stored as UTC `timestamptz`, rendered via `Intl.DateTimeFormat(uiLocale(lang))`. Do not call `toLocaleString` ad hoc.
- The "absolute vs. relative" cutoff is ±30 minutes — encoded once in `pickupCountdownLabel`. Don't reinvent.

### 4. External services and side effects.
- Outbound webhooks: enqueue through `enqueueOutbound` / the retry queue in `artifacts/api-server/src/lib/webhook.ts`. Do not `fetch` upstream directly from a route handler.
- Push: send through `artifacts/api-server/src/lib/push.ts`. VAPID is runtime config and may be unconfigured — the helper degrades silently to debug-log.
- Outbound payloads must include the canonical event types defined in `OutboundEventType`.

### 5. Data integrity.
- Never write `pickup_time_original`. After insert it is read-only.
- Item overrides go in `item_overrides`, not by mutating `order_items`.
- Status changes always log to `order_status_logs` with `userId`, `userRole`, `from`, `to`, `at`.

### Hard Constraints / No-Go Zone

- No `as any`. No `as unknown as <T>` to bypass model gaps — fix the model or fetch the data.
- No `Number(price)` or `parseFloat(price)` on money fields.
- No new `console.log` in server code. Use `req.log` (HTTP-scoped) or the `logger` import.
- No new `fetch(...)` to the upstream service from anywhere except `webhook.ts`.
- No new way to compute "is this status valid here" outside `state-machine.ts`.
- No new way to format pickup countdown outside `pickupCountdownLabel`.
- No new locale-detection libraries — `bb_locale` is the source of truth.
- No emojis in user-facing copy.

## Pattern Enforcement Table

If you are touching... → use this.

| Concern | File / Export |
| --- | --- |
| Computing effective pickup time on the server | `artifacts/api-server/src/lib/pickup-time.ts` → `resolveEffectivePickupTime` |
| Computing effective pickup time on the client | `artifacts/bestellenbij/src/lib/format.ts` → `effectivePickup` |
| Validating a status transition | `artifacts/api-server/src/lib/state-machine.ts` → `assertValidTransition` |
| Status badge color / label key | `artifacts/bestellenbij/src/lib/status.ts` → `STATUS_CLASS`, `statusI18nKey` |
| Pickup countdown urgency color | `artifacts/bestellenbij/src/lib/format.ts` → `urgencyFor` + `URGENCY_CLASS` |
| Pickup countdown text | `artifacts/bestellenbij/src/lib/format.ts` → `pickupCountdownLabel` (returns i18n descriptor) |
| Time / date / currency rendering | `artifacts/bestellenbij/src/lib/format.ts` |
| JWT signing / verification | `artifacts/api-server/src/lib/auth.ts` |
| Express auth middleware | `artifacts/api-server/src/lib/auth.ts` → `requireAuth`, `requireRole`, `requireInboundSecret` |
| Throwing typed HTTP errors | `artifacts/api-server/src/lib/errors.ts` → `httpError(status, code, message)` |
| Push audiences for an event | `artifacts/api-server/src/lib/push-triggers.ts` |
| Sending a Web Push message | `artifacts/api-server/src/lib/push.ts` |
| Sending an outbound webhook | `artifacts/api-server/src/lib/webhook.ts` → `enqueueOutbound`, `startRetryLoop` |
| Serializing an order for the API | `artifacts/api-server/src/lib/order-serialize.ts` |
| Frontend API client config / token | `artifacts/bestellenbij/src/lib/api.ts` (`configureApi`, `getToken`, `setToken`) |
| React Query hooks | `@workspace/api-client-react` (orval-generated — do not hand-write fetchers) |
| Zod request/response schemas | `@workspace/api-zod` (orval-generated) |
| Drizzle table / type | `@workspace/db` (re-exports from `lib/db/src/schema/*`) |

(Non-exhaustive — see `docs/architecture_sources_of_truth.md` for the complete registry.)

## System Architecture

**Tech stack**

- Runtime: Node 24, TypeScript ~5.9
- Monorepo: pnpm workspaces (`pnpm-workspace.yaml` defines artifacts and shared libs)
- API: Express 5, Pino + pino-http, cookie-parser, cors, express-rate-limit
- Auth: local bcryptjs + JWT HS256 (7-day expiry), JTI revocation table
- Database: PostgreSQL via Drizzle ORM (schema under `lib/db/src/schema/`)
- Validation: Zod (`zod/v4`), drizzle-zod
- API contract: OpenAPI (`lib/api-spec/openapi.yaml`); Orval generates `@workspace/api-client-react` (TanStack Query hooks) and `@workspace/api-zod` (Zod schemas)
- Frontend: React 18, Vite 7, Wouter, TanStack Query, Tailwind, framer-motion, react-i18next, shadcn/Radix UI primitives
- PWA: hand-rolled `public/sw.js` + `public/manifest.webmanifest` (we do NOT use vite-plugin-pwa — 1.2.0 was incompatible with Node 24)
- Web Push: `web-push` with VAPID
- Build: esbuild (CJS bundle) for api-server; Vite for the web artifact

**Core architectural decisions**

- **Path-based proxy.** Each artifact binds to its own `PORT`; the workspace proxy maps `/` → bestellenbij and `/api/*` → api-server. Wouter `base` and the API client base both come from `import.meta.env.BASE_URL`. Orval-generated paths already include `/api`, so the client base is `BASE_URL` only.
- **Polling, not push, is the source of truth.** Frontend polls every 30 s. Push notifications supplement polling for latency-sensitive events but never replace the loop.
- **Server-validated state machine.** All status transitions go through one helper. Frontend never decides legality.
- **Atomic rider assignment** via `UPDATE WHERE status='pending'` with a conditional clause; the row count tells us whether we won the race.
- **Webhook retry queue is in the database** (`webhook_retry_queue`), not in memory. A 10-second polling loop (`startRetryLoop`) drains due retries. Survives restarts.
- **Push audiences are centralized** in `push-triggers.ts`. Routes call `audienceForX()` and pass the result to `push.ts`.
- **Item overrides are additive**: original `order_items` are preserved; `item_overrides` (hide-by-index, add-new) is the display layer.
- **JWT + JTI revocation**: tokens are stateless, but logout writes the JTI into `revoked_tokens` so existing sessions can be revoked.
- **Money is a string.** PG `numeric`, transmitted as a string, never parsed into a `Number`.
- **i18n default is hard-coded `nl`.** No browser language detection — too unreliable in the dispatch context. `bb_locale` is the single source.

**Database schema**

- Drizzle schemas live in `lib/db/src/schema/*.ts`, re-exported from `@workspace/db`.
- Migrations are pushed (not generated) for now: `pnpm --filter @workspace/db run push`.
- `drizzle.config.ts` reads `DATABASE_URL` from env.

## Documentation Conventions

| File | Purpose | When to consult |
| --- | --- | --- |
| `replit.md` | Master operating manual. Loaded at the start of every session. Hard policies, Guardian rules, pattern enforcement. | Always — start here. |
| `docs/architecture_sources_of_truth.md` | SSOT registry. The authoritative list of "this is the one place where X lives". | Before implementing any business logic, to confirm whether a centralized utility already exists. |
| `docs/architecture-full-technical.md` | Reference document for new contributors: business context, component structure, business flows, integrations. | When onboarding or when you need a flow-level explanation rather than a rule. |
| `docs/todo.md` | Deferred engineering work that is not yet a planned feature. Inferred from comments, gaps, and partial centralization. | Before starting unrelated work to see if a small fix is in your path. |
| `FUTURE_WORK.md` | Roadmap of planned-but-not-yet-built product features (the 14 items from the brief). | Product / planning conversations. |
| `.local/tasks/*.md` | Per-task briefs for the project tasks workflow. | When taking or planning a project task. |

**Update rule:** when you complete a task that changes the public surface of a centralized utility, alters a hard policy, or adds a new SSOT, update `replit.md` and/or `docs/architecture_sources_of_truth.md` in the same change. The Change Log section at the bottom of the SSOT document is appended to every time. Documentation drift is a defect.

## External Dependencies

| Service | Purpose | Configured by | Status |
| --- | --- | --- | --- |
| PostgreSQL (Replit-managed) | Primary datastore | `DATABASE_URL` | Live |
| Upstream distribution service (inbound) | Sends orders into the platform | `INBOUND_SHARED_SECRET` (header `x-inbound-secret`) | Live (contract defined; counterparty operator-configured) |
| Upstream distribution service (outbound webhooks) | Receives status changes from us | `WEBHOOK_URL` env (or `system_settings.outbound_webhook_url`) | Live (target URL is operator-configured) |
| Web Push (browser push services) | Rider/coordinator/staff push notifications | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Live when VAPID is set; degrades to no-op when unset |
| JWT signing | Local auth | `JWT_SECRET` | Live (required at boot) |
| CORS allowlist | Cross-origin browser auth | `CORS_ALLOWED_ORIGINS` (comma-separated) | Live; permissive in non-production |
| Logging level | Pino verbosity | `LOG_LEVEL` (default `info`) | Live |
