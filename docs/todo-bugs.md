# Bug Backlog

Confirmed defects — things that behave incorrectly, as distinct from work that
was never built (`todo-roadmap.md`) or decisions still to be made
(`workflow-decisions.md`).

Each entry states how it actually fails, where, and whether an agreed decision
already covers it. Every one below was verified in the code, not inferred.

Populated 2026-08-14 during the workflow-alignment review.

---

## B1. A typed pickup time can only ever mean today or tomorrow

**FIXED 2026-08-14** — `components/pickup-time-input.tsx` collects a date as
well as a time, seeded from the order's current effective pickup time, and all
three screens now use it. Combining logic lives once in `lib/format.ts`
(`combineDateAndTime`, `toDateInputValue`, `toTimeInputValue`), verified with
14 assertions. Kept below for the record.

~~Severity: high — produces wrong data silently. Three copies.~~

- `pages/coordinator-order.tsx:513`
- `pages/rider-order.tsx:283`
- `pages/restaurant.tsx:286`

All three take an `HH:MM` from the user, apply it to *today*, and then:

```ts
if (date.getTime() < Date.now() - 60_000) date.setDate(date.getDate() + 1);
```

So a time that has already passed is assumed to mean tomorrow. There is no way
to express any other date.

**How it fails:** an `other_day` order — one placed for, say, Saturday — cannot
be given a correct pickup time from any of the three screens. Entering `18:00`
on Thursday sets Thursday 18:00 or Friday 18:00, never Saturday. The order then
carries a pickup time days off, and because restaurant and override beat
`pickupTimeOriginal` in the priority chain, the wrong value *wins*.

Nobody chose this rule; it was written once and copied twice. Scheduled orders
arrive regularly, so it is reachable today.

**Related:** the "audit every computed time" entry in `workflow-decisions.md`.
Fixing it properly means the three screens need a date as well as a time, and
the shared logic wants to live in one place rather than three.

---

## B2. An empty `cashPaymentType` discards the whole cash payment

**FIXED 2026-08-14** — the four fields are now tested explicitly rather than
via `??` short-circuiting. Verified across all six input shapes, including the
two that previously lost data. Kept below for the record.

~~Severity: medium — silent data loss, narrow trigger.~~

`lib/order-serialize.ts`, the `cashPayment` field:

```ts
cashPayment:
  order.cashPaymentType ??
  order.cashPaymentChangeAmount ??
  order.cashPaymentChangeRequired ??
  order.cashPaymentLabel
    ? { … }
    : null,
```

`??` binds tighter than `?:`, so this reads *"take the first non-nullish of the
four; if it's truthy, emit the object."* An empty string is non-nullish but
falsy, so it ends the chain **and** fails the test.

Verified behaviour:

| `cashPaymentType` | Other fields | Result |
|---|---|---|
| `null` | all null | `null` — correct |
| `"exact"` | — | object — correct |
| `null` | `changeAmount: "5.00"` | object — correct |
| `""` | `changeAmount: "5.00"` | **`null` — amount lost** |
| `""` | `label: "Gepast betalen"` | **`null` — label lost** |

**How it fails:** if the source ever sends an empty string for the type, a
rider is told there is no cash payment when there is one, and how much change
to bring is dropped. Currently invisible because no screen renders
`cashPayment` at all — it becomes live the moment cash is surfaced, which is
the next piece of payload work.

**Fix:** test the four fields explicitly rather than leaning on `??`
short-circuiting.

---

## B3. Failure reasons are write-only

**FIXED 2026-08-14** — the reason is now shown on the coordinator order detail
when an order has failed, *and* carried into the status-log note at transition
time, so the timeline explains itself without a second lookup. Kept below for
the record.

~~Severity: medium — destroys operational history.~~

Both the rider (`pages/rider-order.tsx`) and the coordinator
(`pages/coordinator-order.tsx`) *require* a reason before an order can be
failed. It is stored in `orders.failureReason` by `routes/orders.ts` — and
read by nothing. No screen displays it.

It is not recoverable from the audit trail either: the failure path sends
`failureReason`, while the status log records `note`, which is left null. So
the timeline shows that an order failed and stays silent on why, even though
somebody was made to type the answer.

**Fix:** display it on the order detail, and/or copy it into the status-log
note at transition time so the timeline is self-contained.

---

## B4. Trip progress can never advance

**Severity: medium — a permanently wrong number on the dispatch board.**

`trip_stops.completedAt` is read in four places in `routes/trips.ts` to compute
`completedStopCount`, which drives the coordinator's trip progress bar. **No
code path anywhere writes that column.** The only write that touches it
preserves prior values when stops are replaced, and those values are always
null.

Every trip therefore displays 0% forever.

**FIXED 2026-08-15** — the mechanism is retired rather than repaired, per D6.
`lib/trip-progress.ts` derives each stop's state from its order's status, and
`trip_stops.completed_at` is gone from the schema. A trip now reports progress
from the record the rider is already keeping up to date, so there is no second
thing to remember and no way for the two to disagree.

