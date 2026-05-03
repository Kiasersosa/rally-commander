# Rally Commander — repo guide for Claude Code

## Stack

- Next.js 16 (App Router, Turbopack), TypeScript, Tailwind v4
- Postgres + Drizzle ORM (`drizzle-orm`, `drizzle-kit`)
- NextAuth v5 (Auth.js) with `@auth/drizzle-adapter` and the Resend email provider (magic link)
- Vitest for unit tests
- Fly.io (app + Postgres cluster), Docker multi-stage build, standalone Next output

## Layout

- `app/` — App Router pages and route handlers
- `src/lib/db/` — Drizzle client (`index.ts`), schema (`schema.ts`), bootstrap (`bootstrap.ts`)
- `src/lib/auth.ts` — NextAuth config (single source of `auth`, `signIn`, `signOut`, `handlers`)
- `src/lib/authz.ts` — `requireSession`, `requireChief`, `getCurrentUser`, error classes
- `src/lib/event-lifecycle.ts` — pure deep module for event phase state machine
- `src/components/` — React components
- `tests/` — Vitest suites
- `drizzle/` — generated migrations

## Conventions

- Every domain table has `team_id` (FK → teams). All queries scope by `teamId` from session.
- UUID primary keys. `created_at` / `updated_at` everywhere. `deleted_at` (soft delete) on `users` and `events`.
- Roles: `chief`, `lead_mechanic`, `assistant`, `gopher`, `co_driver`, `driver`. Only `chief` can invite/revoke, create events, advance phases, create todos.
- Event phases: `planning` → `prep` → `on_event` → `post_event`. Terminal at `post_event`.
- Server Actions for form submissions; route handlers reserved for OAuth callbacks and webhooks. (NextAuth lives at `app/api/auth/[...nextauth]/route.ts`.)
- Self-signup is disabled — `adapter.createUser` throws. The chief creates the `users` row at invite time, then a magic link is sent.
- The `signIn` callback rejects login if the email has no users row, or if `deleted_at IS NOT NULL`.

## Local dev

1. `cp .env.example .env`, fill in `DATABASE_URL`, `AUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, and the `RC_BOOTSTRAP_*` vars.
2. `npm install`
3. `npm run db:push` (or `db:generate` + `db:migrate`) against the local Postgres
4. `npm run bootstrap` once to create the team + chief user
5. `npm run dev` → http://localhost:3000

## Tests

- `npm test` — runs Vitest. Phase 1 covers the `EventLifecycle` deep module.
- Future deep modules to test in v1: `DocumentDiffer`, `SafetyExpiryWarner`, `ChecklistEngine`, `BudgetReconciler`.

## Deploy (Fly.io)

From PowerShell at `C:\Users\black\rally-commander`:

```
fly deploy
```

First-time setup:

```
fly launch --no-deploy            # creates app
fly postgres create               # creates a separate cluster
fly postgres attach <pg-app>      # sets DATABASE_URL
fly secrets set AUTH_SECRET=... AUTH_URL=... RESEND_API_KEY=... \
                EMAIL_FROM='Rally Commander <noreply@rallycommander.app>' \
                RC_BOOTSTRAP_TEAM_NAME='...' \
                RC_BOOTSTRAP_CHIEF_EMAIL='...' \
                RC_BOOTSTRAP_CHIEF_NAME='...'
fly deploy
```

The Docker `entrypoint.sh` runs `drizzle-kit migrate` then `tsx src/lib/db/bootstrap.ts` then starts `node server.js`.

## Phase status

- **Phase 1 (Foundation):** shipped + deployed. Auth, team/user/event/todo, lifecycle, debrief.
- **Phase 2 (Vehicles & work orders):** shipped. Vehicle registry (rally_car / service_truck / trailer), work orders with `open → in_progress → done` lifecycle, append-only notes thread, driver-condition reports auto-create draft work orders, maintenance log = closed work orders.
  - **Photo attachments deferred to Phase 5 (documents).** Phase 2 acceptance mentioned photos but the architecture decision is to land all file storage with the documents module so we don't need a Fly volume yet.
- **Phase 3 (Checklists):** shipped. Per-vehicle reusable templates for `pre_event_inspection` and `post_event_teardown`, auto-instantiate as snapshots on event create (or on chief-triggered rebuild). Sign-offs are timestamped + attributed and blocked by unique index from duplication. `ChecklistEngine` (src/lib/checklist-engine.ts) is a pure deep module with full Vitest coverage. Print view at /checklists/[id]/print.
- **Phase 4 (Order lists & packing):** shipped. Per-event Order List (`order_list_items`) with `needed → ordered → received → packed` flow, optionally linked to an open WO. Per-event `tire_needs` with compound + count + ordered/received timestamps. Packing reuses the checklist infrastructure as a third `kind` (`packing`); supports per-vehicle templates (auto-instantiate on event create), ad-hoc item additions, and chief-only "copy from prior event" (label-deduped). Event header shows aggregate "% ready" badge based on packing signoffs.
- See `plans/v1-build.md` for the rest. Issue tracking on GitHub.

## Style system

`app/globals.css` defines a small set of `rc-*` utility classes (rc-card, rc-input, rc-select, rc-btn, rc-btn-primary, rc-btn-ghost, rc-btn-danger, rc-link, rc-muted, rc-list, rc-list-row, rc-empty-section, rc-badge, rc-badge-{phase}, rc-nav, rc-logo). Use these instead of one-off Tailwind utilities for consistency. Phase badges (`rc-badge-planning`, `rc-badge-prep`, `rc-badge-on_event`, `rc-badge-post_event`) are color-coded and double up as work-order status indicators (open/in_progress/done map to planning/prep/post_event respectively).

## What NOT to do

- Don't introduce a new ORM or auth library without discussion.
- Don't add tables without `team_id` on the domain side.
- Don't enable self-signup — the chief is the gatekeeper.
- Don't commit `.env` (it is gitignored). `.env.example` is the source of truth for required vars.
