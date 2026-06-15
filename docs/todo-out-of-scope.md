# Out-of-Scope Items Registry

Every task written for this project has an "Out of scope" section. This document is a permanent index of those items so they don't get lost when the task is closed or archived.

For each item: where it came from, whether it is already in `docs/todo-roadmap.md` (the roadmap register), whether it is a **deferred feature** (we expect to build it eventually) or a **conscious boundary** (an architectural choice not to build this here), and any implementation notes captured at the time.

Items that appear in multiple tasks' out-of-scope sections are merged into one entry.

---

## Authentication & Identity

### External identity provider integration
- **Source**: Task #1 (Backend Foundation)
- **In docs/todo-roadmap.md**: No
- **Kind**: Deferred feature
- **Notes**: The local email/password auth system (bcryptjs + JWT HS256, JTI revocation) was intentionally designed to be replaceable. The `auth.ts` helpers (`hashPassword`, `verifyPassword`, `signToken`, `verifyToken`) are centralized so an OAuth/SAML/OIDC layer can be swapped in without touching route handlers. When this becomes necessary, the most natural seam is replacing `signToken`/`verifyToken` and the `POST /api/auth/login` handler while keeping `requireAuth` and `requireRole` intact. `docs/todo-roadmap.md` does not cover this — it is an infrastructure task, not a product feature.

---

## Quality & Reliability

### Automated test suite
- **Source**: Tasks #1, #2 (multiple mentions)
- **In docs/todo-roadmap.md**: Yes — item 1 (Quality & Reliability)
- **Kind**: Deferred feature (highest priority of all deferred work)
- **Notes**: The four highest-leverage tests identified at the time: state machine unit tests, idempotent inbound order ingestion, webhook retry queue, and pickup-time priority calculation. Also noted as the prerequisite that makes every other deferred item safer to build. See also `docs/todo.md` H3.

### Full translation review and copywriting
- **Source**: Task #3 (Frontend PWA)
- **In docs/todo-roadmap.md**: No
- **Kind**: Deferred feature
- **Notes**: All Dutch and English strings exist and are functional. They were written for correctness and completeness, not for voice, tone, or professional copywriting review. Before the platform goes to a wider user base, both `src/locales/nl/translation.json` and `src/locales/en/translation.json` should be reviewed by a native speaker familiar with dispatch/logistics terminology. No structural changes needed — it is a content pass only.

---

## Architecture

### Real-time updates (WebSockets or SSE)
- **Source**: Tasks #2, #3
- **In docs/todo-roadmap.md**: Yes — item 14 (Architecture)
- **Kind**: Deferred feature — a deliberate architectural boundary for now
- **Notes**: The frontend polls every 30 seconds via TanStack Query `refetchInterval`. Web Push supplements this for latency-sensitive events but is not a replacement (push can be missed; polling is the ground truth). The current design is intentional: a pushed-only architecture fails silently when sockets drop and dispatchers miss orders. When real-time is added, the recommended path is SSE over a new `/api/events` endpoint (simpler than WebSockets for a server-push-only pattern) with the polling loop kept as a fallback. See `docs/architecture-full-technical.md` §8 (Known Limitations, item 1).

### Timezone handling per restaurant
- **Source**: Task #2 (Backend Implementation)
- **In docs/todo-roadmap.md**: Yes — item 5 (Quality & Reliability)
- **Kind**: Deferred feature
- **Notes**: The server runs UTC; the client renders with `Intl.DateTimeFormat` using `nl-NL` / `en-GB`. This works correctly for the current cooperative (all in `Europe/Amsterdam`) because `Intl` applies DST from the device's locale. It breaks if the cooperative expands beyond that timezone or if the server ever needs to reason about "what time is it at the restaurant." The fix is a `timezone` column on `restaurants` (defaulting to `"Europe/Amsterdam"`) and passing it through to any server-side time computation. See `docs/architecture-full-technical.md` §8 (Known Limitations, item 4).

---

## Operations & Admin

### Order export / download
- **Source**: Task #2 (Backend Implementation)
- **In docs/todo-roadmap.md**: Yes — item 6 (Operations & Admin)
- **Kind**: Deferred feature
- **Notes**: CSV export of filtered order lists for coordinators and admins. No schema changes needed; it is a read-side operation on existing data. The natural entry point is the coordinator order board filter panel.

### Order deletion and duplication
- **Source**: Task #2 (Backend Implementation)
- **In docs/todo-roadmap.md**: Yes — item 7 (Operations & Admin)
- **Kind**: Deferred feature
- **Notes**: Deletion is an admin-only hard-delete for erroneous orders. Duplication creates a new `pending` order from an existing one's payload — useful for re-dispatching a `failed` delivery. Both require `order_status_logs` and `item_overrides` handling (delete cascades; duplicate copies overrides fresh). The inbound idempotency key (`orderId`) means a duplicated order needs a new synthetic `orderId`.

