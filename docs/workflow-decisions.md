# Workflow Decisions

Settled decisions about how the order workflow behaves, captured so they don't
get re-litigated or accidentally reversed by a later task.

**This file records decisions, not implementation status.** A decision listed
here is agreed; whether it is built yet is tracked separately (`docs/todo.md`,
`docs/todo-roadmap.md`) and noted per entry.

Each entry states what was decided, why, and — where it matters — what was
explicitly *not* decided. If a task finds itself arguing with an entry here,
that is a signal to raise it with the owner, not to quietly work around it.

---

## D1. Statuses are reports, not gates

**Decided 2026-08-14. Not yet built — reverses current behavior.**

Order statuses are observations reported by whoever is present: the rider or
the restaurant saying where things stand. A missing report is missing
information, not an illegal act. If someone forgets to tap a step, the next
step must still be accepted.

This reverses the current implementation, which enforces a strictly linear
transition table and returns `422 INVALID_TRANSITION` on any deviation. A
rider who forgets "en route to restaurant", arrives, and taps "picked up" is
refused today.

**"Not a gate" is not "no validation."** These remain, because they are
invariants rather than workflow rules:

- `driver_assigned` is reachable only via `POST /orders/:id/assign`, so status
  and `riderId` are always written together.
- The atomic `UPDATE … WHERE status = <observed>` guard stays; it prevents
  concurrent writes clobbering each other.
- `delivered` and `failed` are terminal. Leaving them stays deliberate rather
  than a side effect of a stray tap. (The current table permits
  `delivered → failed`, which appears accidental.)

**Consequence:** a restaurant reporting `picked_up` is a second observer
corroborating an event, not a claim on the rider's role. This dissolves the
question of which role "owns" a status.

---

## D2. "On hold" is a family, and the only real gate

**Decided 2026-08-14. Built 2026-08-14** — `orders.holdState`, `lib/order-hold.ts`,
and the coordinator triage queue. `isParked` / `parkedReason` were replaced
outright rather than deprecated. Needs a schema push.