The API changed shape with it: `TripStop.completedAt` became
`TripStop.state` (`upcoming` / `done` / `skipped`), and
`TripListItem.completedStopCount` became `doneStopCount` + `skippedStopCount`.

---

## B5. The structured address silently drifts from the display address

**FIXED 2026-08-15** — by D12, which removes the second writable copy rather
than synchronising the two. The components are canonical; the source's line
becomes `deliveryAddressOriginal`, immutable and audit-only; the display string
is derived on read. `POST /orders/:id/contact` takes components and no longer
accepts an address string, so there is nothing left that can drift.

~~Severity: medium — two disagreeing records with no indication which is right.~~

Ingestion stores both `deliveryAddress` (a flat display string) and the
structured components (`street`, `houseNumber`, `addition`, `postalCode`,
`city`, `country`).

`POST /orders/:id/contact` updates **only** `deliveryAddress`
(`routes/orders.ts`, the contact handler). So the first time a coordinator
corrects an address, the two representations disagree permanently, and nothing
records which one is current.

Currently masked because no screen renders the structured fields — the same
shape of latent bug as B2, and it goes live the moment they are surfaced.

**Fix:** either update both from a structured editor, or make one derived from
the other rather than storing two independent truths.

The six components are covered by `docs/field-audit.md` §1–§2, which
confirms the display side is deliberate — every screen renders the flat string
— and points at the older deferred decision running the other way
(`todo-out-of-scope.md`, "Legacy `deliveryAddress` text column"), which asks
whether the components should become canonical instead. This bug is live under
either answer: what is wrong is holding two independently-writable copies of
the same fact.

---

## B6. The state machine exists in three places and they disagree

**FIXED 2026-08-14** — the server derives the reportable set and serializes it
as `allowedTransitions`; both client tables are deleted. The SSOT registry now
carries an explicit "do not keep a transition table in a client". Kept below
for the record.

~~Severity: medium — drift risk, no test.~~

- `api-server/src/lib/state-machine.ts` — the authority
- `pages/coordinator-order.tsx:47` — a hand-written `TRANSITIONS` map
- `pages/rider-order.tsx:29` — a hand-written `NEXT` map

The server also exports `nextStatusesFor()`, which is never exposed over the
API — so the two client copies exist because there is nothing to ask.

**Covered by decision D1**, which loosens the machine; the triplication should
be resolved at the same time rather than updated three times over.

---

## B7. Two endpoints are missing from the OpenAPI contract

**FIXED 2026-08-15** — both are in `openapi.yaml` with a new
`OriginalOrderItemsResponse` schema, and `coordinator-order.tsx` uses the
generated `useGetOriginalOrderItems` / `useUnhideOrderItem`. The hand-written
functions and the `authHeaders` helper are deleted; `lib/api.ts` is now token
storage and client configuration only.

Two things fell out. Unhide had no error path — it threw inside a
`try`/`finally` with no `catch`, so a failure surfaced as an unhandled
rejection rather than a toast; it now matches every other mutation. And the
manual `pendingUnhideIndex` state is gone, since the pending row reads off the
mutation's own variables.

~~Severity: low — contract drift.~~

`GET /orders/:id/items/original` and `DELETE /orders/:id/items/hide/:itemIndex`
exist in `routes/order-items.ts` but are absent from `lib/api-spec/openapi.yaml`.

Consequently `pages/coordinator-order.tsx` reaches them through hand-written
`fetch` calls in `lib/api.ts`, bypassing the generated client, its typing and
its auth handling.

**Fix:** add both to the spec and regenerate, then delete the hand-rolled
functions.

---

## B8. Countdowns use the browser clock with nothing reconciling it

**Severity: low — worth knowing, not obviously worth fixing.**

`lib/format.ts` (`minutesUntil`, urgency thresholds) and
`components/pickup-countdown.tsx` compute against the viewer's clock, while
pickup times are computed and stored server-side. A device with a skewed clock
shows a wrong countdown and a wrong urgency colour, with no indication.

Unavoidable to a degree for a live ticking countdown. Noted so it is a known
limitation rather than a surprise.

**Related:** the "audit every computed time" entry in `workflow-decisions.md`.

---

## Not bugs — recorded to stop them being re-reported

- **`delivered → failed` is permitted.** `state-machine.ts` allows leaving the
  terminal `delivered` state for `failed`, and the comment there says so
  explicitly: *"Failure terminal: reachable from any non-failed state (incl.
  delivered)."* Deliberate, not an oversight. An earlier note in
  `workflow-decisions.md` D1 called it accidental; that was wrong and has been
  corrected.
- **`PORT` / `BASE_PATH` have no defaults**, so both Vite builds fail without
  them. Real, but already tracked as `todo.md` M1 rather than duplicated here.
