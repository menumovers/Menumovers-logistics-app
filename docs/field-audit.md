# Field Audit — inbound order payload

Every field the inbound payload carries, scored on two separate questions:

- **Consumed** — does any code path *do* something with it (a calculation, a
  guard, a lookup)?
- **Shown** — does it reach a human anywhere in the UI?

A field can be consumed without being shown (a formula input), or shown
without being consumed (most of the receipt). The ones that are neither are
what this document is for.

Counted on 2026-08-15 by cross-referencing `lib/db/src/schema/orders.ts`
against `lib/order-serialize.ts`, the server routes, and every file under
`artifacts/bestellenbij/src`. **65 columns on `orders`**, of which 7 are
indexes and 2 are housekeeping timestamps.

> A note on the number. An earlier audit was read as saying "16 unused
> fields" — that 16 was a **row number** in the audit's table, not a count.
> The counted figure is **14 dead, 3 invisible, 4 thin**. The rows below are
> the actual list.

---

## A. Dead — stored, never consumed, never shown

Fourteen. Each is written at ingestion and then read by nothing.

| # | Field | Why it exists | Worth having |
|---|---|---|---|
| A1 | `street` | Structured address component | Yes — see below |
| A2 | `houseNumber` | ” | Yes |
| A3 | `addition` | ” | Yes |
| A4 | `postalCode` | ” | Yes |
| A5 | `city` | ” | Yes |
| A6 | `country` | ” | Probably not |
| A7 | `latitude` | Geocode from the source | **Yes — the biggest miss** |
| A8 | `longitude` | ” | ” |
| A9 | `restaurantMinPickupTime` | Source's own timing figure | Unclear |
| A10 | `restaurantMinPrepTime` | ” | Unclear |
| A11 | `deliveryTeamMinPickupTime` | ” | Unclear |
| A12 | `deliveryTeamMinPrepTime` | ” | Unclear |
| A13 | `heldAt` | When a hold was placed | Yes — small |
| A14 | `originalPayload` | Forensic / replay copy | Yes, as-is |

### A1–A6, the address components

Not a mistake so much as an unfinished job. `deliveryAddress` — the flat
display string — is what every screen renders, and the six components sit
beside it unread. That is also the setup for **B5**: two records of the same
fact with nothing keeping them in agreement and no rule about which wins.

`country` is the odd one: every order is Dutch, and it is hard to picture the
screen that would show it.

### A7–A8, latitude and longitude

**This is the one to look at first.** A geocoded position arrives with every
order and the app does nothing with it — no map, no navigation hand-off, no
distance estimate, no route ordering. A rider on a bike gets a text address
and is left to type it into their own phone. Trip stops are sequenced by
pickup time, not by geography, because geography is not available to the code
that sequences them.

Nothing about this is hard. The data is already here.

### A9–A12, the four timing figures

Six timing integers arrive per order; **two are consumed** and four are not:

- `restaurantMinDeliveryTime` and `deliveryTeamMinDeliveryTime` feed the
  travel estimate in `lib/pickup-time.ts` (D4 takes the larger of the two).
- The four `…MinPickupTime` / `…MinPrepTime` figures feed nothing.

D4 deliberately chose no prep-time floor, so A10 and A12 being unused is a
*decision*, not an oversight — but it was decided without knowing what those
numbers actually mean. The two `MinPickupTime` figures were never discussed at
all. **The question worth answering: what does the source intend by each of
these four, and does any of it belong in the pickup formula?**

### A13, `heldAt`

Serialized and never rendered. The hold panel shows *who* held an order and
*why*, but not *when* — and "held since 14:20" is the sort of thing a
coordinator triaging a queue actually wants. A one-line fix whenever someone
is in that file.

### A14, `originalPayload`

Doing its job. Kept deliberately for forensics and replay, never exposed
through the API, and correctly so. Listed for completeness, not as a problem.

---

## B. Invisible — consumed by logic, never shown to anyone

Three. These do real work, but nothing tells a human they exist, so when a
computed time looks wrong there is no way to see why from the UI.

| # | Field | What consumes it |
|---|---|---|
| B1 | `sourceRestaurantReadyTime` | `resolveOriginalPickupTime` — wins outright when sent (D4) |
| B2 | `restaurantMinDeliveryTime` | `resolveTravelMinutes` — the larger of the two wins |
| B3 | `deliveryTeamMinDeliveryTime` | ” |

The ingestion log line `"Computed original pickup time"` carries `pickupBasis`
and `travelMinutes`, so the information is recoverable — from the server logs,
by someone with server log access. A coordinator asking "why does this say
18:10?" cannot get there.

This connects to the **parked pin: audit every computed time**. Whatever that
audit concludes, showing the inputs next to the output is most of it.

---

## C. Thin — reaching exactly one screen

Four. Not problems; noted so that if that one screen changes, someone knows
these lose their only home.

| # | Field | Only appearance |
|---|---|---|
| C1 | `customerEmail` | Coordinator order detail |
| C2 | `statiegeldTotal` | Receipt |
| C3 | `administrationCosts` | Receipt |
| C4 | `sourceCreatedAt` | Receipt |

C2–C4 landed on the receipt when D10 was built, which is what moved them out
of category A.

---

## What is *not* on this list

- **Nothing is dropped at ingestion.** Every field in `InboundOrderPayload`
  maps to a stored column. Whatever the source sends, we keep.
- **`items[].externalId` and `items[].totalPrice`** were dead until the
  receipt (D10) started rendering them. Both are now shown.
- **`kitchenNotes` and `failureReason`** were dead and are now shown — the
  first on the restaurant card, the second on the coordinator detail (B3).
- **`updatedAt`** is housekeeping, not payload data.