Holds are the one mechanism that genuinely blocks. Members today: `parked`
(set automatically when an inbound restaurant code doesn't resolve) and a
manual hold set by an admin or coordinator.

- **Shape:** a field separate from `order_status`, not extra values inside it.
  Statuses are reports and holds are gates; merging them would blur that
  immediately, and an order must be able to be simultaneously held *and*
  last-reported-en-route.
- **Visibility:** admin and coordinator. Not riders. Not restaurants — which
  also sidesteps the fact that a parked order has no known restaurant to show
  it to.
- **Effect:** blocks *new assignment only*. An order already being worked
  keeps accepting status reports; a hold never freezes a rider mid-delivery.

**Implementation note:** `orderScopeWhere` already splits riders into
*discovery* (`status='pending' AND rider_id IS NULL`) and *their own assigned
orders*. The hold filter applies to the discovery branch alone, which delivers
both rules above with one predicate.

**Fixed today's exposure:** `isParked` was read by no code path at all, so
parked orders appeared in every rider's open-orders list and could be
self-claimed. Rider discovery now excludes held orders at the SQL level, and
`/assign` refuses them inside the same guarded UPDATE.

---

## D3. Restaurant acceptance is an acknowledgement, not a gate

**Decided 2026-08-14. Not yet built.**

Acceptance means the restaurant confirms they have seen the order, seen the
pickup time, and accept it. The default assumption is that they will. Nothing
waits on it — the delivery team sees and works the order before and without
acceptance.

Restaurants gain **no capability they don't already have**; what changes is
*when* they're asked. Two modes, set per restaurant by an admin or
coordinator:

| Mode | Behavior |
|---|---|
| Straightforward | One confirm action. Writes only the acknowledgement. |
| Choose one of three | Offers the pickup time as-is, 10 minutes earlier, 10 minutes later. Anything but "as is" writes `pickupTimeRestaurant` via the existing endpoint, at the priority it already has. |

- The ±10 minutes stays a named constant until there's reason to vary it.
- Coordinators see a quiet "not yet acknowledged" marker. Visibility, not
  escalation.
- After acknowledging, restaurants can still change the pickup time and report
  status, per D1.

**Consequence:** this frees "Ready for pickup" from double duty. It currently
writes `pickupTimeRestaurant = now` because it is the restaurant's only
action, which conflates "the food is ready" with "I suggest this pickup time"
and permanently pins the effective pickup time to the moment it was pressed.

---

## D4. Pickup time is right for ASAP, wrong for scheduled orders

**Decided 2026-08-14. Built 2026-08-14** — `lib/pickup-time.ts` →
`resolveOriginalPickupTime`, wired into `POST /inbound/orders`.

`now + minDeliveryTime` is correct when the customer wants the order as soon
as possible. It fails only when there is a real requested time to work back
from — and scheduled orders arrive regularly.

```
pickupTimeOriginal =
    sourceRestaurantReadyTime                    ← if the source sent one, it wins
 ?? asap:         now + travel                   ← current behavior, kept
 ?? later_today
    / other_day:  requestedDeliveryTime − travel ← new

travel =
    globalAdminSetting                                          ← if set, overrides outright
 ?? MAX(restaurantMinDeliveryTime, deliveryTeamMinDeliveryTime) ← longest of the two
 ?? restaurants.minDeliveryTime                                 ← both payload values are nullable
```

**No prep-time floor.** A computed pickup time earlier than the kitchen can
physically produce the food is not clamped. Bestellenbij already factors prep
time into the slots it offers customers, so this can only occur when our
figures and the storefront's disagree — a signal worth surfacing, not
smoothing over. A pickup time that reads as already-late is true, and is the
cheapest available alarm.

---

## D5. Delivery method splits the board

**Decided 2026-08-14. Built 2026-08-14** — `lib/delivery-method.ts`, the rider
scope and assign guard, and `components/delivery-expectation.tsx`. No schema
change: `deliveryMethod` was already stored and serialized.

`deliveryMethod` arrives as `delivery`, `pickup`, or `happy_hour` and
currently drives nothing.

- **`pickup`** — the customer collects. Must be excluded from rider scope at
  the SQL level, not merely hidden in the UI, and gets its own section in the
  admin and coordinator views so it can still be watched.
- **`happy_hour`** — a discount on delivery cost in exchange for the customer
  accepting less control over timing. It exists here as an *expectation
  signal*: it tells staff whether the customer is waiting on a specific time
  or has accepted flexibility.

**Display only.** No bundling logic — bundling is not automated. Show what the
payload carries and nothing more. Note that the payload carries **no
happy-hour window**, only the method flag, so the display is the badge plus
`requestedDeliveryTime` and `deliveryTimeType`.

**What `requestedDeliveryTime` actually is** (confirmed against the storefront,
2026-08-14): the customer's checkout selection resolved to a timestamp. For a
scheduled order, exactly the time they picked. For an ASAP order, the
storefront's calculated delivery estimate. It is the storefront's source of
truth for fulfilment in both cases — not a placeholder.

The string the customer *saw* — "Zo snel mogelijk", "vandaag om 18:30" — is a
separate `deliveryTimeDisplay` field on the storefront that is **not sent to
this app**. So an ASAP timestamp is shown here marked as an estimate: hiding it
would discard a real figure, and showing it bare would imply a precision the
customer was never given.

**Open, low priority:** D4 computes ASAP pickup as `now + travel` and ignores
`requestedDeliveryTime`. Now that it's known to be the storefront's own
estimate, `requestedDeliveryTime − travel` would also be defensible. Keeping
`now + travel` for now — it is anchored to when we actually received the order,
so a queue delay can't produce a pickup time in the past. Worth revisiting only
if ASAP pickup times start disagreeing with the storefront's estimates.

---

## D6. Trips: rider-visible, progress derived

**Decided 2026-08-14. Not yet built.**

Trip bundling stays live but simplified.

- Riders get a trip view showing their stops in order.
- Progress is derived from the underlying order statuses.
- No formal per-stop completion. `trip_stops.completedAt` and
  `completedStopCount` stop being the progress source.

This retires a broken mechanism rather than repairing it: nothing in the
codebase has ever written `completedAt`, so every trip currently displays 0%
progress permanently. There is also no rider trip route in `App.tsx` at all —
the `RiderTripStops` mockup was never built.

---

## D7. The outbound webhook is disabled until it's needed

**Decided 2026-08-14. Built 2026-08-14** — `outbound_webhook_enabled`, default off.

The implementation is complete — four event types, a retry queue with
backoff, an admin UI — but the receiving end has not been built. It stays off
until there is something to receive it, which may well be after launch.

- A setting controls it. Null **or** explicitly disabled means disabled.
- Disabled short-circuits before any payload construction or database write.
- `startRetryLoop` is gated on the same flag. It currently queries
  `webhook_retry_queue` every ten seconds regardless of configuration, which
  is the actual wasted work.

**Explicitly deferred, not urgent:** the outbound POST carries no request
signing — no HMAC, no shared secret — so a receiver cannot verify it came
from this app. This is a prerequisite for *enabling* the webhook, whenever
that happens. It is not a launch blocker and is not tracked as active work.

Note that `todo-roadmap.md` item 8 states "the retry queue and signing logic
stay the same", implying signing exists. It does not.

---

## D8. Prefer an admin override to a blocking decision

**Decided 2026-08-14. Standing working principle.**

When a question comes up that can't be answered confidently from current
knowledge, the default response is an admin-configurable override with a
sensible default — not a stalled decision. Real scenarios then teach us the
right value, and the override covers the gap in the meantime.

**Caveat, accepted:** overrides are not free. Each is a key, a reader, an API
field, and a UI control, and too many turn the admin screen into an
undifferentiated wall of knobs. The mitigation is to make adding one cheap
(see D9) rather than to ration them.

---

## D9. A settings registry precedes further overrides

**Decided 2026-08-14. Built 2026-08-14** — `lib/settings-registry.ts`.

Settings are declared once — key, type, default, optional environment
fallback — and the reader, the API field, and validation derive from that
declaration.

Motivated by duplication already visible at two settings: the outbound webhook
URL resolution existed in both `lib/webhook.ts` and `routes/settings.ts`, and
`allow_rider_self_claim` had near-identical readers in `routes/settings.ts`
and `lib/settings-readers.ts`. Given D8, settings will be added often, so the
per-setting cost is worth removing before it multiplies.

---

## Open questions

Neither blocks implementation.

- **Documentation corrections.** D1 contradicts four documents: `replit.md` §1
  ("strict server-validated state transitions" — a core-contract section),
  `architecture-full-technical.md`:32, the SSOT transition table at
  `architecture-sources-of-truth.md`:49–52, and a planned test at
  `todo-roadmap.md`:13 asserting every illegal transition is rejected.
  "Server-validated" remains true — the server still validates, just different
  things — so the edits are narrow. Per the Working Agreement, reversing a
  documented decision also earns a `changelog.md` entry.

- **Where the acceptance-mode setting lives.** Per-restaurant, so it belongs on
  `restaurants` rather than `system_settings`. The registry in D9 covers global
  settings only; whether it should grow a per-restaurant tier is unresolved.

---

## A note on trusting the existing docs

Relevant because the work above leans on them. They run in three registers
that read identically on the page:

- **Reliable** — `changelog.md` is precise, dated and self-critical. Its
  2026-08-13 entry states outright that "no dispatch/visibility mechanics were
  designed beyond making parked orders queryable", which is exactly the gap
  D2 addresses.
- **Honest placeholders** — `replit.md` §4 and §5, `architecture.md`,
  `todo-bugs.md` and `external-services.md` are explicitly marked "to be
  populated in the content-migration pass". Empty, but labelled.
- **Written as fact, describing things that don't exist** — `todo-roadmap.md`
  item 8's signing logic (D7) and `architecture-sources-of-truth.md`:252's
  "Trip bundling end-to-end" (D6). These are the hazard, because nothing in
  their tone separates them from the reliable register.

`replit.md` §1's "strict server-validated state transitions" is *not* in that
third register — it accurately describes the code. It is a true statement
about a decision now being reversed, which is a different thing from drift.
