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

**Decided 2026-08-14. Built 2026-08-14** — `lib/state-machine.ts` rewritten,
`allowedTransitions` serialized onto every order, both client transition tables
deleted. Docs updated and a changelog entry added, per the Working Agreement.
No schema change.

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
  than a side effect of a stray tap. (`delivered → failed` is currently
  permitted and is *intentional* — `state-machine.ts` says so explicitly. Worth
  re-confirming when D1 lands, but it is not an oversight to clean up.)

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

**Decided 2026-08-14. Built 2026-08-14** — `restaurants.acceptanceMode`,
`orders.restaurantAcceptedAt`, `POST /orders/:id/acknowledge`, and
`components/acknowledge-card.tsx`. Needs a schema push.

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

**Consequence:** this frees "Ready for pickup" from double duty. It was writing
`pickupTimeRestaurant = now` because it was the restaurant's only action, which
conflated "the food is ready" with "I suggest this pickup time" and pinned the
effective pickup time to the moment it was pressed.

*Identified here on 2026-08-14 and not actually fixed until D14 on 2026-08-15 —
this decision added the acknowledgement flow without removing the old
behaviour.*

---

## D4. Pickup time is right for ASAP, wrong for scheduled orders

**Decided 2026-08-14. Built 2026-08-14. SUPERSEDED 2026-08-15 by D13.**

D4 diagnosed the right problem — scheduled orders were counting forward from
`now` instead of working back from the promised time — and then fixed it with a
travel figure derived from `*MinDeliveryTime`. That turned out to be wrong at
the root: `MinDeliveryTime` is checkout-to-doorstep, prep included, and a rough
coordinator-set number that often sits stale. Subtracting it from the delivery
time lands at checkout, not at pickup.

D13 replaces the formula. What survives is D4's refusal to clamp, restated
there with a better reason. Kept below for the record.

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

## D13. The temporal mapping: two anchors, never combined

**Decided 2026-08-15. Built 2026-08-15.** Supersedes D4. Answers the parked
question *"why is anything computing from `now`?"* — it shouldn't be, and now
nothing does.

### The two rules

```
ASAP, pickupWithin set:   pickup = sourceCreatedAt      + pickupWithin
otherwise:                pickup = requestedDeliveryTime − pickupOffset
observed:                 leadTime = requestedDeliveryTime − sourceCreatedAt
```

**`pickupOffset` counts backwards from the delivery time. `pickupWithin` counts
forwards from the order arriving.** Different quantities, different anchors, and
they never combine — whichever applies simply *is* the answer.

That distinction is the whole decision, and getting it wrong is what produced
four discarded designs in one afternoon.

### Why the delivery time is the default anchor

`requestedDeliveryTime` is badly named: nothing is "requested" on an ASAP order.
It is **the delivery time shown to the customer at checkout**. The field name
stays, because it is the payload's, but every description now says what it
means.

It already has **the restaurant's opening hours and prep time applied**, because
the source used them to decide what to promise. Anchoring there inherits all of
it for free.

Counting forward from checkout instead reconstructs that calculation with less
information than the source had, and gets it wrong every time someone orders
while a kitchen is shut — `sourceCreatedAt + MinPickupTime` has no idea the
restaurant opens at 17:00. That is what retired the previous version.

**`*MinPickupTime` is consequently unused**, as are the other five duration
fields. All six are audit-only. The payload contributes one timestamp to the
calculation and one more to the observation.

### Why `pickupWithin` counts forwards

Because of what a coordinator is actually saying. *"It's quiet, we can do it in
ten"* means we can be at the restaurant ten minutes after an order lands — get
moving, stop sitting idle. The ten is counted from the order arriving, not from
the delivery time.

So a **small value moves pickup earlier** and a large one moves it later, with
no comparison logic at all. Both directions fall out of the anchor.

It is **ASAP only**: "we can be there in ten" says nothing about an order placed
today for next Tuesday. And it is **not clamped** — everything we could clamp
against is a guesstimate, and a coordinator setting it can see whether
restaurants are open. Feasibility is Bestellenbij's; ours is to show what was
decided.

### Terminology

Three words were doing damage:

