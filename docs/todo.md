# Engineering TODO

Smaller deferred engineering work, inferred from the current code and from notes captured in earlier task rounds. Items here are not the planned product features in `FUTURE_WORK.md` — those are roadmap. These are residue: half-centralized patterns, known gaps, and small risks that the next contributor would otherwise rediscover.

For each item: what it is, what investigation is already done, priority.

---

## High

### H1. Rider self-assign authorization on `POST /api/orders/:id/assign`

The endpoint accepts a target `riderId` and expects coordinators and admins to call it. A rider self-claiming an unassigned order is allowed by the product spec but the route currently authorizes only coordinator/admin. Either add a rider branch (where `riderId` must equal `req.auth.riderId` and the order is `pending`) or split into a separate `/api/orders/:id/claim` endpoint for riders. Investigation: see `routes/orders.ts` around the assign handler — the atomic update already enforces the `status='pending'` invariant, so the missing piece is just the role gate. Priority: high (frontend currently exposes a self-claim button that may 403).

### H2. Frontend `RequireRole` cross-role direct navigation

Direct-URL navigation by a role outside the page's allowed set should redirect rather than render briefly. The guard exists in `App.tsx` but there are routes where the guard is applied loosely. Investigation: walk every `<Route>` in `App.tsx` and confirm each is wrapped. Priority: high (security posture).

### H3. No automated tests

Already captured as `FUTURE_WORK.md` item 1, but worth listing here too because every other item is harder to fix safely without a test suite. The four highest-leverage tests: state-machine, idempotent inbound, webhook retry queue, and pickup-time priority. Priority: high.

## Medium

### M1. Default `PORT` and `BASE_PATH` in Vite config

`artifacts/bestellenbij/vite.config.ts` and `artifacts/mockup-sandbox/vite.config.ts` read `process.env.PORT` and `process.env.BASE_PATH` and throw if absent. This is correct in the Replit workspace but breaks `vite build` in vanilla CI. Add safe defaults gated on `NODE_ENV !== 'production'` (or accept a missing PORT in build mode, which doesn't bind a server). Investigation: see `rawPort` handling at the top of both vite configs. Priority: medium.

### M2. Expand structured logging coverage

`pino-http` is wired and adds `requestId`, `userId`, `role` to every HTTP log. Some application code paths that fire outside an HTTP request (the webhook retry loop, push delivery) use the module-level `logger` and do not log a correlation id. Add an `eventId` (or pass the `requestId` from the originating request through into the queued retry row) so a webhook delivery can be traced back to the originating action. Investigation: `webhook.ts` `runRetryLoopOnce` and `push.ts` `sendToUsers` are the call sites. Priority: medium.

### M3. Error handler: tighten the "unknown error" path

`middlewares/error-handler.ts` handles `ZodError`, `AppError`, and "looks like a 4xx", and falls through to a generic 500. The generic path could leak `err.message` to the client in non-production. Audit and gate stack/message exposure on `NODE_ENV`. Investigation: see lines after the `AppError` branch. Priority: medium.

### M4. CORS allowlist is permissive in non-production

`app.ts` reflects any origin when `NODE_ENV !== 'production'`. This is convenient locally but means a misconfigured staging deploy is wide open. Make the staging behavior explicit (require `CORS_ALLOWED_ORIGINS` set in any environment that calls itself production-like). Priority: medium.

### M5. `system_settings.outbound_webhook_url` and env precedence

`getOutboundWebhookUrl` prefers `WEBHOOK_URL` env over the database setting. This is fine, but the admin settings UI lets you set the database value while it is being silently overridden by env. Surface the precedence in the admin UI or invert the precedence so the admin-configurable value wins. Investigation: `webhook.ts` `getOutboundWebhookUrl` and `routes/settings.ts`. Priority: medium.

## Low

### L1. Push: rider-targeted notifications when an order has no assigned rider

`audienceForAssignment` and `audienceForStatus` use `notifyAssignedRider` to target the rider for an order. There is no graceful path for "an order failed before assignment". Today this is implicitly fine (failed pre-assignment notifies coordinators and admins only), but worth an explicit comment in `push-triggers.ts` so a future contributor doesn't add a confused branch. Priority: low.

### L2. `revoked_tokens` cleanup

Logout inserts JTIs with their `expiresAt`. There is no janitor that prunes rows after they expire. The table grows linearly. A weekly `DELETE FROM revoked_tokens WHERE expires_at < now()` job (or a deferred cleanup at startup) would keep it bounded. Priority: low.

### L3. Web Push payload shape is implicit

`PushPayload` is `{ title, body, data? }` and the service worker shows it directly. There is no versioning. If we ever change the shape (e.g. add an `actions` array), older service workers will silently ignore the new fields. Add a `v: 1` field and gate new behavior in the SW. Priority: low.

### L4. Locale switch persistence

The locale dropdown writes to `bb_locale` and i18next reflects the change. Verify there is no path that resets it to `nl` on next mount (we removed `i18next-browser-languagedetector` but the dependency remains in `package.json`). Investigation: search for `LanguageDetector` usage. Priority: low.

### L5. The bootstrap demo seed in api-server

The API-server image, on first run with an empty DB, seeds demo accounts (`admin@`, `coordinator@`, `rider1/2/3@bestellenbij.nl`, `marco@damarco.nl`, `yuki@sushiyama.nl`) all with password `password`. This is convenient for development, dangerous in production. Either gate on `NODE_ENV !== 'production'` or move the seed into `scripts/` and out of the boot path. Priority: low (real production should set `JWT_SECRET` to something else and rotate the demo passwords first anyway, but the seed should not run unconditionally).

### L6. `as unknown as` audit

We removed the casts during the Task #3 review rounds, but the rule is enforced by code review, not by lint. Add an ESLint rule (`@typescript-eslint/consistent-type-assertions` with `assertionStyle: "as"` and `objectLiteralTypeAssertions: "never"`, plus a custom rule for double-`as`) so a future PR can't sneak one in. Priority: low.
