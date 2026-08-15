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

Entries here are in effect. Each needs a yes/no before it is written forward.

### O1. "Ask before implementing a new pattern"

- **Constraint:** `replit.md` §8 Working Agreement — *"If a new pattern or
  utility is genuinely required, ask before implementing it, and register it
  once built."* Soft, and part of an ecosystem-shared section.
- **What actually happened (2026-08-14):** asked before building the settings
  registry. Did **not** ask before creating `lib/order-hold.ts`,
  `lib/delivery-method.ts`, `components/pickup-time-input.tsx`,
  `components/payment-panel.tsx`, `components/delivery-expectation.tsx` or
  `components/acknowledge-card.tsx` — all new shared modules.
- **Why:** each was a direct, obvious consequence of an agreed decision rather
  than a new architectural direction, and stopping to ask six times would have
  been friction without information. That is a judgement, not a rule the doc
  makes.
- **Needs confirming:** is "new pattern" meant to cover a shared component or
  helper that falls straight out of an approved decision — or only genuinely
  novel architecture? If the latter, the Working Agreement wording could say so.
  Note it is worded identically across ecosystem projects, so a change there is
  not this repo's alone to make.

### O2. Compatibility shims and migration ceremony

- **Constraint:** general engineering caution — retain old columns, backfill,
  deprecate before dropping. Never written down here, but applied by default.
- **Superseded (2026-08-14):** *"There is nothing yet in production, so don't
  even 1% hold things back because of trying to retain something."*
- **Now in force:** schema changes in place and gets pushed. No backfills, no
  deprecation cycles, no compatibility shims. Recorded in
  `docs/environment-checklist.md` Part 2.
- **Needs confirming:** the expiry condition. This stops being true the moment
  anything runs anywhere with real data — worth agreeing now who notices that
  moment, rather than discovering it after a `push` drops a column.

---

## Written forward — confirmed, docs updated

Kept briefly so a reconciliation pass can see what changed, then cleared.

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