### Per-restaurant (or per-brand) webhook targets
- **Source**: Task #2 (Backend Implementation)
- **In docs/todo-roadmap.md**: Yes — item 8 (Operations & Admin)
- **Kind**: Deferred feature
- **Notes**: Currently all outbound events go to one global URL (`system_settings.outbound_webhook_url` or `WEBHOOK_URL`). The natural evolution is a `webhookUrl` column on `restaurants` (or a separate `webhook_targets` table for brand-level targets). The `enqueueOutboundEvent` function in `lib/webhook.ts` would need to resolve the target URL per-order rather than globally. The `getOutboundWebhookUrl` helper in the same file is the single change point.

### Admin dashboard / analytics
- **Source**: Task #3 (Frontend PWA)
- **In docs/todo-roadmap.md**: Yes — item 9 (Operations & Admin)
- **Kind**: Deferred feature
- **Notes**: Orders per restaurant per day, average delivery time, rider performance, on-time rates, failed-delivery breakdown. All data exists in `orders`, `order_status_logs`, and `rider_assignments`. A reporting layer does not require schema changes — it is a set of aggregation queries and a new admin page.

### Availability scheduling for riders
- **Source**: Task #3 (Frontend PWA), listed as "Rider shift scheduling view"
- **In docs/todo-roadmap.md**: Yes — item 10 (Operations & Admin)
- **Kind**: Deferred feature
- **Notes**: Riders currently have a simple `availability` status (`offline`/`online`/`backup`) toggled manually. A shift-based view where coordinators plan upcoming rider availability in advance would be the natural extension. Would require a `rider_shifts` table and a scheduler UI for coordinators.

---

## UX Improvements

### Rider mobile UX — dedicated per-step delivery flow
- **Source**: Task #3 (Frontend PWA)
- **In docs/todo-roadmap.md**: Yes — item 11 (UX Improvements)
- **Kind**: Deferred feature
- **Notes**: The rider interface today surfaces the full order detail and a status-advance button. A proper mobile-first flow would have one screen per delivery step (navigate → arrived at restaurant → food picked up → navigate to customer → delivered), with large tap targets and no cognitive overhead. The trip-bundling mockup `RiderTripStops.tsx` on the canvas is a partial design input for this.

### Customer-facing delivery status page
- **Source**: Tasks #3, #5
- **In docs/todo-roadmap.md**: Yes — item 12 (UX Improvements)
- **Kind**: Deferred feature
- **Notes**: An optional public-facing URL per order where the customer can track their delivery without logging in. Task #5 adds a nuance: if the order is part of a trip, the customer should still only see their own order (not the full trip routing or other customers' data). The customer-facing page is entirely decoupled from trips at the data layer — `tripId` is an internal field and would not be exposed.

### Notification preference management per user
- **Source**: Task #3 (Frontend PWA)
- **In docs/todo-roadmap.md**: Yes — item 13 (UX Improvements)
- **Kind**: Deferred feature
- **Notes**: All users of a given role currently receive all notifications for that role. A coordinator who only wants pings for `failed` orders, or a rider who wants to mute the "new order available" broadcast, has no opt-out. Would require a `notification_preferences` table keyed on `(userId, eventType)` and a preference screen in each role's settings. The push audience helpers in `push-triggers.ts` are the server-side integration point.

---

## Trip-specific items

These items were declared out of scope specifically in Task #5 (Trip Bundling) and are not currently in `docs/todo-roadmap.md`. They range from natural next steps to deliberate boundaries.

### Route optimization / stop-order suggestions
- **Source**: Task #5 (Trip Bundling)
- **In docs/todo-roadmap.md**: No
- **Kind**: Deferred feature (natural next step)
- **Notes**: Stop order is currently set manually by the coordinator (or rider). Auto-suggesting an optimal sequence — based on effective pickup times, geocoordinates, or both — is the natural evolution once geo data is available. The `trip_stops.sequence` column exists and supports any ordering; the UI already allows reordering. The feature is purely a suggestion layer on top of the existing schema.

### Map / geo features and distance display
- **Source**: Task #5 (Trip Bundling)
- **In docs/todo-roadmap.md**: No
- **Kind**: Deferred feature
- **Notes**: The rider trip-stop card has a placeholder for distance to the next stop. No geocoding is currently wired. Addresses are stored as free-text strings in `orders` (from the upstream payload). Implementing distance display would require either geocoding the address strings (external API call, caching) or requiring the upstream service to supply coordinates in the inbound payload. The latter is the lower-risk path and worth speccing with the distribution service before implementing.

