# Constraint Overrides

A working ledger of documented constraints that current decisions have
superseded, kept open until someone confirms each override was intended.

Its purpose is the double-check. Superseding an old constraint is normal and
often correct; doing it *silently* is what causes trouble, because six weeks
later nobody can tell an intentional reversal from a rule that got quietly
ignored.

---

## How documentation is meant to be read

**Descriptive** — a doc saying what the system *does*. When it disagrees with
the code, the code wins and the doc is simply stale. Fix the doc; there is
nothing to discuss.

**Prescriptive** — a doc saying what we *should* do. Two kinds, and the
difference matters:

- **Hard.** Protects correctness, safety or data integrity. The atomic
  `WHERE status = <observed>` guard. `pending` / `driver_assigned` staying
  coupled to `riderId`. Immutability of `pickupTimeOriginal` after insert.
  Crossing one of these needs a real reason and a deliberate decision — and
  usually means the invariant should be re-stated rather than removed.
- **Soft.** Accumulated preference: the conclusion of an earlier conversation,
  written down so it wouldn't be re-litigated every week. Most of what reads
  like a rule is this.

### When a suggestion contradicts a doc

**It is the start of a conversation, not a refusal.** A soft constraint is a
previous suggestion; the person suggesting otherwise now may simply have newer
information, or may have changed their mind, which they are entitled to do.

So:

1. **Say what the doc says**, and which kind it is. "This contradicts X, which
   is a soft preference from *date*" is useful. Silently complying is not, and
   neither is refusing.
2. **Proceed with the current instruction** once it is clear it is deliberate.
   The live conversation outranks a written-down old one.
3. **Log the override here**, so the supersession is visible rather than
   inferred from a diff.
4. **Annotate the superseded doc** where it would otherwise mislead a reader —
   a line saying a conversation is open and the constraint is under review.
5. **Reconcile before the work stream closes** — walk this ledger, confirm each
   override was intended, then write the new situation forward into the
   permanent docs and clear the entry.

Hard constraints follow the same path but warrant more resistance at step 1:
name the specific failure the constraint prevents, and make sure that failure
is acceptable, before proceeding.

---

## Active — superseded, not yet confirmed

*None open.* Both entries from the 2026-08-14 review were answered and written
forward below.

---

## Written forward — confirmed, docs updated

Kept briefly so a reconciliation pass can see what changed, then cleared.

### O1. "Ask before implementing a new pattern"

- **Constraint:** `replit.md` §8 Working Agreement — *"If a new pattern or
  utility is genuinely required, ask before implementing it."* Soft, and part of
  an ecosystem-shared section.
- **What happened (2026-08-14):** asked before the settings registry; did not
  ask before six other new shared modules (`lib/order-hold.ts`,
  `lib/delivery-method.ts`, `components/pickup-time-input.tsx`,
  `components/payment-panel.tsx`, `components/delivery-expectation.tsx`,
  `components/acknowledge-card.tsx`).
- **Answered:** leaning yes — a shared component probably does count — but the
  owner was explicit about being unsure. **All six were retrospectively
  approved**, so nothing is reverted.
- **Practice going forward, given a soft yes and genuine uncertainty:** *say,
  don't ask.* Name a new shared module in the reply that introduces it, rather
  than stopping for permission. That surfaces it for objection without turning
  every obvious consequence of an approved decision into a blocking question.
  If that proves too loose, the answer hardens to asking.
- **Not changed:** the Working Agreement wording itself. It is worded
  identically across ecosystem projects, so a real edit isn't this repo's alone
  to make, and the answer isn't firm enough to warrant proposing one. The
  in-place annotation pointing here stays.

### O2. Compatibility shims and migration ceremony

- **Constraint:** general engineering caution — retain, backfill, deprecate
  before dropping.
- **Superseded (2026-08-14):** *"nothing yet in production, don't hold anything
  back to retain something."*
- **Answered: scoped to that conversation only.** Not a standing rule. The
  authorization lapsed; a later session re-confirms before dropping anything.
- **Re-confirmed 2026-08-15**, when the D12 rename and the D6 column drop were
  about to be pushed: *"this is all still development, there's nothing to
  preserve."* The mechanism worked as intended — the question was asked, and
  cheaply. Note that a re-confirmation is itself scoped to the conversation it
  was given in.
- **Written forward:** `docs/environment-checklist.md` Part 2 now carries the
  expiry as a marked warning rather than stating the rule open-endedly — that
  doc was the one thing likely to mislead a future reader into applying it.

### D1's reversal of "strict server-validated state transitions"

- **Constraint:** `replit.md` §1 (core-contract), `architecture-full-technical.md`:32,
  the SSOT transition table, and a planned test in `todo-roadmap.md`.
- **Superseded (2026-08-14):** status is a report, not a gate — `workflow-decisions.md` D1.
- **Written forward:** all four documents updated, `changelog.md` entry added,
  SSOT gained an explicit "do not keep a transition table in a client".
- **Confirmed by:** the owner, who reviewed the contradiction explicitly before
  the work began and delegated the doc wording.

---

## Reconciliation

Before a work stream is considered finished:

- [ ] Every **Active** entry has an explicit yes or no
- [ ] Confirmed overrides are written into the permanent docs, and the entry
      moves to *Written forward*
- [ ] Rejected overrides are reverted in code, not just in prose
- [ ] *Written forward* entries older than the current work stream are cleared —
      `changelog.md` is the permanent record, this file is scaffolding

### 2026-08-14 workflow-alignment review

- [x] Every Active entry answered — O1 (soft yes, all six retrospectively
      approved) and O2 (scoped to that conversation, now lapsed)
- [x] Both written forward: O1's practice recorded here, O2's expiry marked in
      `environment-checklist.md` Part 2
- [x] Nothing rejected, so nothing to revert
- [ ] Clear the three *Written forward* entries above once the branch merges —
      `changelog.md` already carries D1 permanently

**Note for whoever runs the next reconciliation:** O2 is the pattern to watch
for. It was a time-boxed authorization that read like a standing rule, and it
had already been written into a checklist in the open-ended voice before anyone
asked how long it lasted. Authorizations granted mid-conversation should be
assumed to expire with it unless stated otherwise.