- **"travel time"** implies something measured. Nothing measures the journey.
  `pickupOffset` says where pickup sits relative to delivery and claims nothing
  about what fills the gap.
- **"lead time"** meant two things — order-to-pickup, or pickup-to-delivery. It
  now names exactly one: the observation `requestedDeliveryTime −
  sourceCreatedAt`.
- **"minimum"** invited a floor, which is not what this is. `pickupWithin`
  replaces; it does not bound.

### The settings

| Setting | Anchor | Applies to | Notes |
|---|---|---|---|
| `pickupOffsetMinutes` | delivery time, backwards | every order | Default 20. Cannot be unset. |
| `pickupWithinMinutes` | order arrival, forwards | **ASAP only** | Null means the offset rule applies. Cleared 03:00 Europe/Amsterdam. |

### The daily reset

**A clear, not an expiry computed on read.** The stored row should say what is
actually in effect; a value sitting in settings while the effective value is
empty is the same stored-versus-true divergence D12 removed from the address.

The cost of choosing a clear is a job that can be missed, so it runs on the
existing five-minute janitor rather than an 03:00 cron. That makes it
self-healing: if the server was down at 03:00, the first tick after it returns
clears the value. `lib/daily-reset.ts` resolves the boundary through `Intl`,
because Amsterdam observes DST and consecutive resets are 23 or 25 hours apart.

### Feasibility is not ours

An order placed at 17:20 for 17:30 is not ours to reject or repair.
Bestellenbij owns what the customer is offered; we take what arrives and make it
usable. We record the lead time and let a coordinator go and ask, rather than
clamping a pickup time into looking possible.

That is D4's no-clamp rule kept for a better reason than it gave.

### What was removed

`pickupTravelOverrideMinutes`, `resolveTravelMinutes`,
`restaurantDefaultMinDeliveryTime`, and the `now` input.
`restaurants.minDeliveryTime` is no longer read by the pickup path.

Verified with 23 assertions on the formula and 22 on the daily reset.

### How this decision was reached, because the process cost more than the code

Four versions were built and discarded before this one:

1. **`now + travel`, travel from `*MinDeliveryTime`** (D4) — wrong field.
   `MinDeliveryTime` is checkout-to-doorstep, so subtracting it from a delivery
   time lands at checkout.
2. **`sourceCreatedAt + MinPickupTime`** — ignored opening hours, which the
   source had already accounted for.
3. **`MAX(offset rule, checkout + minimum)`** — read a re-description of
   `pickupOffset` as a second quantity, then invented a floor to reconcile them.
   Only handled the busy direction.
4. **`pickupWithin` as an override of `pickupOffset`** — collapsed two anchors
   into one, so a smaller value moved pickup the wrong way.

Every one came from the same habit: filling a gap in understanding with
something plausible, because code will not compile around a gap. Each was
internally consistent and had passing assertions, which proved nothing about
whether it was true.

The rule that came out of it is in `replit.md` §5: state the spec back in a few
lines and wait, and stop at gaps rather than filling them. That rule caught the
fifth version before it was written.

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

**Decided 2026-08-14. Built 2026-08-15.**

Trip bundling stays live but simplified.

- Riders get a trip view showing their stops in order.
- Progress is derived from the underlying order statuses.
- No formal per-stop completion. `trip_stops.completedAt` and
  `completedStopCount` stop being the progress source.

This retires a broken mechanism rather than repairing it: nothing in the
codebase has ever written `completedAt`, so every trip currently displays 0%
progress permanently. There is also no rider trip route in `App.tsx` at all —
the `RiderTripStops` mockup was never built.

### How it was built

`api-server/src/lib/trip-progress.ts` holds the derivation, and it is the only
place that decides what "done" means:

- A **pickup** stop is `done` once its order reads `picked_up` or later.
- A **dropoff** stop is `done` once its order reads `delivered`.
- A **failed** order marks *both* of its stops `skipped`.

`skipped` is a third state rather than a flavour of done, and it exists because
of an honest limitation. `orders.status` is last-write-wins, so once an order
reads `failed` we can no longer tell whether the pickup happened before it went
wrong. Calling the pickup complete would be a guess; calling it outstanding
would leave the rider staring at a stop they will never do. `skipped` says what
we actually know — settled, not completed — and the status log has the detail
if anyone needs it.

