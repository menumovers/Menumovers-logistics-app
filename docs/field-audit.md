# Field Audit — inbound order payload

Every field the inbound payload carries, scored on two separate questions:

- **Consumed** — does any code path *do* something with it (a calculation, a
  guard, a lookup)?
- **Shown** — does it reach a human anywhere in the UI?

A field can be consumed without being shown (a formula input), or shown
without being consumed (most of the receipt). Neither on its own means a field
is doing nothing — see §C, which is the whole point of this revision.

Counted on 2026-08-15 by cross-referencing `lib/db/src/schema/orders.ts`
against `lib/order-serialize.ts`, the server routes, and every file under
`artifacts/bestellenbij/src`. **65 columns on `orders`**, of which 7 are
indexes and 2 are housekeeping timestamps.

**Reviewed the same day by the owner, which reclassified most of it.** The
first pass filed 14 fields as "dead". That was a measurement dressed up as a
judgement: the code genuinely does not read them, but "unread" and "serving no
purpose" are different claims, and only the first one was measured. Nine of the
fourteen are doing exactly what they are meant to.

**Identifiers A1–A14 are stable** and mean the same fields they did in the
first pass. The grouping around them changed; the numbers did not.

> A note on a number that got away. An earlier audit was read as saying "16
> unused fields" — that 16 was a **row number** in the audit's table, not a
> count. The counted figure was 14 unread. After review the count that matters
> is: **1 open gap, 2 to check against real data, 5 covered by a live
> decision, and 3 fields that feed calculations nobody can see.**

---

## A. The flat address string is what gets rendered

**A1 `street` · A2 `houseNumber` · A3 `addition` · A4 `postalCode` · A5 `city`**

Confirmed: every screen renders `deliveryAddress`, the single-line display
string, and the components sit beside it unread. That is deliberate as far as
display goes, and there is nothing to build.

It is still the setup for **`todo-bugs.md` B5**, which is a data-integrity
problem rather than a display one. `POST /orders/:id/contact` updates only
`deliveryAddress`, so the first coordinator correction makes the two
representations disagree permanently, with nothing recording which is current.
Harmless while nothing reads the components — and B5 goes live the moment
anything does.

There is also an older deferred decision pointing the *other* way:
`todo-out-of-scope.md` ("Legacy `deliveryAddress` text column") asks whether
readers should eventually move onto the structured fields and `deliveryAddress`
be dropped. Both directions are still open; what is not open is keeping two
independently-writable copies of the same fact.

---

## B. Optional, and possibly never populated

**A6 `country` · A7 `latitude` · A8 `longitude`**

Nothing to do here — but the three are not in the same position, and the first
pass got one of them wrong.

**A6 `country` does always arrive.** It is in the inbound contract's required
list for `customer` and `NOT NULL` in the schema. It is simply not worth
showing: every order is Dutch.

**A7/A8 `latitude`/`longitude` are optional** (`["string", "null"]` in the
contract, nullable in the schema) and **whether the source populates them is
unknown**. There are no fixtures or sample payloads in the repository, so this
cannot be settled from the code — it needs a look at real rows.

> **Correction.** The first pass called lat/long "the biggest miss" and said a
> geocoded position "arrives with every order". That was never checked. The
> contract says the field *may* arrive; nothing establishes that it *does*. An
> empty column and an ignored one look identical from the schema, and the whole
> argument was built on the wrong one of those.
>
> The underlying observation still holds — the app has no map, no navigation
> hand-off and no distance estimate, and trip stops sequence by pickup time
> because geography is not available to the code that sequences them. But that
> is a feature that was never built, not data being wasted, and it stays
> speculative until someone confirms the coordinates are actually there.

---

## C. Retained so the coordinator does not have to go and ask Bestellenbij

**A9 `restaurantMinPickupTime` · A10 `restaurantMinPrepTime` ·
A11 `deliveryTeamMinPickupTime` · A12 `deliveryTeamMinPrepTime` ·
A14 `originalPayload`**

These are **not unused. They are stored on purpose, and their purpose is
answering questions after the fact.** When a coordinator needs to work out why
an order came through the way it did, the inputs that drove the source's own
behaviour are already here — no logging into Bestellenbij, no asking someone to
look something up.

That makes them read-by-a-human data rather than read-by-code data, and code
search cannot tell the difference. Recorded as **D11** so that a future pass
looking for dead columns finds the reason before it finds the columns.

Two of the six timing figures *are* consumed by code —
`restaurantMinDeliveryTime` and `deliveryTeamMinDeliveryTime` feed the travel
estimate in `lib/pickup-time.ts` (D4 takes the larger). The other four are the
forensic set. D4's choice of no prep-time floor stands.

---

## D. The one real gap

**A13 `heldAt`**

Serialized and rendered nowhere. Unlike §C this is ours, not the source's — it
records when *we* placed a hold, so the auditability argument does not reach
it; there is no upstream system to avoid having to ask.

The hold panel already shows who held an order and why. "Held since 14:20" is
the sort of thing a coordinator triaging a queue wants, and it is a one-line
addition whenever someone is next in that file.

---

## E. Invisible — consumed by logic, never shown to anyone

Three. These do real work, but nothing tells a human they exist, so when a
computed time looks wrong there is no way to see why from the UI.

| # | Field | What consumes it |
|---|---|---|
| E1 | `sourceRestaurantReadyTime` | `resolveOriginalPickupTime` — wins outright when sent (D4) |
| E2 | `restaurantMinDeliveryTime` | `resolveTravelMinutes` — the larger of the two wins |
| E3 | `deliveryTeamMinDeliveryTime` | ” |

The ingestion log line `"Computed original pickup time"` carries `pickupBasis`
and `travelMinutes`, so the information is recoverable — from the server logs,
by someone with server log access. A coordinator asking "why does this say
18:10?" cannot get there.

This is the sharpest item left in the audit, and it is the same instinct as §C
pointed at our own calculations rather than the source's: the inputs should be
visible next to the output. It connects directly to the parked pin, **audit
every computed time**.

---

## F. Thin — reaching exactly one screen

Four. Not problems; noted so that if that one screen changes, someone knows
these lose their only home.

| # | Field | Only appearance |
|---|---|---|
| F1 | `customerEmail` | Coordinator order detail |
| F2 | `statiegeldTotal` | Receipt |
| F3 | `administrationCosts` | Receipt |
| F4 | `sourceCreatedAt` | Receipt |

F2–F4 landed on the receipt when D10 was built.

---

## What is *not* on this list

- **Nothing is dropped at ingestion.** Every field in `InboundOrderPayload`
  maps to a stored column. Whatever the source sends, we keep — which §C turns
  from an accident into the point.
- **`items[].externalId` and `items[].totalPrice`** were unread until the
  receipt (D10) started rendering them.
- **`kitchenNotes` and `failureReason`** were unread and are now shown — the
  first on the restaurant card, the second on the coordinator detail (B3).
- **`updatedAt`** is housekeeping, not payload data.

---

## The lesson worth keeping

Grep proves a field is unread. It cannot prove a field is pointless, and this
document asserted the second while having measured only the first — twice over,
counting the lat/long claim, which asserted something it had not measured at
all.

Both mistakes have the same shape as the one already recorded against
`requestedDeliveryTime` and `cashPayment`: a plausible reading of a field,
stated as fact, with a recommendation built on top of it. The fix is the same
one D11 applies — when a field's purpose is not visible in the code, ask what
it is for before concluding it has none.
