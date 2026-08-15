# Field Audit — inbound order payload

**Completed 2026-08-15.** A finished report, not a working document — the
questions it asked have been answered. Its live follow-ups moved to `todo.md`
(L8, L9) and its durable rule to `replit.md` §5; nothing here is waiting on
anyone.

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

## 1. The flat address string is what gets rendered

`street` · `houseNumber` · `addition` · `postalCode` · `city`

**Keep. Nothing to build.** Every screen renders `deliveryAddress`, the
single-line display string; the components sit beside it unread, by design.

This is still the setup for **`todo-bugs.md` B5**, which is a data-integrity
problem rather than a display one: `POST /orders/:id/contact` writes only
`deliveryAddress`, so the first coordinator correction makes the two
representations disagree permanently, with nothing recording which is current.
Harmless while nothing reads the components; live the moment anything does.

An older deferred note points the other way —
`todo-out-of-scope.md`, "Legacy `deliveryAddress` text column" — asking whether
readers should move onto the structured fields and the flat string be dropped.
Both directions remain open. What is not open is holding two
independently-writable copies of one fact.

## 2. Arrives, genuinely nothing to do with it

`country` · `latitude` · `longitude`

**Keep. No action.** Harmless to carry in the payload.

`country` **does** always arrive — it is in the inbound contract's required
list for `customer` and `NOT NULL` in the schema. It is simply not worth
showing, since every order is Dutch.

`latitude` / `longitude` are optional (`["string", "null"]` in the contract,
nullable in the schema) and **whether the source populates them is unknown**.
There are no fixtures or sample payloads in the repository, so this cannot be
settled from code — it needs a look at real rows. Carried to `todo.md` L9.

An earlier draft of this audit called these "the biggest miss" and asserted
that a geocoded position arrives with every order. Nothing established that.
The app does lack a map, a navigation hand-off and any distance estimate —
trip stops sequence by pickup time because geography is not available to the
code that sequences them — but that is a feature never built, not data being
wasted, and it stays speculative until someone confirms the coordinates are
actually there.

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

Two of the six source timing figures *are* consumed by code:
`restaurantMinDeliveryTime` and `deliveryTeamMinDeliveryTime` feed the travel
estimate in `lib/pickup-time.ts` (D4 takes the larger). The other four are the
forensic set. D4's choice of no prep-time floor is unaffected — the prep
figures are retained for reading, not for computing.

`heldAt` is also worth **showing**, separately from being kept. The hold panel
gives who and why but not when, and "held since 14:20" is what a coordinator
triaging a queue wants. Carried to `todo.md` L8.

## 4. Consumed by logic, shown to nobody

| Field | What consumes it |
|---|---|
| `sourceRestaurantReadyTime` | `resolveOriginalPickupTime` — wins outright when sent (D4) |
| `restaurantMinDeliveryTime` | `resolveTravelMinutes` — the larger of the two wins |
| `deliveryTeamMinDeliveryTime` | ” |

**The sharpest finding left.** These three decide what pickup time an order
gets, and nothing tells a human they exist. The ingestion log line
`"Computed original pickup time"` carries `pickupBasis` and `travelMinutes`, so
the reasoning is recoverable — from server logs, by someone with server log
access. A coordinator asking "why does this say 18:10?" cannot get there.

It is the same instinct as §3 turned on our own arithmetic rather than the
source's: keep the inputs available to whoever has to explain the output.
Folded into the open pin **audit every computed time**
(`workflow-decisions.md`), which is where it will be acted on.

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