The API changed shape to match: `TripStop.completedAt` → `TripStop.state`, and
`TripListItem.completedStopCount` → `doneStopCount` + `skippedStopCount`.
Outstanding work is `stopCount - doneStopCount - skippedStopCount`, so the two
counters answer "how much is left" without collapsing a failure into progress.

The rider view is `/rider/trips/:id`, reachable from a trips section on the
rider dashboard. It shows the ordered stops and calls out the next one, and it
has **no controls of its own** — every stop links through to the order screen,
where the rider already advances status. Adding a tick box here would have
recreated exactly the second record this decision removes.

Two things fell out that were not the point but are worth noting. Replacing a
trip's stops used to carry `completedAt` across by `(orderId, kind)` so a
reorder wouldn't lose progress; with progress on the order, stops can be
replaced wholesale and there is nothing to carry. And `TripStopWithOrder` now
carries `restaurantAddress` and `customerPhone`, because a rider running a trip
needs an address to go to and a number to call without opening each order.

Verified with 25 assertions covering every status against both stop kinds, the
aggregate counts, and the client-side phrasing.

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

## D10. The money breakdown is receipt data, not operational data

**Decided 2026-08-14. Receipt built 2026-08-14** — `pages/order-receipt.tsx`.
The fields remain absent from every operational screen; the receipt is the one
place they appear. No schema change.

Six fields arrive on every order and are stored, serialized and typed:

`deliveryFee`, `tipRider`, `tipRestaurant`, `supTotal`, `statiegeldTotal`,
`administrationCosts` — plus `items[].totalPrice`.

They are **financial fields**. They exist so receipts can eventually be
created, shown and printed. None of them changes what a rider, restaurant or
coordinator does during a delivery.

**So they are not surfaced anywhere, and that is the decision — not an
oversight.** An earlier survey listed them as "stored but rendered nowhere",
which is true and reads like a gap; it isn't one. Adding `tipRider` to a rider
card or `statiegeldTotal` to a restaurant view would be noise on screens whose
job is to get food moved.

Two guesses this corrects, recorded so they aren't repeated:

- `tipRider` looked like something the rider should see. It is a receipt line.
- `statiegeldTotal` (deposit on returnables) looked operational — a physical
  thing someone handles. It is a receipt line.

The one payment-shaped thing that *is* operational is `cashPayment`, which
tells a rider what to do at the door. That is already surfaced, and it is the
exception rather than the pattern.

**Where the work goes:** the receipt at `/orders/:id/receipt` is the only
feature that consumes them.

**What the receipt actually is** (clarified 2026-08-14): primarily a *kitchen*
document, sometimes shown to customers. The customer's formal invoice is
emailed by the storefront — which is why no BTW, VAT number or KvK data reaches
this app, and why none is missing. It is a sheet of paper the kitchen works
from, and sometimes writes on: staff may hand-number packaging and mark the
matching lines.

Consequences that shaped the build:

- **Lines are not pre-numbered.** The annotation is the kitchen's, done by hand
  when they choose to label. Printing numbers ourselves would promise a
  labelling scheme that isn't always used, and set an expectation for the
  customer that the packaging then fails to meet. Lines get room to write on
  instead of markings.
- Items lead; the financial block is one self-contained section, because some
  restaurants will eventually want an item-only receipt — that is the section
  not rendering, not a rewrite.
- Receipts are not a default for every restaurant. Per-restaurant enablement is
  **not built** — every order has one today. When it is wanted it belongs beside
  `restaurants.acceptanceMode`.
- `totalAmount` is written once at ingestion and never recomputed, so hidden or
  added items leave the delivered list disagreeing with what was charged. The
  serializer computes `itemsAdjustment` (delivered minus ordered) and the
  receipt shows it as its own line. The charged amount stands — we are not the
  payment authority — and the discrepancy is surfaced rather than reconciled
  away.

---

## D11. Data is kept so questions can be answered afterwards

**Decided 2026-08-15. Nothing to build — this protects what already exists.**

Several fields are stored on every order and read by no code at all: the four
timing figures `restaurantMinPickupTime`, `restaurantMinPrepTime`,
`deliveryTeamMinPickupTime`, `deliveryTeamMinPrepTime`, plus `originalPayload`
and `heldAt`.

