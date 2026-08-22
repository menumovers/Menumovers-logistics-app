# Architecture

Bestellenbij is a TypeScript monorepo for the delivery cooperative's internal
logistics workflow. The full implementation reference is
[`architecture-full-technical.md`](architecture-full-technical.md); this page
is the short map for contributors.

## Runtime shape

- **Web PWA** — `artifacts/bestellenbij`: React/Vite client with two installable
  variants from one bundle: the internal rider app at `/` and the restaurant
  app at `/restaurant/`.
- **API** — `artifacts/api-server`: Express API mounted at `/api`, responsible
  for authentication, authorization, workflow validation, order/trip writes,
  notifications, and outbound-webhook queuing.
- **Shared packages** — `lib/db` is the Drizzle/PostgreSQL schema,
  `lib/api-spec` is the OpenAPI contract, and code generation produces the
  React Query client and API Zod validators consumed by both artifacts.

The web and API are separate artifacts behind the workspace path-based proxy.
The API owns all access control and business-state changes; frontend route
guards are navigation aids, not authorization.

## Accounts and authorization

Accounts authenticate with a unique `users.username`, not an email address.
The API normalizes usernames to lowercase on login and account writes. A
customer email may still exist on an order as `customerEmail`, but it is not an
account identity field.

Accounts have a set of roles, not one role. `user_roles` is the canonical and
only authorization source; `users` holds the username, account status, optional
restaurant membership, and locale, but no role field. The supported roles are
`admin`, `coordinator`, `rider`, and `restaurant_staff`.

Login requires at least one current role row and returns `roles: UserRole[]`.
JWTs carry that array for session context, but `requireAuth` reloads role rows
on every request, so an admin role edit takes effect immediately for later
requests. `requireRole` allows a request when its current role set intersects
the route's explicit allowlist — it does not implement inherited roles.

Creating or editing an account writes the user record and role rows
transactionally. Edits lock the account row before reading and replacing role
assignments, preventing concurrent role updates from using a stale role set.
See the **Auth** section of
[`architecture-sources-of-truth.md`](architecture-sources-of-truth.md) for the
authoritative implementation locations and invariants.

## Critical ownership boundaries

- The **API** validates all order status reports, rider assignments, access
  scope, and role checks.
- **PostgreSQL** is the source of truth for accounts, roles, orders, trips,
  settings, audit logs, push subscriptions, and webhook retries.
- **Babeldish** is upstream: it sends inbound orders and receives outbound
  status webhooks. Bestellenbij does not host customer ordering or route orders
  automatically.
- The OpenAPI document is the public API contract. Do not hand-write a client
  request for an endpoint that belongs in the contract; add it to
  `lib/api-spec/openapi.yaml` and regenerate the client packages.

## Order status and record lifecycle

`postponed` is a delivery-status report, not a deletion state. Resuming a
postponed order restores the exact status recorded immediately before its
postponement: unassigned work returns to `pending`; assigned or in-motion work
keeps its rider and resumes its prior status. Admins and coordinators may resume
any eligible order; riders may resume only an order assigned to them.

Archiving is separate from status. An admin can archive an order to remove it
from operational lists, trip views, rider workload counts, and normal
subresources while retaining its audit data. Only admins may inspect archived
orders, restore them, or permanently delete them. Permanent deletion is
deliberately two-step: the order must already be archived and the admin must
confirm its external order ID exactly. See
[the full flow reference](architecture-full-technical.md#53a-postponement-and-resume)
and [the source-of-truth registry](architecture-sources-of-truth.md).

A coordinator may reassign an in-flight order to a different rider, or
unassign it back to `pending`, at any non-terminal, non-held stage — there is
no "hasn't left the restaurant yet" cutoff. This is a deliberate choice: a
barrier only earns its keep when it prevents a concrete, recoverable mistake,
and trusted staff correcting a live assignment doesn't need one. See D18 in
[workflow decisions](workflow-decisions.md).

A trip's order set is no longer fixed at creation: coordinators can add more
bundleable orders to an existing trip or remove one, and a trip now completes
itself once every order on it reaches a terminal status, rather than sitting
in `planned`/`in_progress` forever with nothing left to do. See D19.

## Receipt rendering and printing

The receipt at `/orders/:id/receipt` is a kitchen document, not a customer
invoice. Its print CSS removes the application chrome, and the page retains a
manual Print button for ordinary navigation. From the restaurant order detail,
the receipt link carries a one-shot `autoprint=true` intent: the receipt waits
until both the order and its matching restaurant record are available, renders
the complete sheet, and then opens `window.print()` on the next animation frame.
The query flag is removed before printing so cancelling or refreshing does not
repeat the print unexpectedly. The readiness and scheduling rule lives in
`artifacts/bestellenbij/src/lib/receipt-autoprint.ts`; it is a frontend-only
flow with no API or schema change.

## Order history and privacy redaction

Restaurant staff and riders can browse a paginated history of their own past
orders (`GET /orders/history`, 10 per page, filterable by date range) instead
of only ever seeing the live operational views. Beyond 24 hours after an
order becomes `delivered` or `failed`, the history response redacts customer
name and phone to `null` and reduces the delivery address to postal code and
city — recent history stays fully identifiable so staff can resolve a
same-day dispute, older history doesn't keep customer PII reachable
indefinitely. Redaction is computed at read time from the existing order row,
not stored separately. See D20 in [workflow decisions](workflow-decisions.md)
and the "Order history and PII redaction" entry in the
[source-of-truth registry](architecture-sources-of-truth.md).

## Working references

- [Sources of truth](architecture-sources-of-truth.md) — centralized helpers,
  policies, and "do not" rules.
- [Full technical reference](architecture-full-technical.md) — flows, route
  modules, deployment topology, and trade-offs.
- [Environment checklist](environment-checklist.md) — deployment-only
  prerequisites and verification steps.
