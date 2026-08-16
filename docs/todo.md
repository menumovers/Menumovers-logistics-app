# Engineering TODO

Smaller deferred engineering work, inferred from the current code and from notes captured in earlier task rounds. Items here are not the planned product features in `docs/todo-roadmap.md` — those are roadmap. These are residue: half-centralized patterns, known gaps, and small risks that the next contributor would otherwise rediscover.

For each item: what it is, what investigation is already done, priority.

---

## High

### H1. Rider self-assign authorization on `POST /api/orders/:id/assign` — DONE (2026-05-03)

The route now allows a rider caller iff `system_settings.allow_rider_self_claim` is on, `body.riderId === req.auth.riderId`, and the order is `pending`. The atomic `UPDATE ... WHERE status='pending'` invariant is unchanged. Admin UI exposes the toggle on the Settings tab. The auth-only `GET /settings/flags` endpoint (`{ allowRiderSelfClaim }`) is consumed by `pages/rider.tsx` via `useGetSettingsFlags` so the self-claim button is pre-emptively hidden when the flag is off, on top of the 403 the server still returns.

### H2. Frontend `RequireRole` cross-role direct navigation

Direct-URL navigation by a role outside the page's allowed set should redirect rather than render briefly. The guard exists in `App.tsx` but there are routes where the guard is applied loosely. Investigation: walk every `<Route>` in `App.tsx` and confirm each is wrapped. The 2026-05-03 PWA split added three new public routes (`/`, `/rider/login`, `/restaurant/login`) that intentionally do not go through `RequireRole`; the audit needs to re-confirm each authed route is still guarded after the route table reshuffle. Priority: high (security posture).

### H3. No automated tests

Already captured as `docs/todo-roadmap.md` item 1, but worth listing here too because every other item is harder to fix safely without a test suite. The four highest-leverage tests: state-machine, idempotent inbound, webhook retry queue, and pickup-time priority. Priority: high.

## Medium

### M1. Default `PORT` and `BASE_PATH` in Vite config