**They are kept deliberately.** When a coordinator needs to work out why an
order came through the way it did, the inputs that drove the source's own
behaviour are already in our payload — nobody has to log into Bestellenbij or
ask someone to look something up. The most important things are here.

The consequence for anyone reading this repository: **"nothing reads this
column" is not evidence a column should go.** These are read by people, after
the fact, when something looks wrong — and code search cannot see that kind of
reader. A `git grep` returning nothing tells you a field is unread, not that it
is pointless.

This is why `docs/field-audit.md` was rewritten within a day of being written.
Its first pass filed fourteen fields as "dead" on exactly that reasoning; nine
of them were doing their job.

**It applies to data we generate too.** `heldAt` records when *we* placed a
hold, and no upstream system holds that fact — which makes the case stronger,
not weaker: for source data there is at least a slow alternative, and for this
there is none. An earlier draft of this decision carved `heldAt` out on the
grounds that "there's no one to avoid having to ask". That was too fine a
distinction; the principle is about answering questions later, not about which
system the answer would otherwise have come from.

What this does **not** say is that every field must be retained forever. It
says the question *"what is this for?"* gets asked before the question *"can we
drop it?"* — and answered by someone who knows, rather than inferred from call
sites.

Two of the six source timing figures *are* consumed —
`restaurantMinDeliveryTime` and `deliveryTeamMinDeliveryTime` feed the travel
estimate (D4). D4's decision to apply no prep-time floor is unaffected: the
prep figures are retained for reading, not for computing.

Retention and display are separate questions. `heldAt` is kept under this
decision *and* is worth showing — a hold panel that gives who and why but not
when is missing the thing a coordinator triaging a queue actually wants
(`todo.md` L8).

---

## D12. The components are the address; the source's line is the receipt

**Decided 2026-08-15. Built 2026-08-15.** Closes `todo-bugs.md` B5.

The source keeps the address as components and sends them to us as-is. It also
runs them through its own `buildFullAddress()` and sends the resulting line as
`customer.address`. So we receive one record twice: the components, and the
source's rendering of them.

We were storing both as writable and treating the rendering as canonical — so
the first coordinator correction made them disagree permanently, with nothing
recording which was current.

**The components are canonical for everything the app does** — which is what
they already are at the source. They are what a coordinator edits, and what any
future area grouping, postcode sort or geocoding will query.

**The source's line is kept purely for audit**, under the same rule as D11:
`deliveryAddressOriginal`, immutable after insert. Because it is a rendering of
the components *as they arrived*, it doubles as a snapshot of them before any
coordinator correction — which is more useful than a second address, and is the
real reason to keep it.

That is what removes the drift — not better synchronisation, but **one writable
copy**. There is nothing left to keep in step.

### How it fits together

- `orders.delivery_address` → `delivery_address_original`, immutable, commented
  the same way as `pickupTimeOriginal`.
- `lib/address.ts` builds the display line from the components on every read.
  The serializer still emits `deliveryAddress`, so every screen keeps working
  and now shows corrections. It also emits `deliveryAddressOriginal`.
- `POST /orders/:id/contact` takes components and no longer accepts an address
  string. The generated types made this a compile error at the one call site,
  which is the contract doing its job.
- Order search matches the components joined as they read
  (`concat_ws`), so "Hoofdstraat 12" still finds an order despite spanning two
  columns — **and** still matches the original line, so an order stays findable
  by the address it arrived with.
- The coordinator's contact card is now six fields. It shows the source's line
  only when it differs from the current one, which is exactly when it is
  interesting.

### What this costs

Almost nothing, and less than two earlier drafts of this section claimed.

Both drafts were wrong because they assumed the source's line might contain
something the components don't. It cannot: the source builds that line *from*
those components. We are now doing what it already does, with our own
formatter. So there is no information to drop, and never was.

The gap cases are symmetric for the same reason — if the source has no house
number, its own line lacks one too. `formatAddress` drops blank parts before
joining, so an absent house number gives `Hoofdstraat, 1011 AB Amsterdam`,
never a stray comma; empty string, `null` and whitespace behave identically.
Unusual house numbers are not a hazard either: `houseNumber` is text, nothing
parses it, and `12-14` prints verbatim.

