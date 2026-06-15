# Bestellenbij

## Overview

Bestellenbij is an internal Progressive Web App (PWA) designed for food-delivery logistics within a Dutch delivery cooperative. Its core function is to manage the entire order lifecycle, from ingestion to delivery. The system handles order dispatch to riders, manages pickup confirmations from restaurant staff, and tracks orders through a strict state machine. Key capabilities include multi-source pickup-time prioritization, item overrides, outbound webhooks with retry mechanisms, and Web Push notifications.

The project aims to streamline the dispatch process, improve operational efficiency for coordinators, riders, and restaurant staff, and ensure robust data integrity for logistics operations. It focuses on providing role-based user interfaces and ensuring a reliable, scalable platform for internal logistics management.

## User Preferences

I prefer concise and direct communication. When making changes, please prioritize using existing, centralized utilities and patterns. If a new pattern or utility is required, ask before implementing. For any significant architectural changes or new external dependencies, I expect a clear explanation and my explicit approval before proceeding. Do not make changes to files or folders that are not directly related to the task at hand.

When closing or completing a task, any items listed as "out of scope" in that task file must be added to `docs/todo-out-of-scope.md` if they are not already present there.

### Contributing: Keeping the Out-of-Scope Backlog Current

`docs/todo-out-of-scope.md` is the canonical list of deferred work. Whenever a task is completed or a new one is proposed, update it:

- **New deferred items**: first confirm the item isn't already implemented in the codebase, add a bullet under the appropriate section with a short description and a `*(source task name)*` reference.
- **Newly tracked items**: append `→ **now a task** (Proposed): "<task title>"` to the relevant bullet.
- **Completed items**: append `→ **completed**` to the relevant bullet so it can be pruned in the next pass.

This keeps the backlog accurate as a working document rather than a stale snapshot.


## System Architecture

Bestellenbij is built as a monorepo using pnpm workspaces, with a Node 24 and TypeScript ~5.9 runtime environment.

**Core Architectural Decisions:**

*   **Path-based Proxy:** The system uses a path-based proxy where each artifact binds to its own port. The workspace proxy maps `/` to the frontend and `/api/*` to the API server.
*   **Polling for Truth, Push for Latency:** The frontend primarily relies on polling every 30 seconds for data consistency. Push notifications are used to supplement polling for latency-sensitive events, but never replace the polling mechanism as the single source of truth.
*   **Server-Validated State Machine:** All order status transitions are strictly validated on the server side using a centralized helper. The frontend never determines the legality of a status change.
*   **Atomic Rider Assignment:** Rider assignments are handled atomically using conditional SQL updates (`UPDATE ... WHERE status = 'pending'`) to prevent race conditions.
*   **Database-backed Webhook Retry Queue:** Outbound webhook retries are managed via a database table (`webhook_retry_queue`) to ensure persistence across restarts. A polling loop drains due retries.
*   **Centralized Push Audiences:** Logic for determining push notification audiences is centralized in `push-triggers.ts`.
*   **Additive Item Overrides:** Original order items are preserved, and item overrides (e.g., hiding items, adding new ones) are applied as a display layer.
*   **JWT with JTI Revocation:** JWTs are stateless, but a `revoked_tokens` table allows for explicit session revocation by storing JWT IDs (JTIs).
*   **Money as String:** Monetary values are stored as PostgreSQL `numeric` types and transmitted as strings end-to-end to avoid floating-point inaccuracies. Arithmetic operations on money are explicitly avoided.
*   **Locale Resolution Priority:** The active UI locale is resolved based on a strict priority: authenticated user's `preferredLocale` > `localStorage.bb_locale` > `navigator.language` (mapped to `nl`/`en`) > `nl`.
*   **Two PWAs, One Bundle:** The app ships as two independently-installable PWAs from a single Vite build: a "rider" PWA (internal — admin/coordinator/rider, scope `/`, start_url `/rider/login`) and a "restaurant" PWA (external — restaurant_staff, scope `/restaurant/`, start_url `/restaurant/login`). Static manifests live at `public/manifest-rider.webmanifest` and `public/manifest-restaurant.webmanifest`; `main.tsx` swaps the `<link rel="manifest">` href at boot based on path. The landing page at `/` lets users pick which app to enter; each login restricts allowed roles and rejects mismatches with a "wrong app" message. Sign-out and unauth redirects are context-aware via `lib/app-context.ts` (`getContextForPath`, `getLoginPath`).
*   **Configurable Outbound Webhook URL:** The outbound webhook URL can be configured via an admin setting (`system_settings.outbound_webhook_url`), taking precedence over environment variables.
*   **Rider Self-Claim Toggle:** A runtime toggle (`system_settings.allow_rider_self_claim`) controls whether riders can assign themselves to orders.
*   **Trips (Order Bundling):** Coordinators can bundle multiple orders into a `trip` (first-class entity in `trips` + `trip_stops` tables; orders carry `tripId` FK). Trips have an auto-incrementing `tripNumber`, optional name, optional rider, and a status (`planned` / `in_progress` / `completed` / `dissolved`). Stops are split into `pickup` and `dropoff` kinds, default-built with all pickups (ascending effective pickup-time, ties by orderIds order) followed by dropoffs in orderIds order. Same-trip + same-restaurant orders surface a unified `bundlePickupTime` (the earliest pickup of the bundle) so restaurants prepare them together. The `postponed` order status lets a rider temporarily set an order aside (legal from `en_route_to_restaurant`/`en_route_to_customer`; resumable to `en_route_to_restaurant`/`en_route_to_customer` or `failed`). Dissolving a trip reverts pre-flight orders (`pending`/`driver_assigned`) to `pending` and clears their `riderId`/`tripId`; in-flight orders keep their status/rider but lose `tripId`. Trip mutations (create, reassign/rename, stop replacement, dissolve) all run inside `db.transaction(...)` with `SELECT ... FOR UPDATE` row locks so concurrent edits cannot leave a trip with partial stops or partial order linkage. Reassigning a trip whose orders are already in motion (`picked_up` or later) returns `409 TRIP_IN_MOTION` unless the caller passes `force: true` after confirming the warning dialog. Push triggers fire on trip assignment and dissolution.

