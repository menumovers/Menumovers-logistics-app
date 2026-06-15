# Documentation Blueprint — `replit.md`

## Purpose

This document defines a shared structure for `replit.md` and the `docs/` folder across the Bestellenbij-ecosystem Replit projects. The goal is a consistent floor of documentation quality everywhere, without making `replit.md` itself bloated — it stays a lean "cockpit," loaded every session, while depth lives in `docs/`, discoverable via the Documentation Index (Part 1, §7).

When applying this structure to an existing project: re-sort existing content into it rather than discarding anything that doesn't map cleanly — flag such content for review instead. The full process is in Part 3.

---

## Part 0 — Ecosystem Reference

The Bestellenbij ecosystem has three roles. A **storefront** (Bestellenbij.nl) — the customer-facing ordering platform — sends order data to a **distribution middleware** (babeldish) for fulfillment routing. The middleware routes orders, via config/rule-based logic (currently keyed by source), to one or more **logistics apps** — each shows riders and restaurants their orders, receives distributed orders from the middleware, and sends status updates back.

There can be more than one logistics app at a time, serving different operational models (e.g. low-volume/high-rider-agency vs. high-volume/algorithmic-dispatch). Which app(s) handle which source or region is a routing decision in the middleware's configuration, not a fixed structural mapping — this can change or expand without restructuring anything. Some logistics apps may be cooperative-owned but built and maintained by a different team, without a shared `replit.md` — the "Ecosystem boundaries are negotiable" principle (Part 1, §8) still applies to these, but changes need direct coordination with that team rather than a docs update.

Each project should use this reference to identify its own role (storefront / middleware / a logistics app) and name its direct neighbors accordingly in its Identity section (Part 1, §1). The middleware's specific current logistics-app consumers — names, statuses, routing configuration — are operational detail that belongs in the middleware's own Identity and `docs/`, not in this shared reference.

**Why this matters for Agent.** This reference isn't for tracking what sibling projects are doing day to day — it's so this project can recognize when the best solution to a problem lies on the other side of one of these interfaces, and apply the "Ecosystem boundaries are negotiable" principle (Part 1, §8) rather than only optimizing within its own boundary.

---

## Part 1 — The `replit.md` template

### 1. Identity

One paragraph: what this project is, its role, who/what it serves. This is the part that still reads like a README.

Then:
- **In scope:** what this project owns/handles.
- **Explicitly out of scope:** anything stubbed, planned, or deliberately not implemented — with status (live / stub / planned) where relevant.

Then, **ecosystem position** — use Part 0 to identify which of the three roles (storefront / middleware / a logistics app) this project plays, then describe only what's relevant from there. No shared "describe the whole ecosystem" blurb — each project's slice is sized to its own boundary:

- **Storefront**: a sentence or two — "sends order data to babeldish for fulfillment routing." Two things worth making explicit here, for different reasons. First: babeldish owns everything downstream of that — this project doesn't need to track which logistics apps are active, which preempts an agent going down a rabbit hole when it stumbles on references to things outside this project's boundary. Second: babeldish is built and maintained by the same team — its interface is a fence you can move, not a wall like a third-party API would be, so if changing it is the best fix for something, that's a live option (see Working Agreement, "Ecosystem boundaries are negotiable").
- **Middleware (babeldish)**: each direct relationship — what flows, from/to whom, current status (live / planned / stub), and where the contract is defined (OpenAPI spec, `external-services.md`, etc.). Include cooperative-owned-but-externally-maintained logistics apps alongside ones built by this team — they're part of the picture even though there's no shared `replit.md` on their side.
- **A logistics app**: the relationship with babeldish is two-way — receives distributed orders, and sends status updates back via webhooks. Cover both directions, with status and contract location for each. Other logistics apps may exist as siblings, per Part 0 (different operational models, possibly different teams) — this project doesn't need their details, only that they exist and that babeldish coordinates between them.

### 2. Run & Operate

Commands (install, dev, build, typecheck, db push/drift, test) and required env var **names**, grouped by what they're for. Full provisioning detail (auth, endpoints, where to get keys) lives in `external-services.md` — this section is just enough to get a session oriented and running.

### 3. Stack

Brief — runtime, framework, DB/ORM, frontend, key libraries. A table only if version-pinning matters (e.g. an exact-pinned ORM version with a reason); otherwise a short list.

### 4. Map

Where things live — key directories and entry points. For API-heavy projects, include a route-module table (prefix → file) here.

### 5. Non-Negotiables

The merged register of Hard Policies + No-Go Zone + Gotchas. Numbered, one line each where possible, phrased as concrete Always/Never statements — concrete enough to verify, not vague principles. Add a pointer to a deeper doc only if the *why* isn't self-evident from the rule itself.