**What is actually true:** we chose our own ordering and punctuation, so our
line may read slightly differently from the source's. Cosmetic. Beyond that we
own a small function that could have bugs, which is what the 21 assertions are
for.

### Replay

`deliveryAddressOriginal` is not updated when the source re-sends an order,
matching `pickupTimeOriginal` and `sourceCreatedAt`. Nothing is lost: the
replay refreshes `originalPayload`, which carries the newer line.

---

## D14. Pickup times are a negotiation; "ready" is a status

**Decided 2026-08-15. Built 2026-08-15.** Closes a gap D3 identified and did not
fix.

Four parties write a pickup time, and they are all doing the same thing:
**forecasting when collection should happen, each adding what the previous one
could not know.**

| Who | What they add |
|---|---|
| The storefront's calculation | presets and minimum times, knowing neither the restaurant's reality nor the streets |
| The restaurant | its own reality — *"you think 18:00; I'd like 18:10"* |
| The rider | theirs — *"site says 18:00, restaurant says 18:10, I say 18:12"* |
| The coordinator | arbitration, overriding whatever was negotiated |

**Resolution is unchanged and now deliberate rather than inherited:**

```
coordinator  >  restaurant  >  rider  >  storefront
```

Only the storefront set it → storefront's. Restaurant but not rider → the
restaurant's. Both → the restaurant's. Rider but not restaurant → the rider's.
Coordinator at all → the coordinator's, always.

### The outlier

**"Ready for pickup" is not part of that negotiation.** It communicates no
future expectation; it reports a present fact. It belongs to the restaurant's
own journey — seen, accepted, ready, picked up — which runs parallel to the
rider's and is informational. Of every status in the system, only `delivered`
produces an outcome.

It was writing `pickupTimeRestaurant = now`, so **a status update silently won
an argument it was never in**: pressing the button discarded whatever time the
restaurant had negotiated and replaced it with the moment of the press. Worse
on a scheduled order, where a kitchen finishing early would drag the pickup
time hours forward.

Now it writes `orders.restaurantReadyAt` through `POST /orders/:id/ready`, and
touches no pickup time at all. Idempotent, so a double-tap doesn't rewrite when
the food was actually ready.

Shown in two places, because a status nothing displays is the shape of a bug we
already fixed once (`todo-bugs.md` B3): the restaurant card replaces the button
with the time it was reported, and the rider sees "food ready since 18:04" on
the order they're travelling to. It tells a rider the food is waiting — not when
to collect. The agreed pickup time is still the agreed pickup time.

### Why this sat unfixed all day

D3 named it in the morning, in its own consequences section, and the build that
followed added the acknowledgement flow without removing the old behaviour. It
then got reported as open three separate times without being fixed, because it
was treated as blocked on "where should the status live?"

It never was. Removing a bad write does not depend on knowing the final home for
what it wrote. **A small certain fix should not wait on a large uncertain one.**

### Still open

The restaurant journey exists now as two timestamps — acknowledged and ready —
not as a modelled sequence. Whether it becomes one, and whether "seen" and
"accepted" split apart, is undecided. The restaurant's "picked up" is already
the shared order status, since a restaurant reporting a pickup is a second
observer of one event rather than a separate claim (D1).

---

## D15. Item customizations are a structured array, not a delimited string

**Decided 2026-08-18. Built 2026-08-18.**

`items[].notes` was a single free-text string. The only thing that ever put
customizations into it was Babeldish joining a customer's selected options
with `", "` before sending — so "Large" and "Extra kaas" arrived as one
string, `"Large, Extra kaas"`. The receipt (`order-receipt.tsx`) then
re-split that string on `,` to show one line per option. An option whose own
value contains a comma — e.g. `"Creamy Chipotle Mayo | Mild - Niet vegan"`
doesn't, but plenty legitimately could — makes the split ambiguous: there is
no way to tell a separator comma from a content comma after the fact.

**The fix is upstream of this app, not a smarter parser here.** Babeldish
already holds each selected option as a discrete `SelectedOption` before it
ever joins them into a string — the information was never actually
unstructured, it was only *serialized* as if it were. So the contract changed
to carry that structure through instead of encoding and re-decoding it:

- `InboundOrderPayload.items[].options: string[]` — new field, one entry per
  selected option, added to `openapi.yaml` (and thus the generated Zod
  schema and the `OrderItem` type in `lib/db`).
- Babeldish's outbound transform for this destination now sends
  `itemOptionsArray` (`selectedOptions.map(o => o.value)`) instead of
  `itemOptionsPlainText` (`selectedOptions.map(o => o.value).join(", ")`).
- `notes` stays in the contract, nullable, for sources that haven't migrated
  — it is shown as one unsplit line, never parsed. It is not a fallback
  serialization of `options`; a source sends one or the other.
- Every screen that rendered `it.notes` (`order-receipt.tsx`,
  `coordinator-order.tsx`) now prefers `it.options`, rendering each entry as
  its own line, and only falls back to a single-line `it.notes` when
  `options` is absent.

### The rollout gotcha this exposed

`items` is not a passthrough of the validated inbound payload — it is
hand-built field-by-field in `POST /inbound/orders` (`routes/orders.ts`),
separately from `originalPayload` (which *is* the validated payload, stored
verbatim). Adding a field to the OpenAPI contract makes it survive Zod
validation and land in `originalPayload` automatically; it does **not**
automatically appear on `items` — that mapping has to be extended by hand,
same as `notes`, `totalPrice` and `externalId` before it.

This bit a real order during rollout: Babeldish had already switched to
sending `options` before this app's ingestion mapping was redeployed to read
it, so the order's `originalPayload` had `options` but its stored `items`
didn't — confirmed by comparing the two on the same order via the
coordinator page's "Original payload" card, not assumed. Both the receipt
and the coordinator page read the same stored `items`, so neither could have
shown that order's options until the mapping caught up.
`scripts/src/backfill-item-options.ts` re-derives `items[].options` from
`originalPayload` for any order caught in that gap; idempotent, safe to
re-run.

**The lesson, not just the incident:** any field added to the inbound
contract needs the ingestion mapping in `routes/orders.ts` updated in the
*same* deploy, not assumed to fall out of the schema change — and a two-repo
contract change (here, Babeldish + this app) is not atomic across a
deployment boundary, so a field can legitimately exist in `originalPayload`
before it exists in `items` for orders ingested mid-rollout. See the new
"Inbound item field mapping" entry in `architecture-sources-of-truth.md`.

---

# Told once, not to be asked again

The two sections below exist because the decision log above did not stop things
being re-raised. It records *decisions about the product*. It had nowhere to put
a **fact about the world** or a **decision about what we are working on**, so
both kept living only in conversation — and conversation gets compacted.

Added 2026-08-15 after the owner pointed out, for the second time, that settled
things keep coming back. The first time was 2026-08-14, about the outbound
webhook, and produced this document. That fix was incomplete.

## F. Established facts

Things the owner has stated about systems **outside this repository**. They
cannot be verified from the code, so absent a written record the honest-looking
default is "unknown" — and re-raising a settled question dressed as diligence
is still re-raising it.

**Treat every line here as established. Do not re-open one without new
evidence, and never soften one back into a question.**

