# Plan: Rally Commander v1

> Source PRD: [PRD.md](../PRD.md)

## Architectural decisions

Durable decisions that apply across all phases.

- **Stack**: Next.js (App Router) + Postgres + Fly.io. PWA manifest + service worker for installability. No offline data sync.
- **Routes**: `/login`, `/events`, `/events/[eventId]`, `/events/[eventId]/<module>` for per-event surfaces (`todos`, `work-orders`, `parts`, `packing`, `checklists`, `itinerary`, `hotels`, `meals`, `recce`, `budget`, `expenses`, `documents`, `live`, `incidents`, `service-stops`, `crew-status`), `/vehicles`, `/vehicles/[vehicleId]`, `/equipment`, `/safety`, `/licenses`, `/team`, `/api/*`.
- **Schema conventions**: Postgres. Every table has `team_id` (FK to `team`). UUID primary keys. `created_at`, `updated_at` timestamps on every row. Soft delete via nullable `deleted_at` where retention matters (users, vehicles, events). All FK relationships explicit and indexed.
- **Multi-tenancy**: `team_id` on every table; one team provisioned per deployment. No UI for team management in v1.
- **Key models**: `Team`, `User` (role enum: `chief`, `lead_mechanic`, `assistant`, `gopher`, `co_driver`, `driver`), `Vehicle` (type: `rally_car`, `service_truck`, `trailer`), `Event` (phase: `planning`, `prep`, `on_event`, `post_event`), `Todo`, `WorkOrder`, `MaintenanceLogEntry`, `ChecklistTemplate`, `ChecklistInstance`, `OrderListItem`, `PackingChecklistItem`, `ItineraryLeg`, `HotelBooking`, `MealPlanItem`, `RecceSchedule`, `RoadbookFile`, `Document` (with versions), `Acknowledgment`, `BudgetLine`, `ExpenseEntry`, `Incident`, `ServiceStop`, `CrewStatus`, `SafetyItem`, `LicenseDoc`, `Equipment`, `Notification`.
- **Auth**: NextAuth magic-link via email. No passwords. Role assigned at invite. Soft-delete on revoke (data retained).
- **Authorization**: Crew-chief-only actions enforced server-side (invites, role changes, work-order assignment, bulk SMS). All other crew members see all event data; per-person views are a UX filter, not a security boundary.
- **File storage**: Fly.io volume for documents, photos, GPX, road books. Path structure: `team_id/event_id/<category>/<filename>`.
- **Third-party services**: Twilio (SMS, ~$1/year volume); email provider for magic-link delivery and weekly digests (Resend or equivalent).
- **Deep modules** (pure functions, isolated, tested in v1): `DocumentDiffer`, `SafetyExpiryWarner`, `ChecklistEngine`, `BudgetReconciler`. Plus `EventLifecycle` (state machine) and `NotificationDigestComposer` (composer; tested but lower priority).
- **Print views**: each owning phase delivers its own printable variant (CSS `@media print` + dedicated route segment where needed).
- **Public repo from day 1**: README starts with a self-host quickstart for Fly.io. No secrets in commits.

---

## Phase 1: Foundation

**User stories**: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11

### What to build

A logged-in user can create a team, invite crew by email magic link, assign roles, create an Event, advance it through its four lifecycle phases, and assign per-person todos. Each user sees their own todo list; the chief sees the full event board. Database is provisioned with the conventions above.

### Acceptance criteria

- [ ] A new deployment provisions one Team and one initial chief user via env-var bootstrap
- [ ] Chief can invite a user by email; the invitee receives a magic link and lands logged in with the assigned role
- [ ] Chief can revoke a user (soft delete); revoked user can no longer log in
- [ ] Chief can create an Event with name, date, location, ARA round number; it appears on the season dashboard
- [ ] Event phase advances on chief command; UI surfaces phase-appropriate empty modules
- [ ] Any crew member can be assigned a todo scoped to an Event; the assignee sees it in "my todos"; the chief sees all todos in the event board
- [ ] Crew member can mark their own todo complete with timestamp
- [ ] Post-event debrief view captures free-text notes per event
- [ ] All tables include `team_id`; all writes scoped to the current team

---

## Phase 2: Vehicles & work orders

**User stories**: 12, 13, 14, 15, 19

### What to build

The team can register the rally car, service truck, and trailer as Vehicles, each with its own page. Work orders open against a vehicle, move through `open → in_progress → done`, can be assigned to a mechanic, accept photos and notes, and roll up into a chronological maintenance log per vehicle. Driver-reported condition issues entered after a stage create a draft work order.

### Acceptance criteria

