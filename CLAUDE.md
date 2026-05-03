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
- **Phase 5a (Logistics):** shipped. `itinerary_legs` (ordered, with optional vehicle, depart/arrive timestamps, free-form notes) + `itinerary_leg_assignees` many-to-many for crew assignment. `hotel_bookings` (name, address, conf #, check-in/out dates, room assignments as text). `meal_plan_items` (when, where, what, optional assignee). "My legs" filter via `?legs=mine` query param. Itinerary print view at `/events/[id]/itinerary/print` covers legs + hotels + meals on one paper-friendly page.
- **Phase 5b (Recce):** shipped. `event_stages` (per event, unique stage_number) + `recce_schedule_entries` (stage + day + pass_number + driver/codriver) + `events.recce_logistics_notes` text column. **File uploads (road book PDF, GPX) intentionally deferred** to Phase 7 (documents) — all file handling consolidated there. Recce print view at `/events/[id]/recce/print` covers stages + schedule + logistics.
- **Phase 6 (Budget):** shipped. `budget_lines` (per event×category, unique) + `expense_entries` (per event, vendor + date + entered_by). All amounts stored as integer cents to avoid float drift. **`BudgetReconciler`** deep module (src/lib/budget-reconciler.ts) is pure with full Vitest coverage (10 cases — under/over/on_budget/no_budget/no_actuals/aggregation/canonical ordering). Event detail Budget section shows variance per category with status-coded badges (under/on_budget = good, no_actuals = warning, over/no_budget = alert). `/events` adds a current-year season rollup by category. Receipt photos deferred to Phase 7.
- **Phase 7 (Documents):** shipped. `documents` (per team×event×category×name, unique-indexed; soft delete; must_acknowledge flag) + `document_versions` (immutable, with R2 storage_key, extracted_text, cached diffJson) + `document_acknowledgments` (one per (doc, user); points at the version that was acked — staleness derived by comparing to current version). **`DocumentDiffer`** (src/lib/document-differ.ts) is pure deep module with full Vitest coverage (15 cases — paragraph-level LCS diff with CRLF/BOM/Unicode/whitespace normalization). Storage layer at src/lib/storage.ts wraps Cloudflare R2 via the AWS S3 SDK; downloads use 5-minute presigned URLs. PDF text extraction via `unpdf`. Per-event Documents section, /documents/[id] shows version history + structured diff vs prior + ack flow. /events shows pending-ack feed for the current user.
- **Phase 8 (Safety, licensing, equipment):** shipped. `safety_items` (helmet/HANS/suit/harness/fuel_cell/fire_extinguisher/other with FIA spec + serial + expiry + owner), `license_docs` (per holder × kind: ARA/FIA/medical), `equipment_items` (service_tool/comms/filming/other registry; non-expiry-tracked). **`SafetyExpiryWarner`** (src/lib/safety-expiry-warner.ts) is the **5th deep module** — pure function classifying items into bands `expired / 1w / 1mo / 3mo / 6mo / ok / no_expiry` with attention-band filter and urgency sort. 14 Vitest cases. `/safety` page is the chief's registry; `/events/[id]/tech-ready` is a per-event red/yellow/green status report computed against the event date (not today). `/events` shows top-8 expiry warnings.
- **Phase 9 (Live mode):** shipped. `/events/[id]/live` is the on-event mobile-first surface — high-contrast styling (`.rc-live` CSS class forces white background + black text + 56px-min tap targets + 17px font, even in dark-mode browsers, for sun readability). Schema: `incidents` (vehicle + stage # + note + reporter, optional WO link), `service_stops` (name + planned_duration_seconds + started_at/ended_at + started_by_user) + `service_stop_items` (sign-off list per stop), `crew_status_entries` (one row per (event, user) with upsert via PK on (event_id, user_id), status enum `at_service / paddock / parts_run / hotel / recce / other`). Sections on the live page: my status (instant pill-button update), incident logger (vehicle + stage # + note + optional auto-WO checkbox), active service stop (live countdown timer via client component, inline checklist with sign-off, chief-only end), bulletin feed (latest event docs with must-ack badges), crew status board (everyone's pill + last update). Event detail page links to live mode when phase is `on_event`.
- See `plans/v1-build.md` for the rest. Issue tracking on GitHub.

## Style system

`app/globals.css` defines a small set of `rc-*` utility classes (rc-card, rc-input, rc-select, rc-btn, rc-btn-primary, rc-btn-ghost, rc-btn-danger, rc-link, rc-muted, rc-list, rc-list-row, rc-empty-section, rc-badge, rc-badge-{phase}, rc-nav, rc-logo). Use these instead of one-off Tailwind utilities for consistency. Phase badges (`rc-badge-planning`, `rc-badge-prep`, `rc-badge-on_event`, `rc-badge-post_event`) are color-coded and double up as work-order status indicators (open/in_progress/done map to planning/prep/post_event respectively).

## What NOT to do

- Don't introduce a new ORM or auth library without discussion.
- Don't add tables without `team_id` on the domain side.
- Don't enable self-signup — the chief is the gatekeeper.
- Don't commit `.env` (it is gitignored). `.env.example` is the source of truth for required vars.