**Technology Stack:**

*   **API:** Express 5, Pino for logging, cookie-parser, cors, express-rate-limit.
*   **Auth:** bcryptjs for hashing, JWT HS256 with 7-day expiry and JTI revocation.
*   **Database:** PostgreSQL, managed with Drizzle ORM. Schemas are defined in `lib/db/src/schema/`.
*   **Validation:** Zod for schema validation.
*   **API Contract:** OpenAPI (`lib/api-spec/openapi.yaml`) generates `@workspace/api-client-react` (TanStack Query hooks) and `@workspace/api-zod` (Zod schemas) via Orval.
*   **Frontend:** React 18, Vite 7, Wouter for routing, TanStack Query for data fetching, Tailwind CSS, framer-motion, react-i18next, shadcn/Radix UI primitives.
*   **PWA:** Hand-rolled `public/sw.js` plus two static manifests (`public/manifest-rider.webmanifest`, `public/manifest-restaurant.webmanifest`); `main.tsx` swaps the active `<link rel="manifest">` href at boot. `vite-plugin-pwa` is configured with `strategies: "injectManifest"` and `manifest: false` so it bundles our SW but never emits a manifest.
*   **Web Push:** `web-push` library with VAPID.
*   **Build:** esbuild for API server (CJS bundle), Vite for the web artifact.

## External Dependencies

*   **PostgreSQL:** The primary datastore for the application, configured via `DATABASE_URL`.
*   **Upstream Distribution Service (Inbound):** Used for ingesting new orders into the platform. Secured by a shared secret (`INBOUND_SHARED_SECRET`).
*   **Upstream Distribution Service (Outbound Webhooks):** Receives status updates from Bestellenbij via webhooks. The target URL is operator-configured (`WEBHOOK_URL` or `system_settings.outbound_webhook_url`).
*   **Web Push Services:** Browser-based push notification services utilized for rider, coordinator, and staff notifications. Configured with VAPID keys (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
*   **JWT Signing:** Relies on `JWT_SECRET` for local authentication token generation and verification.
*   **CORS Allowlist:** Configured via `CORS_ALLOWED_ORIGINS` to manage cross-origin resource sharing.