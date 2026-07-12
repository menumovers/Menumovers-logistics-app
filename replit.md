# Bestellenbij

## 1. Identity

Bestellenbij is an internal Progressive Web App (PWA) for food-delivery logistics within a Dutch delivery cooperative. It manages the complete order lifecycle — from inbound order ingestion to final delivery — providing role-based interfaces for coordinators, riders, and restaurant staff, with strict server-validated state transitions, trip bundling, outbound status webhooks, and Web Push notifications.

**In scope:**
- Receiving inbound orders from the upstream distribution middleware (babeldish) via a shared-secret endpoint
- Dispatching orders to riders and tracking them through a strict state machine
- Pickup confirmation from restaurant staff; item overrides (hide/add)
- Multi-source pickup-time prioritization; trip (order-bundle) management
- Outbound webhook delivery of status updates back to babeldish, with database-backed retry
- Web Push notifications for riders, coordinators, and restaurant staff
- Role-based UIs: coordinator dispatch view, rider order flow, restaurant pickup view, admin settings

**Explicitly out of scope:**
- Customer-facing ordering (that is the storefront, Bestellenbij.nl)
- Order routing and source-keyed dispatch rules (that is babeldish)
- Multi-cooperative or multi-region routing logic

**Ecosystem position:** This is a logistics app. It sits downstream of babeldish (the distribution middleware): babeldish routes inbound orders to this app via a shared-secret POST endpoint (live). This app sends order status updates back to babeldish via outbound webhooks (live; URL is operator-configurable). Other logistics apps may exist as siblings serving different operational models — babeldish coordinates between them. Contract for the inbound direction: `lib/api-spec/openapi.yaml` (inbound endpoint) + `INBOUND_SHARED_SECRET`. Contract for the outbound direction: babeldish's webhook receiver + `WEBHOOK_URL` / `system_settings.outbound_webhook_url`.

---

## 2. Run & Operate

**Migration workflow:** `pnpm --filter @workspace/db run push` applies local schema changes to the database. Schema-drift guard: `pnpm --filter @workspace/db run db:drift` — exits non-zero if `lib/db/src/schema/` has uncommitted changes, signalling that schema was edited but `push` may not have been run. (This project uses `push`, not migrations — the guard catches local edits, not live DB divergence.)

**Importing external code (GitHub / PR merges):** the platform runs `scripts/post-merge.sh` (install + `db push`) automatically after *platform-managed* merges — but a **manual** GitHub merge or PR merge on `main` bypasses it, leaving the environment un-reconciled (unlinked deps, unapplied schema changes). When the user says they imported or merged external code:
1. **Clarify what they actually did first** — a manual GitHub merge, a fresh import, or a rebase? Each reconciles slightly differently; don't assume.
2. Run `scripts/post-merge.sh`, then run **all** validation steps up front in one pass (`db:drift`, typecheck, any tests) and collect every failure before fixing — don't fix one, re-run, discover the next.
3. **Do** fix reconciliation breakage (unlinked deps, unapplied schema). **Don't** rewrite app logic, "improve" unrelated code, or revert files the merge legitimately changed.

---

## 3. Stack

- **Runtime:** Node 24, TypeScript ~5.9, pnpm workspaces monorepo
- **API:** Express 5, Pino (logging), cookie-parser, cors, express-rate-limit
- **Auth:** bcryptjs (password hashing), JWT HS256 7-day with JTI revocation
- **Database:** PostgreSQL, Drizzle ORM (schemas in `lib/db/src/schema/`)
- **Validation:** Zod
- **API contract:** OpenAPI (`lib/api-spec/openapi.yaml`) → Orval → `@workspace/api-client-react` (TanStack Query hooks) + `@workspace/api-zod` (Zod schemas)
- **Frontend:** React 18, Vite 7, Wouter, TanStack Query, Tailwind CSS, framer-motion, react-i18next, shadcn/Radix UI
- **PWA:** Custom `public/sw.js`, two static manifests, vite-plugin-pwa (`injectManifest`, `manifest: false`)
- **Push:** web-push (VAPID)
- **Build:** esbuild (API, CJS bundle), Vite (frontend artifact)

---

## 4. Map

→ Pending Migration (content-migration pass): key directories and entry points to be populated from codebase.

---

## 5. Non-Negotiables

→ Pending Migration (content-migration pass): to be synthesized from `docs/architecture-sources-of-truth.md` "Do not" entries.

---