### Multi-rider trips, trip templates, recurring trips
- **Source**: Task #5 (Trip Bundling)
- **In docs/todo-roadmap.md**: No
- **Kind**: Deferred feature (longer-term)
- **Notes**: The current schema (`trips.riderId` — a single nullable FK) assumes one rider per trip. Multi-rider trips would require a `trip_riders` join table and a stop-assignment layer (which rider does which stop). Trip templates and recurring trips are even further out. None of these require a breaking change to existing data — the current schema can coexist with a multi-rider extension.

### Outbound webhook contract extension for trip events
- **Source**: Task #5 (Trip Bundling)
- **In docs/todo-roadmap.md**: No
- **Kind**: Conscious boundary — revisit only if the distribution service requests it
- **Notes**: Trips are an internal concept. The outbound webhook contract currently fires per-order events only (`order.created`, `order.assigned`, `order.status_changed`, `order.pickup_time_updated`). The upstream distribution service has no awareness of trips and does not need to. If the distribution service ever needs trip-level events (e.g. to show a customer when their order is "part of a batch"), that is a contract negotiation with the upstream team first, not a unilateral change. Do not add trip events to the outbound webhook without that conversation.

### Backfilling historical orders into synthetic trips
- **Source**: Task #5 (Trip Bundling)
- **In docs/todo-roadmap.md**: No
- **Kind**: Conscious boundary — do not do this
- **Notes**: Orders that were delivered before trips existed have no `tripId`. There is no value in retroactively creating synthetic trips for them — historical delivery data makes sense as solo orders given the context in which they were created. Any reporting or analytics that groups "orders that a rider delivered in the same shift" should do so through `rider_assignments` and timestamp proximity, not through `tripId`.

---

## Items that are conscious architectural choices, not deferred work

These were listed as out of scope but represent decisions made — not things to revisit lightly.

### Customer visibility into trip routing
- **Source**: Task #5 (Trip Bundling)
- **Notes**: The customer receives a single delivery and should not see that their order is one of several on a rider's current run. Other customers' names, addresses, or order contents must never be exposed through any customer-facing surface. This is a privacy boundary, not a product gap.

### Changes to the upstream webhook payload shape
- **Source**: Task #5 (Trip Bundling)
- **Notes**: See "Outbound webhook contract extension" above. Same constraint. The per-order event contract is stable; trips do not change it.

---

## Documentation

### replit.md content-migration pass
- **Source**: replit.md blueprint — structural pass
- **In docs/todo-roadmap.md**: No
- **Kind**: Deferred feature (follow-up pass)
- **Notes**: The structural pass (2026-06-15) re-sorted `replit.md` into the nine-section blueprint shape and placed content that can't yet land cleanly in a cockpit section under a "Pending Migration" block. A dedicated content-migration pass needs to: (1) populate `replit.md §2` (Run & Operate) with commands and env var names from the codebase; (2) populate `replit.md §4` (Map) with key directories and entry points; (3) synthesize `replit.md §5` (Non-Negotiables) from the "Do not" entries in `docs/architecture-sources-of-truth.md`; (4) populate `docs/external-services.md` with per-service detail (PostgreSQL, inbound distribution service, outbound webhooks, Web Push/VAPID, JWT, CORS); (5) verify Core Architectural Decisions and Technology Stack are fully covered in `docs/architecture-full-technical.md` and remove the Pending Migration block from `replit.md`. Tracked as PM1–PM7 in `docs/todo.md`.

---

## Coverage status

| Item | In docs/todo-roadmap.md | In docs/todo.md |
|---|---|---|
| External identity provider | No | No |
| Automated test suite | Yes (item 1) | Yes (H3) |
| Translation review | No | No |
| Real-time updates | Yes (item 14) | No |
| Timezone handling | Yes (item 5) | No |
| Order export/download | Yes (item 6) | No |
| Order deletion/duplication | Yes (item 7) | No |
| Per-restaurant webhooks | Yes (item 8) | No |
| Admin analytics dashboard | Yes (item 9) | No |
| Rider shift scheduling | Yes (item 10) | No |
| Rider mobile UX | Yes (item 11) | No |
| Customer-facing status page | Yes (item 12) | No |
| Notification preferences | Yes (item 13) | No |
| Route optimization | No | No |
| Map / geo / distance | No | No |
| Multi-rider / templates / recurring trips | No | No |
| Outbound webhooks for trip events | No | No |
| Historical order backfill | No | No (conscious boundary) |
| Customer trip visibility | No | No (privacy boundary) |
| replit.md content-migration pass | No | Yes (PM1–PM7) |