`artifacts/bestellenbij/vite.config.ts` and `artifacts/mockup-sandbox/vite.config.ts` read `process.env.PORT` and `process.env.BASE_PATH` and throw if absent. This is correct in the Replit workspace but breaks `vite build` in vanilla CI. Add safe defaults gated on `NODE_ENV !== 'production'` (or accept a missing PORT in build mode, which doesn't bind a server). Investigation: see `rawPort` handling at the top of both vite configs. Priority: medium.

### M2. Expand structured logging coverage — PARTIALLY DONE (2026-05-03)

Webhook retry path now propagates a `correlationId` (the originating `req.id`) end-to-end: stored on `webhook_retry_queue.correlation_id` and emitted in retry logs. `routes/orders.ts` threads `String(req.id)` to every `enqueueOutboundEvent` call. Remaining: `push.ts` `sendToUsers` does not yet carry a correlation id; add the same field there if/when push reliability becomes a debugging concern. Priority: low (down from medium).

### M3. Error handler: tighten the "unknown error" path

`middlewares/error-handler.ts` handles `ZodError`, `AppError`, and "looks like a 4xx", and falls through to a generic 500. The generic path could leak `err.message` to the client in non-production. Audit and gate stack/message exposure on `NODE_ENV`. Investigation: see lines after the `AppError` branch. Priority: medium.

### M4. CORS allowlist is permissive in non-production

`app.ts` reflects any origin when `NODE_ENV !== 'production'`. This is convenient locally but means a misconfigured staging deploy is wide open. Make the staging behavior explicit (require `CORS_ALLOWED_ORIGINS` set in any environment that calls itself production-like). Priority: medium.

### M5. `system_settings.outbound_webhook_url` and env precedence — DONE (2026-05-03)

Precedence inverted: the admin-configurable `system_settings.outbound_webhook_url` now wins; `WEBHOOK_URL` is the fallback. `routes/settings.ts` returns a `source` discriminator (`settings` | `env` | `unset`) and the admin UI surfaces it.

### M6. Composite lib packages need `tsc --build` wired into codegen and post-merge

`lib/api-client-react` and `lib/api-zod` are TypeScript composite projects whose `.d.ts` output lives in `dist/`. Codegen (`pnpm --filter @workspace/api-spec run codegen`) regenerates the source files but does not rebuild the declarations — so every consumer continues to see the previous types until `tsc --build` is run manually. This caused `nameCode` to be absent from compiled types for the entire period between Task #11 (added to source) and 2026-08-14 (rebuild manually applied). Two fixes needed: (1) add `tsc --build lib/api-zod lib/api-client-react` as a post-codegen step in `lib/api-spec/package.json`'s `codegen` script, and (2) add the same rebuild to `scripts/post-merge.sh` so it runs automatically on platform-managed merges. Priority: medium.

## Low

### L1. Push: rider-targeted notifications when an order has no assigned rider

`audienceForAssignment` and `audienceForStatus` use `notifyAssignedRider` to target the rider for an order. There is no graceful path for "an order failed before assignment". Today this is implicitly fine (failed pre-assignment notifies coordinators and admins only), but worth an explicit comment in `push-triggers.ts` so a future contributor doesn't add a confused branch. Priority: low.

### L2. `revoked_tokens` cleanup — DONE (2026-05-03)

`artifacts/api-server/src/lib/janitor.ts` `startJanitor` runs every 5 minutes and deletes rows where `expiresAt < now()`. Wired in `index.ts` next to `startRetryLoop`.

### L3. Web Push payload shape is implicit

`PushPayload` is `{ title, body, data? }` and the service worker shows it directly. There is no versioning. If we ever change the shape (e.g. add an `actions` array), older service workers will silently ignore the new fields. Add a `v: 1` field and gate new behavior in the SW. Priority: low.

### L4. Locale switch persistence

The locale dropdown writes to `bb_locale` and i18next reflects the change. Verify there is no path that resets it to `nl` on next mount (we removed `i18next-browser-languagedetector` but the dependency remains in `package.json`). Investigation: search for `LanguageDetector` usage. Priority: low.

### L5. Trip mutations are not transactional — DONE (2026-05-03)

Every multi-statement mutation in `routes/trips.ts` (`POST /trips`, `PATCH /trips/:id`, `PUT /trips/:id/stops`, `POST /trips/:id/dissolve`) now runs inside `db.transaction(async (tx) => …)` and starts with `SELECT ... FOR UPDATE` on the trip row. Terminal-state checks (`status in ('dissolved','completed')`) and order-status reads happen inside the same transaction so a concurrent rider advance, rename, or dissolve cannot leave a trip with partial stops or partial order linkage. Captured as an SSOT entry under "Trip bundling and bundled pickup time" (Concurrency safety).

### L6. Reassignment can rewind active orders — DONE (2026-05-03)

Resolved with option (c) plus an explicit confirmation gate. `PATCH /api/trips/:id` returns `409 TRIP_IN_MOTION` whenever the assigned rider changes and any order on the trip is at or past `picked_up`, unless the caller passes `force: true`. The coordinator UI (`pages/coordinator-trip.tsx`) catches that error code, opens a confirmation dialog, and re-issues the patch with `force: true` on confirm. The server still preserves in-flight order statuses; only the trip's nominal rider is swapped. Captured as an SSOT entry under "Trip bundling and bundled pickup time" (Reassignment in motion).

### L7. `as unknown as` audit

We removed the casts during the Task #3 review rounds, but the rule is enforced by code review, not by lint. Add an ESLint rule (`@typescript-eslint/consistent-type-assertions` with `assertionStyle: "as"` and `objectLiteralTypeAssertions: "never"`, plus a custom rule for double-`as`) so a future PR can't sneak one in. Priority: low.

### L8. `heldAt` is stored and shown nowhere — DONE (2026-08-15)

Both hold surfaces now show it: the coordinator order detail's hold card and the dispatch board's held row, as "sinds 14:20" next to who placed the hold. Original entry below.

The hold panel (`pages/coordinator.tsx`, `pages/coordinator-order.tsx`) shows who held an order and why, but not when. `orders.heldAt` is written, serialized as `heldAt`, and rendered by nothing. "Held since 14:20" is what a coordinator triaging a queue wants, and it is roughly one line next to the existing `heldByUserName`. Investigation: done — the field is already on the wire, so this is display only. Retention is settled separately by D11; this is the display half. From `docs/field-audit.md` §3. Priority: low.


---

## Pending Migration — content-migration pass

The following items were collected in `replit.md §Pending Migration` during the structural pass (2026-06-15). Each needs a dedicated content-migration pass to move detail out of the cockpit and into the right doc. Do not process these during unrelated tasks.

- **PM1. Run & Operate (§2)** — populate `replit.md §2` with install/dev/build/typecheck/db commands and required env var names from the codebase.
- **PM2. Map (§4)** — populate `replit.md §4` with key directories and entry points from the codebase.
- **PM3. Non-Negotiables (§5)** — synthesize `replit.md §5` from all "Do not" entries in `docs/architecture-sources-of-truth.md`.
- **PM4. Core Architectural Decisions** — already documented in `docs/architecture-full-technical.md`; remove the duplicate block from `replit.md` Pending Migration section once verified.
- **PM5. Technology Stack (detailed)** — already documented in `docs/architecture-full-technical.md`; remove the duplicate block from `replit.md` Pending Migration section once verified.
- **PM6. External Dependencies** — populate `docs/external-services.md` with per-service env vars, auth, endpoints, and live/stub status (PostgreSQL, inbound distribution service, outbound webhooks, Web Push/VAPID, JWT, CORS allowlist).
- **PM7. Contributing / out-of-scope backlog protocol** — verify the detailed 3-bullet procedure (formerly in `replit.md` User Preferences) is captured in the `docs/todo-out-of-scope.md` header; consolidate if needed.