Format:
```
1. Never inline VAT/fee calculations — use `lib/pricing` exclusively. See SSOT Quick-Reference.
2. Never use native `Date` methods for Amsterdam-local time — use `@workspace/timezone`.
3. [project-specific rule]. See `docs/X.md` for rationale.
```

Length isn't artificially capped — include everything that genuinely belongs here, no more and no less. The test for *inclusion* is whether getting it wrong would be a silent, costly mistake. The test for *exclusion* is whether something is really architecture-doc material (a decision and its rationale) rather than an enforceable rule, or whether it's already covered elsewhere (don't restate SSOT Quick-Reference entries here).

### 6. SSOT Quick-Reference

A condensed *recognition* list, not the full pattern table. One line per domain:

```
Pricing / fees / VAT → `@workspace/pricing` — full function table in `architecture-sources-of-truth.md`
Amsterdam date/time → `@workspace/timezone` — full reference in `architecture-sources-of-truth.md`
Auth / permissions → `@workspace/auth` (`hydrateAuth`, `requireAuth`, `hasPermission`, `canAccess`)
```

Its only job is to make an agent pause before writing inline logic in a covered domain and go check the registry. The exact function signatures, params, and file paths live in `architecture-sources-of-truth.md` (Part 2).

### 7. Documentation Index

A table covering every file in `docs/`. This is the single most important section for discoverability, since there's no automatic/conditional loading mechanism in Replit — if it's not in this table, an agent has no reason to know it exists.

| Document | Contents | Bucket | Update trigger |
|---|---|---|---|
| `architecture-sources-of-truth.md` | Full SSOT pattern registry | Routine | New reusable pattern/helper created |
| `changelog.md` | Dated record of architecturally-significant changes | Routine | New external service goes live, pattern added/retired, major decision made/reversed |
| `architecture.md` | Short contributor summary | Core-contract | Real architectural shift |
| `architecture-full-technical.md` | Deep technical reference | Core-contract | Major feature or external service change |
| `external-services.md` | Per-service env vars, auth, endpoints, status | Routine | External service added/changed |
| `todo-out-of-scope.md` | Deferred-work backlog | Routine (automated) | Existing protocol — unchanged |
| `todo.md` | Lean, uncategorized quick-capture inbox | Idea-space | Periodic triage only |
| `todo-bugs.md` | Confirmed low-priority defects | Idea-space (on-command) | Only when explicitly added/moved |
| `todo-roadmap.md` | Planned-but-not-built product/feature work | Idea-space (on-command) | Only when explicitly added/moved |

The **bucket** column governs how cautiously Agent should treat self-edits to that doc (see Maintenance, §9, and Part 2 for per-doc protocols). This table isn't capped at nine rows — a project may add others here for docs that have earned a defined role of their own (Part 2, "Beyond the nine"), with a bucket assigned via Maintenance §9's "Discoveries that don't fit."

**Notes** — anything relocated into `docs/notes/` (see Part 2) gets a lighter second list, name and purpose only:

| Document | What it's for |
|---|---|
| `notes/<name>.md` | One-line description of what this is for — filled in per project during migration |

### 8. Working Agreement

Shared across **all** Bestellenbij-ecosystem projects, worded identically by design.

> **Communication style.** Work through reasoning and tradeoffs, not just conclusions — if something has nuance or competing considerations, surface them rather than collapsing to a single answer. Proactively flag tensions, inconsistencies, or ambiguities you notice, even if not directly asked. When something is underspecified, ambiguous, or could reasonably go more than one way, ask rather than guess — clarifying questions are welcome and expected, not a sign of failure to understand.
>
> **Centralized patterns first.** Prioritize existing, centralized utilities and patterns (see SSOT Quick-Reference / `architecture-sources-of-truth.md`). If a new pattern or utility is genuinely required, ask before implementing it, and register it once built.
>
> **Significant changes need sign-off.** For significant architectural changes or new external dependencies, explain clearly and get explicit approval before proceeding.
>
> **Scope discipline.** Don't make changes to files or folders that aren't directly related to the task at hand.
>
> **Out-of-scope backlog.** When a task is completed, anything explicitly scoped out of it gets logged to `docs/todo-out-of-scope.md` per the existing protocol — confirm it isn't already implemented elsewhere before adding, mark items as `completed` or promoted to `now a task` as appropriate.
>
> **Changelog discipline.** Before considering a task done, ask whether it made an architecturally-significant change — a new external service went live, a pattern was added or retired, a major decision was made or reversed. If so, add a dated entry to `docs/changelog.md` in the format shown in Part 2.
>
> **Ecosystem boundaries are negotiable.** This project is one part of the Bestellenbij ecosystem — the storefront, distribution middleware, and rider/restaurant logistics apps are all under common ownership, plus at least one cooperative-owned app maintained by another team. Repo boundaries exist for operational isolation (so a failure in one doesn't take down the rest), not because these are walls of authority. If the best solution to a problem involves a change on the other side of an interface — including a change someone else's team would need to make — say so explicitly: describe what the change would be and where it would need to happen, rather than only optimizing within this repo. Propose it, and wait for explicit approval before acting on it — never unilaterally.

### 9. Maintenance

Governs how Agent treats `replit.md` itself when self-updating (Replit Agent updates this file as it works — there's no separate human/agent file split here, so this section *is* the discipline).

- **Core-contract sections** — Identity, Non-Negotiables, Working Agreement, this Maintenance section — change rarely and deliberately. Never edit these as a side effect of unrelated work. If a session feels one of these needs substantial rewriting, surface that explicitly and wait for confirmation before making the change.
- **Routine sections** — Run & Operate / Stack / Map update when the underlying facts change (new command, new directory, new dependency). Documentation Index entries update when their target doc's purpose or status changes. SSOT Quick-Reference gets a new line whenever `architecture-sources-of-truth.md` gains a new entry.
- **Discoveries that don't fit** — if something comes up that doesn't have an obvious home in this structure, propose a new `docs/` entry (assign it a bucket per Part 2's categories) rather than appending it to the cockpit. If genuinely unclear where it belongs, flag it rather than guessing.
- **Size discipline** — the ~150–180 line range is a diagnostic signal, not a hard cap. If `replit.md` creeps past it, that's a prompt to go through it line by line and ask whether each one still earns its place in the cockpit (per Purpose, above) — not to trim indiscriminately just to hit a number.
- **Readability** — this file is also human-facing documentation. Keep prose readable, not just terse instruction fragments.

---

## Part 2 — The `docs/` set

### `architecture-sources-of-truth.md` — *Routine*
The full SSOT pattern registry — every reusable calculation/utility/pattern that could otherwise be silently re-implemented: canonical function, signature/usage, file location, and an explicit "do not inline" note. Update whenever a new pattern is created or an existing one changes. (Previously also described as covering an "architectural changelog" — that responsibility now lives in `changelog.md`; this file is purely the pattern registry.)

### `changelog.md` — *Routine*
Dated, terse entries for architecturally-significant changes: a new external service goes live, a pattern is added or retired, a major decision is made or reversed. One or two lines per entry, with a task reference if applicable. This is the home for the kind of provenance currently embedded inline as "(Task #N)" markers in some current-state docs — during migration, consider extracting those into dated entries here so the architecture docs can describe *now* without historical clutter.

Format:
```
- 2026-06-15 (Task #42): Resend email notifications went live for restaurant order confirmations.
- 2026-05-03: `calcVatAllocation` became the canonical VAT/fee helper — replaces inline calculations in checkout.
- 2026-04-20 (Task #31): Reversed earlier decision to poll for rider status; switched to webhook-based updates.
```

### `architecture.md` — *Core-contract*
Short contributor-facing summary — the high-level "why" behind major decisions, written for someone (or some session) orienting on a subsystem without needing full depth. Tiered alongside `architecture-full-technical.md` below.

### `architecture-full-technical.md` — *Core-contract*
The deep reference: full tech stack with versions, detailed architectural decision narratives (the kind of depth in the existing "Trips"/"Two PWAs" writeups), route/auth/boot-sequence tables, testing infrastructure detail. Updated when adding major features or external service changes.

### `external-services.md` — *Routine*
Per external service: env vars, auth, endpoints, provisioning steps, and live/stub status. Updated whenever an external service is added or its status changes.

### `todo-out-of-scope.md` — *Routine, automated*
Unchanged from the existing protocol: canonical list of deferred work, updated as a routine part of closing a task. New deferred items get a source-task reference and a check that they aren't already implemented; completed items get marked; promoted items get an annotation.

### `todo.md` — *Idea-space, triage inbox*
Deliberately lean. Quick, uncategorized capture — anything not yet sorted into roadmap/bugs/resolved. Hands-off during normal tasks. During a dedicated triage session (initiated by you), Agent's role shifts to: read each item and help decide — resolve now, or move to `todo-bugs.md` / `todo-roadmap.md` / elsewhere.

### `todo-bugs.md` — *Idea-space, on-command*
Confirmed defects that aren't urgent enough to fix now but shouldn't be forgotten. Each entry: what's broken, plus *why it's not urgent right now* — so a later pass has context to re-assess rather than re-litigating or dismissively skipping. Populated only when explicitly added or moved during triage.

### `todo-roadmap.md` — *Idea-space, on-command*
Planned-but-not-yet-built product/feature extensions — your own roadmap notes. Populated only on command, same as above.

### Beyond the nine: project-specific docs and notes

The nine docs above are the only ones guaranteed to exist — every project has all nine (created as stubs where missing, per Part 3). Each has a universal, predefined role, bucket, and maintenance protocol, and gets a full row in the Documentation Index.

A project may also have additional docs that have earned a full Documentation Index entry — their own defined role, bucket, and update trigger — without being part of the universal nine. These are project-specific: something that matters enough to *this* project to warrant a real maintained reference (a compliance policy doc, say). They get a bucket assigned via the "Discoveries that don't fit" process in Maintenance (§9), and then sit alongside the nine in the main table.

Anything that hasn't reached that point yet — working notes, in-progress checklists, loose collections of ideas on a topic — lives in `docs/notes/` and gets only the lighter listing (name + one-line purpose, no bucket or trigger). These can be promoted later: once something in `docs/notes/` becomes a real, maintained reference in its own right, it moves into `docs/`, gets a bucket assigned the same way, and graduates to the main table.

During restructuring, the default for anything not obviously one of the nine is: if it already functions as a defined reference, give it a full entry (assign a bucket per §9); otherwise relocate it into `docs/notes/` (creating the folder if needed), update any cross-references, and list it in the lighter table — without rewriting its content either way.

---

## Part 3 — Migration (one-time, for initial rollout)

This first pass is scoped to two things: (1) giving `replit.md` the Part 1 structure, and (2) the file-level organization of `docs/` — names, existence, and the Documentation Index. **Don't rewrite or restructure the content of any `docs/` file in this pass.** Leave existing docs as-is and create missing ones as stubs; moving detailed material out of `replit.md` and into the right `docs/` files is a separate follow-up pass.

Generic instructions, same wording for every project:

> Use this document to restructure this project's `replit.md` and the file structure of `docs/`. Treat this as a re-sort, not a rewrite — nothing gets discarded, only relocated, flagged, or renamed.
>
> 1. Read the current `replit.md` and inventory `docs/`, including any pre-blueprint one-off docs.
> 2. Using Part 0 (Ecosystem Reference), identify which role this project plays — storefront, middleware, or a logistics app — and what its direct neighbors are. This grounds step 7 below.
> 3. Re-sort `replit.md`'s existing content into the Part 1 section structure. If something clearly belongs in a `docs/` file instead (per Part 1/2) but isn't being moved this pass, collect it under a temporary "Pending Migration" section at the end of `replit.md`, with each item tagged with its intended destination doc (e.g. "→ `architecture-full-technical.md`") — to be processed and removed during the content-migration pass. Unanchored items tend to stay forever; an assigned destination is what makes the follow-up pass mechanical.
> 4. While inventorying `docs/`, categorize each existing file: (a) one of the nine blueprint docs (Part 2); (b) a project-specific doc that already functions as a defined, maintained reference — give it a full Documentation Index entry, assigning a bucket via §9's "Discoveries that don't fit"; (c) a note — relocate into `docs/notes/` (creating the folder if needed) and add a lighter entry; or (d) neither of these — flag for review. Don't rewrite content in any case.
> 5. Case-normalize filenames to lowercase kebab-case (e.g. `ARCHITECTURE_SOURCES_OF_TRUTH.md` → `architecture-sources-of-truth.md`). Update every cross-reference to a file renamed or relocated in this pass — in `replit.md` and in any other `docs/` file that links to it — so nothing breaks. Fixing broken links from renames or moves is a mechanical edit, not the kind of content rewrite this pass is otherwise scoped to avoid.
> 6. Create any missing standard `docs/` files from Part 2 that plausibly apply to this project (commonly `changelog.md` and `external-services.md`) as stubs — a title plus a one-line "to be populated in the content-migration pass" note. If one clearly doesn't apply, note why rather than creating it.
> 7. Populate the Documentation Index (Part 1, §7) completely — every blueprint doc, every project-specific doc from step 4(b) in the main table, and an entry in the Notes table for everything relocated to `docs/notes/` in step 4(c).
> 8. For the Identity section's ecosystem position, describe only this project's direct upstream/downstream relationships (per step 2), at the level of detail relevant to this project's own work — don't attempt to reproduce the whole Part 0 reference.
> 9. Apply the Working Agreement (Part 1, §8) verbatim — it's shared across all Bestellenbij projects by design.
> 10. Adopt the Maintenance rules (Part 1, §9) for self-updates going forward.
> 11. The ~150–180 line range (Part 1, §9) is a diagnostic signal, not a target to hit in this pass — it may well sit above that range if step 3 produced a Pending Migration section. That's expected, and gets resolved in the content-migration pass. The section *structure* should otherwise match Part 1 in full.