- [ ] Chief can register Vehicles of type `rally_car`, `service_truck`, `trailer`
- [ ] Each Vehicle has a detail page showing its open work orders and full maintenance log
- [ ] Anyone can open a work order with title, description, assignee, status, and photo attachments
- [ ] Mechanic can update status and append notes; transitions are timestamped and attributed
- [ ] Closing a work order creates a `MaintenanceLogEntry` derived from the work order
- [ ] A driver-condition note (free text + stage #) creates a draft work order tagged "driver report"
- [ ] Photos render inline in mobile view

---

## Phase 3: Checklists

**User stories**: 20, 21, 23, 24

### What to build

Reusable checklist templates per vehicle, instantiated per event for pre-event mandatory inspection and post-event teardown. Sign-offs are timestamped and attributed. The `ChecklistEngine` deep module owns all checklist state derivation and is unit-tested in isolation.

### Acceptance criteria

- [ ] Chief can author a `ChecklistTemplate` (ordered items, per-vehicle) for "pre-event inspection" and "post-event teardown"
- [ ] On Event creation (or manually), templates instantiate as `ChecklistInstance` rows for each vehicle
- [ ] Any crew member can sign off an item; sign-off records user + timestamp
- [ ] Vehicle detail and Event dashboard both show completion percentage per checklist
- [ ] `ChecklistEngine` module exposes a pure function `(template, instance, signoffs) → state` and has tests covering: empty, partial, complete, attribution, percentage math
- [ ] Print view of any `ChecklistInstance` is paper-friendly

---

## Phase 4: Order lists & packing

**User stories**: 16, 17, 18, 22

### What to build

Each event has a "parts to order" list aggregated from open work orders plus manual additions, a separate "tires needed" list, and per-vehicle packing checklists. Items track ordered/received/packed status. Packing checklists are paper-friendly for the gopher.

### Acceptance criteria

- [ ] Per-event Order List shows items (from work orders + manual) with status `needed → ordered → received → packed`
- [ ] Per-event Tires Needed list (compound, count) is separate from parts and editable inline
- [ ] Each Vehicle has a per-event Packing Checklist; items can be added ad hoc and copied from prior event
- [ ] Packing items sign off with user + timestamp; print view available
- [ ] Event dashboard surfaces "% ready to ship" across all packing checklists for the event

---

## Phase 5a: Logistics (itinerary, hotels, meals)

**User stories**: 25, 26, 27, 28

### What to build

A full leg-by-leg itinerary per event from "depart home" to "return home," with crew members optionally assigned to legs. Hotel bookings recorded with confirmation, address, dates, and room assignments. Meal plan per event with what/when/where and assigned gopher.

### Acceptance criteria

- [ ] Chief can create ordered `ItineraryLeg` rows per event (from/to, vehicle, depart, arrive, assigned crew)
- [ ] Crew member can filter itinerary to "my legs"
- [ ] Chief can record a `HotelBooking` (name, address, confirmation #, check-in/out, rooms with assigned crew)
- [ ] Chief can add `MealPlanItem` rows (when, where, who's bringing what, assignee)
- [ ] Print view: per-event itinerary handout

---

## Phase 5b: Recce

**User stories**: 29, 30, 31

### What to build

Per-event recce schedule covering each stage, with driver/co-driver pair assignments and pass numbers. Storage for organizer-provided road book PDFs and GPX tracks per stage. Recce logistics notes (fuel stops, lunch, transit times between stages).

### Acceptance criteria

- [ ] Chief can define stages for an event and add `RecceSchedule` entries (stage, day, pass #, pair)
- [ ] Co-driver can upload `RoadbookFile` (PDF or GPX) per stage; files render or download from the event detail
- [ ] Free-text recce-logistics field per event captures fuel/lunch/transit notes
- [ ] Recce schedule renders chronologically and is print-friendly

---

## Phase 6: Budget

**User stories**: 36, 37, 38, 39

### What to build

Per-event budget broken into categories (entry, fuel, parts, hotels, food, transport, other). Any crew member can log an actual expense with amount, category, vendor, and receipt photo. Budget vs actuals shown per-category and overall, plus a season rollup. The `BudgetReconciler` deep module owns variance math and is unit-tested.

### Acceptance criteria

- [ ] Chief can enter `BudgetLine` rows per event with category and estimated amount
- [ ] Any crew member can add an `ExpenseEntry` (amount, category, vendor, date, receipt photo)
- [ ] Event budget view shows estimated vs actual per category and overall variance
- [ ] Season dashboard rolls up total spend by category across all events in the current year
- [ ] `BudgetReconciler` module exposes a pure function `(budgetLines, expenses) → variance` with tests covering: under-budget, over-budget, missing category each side, mixed

---

## Phase 7: Documents

**User stories**: 32, 33, 34, 35

### What to build

Manual document upload tagged by event and category (entry / supp regs / bulletins / schedules / other). Re-uploading a logical document creates a new version and the `DocumentDiffer` deep module produces a structured diff against the prior version. New/updated documents appear in a per-user feed for events the user is on. Chief can mark a document as "must acknowledge"; each crew member confirms they've read it.

### Acceptance criteria

- [ ] User can upload a PDF tagged with event + category + logical document name
- [ ] Re-uploading the same logical name appends a version; the prior version is preserved and diff is generated
- [ ] `DocumentDiffer` module exposes a pure function `(prevText, nextText) → structuredDiff` with tests covering: added section, removed section, changed wording, no change, encoding edge cases
- [ ] Per-user document feed shows new and updated documents for events the user is assigned to
- [ ] Chief can flag a document "must acknowledge"; crew acknowledgment recorded as `Acknowledgment` row with timestamp
- [ ] Acknowledgment status visible to the chief per crew member

---

## Phase 8: Safety, licensing, equipment

**User stories**: 40, 41, 42, 43, 44

### What to build

Registry for safety gear (helmets, HANS, suits, harnesses, fuel cell, fire extinguisher) with FIA/SA spec, serial, expiry. Registry for driver/co-driver ARA license, FIA license, medical certificate with expiry. Registry for service tools, comms gear, and in-car filming equipment. The `SafetyExpiryWarner` deep module produces warnings at the 6mo / 3mo / 1mo / 1wk ladder and is unit-tested. A per-event "tech-ready" report lists every required gear/license item with current status.

### Acceptance criteria

- [ ] Chief can register `SafetyItem` rows (type, FIA/SA spec, serial, expiry, owner)
- [ ] Chief can register `LicenseDoc` rows (driver, type: ARA/FIA/medical, expiry)
- [ ] Chief can register `Equipment` rows (category: service-tool, comms, filming; description, location)
- [ ] `SafetyExpiryWarner` module exposes a pure function `(items, referenceDate, ladder) → warnings` with tests for: items in each band, items with no expiry, items expired, items >6mo out
- [ ] Dashboard shows current expiry warnings color-coded by band
- [ ] Per-event tech-ready report lists every safety item and license with green/yellow/red status

---

## Phase 9: Live mode

**User stories**: 45, 46, 47, 48, 49, 50, 51

### What to build

The on-event mobile-first surface. Driver/co-driver can log an `Incident` in three taps (photo, stage #, short note); incidents optionally auto-create a work order against the rally car. Chief can run a `ServiceStop` with a configurable timer (default 30 min) and a checklist; team marks items complete in real time. Bulletin feed surfaces new and updated documents pushed to crew on the event. Crew status board lets each member set their current state (at service / paddock / parts run / hotel).

### Acceptance criteria

- [ ] "Live" route per event renders mobile-first; large tap targets; works one-handed
- [ ] Driver can log an `Incident` in three taps; incident has photo + stage # + free text
- [ ] Toggling "create work order" on an incident creates a draft work order linked to the incident
- [ ] Chief can start a `ServiceStop`; visible countdown timer; checklist items can be added inline and signed off live
- [ ] Bulletin feed shows new and updated documents for the event with unread badging
- [ ] Each crew member can set their `CrewStatus` from a fixed list; status board shows everyone's current state and last-update time
- [ ] Live route remains usable on a phone in direct sun (high-contrast styling)

---

## Phase 10: Notifications

**User stories**: 52, 53, 54

### What to build

Weekly email digest per user covering upcoming todos, event activity, expirations, and bulletins. Twilio SMS for time-critical alerts (chief approval before bulk send). Safety/licensing expiry warnings appear as digest entries at 6mo / 3mo / 1mo and as SMS at 1wk. The `NotificationDigestComposer` module owns digest body composition.

### Acceptance criteria

- [ ] Twilio integration sends an SMS to a single user or filtered subset; chief approval required for bulk
- [ ] Weekly cron job composes and sends a digest email per user
- [ ] `NotificationDigestComposer` module exposes a pure function `(period, user, events, todos, expirations, bulletins) → digestBody` with tests covering: empty week, todos only, expirations only, mixed
- [ ] `SafetyExpiryWarner` warnings are wired into both the digest (6mo / 3mo / 1mo) and SMS (1wk)
- [ ] User can opt out of SMS in their profile (email digest is mandatory while account is active)
- [ ] All sent notifications recorded as `Notification` rows for audit
