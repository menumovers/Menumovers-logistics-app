# Field Audit — inbound order payload

**Completed 2026-08-15.** A finished report, not a working document — the
questions it asked have been answered, and its durable rule went to
`replit.md` §5. Nothing here is waiting on anyone.

Two of its findings were acted on the same day and are marked in place: §1 was
inverted by D12, and §3's `heldAt` is now displayed (`todo.md` L8).

Kept because the value is the *reasoning*: which fields we keep, which we
could throw, and why. That is expensive to reconstruct and cheap to store.

---

## What was measured

Every field on `orders`, scored on two independent questions:

- **Consumed** — does any code path *do* something with it (a calculation, a
  guard, a lookup)?
- **Shown** — does it reach a human anywhere in the UI?

Cross-referenced `lib/db/src/schema/orders.ts` against `lib/order-serialize.ts`,
the server routes, and every file under `artifacts/bestellenbij/src`.
**59 columns and 6 indexes.** Re-verified before this report was finalized.

**The two questions do not settle whether a field earns its place.** That is
the audit's main finding, and it arrived by getting it wrong first: the initial
pass filed fourteen fields as "dead" on the strength of `git grep` alone, and
nine of them turned out to be doing exactly what they were meant to. Fields
read by *people, after the fact* look identical to abandoned ones from a call
graph. See §3.

---

## 1. The components are the address

`street` · `houseNumber` · `addition` · `postalCode` · `city`

**Superseded 2026-08-15 by D12.** At the time of the audit these were unread:
every screen rendered `deliveryAddress`, the source's single-line string, and
the components sat beside it doing nothing.

That has been inverted. The components are now canonical — they are what a
coordinator edits, what order search queries, and what the displayed line is
built from on every read. The source's line became
`deliveryAddressOriginal`: immutable, audit-only, the same pattern as §3.

This also closed `todo-bugs.md` **B5**, and not by synchronising the two
copies — by removing the second writable one. `POST /orders/:id/contact` takes
components and no longer accepts an address string, so there is nothing left
that can drift.

## 2. Arrives, genuinely nothing to do with it

`country` · `latitude` · `longitude`

**Keep. No action.** Harmless to carry in the payload.

`country` **does** always arrive — it is in the inbound contract's required
list for `customer` and `NOT NULL` in the schema. It is simply not worth
showing, since every order is Dutch.

**`latitude` / `longitude` are not populated by the source** — confirmed by the
owner. Whether the payload sends them empty or omits them entirely is
immaterial; either way there is no coordinate data and nothing to do. Both are
optional in the contract and nullable in the schema, which is the correct shape
for a field that arrives without a value. **This is settled — not an open
question.**

An earlier draft of this audit called these "the biggest miss" and asserted
that a geocoded position arrives with every order. That was invented. The app
does lack a map, a navigation hand-off and any distance estimate — trip stops
sequence by pickup time — but that is a feature never built, and building it
would require geocoding the address ourselves, because the coordinates are not
in the payload.

## 3. Retained so questions can be answered afterwards

`restaurantMinPickupTime` · `restaurantMinPrepTime` ·
`deliveryTeamMinPickupTime` · `deliveryTeamMinPrepTime` · `originalPayload` ·
`heldAt`

**Keep — deliberately, and this is the category that matters.** These are read
by no code at all, and they are stored on purpose. When a coordinator needs to
work out why an order came through the way it did, the inputs that drove the
source's own behaviour are already in our payload: no logging into
Bestellenbij, no asking someone to look something up.

`heldAt` belongs here for the same reason even though it is ours rather than
the source's — it records when *we* placed a hold, and there is no other
system holding that fact. If anything the case is stronger: for source data
there is at least a slow alternative, and for this there is none.

Recorded as **D11** in `workflow-decisions.md`, and as a non-negotiable in
`replit.md` §5, so a future pass hunting dead columns meets the reason before
it meets the columns.

**Which two are consumed changed on 2026-08-15 (D13).** As audited it was
`restaurantMinDeliveryTime` and `deliveryTeamMinDeliveryTime`, feeding a travel
estimate. That turned out to be the wrong pair — see §4 — and it is now
`restaurantMinPickupTime` and `deliveryTeamMinPickupTime`, so those two have
left this category. The `*MinDeliveryTime` pair joined it, and the `*MinPrepTime`
pair stays here as legacy at the source: retained for reading, never for
computing.

`heldAt` is also worth **showing**, separately from being kept. The hold panel
gives who and why but not when, and "held since 14:20" is what a coordinator
triaging a queue wants. Carried to `todo.md` L8.

## 4. Consumed by logic, shown to nobody

**Superseded 2026-08-15 by D13.** As audited, three fields decided an order's
pickup time and were shown to nobody: `sourceRestaurantReadyTime`,
`restaurantMinDeliveryTime` and `deliveryTeamMinDeliveryTime`.

That was the sharpest finding here, and pulling on it found something worse than
invisibility — the formula was reading the wrong fields entirely.
`*MinDeliveryTime` is checkout-to-doorstep, so subtracting it from a delivery
time lands at checkout. All three are now **audit-only**, and the pickup time is
built from `sourceCreatedAt`, `requestedDeliveryTime` and `*MinPickupTime`
instead.

The visibility complaint stands and is now narrower: the ingestion log records
`pickupBasis`, `estimateMinutes`, `estimateSource`, `leadMinutes` and
`sourceCreatedAt`, so the reasoning is recoverable — from server logs, by
someone with server log access. A coordinator asking "why does this say 18:10?"
still cannot get there from the UI.

## 5. Reaching exactly one screen

| Field | Only appearance |
|---|---|
| `customerEmail` | Coordinator order detail |
| `statiegeldTotal` | Receipt |
| `administrationCosts` | Receipt |
| `sourceCreatedAt` | Receipt |

**Keep. No action** — noted only so that if that one screen changes, someone
knows these lose their only home. The last three landed on the receipt when
D10 was built.

---

## Also established

- **Nothing is dropped at ingestion.** Every field in `InboundOrderPayload`
  maps to a stored column. Whatever the source sends, we keep — which §3 turns
  from an accident into the point.
- `items[].externalId` and `items[].totalPrice` were unread until the receipt
  (D10) started rendering them.
- `kitchenNotes` (restaurant card, receipt) and `failureReason` (rider and
  coordinator screens, B3) were unread and are now shown.
- `updatedAt` is housekeeping, not payload data.
- Nothing in this audit warrants dropping a column.