## 6. SSOT Quick-Reference

One line per domain — go check the registry before writing anything in a covered area. Full registry → `docs/architecture-sources-of-truth.md`.

- **Calculations** (effective pickup time, countdown label, urgency, status visuals, state machine, trip bundling, item overrides, currency rendering) → `docs/architecture-sources-of-truth.md` §Calculations
- **Auth** (password hashing, JWT sign/verify, auth middlewares, JTI revocation, user serialization) → `docs/architecture-sources-of-truth.md` §Auth
- **Time / Locale** (active locale resolution, locale-aware UI mapping) → `docs/architecture-sources-of-truth.md` §Time/Locale
- **External Services** (outbound webhook dispatch + retry, push dispatch, push audiences, typed settings readers, revoked-token janitor) → `docs/architecture-sources-of-truth.md` §External Services
- **Data Access** (Drizzle client, order serialization, HTTP errors, logger, rate limits) → `docs/architecture-sources-of-truth.md` §Data Access
- **Frontend Plumbing** (API client config, auth context, app context, PWA manifests, generated hooks + Zods) → `docs/architecture-sources-of-truth.md` §Frontend Plumbing

---

## 7. Documentation Index

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
| `documentation-blueprint.md` | Shared `replit.md` structure template for the Bestellenbij ecosystem | Core-contract | Blueprint revision by ecosystem team only |

---

## 8. Working Agreement

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

---

## 9. Maintenance

Governs how Agent treats `replit.md` itself when self-updating (Replit Agent updates this file as it works — there's no separate human/agent file split here, so this section *is* the discipline).

- **Core-contract sections** — Identity, Non-Negotiables, Working Agreement, this Maintenance section — change rarely and deliberately. Never edit these as a side effect of unrelated work. If a session feels one of these needs substantial rewriting, surface that explicitly and wait for confirmation before making the change.
- **Routine sections** — Run & Operate / Stack / Map update when the underlying facts change (new command, new directory, new dependency). Documentation Index entries update when their target doc's purpose or status changes. SSOT Quick-Reference gets a new line whenever `architecture-sources-of-truth.md` gains a new entry.
- **Discoveries that don't fit** — if something comes up that doesn't have an obvious home in this structure, propose a new `docs/` entry (assign it a bucket per Part 2's categories) rather than appending it to the cockpit. If genuinely unclear where it belongs, flag it rather than guessing.
- **Size discipline** — the ~150–180 line range is a diagnostic signal, not a hard cap. If `replit.md` creeps past it, that's a prompt to go through it line by line and ask whether each one still earns its place in the cockpit (per Purpose, above) — not to trim indiscriminately just to hit a number.
- **Readability** — this file is also human-facing documentation. Keep prose readable, not just terse instruction fragments.

---

## Pending Migration

Content that can't yet live cleanly in a cockpit section — to be processed in the content-migration pass. Each item is tagged with its destination.

- **Core Architectural Decisions** (12 bullets from the former §System Architecture: path-based proxy, polling/push, server-validated state machine, atomic rider assignment, database-backed webhook retry queue, centralized push audiences, additive item overrides, JWT with JTI revocation, money as string, locale resolution priority, two PWAs one bundle, configurable outbound webhook URL, rider self-claim toggle, trips/order bundling) → `docs/architecture-full-technical.md` *(already documented there; remove from cockpit in content-migration pass)*
- **Technology Stack** (detailed annotated list with parenthetical implementation notes) → `docs/architecture-full-technical.md` *(already documented there)*
- **External Dependencies** (6 bullets: PostgreSQL/DATABASE_URL, inbound distribution service/INBOUND_SHARED_SECRET, outbound webhooks/WEBHOOK_URL, Web Push/VAPID keys, JWT/JWT_SECRET, CORS/CORS_ALLOWED_ORIGINS) → `docs/external-services.md` *(to be populated in content-migration pass)*
- **Map** (directory structure and entry points) → `replit.md §4` *(populate from codebase in content-migration pass)*
- **Non-Negotiables** → `replit.md §5` *(synthesize from `docs/architecture-sources-of-truth.md` "Do not" entries in content-migration pass)*
- **Contributing / out-of-scope backlog protocol** (detailed 3-bullet procedure from former User Preferences) → superseded by §8 Working Agreement "Out-of-scope backlog" bullet; detailed procedure belongs in `docs/todo-out-of-scope.md` header *(verify and consolidate in content-migration pass)*
