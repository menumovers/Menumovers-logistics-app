# Bestellenbij

## Overview

Internal food delivery logistics PWA for a Dutch delivery cooperative. Inbound orders are received via webhook from the public-facing storefront, dispatched to riders by a coordinator, and tracked through a strict status state machine. UI in nl-NL with i18n scaffolding (nl + en).

## Roles

- `admin` — full access, manages users / restaurants / riders / system settings
- `coordinator` — dispatches and reassigns orders, edits pickup times, manages item overrides
- `rider` — sees own assigned orders, transitions status (picked_up → delivered)
- `restaurant_staff` — sees own restaurant's orders, can adjust pickup time

## Stack

- **Monorepo**: pnpm workspaces, TypeScript 5.9, Node 24
- **API**: Express 5 + Pino + cookie-parser + cors
- **DB**: PostgreSQL + Drizzle ORM (schema in `lib/db/src/schema/`)
- **Auth**: local bcryptjs + JWT (HS256, 7-day expiry); `JWT_SECRET` + `INBOUND_SHARED_SECRET` env vars
- **Validation**: Zod (`zod/v4`), drizzle-zod
- **API codegen**: Orval — generates React Query hooks (`lib/api-client-react`) and Zod schemas (`lib/api-zod`) from `lib/api-spec/openapi.yaml`
- **Build**: esbuild (CJS bundle for the api-server)

## Architecture notes

- `pickup_time_original` on orders is immutable after insert (enforced at app layer). Effective pickup time is computed at read time from priority: override > rider-set > restaurant-set > original.
- Inbound orders preserve the upstream payload in `originalPayload` (jsonb).
- Item overrides are a separate table (hide-by-index, add-new) so the original order is never mutated.
- Outbound webhooks use a `webhook_retry_queue` table with exponential backoff.
- Web Push (VAPID) for rider notifications; UI also polls every 30s as a fallback.

## Orval naming gotcha

Orval auto-generates a Zod response schema named `<OperationId>Response` for every operation. Do NOT name an OpenAPI component schema with the same suffix — they collide on export. We use `AuthSession` (not `LoginResponse`) for the login operation's body schema. In handlers, import the orval-generated response Zods as:

```ts
import { LoginResponse as LoginResponseZod, GetCurrentUserResponse } from "@workspace/api-zod";
```

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema to dev DB
- `pnpm --filter @workspace/api-server run dev` — run API server
- Bootstrap admin: `cd scripts && ADMIN_EMAIL=… ADMIN_PASSWORD=… pnpm exec tsx ./src/seed-admin.ts`

## Default dev admin

Seeded via `scripts/src/seed-admin.ts`: `admin@bestellenbij.nl` / `admin123` (change in production).

## Project tasks

Tracked in `.local/tasks/`:
1. Backend foundation (DB schema + local auth + OpenAPI) — DONE
2. Backend implementation (route handlers, state machine, webhooks, push) — pending
3. Frontend PWA + i18n — pending
4. FUTURE_WORK.md — pending

See the `pnpm-workspace` skill for workspace structure.