| Fact | Where it is applied |
|---|---|
| `latitude` / `longitude` are **not populated** by the source. Empty vs. omitted is immaterial — there is no coordinate data | `field-audit.md` §2 |
| The source holds the address as components. It sends them as-is *and* sends its own `buildFullAddress()` rendering of them as `customer.address` — one record, two forms. The line can never carry what the components lack | D12 |
| `happy_hour` is a discount on delivery cost in exchange for the customer accepting less control over timing | D5 |
| `deliveryTimeType` sends exactly `asap`, `later_today`, `other_day` | D4 |
| `sourceCreatedAt` is the order's creation timestamp at the source — when checkout completed. Every duration below is measured from it | Audit only (D13) |
| `sourceRestaurantReadyTime` is when the source calculated the restaurant should have the order ready, from that restaurant's settings at order time. **ASAP only, and a guesstimate — a soft border, never a bound to clamp against** | Audit only (D13) |
| `*MinDeliveryTime` is **checkout → doorstep** — the whole journey including prep, used by the source to show the customer an estimate. It is *not* travel time | Audit only (D13) |
| `*MinPickupTime` is a **minimum lead time** — the least notice either party needs — not a scheduling offset | Audit only (D13) |
| `*MinPrepTime` is **legacy at the source**. Ignore it | Audit only (D13) |
| The `restaurant*` / `deliveryTeam*` split is the restaurant's own configured figure versus the delivery team's | Audit only (D13) |
| **`requestedDeliveryTime` is the delivery time shown to the customer at checkout** — nothing is 'requested' on an ASAP order. It already carries the restaurant's opening hours and prep time, which is why our pickup time anchors to it | D13 |
| `cashPayment` means **any payment not made online** — not necessarily cash | D-none; `components/payment-panel.tsx`, OpenAPI |
| `changeAmount` is what the customer will **pay with**, not the change owed | OpenAPI, `payment-panel.tsx` |
| Bestellenbij already accounts for prep time upstream | D4's no-prep-floor choice |
| `happy_hour` is information to display, not logic | D5 |
| Restaurants sometimes hand-number items on packaging; the receipt is paper to write on, so it must not pre-number | D10 |
| Receipts are not enabled for every restaurant, and some will eventually be item-only | D10 |

## G. What this work stream is

**This conversation is one contained process, not a series of shipped
increments.** Its job is to make the architecture match the intended UX and UI.
Implementing, applying schema, testing against a live system and going forward
happen **after** it, as one step, not per decision.

That framing keeps being lost, and the loss has a signature: treating each
decision as needing its own deployment, its own live verification, its own
sign-off — then reporting the absence of those as open risk. They are not
risk. They are the plan.

**Documentation follows the same shape.** Much of `docs/` still describes the
project's older intentions. The order is: settle the new expectations first,
*then* make the documentation match the new reality. Existing docs are not
constraints to be obeyed on the way — that is what
`constraint-overrides.md` is for. A doc that prescribes the old design is
something to update at the end, not something to argue with in the middle.

## Deliberately not now

Real work, deliberately sequenced out of the current stream. **Do not propose
any of these as a next step.** Listing one as "still open" is technically true
and practically noise — they are open because someone decided they should be.

| Deferred | Decided | Note |
|---|---|---|
| **Applying schema, database work, the whole environment checklist** | 2026-08-14, restated 2026-08-15 | *"That is the end game. Do not worry about its checkboxes. Right now we're just working on code and architecture."* `environment-checklist.md` is a **parking lot**, not a to-do list |
| Bundling automation | 2026-08-14 | Not automated; no logic to build yet |
| Per-restaurant receipt enablement | 2026-08-14 | Belongs beside `restaurants.acceptanceMode` when wanted |
| Outbound webhook signing | 2026-08-14 | Prerequisite for enabling the webhook, which is off (D7) |

---

## Closed: audit every computed time — resolved by D13

**Raised 2026-08-14. Resolved 2026-08-15.**

The question was: **why is anything computing from `now`?** `now` is when our
API processes a request. It is not when the customer ordered, and treating them
as interchangeable assumes ingestion is instantaneous.

**Answer: nothing computes from `now` any more.** The ASAP branch counts forward
from `sourceCreatedAt`; the scheduled branch works back from
`requestedDeliveryTime`. Both are source timestamps. See D13.

The audit also turned up three things worth recording:

- **`*MinDeliveryTime` was the wrong input**, not just wrongly weighted. The old
  formula subtracted a checkout-to-doorstep figure from a doorstep time, which
  lands at checkout.
- **Half the time fields had no confirmed meaning** and were being read off
  their names. Now recorded in §F.
- **The remaining `now` reads are correct.** `heldAt` and `restaurantAcceptedAt`
  record when something happened, which is what `now` is for. Webhook retry,
  JWT expiry and the janitor are infrastructure.

Two related items stay open and are tracked elsewhere: `todo-bugs.md` **B8**
(the client countdown runs on the browser clock, with nothing reconciling it)
and the "Ready for pickup" button still writing `pickupTimeRestaurant = now` in
`pages/restaurant.tsx`, which D3 decided it should stop doing.

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
