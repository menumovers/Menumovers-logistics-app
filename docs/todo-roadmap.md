# Future Work

This document captures the planned-but-not-yet-built extensions for the Bestellenbij logistics platform. Each item is ready to be picked up as its own task; the list is grouped into four broad categories so we can prioritize by area.

The current build covers order ingestion, the status state machine, atomic rider assignment, multi-source pickup time priority, item overrides, outbound webhooks with retry, Web Push, 30-second polling, and the four role UIs (admin, coordinator, rider, restaurant_staff). Everything below extends or hardens that foundation.

---

## Quality & Reliability

### 1. Automated test suite
The platform currently has no automated tests. At minimum we want:
- Unit tests for the order status transition state machine (every legal transition + every illegal one rejected).
- Idempotency tests for the inbound order endpoint (same `orderId` arriving twice updates rather than duplicates).
- Webhook retry tests covering 4xx (no retry), 5xx (retry with exponential backoff), and crash-recovery from the persisted retry queue.
- Pickup time priority tests for the override > restaurant > rider > original ordering, including null-handling.
- Integration tests for the critical endpoints: `/auth/login`, `/inbound/order`, `/orders/:id/assign`, `/orders/:id/status`.

This is the single highest-leverage investment for stability.

### 2. Centralized structured logging
`pino-http` is already wired in for HTTP logs, but most application code still uses ad-hoc logging. Expand to a single structured logger with consistent fields on every significant action: `requestId`, `userId`, `userRole`, `orderId`, and the action name. Replace remaining `console.log` calls with the structured logger so logs are queryable.

### 3. Centralized error handling
Today errors are handled per-route with varying response shapes. Introduce a single Express error middleware that produces a consistent body (`{ error, code, requestId }`), maps known error classes to HTTP status codes, logs structurally with stack traces in development only, and never leaks internal details in production.

### 4. Rate limiting — DONE
Rate limiting is implemented on both the inbound order endpoint (`inboundLimiter` on `/api/inbound/orders`) and the auth endpoints (`authLimiter` on `/api/auth`) — see `artifacts/api-server/src/middlewares/rate-limit.ts` and their wiring in `app.ts`. The inbound endpoint's auth also moved from a single shared secret to a per-source hashed credential (`api_credentials`) since this item was written; rate limiting remains defense-in-depth alongside that, not the only barrier.

### 5. Timezone handling
The system currently assumes server times are UTC and the client renders in `nl-NL` without explicit conversion. Store a timezone per restaurant (or per order, captured at ingestion), and apply it when computing pickup countdowns and rendering clock times. Make sure DST transitions are handled correctly so a 19:00 pickup in October still reads 19:00 in November.

---

## Operations & Admin

### 6a. Receipts — create, show, print
Every order already carries the complete financial breakdown from the source:
`deliveryFee`, `tipRider`, `tipRestaurant`, `supTotal`, `statiegeldTotal`,
`administrationCosts`, `totalAmount`, and a per-line `items[].totalPrice`.
Nothing consumes them, deliberately — they are receipt input, not operational
data (see `docs/workflow-decisions.md` D10).

A receipt feature would render that breakdown into a document that can be
displayed and printed. Worth settling when it is picked up: who can generate
one (rider at the door? coordinator after the fact? both?), whether it is a
customer-facing artefact or an internal record, and whether the totals are
rendered as sent or recomputed from the lines — the source sends both, and
they could in principle disagree.


### 6. Order export / download
Let coordinators and admins export filtered order lists as CSV. The export should respect the same filters used in the UI (status, restaurant, rider, date range, search) and include the columns needed for downstream reporting: order id, customer, restaurant, rider, statuses with timestamps, effective pickup time, total amount.

### 7. Order deletion and duplication
Admins should be able to delete erroneous orders (e.g., a test order that slipped in from upstream) with a confirmation prompt and an audit-trail entry. Admins should also be able to duplicate an order (typically a failed delivery) into a fresh `pending` order so it can be re-dispatched without the upstream service having to resend.

### 8. Per-restaurant (or per-brand) webhook targets
Currently there is a single global outbound webhook URL. The natural next step is per-restaurant (or per-brand) webhook configuration so different clients of the distribution service receive independent notifications. The retry queue and signing logic stay the same; the change is in routing and admin configuration.

### 9. Admin dashboard / analytics
Basic counts exist (orders by status). A real dashboard adds: orders per restaurant per day, average delivery time, on-time rate, rider performance (orders per shift, on-time percentage), and a failed-delivery breakdown by reason. This belongs to admin only and should pull from the audit-trail rather than recomputing from live order rows.

### 10. Availability scheduling for riders
Riders today set themselves to offline / online / backup manually. A shift-based scheduling view would let coordinators plan availability in advance: weekly recurring shifts, ad-hoc shift assignments, and a per-day overview of who is expected to be online. The current `availabilityStatus` becomes the live override on top of the scheduled plan.

---

## UX Improvements

### 11. Rider mobile UX improvements
The rider interface works but is still organized as a list of cards. A dedicated step-by-step flow for each delivery (one screen per state: navigate to restaurant, mark picked up, navigate to customer, mark delivered, capture failure reason) with large tap targets and minimal cognitive load would reduce errors in the field, especially in poor weather or low-light conditions.

### 12. Customer-facing status page
An optional, login-free public URL per order where the end customer can track their delivery. The page should show only what the customer needs to see (status, ETA, rider first name once assigned) and never the full audit trail or contact data. Link signing or a per-order opaque token avoids enumeration.

### 13. Notification preference management
Right now every user of a role receives every push for that role. Per-user notification preferences (e.g., a coordinator who only wants pings for failed orders, or a restaurant staff member who only wants pings for orders going to a specific kitchen) would dramatically reduce noise. The trigger rules stay centralized; preferences become an additional filter applied per recipient.

---

## Architecture

### 14. Real-time updates
Replace or supplement the 30-second polling loop with WebSockets or Server-Sent Events so coordinators see order changes the moment they happen. Polling stays as the fallback for clients that lose the persistent connection. The push-notification triggers and the webhook retry queue are unaffected; this only changes how the frontend learns about changes that have already been committed server-side.
