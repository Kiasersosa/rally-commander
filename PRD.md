# PRD: Rally Commander

**Status:** Draft v1 — 2026-05-02
**Owner:** Jason Mesman
**Repo:** rally-commander (to be created)

---

## Problem Statement

A rally team running 3–5 American Rally Association (ARA) events per season coordinates a chaotic mix of moving parts across every race weekend:

- Vehicle prep, work orders, parts ordering
- Crew assignments and accountability
- Travel logistics, hotel bookings, meal plans, full-itinerary leg-by-leg coordination
- Organizer documents from Sportity, the ARA member portal, and email (entry forms, supplementary regulations, mid-event bulletins)
- Recce planning (schedule, road book, transit logistics)
- Safety equipment expirations (helmets, HANS, suits, harnesses, fuel cells, fire extinguishers) and licensing/medical certificates
- Per-event budgeting versus actual spend
- Live operations during the event itself: service-stop checklists, incident logging, bulletin acknowledgments, crew location/status

This information today lives in spreadsheets, group texts, paper checklists, email threads, and app push notifications across Sportity and the ARA portal. Things slip: expired safety gear discovered at tech, a forgotten part loaded into the wrong service vehicle, a bulletin nobody read until after a stage was run, double-booked hotel rooms, post-event receipts lost before reconciliation.

The driver/team owner needs a single place that organizes the entire arc of every race weekend — from initial entry through post-event debrief — that the crew can be invited into and that works on a phone in the service park.

## Solution

**Rally Commander** is a self-hostable web app (mobile-first PWA) for managing every aspect of an ARA rally weekend.

It is built around two equal-weight entities:

- **Vehicle** — ongoing, with a continuous history (rally car, service truck, trailer)
- **Event** — per-rally, with a four-phase lifecycle: Planning → Prep → On-event → Post-event

The crew chief invites crew by email magic link; each person sees their own assigned work, with a shared event view available. The app is mobile-first because the service park and paddock are where most live use happens, but it produces clean printable handouts for crew who prefer paper and is fully usable on a laptop for at-home planning and on a tablet in the service truck.

Rally Commander is designed single-tenant for the owner's team but every table includes a `team_id` from day one, so other rally teams can self-host their own copy from the open-source GitHub repo without a future schema migration. Document handling is intentionally manual-upload (Sportity/ARA push notifications and emails are forwarded or uploaded by the user) with automatic change-detection diffs against prior versions — no fragile scraping or third-party API dependencies.

Built on the same stack the owner already operates: Next.js, Postgres, Fly.io.

## User Stories

### Access & roles

1. As a driver/team owner, I want to invite crew by email magic link, so I don't have to manage passwords during a chaotic race weekend.
2. As a crew member, I want to log in on my phone with one tap on a magic link, so I don't have to memorize credentials.
3. As a crew chief, I want to assign each crew member a role (chief, lead mechanic, assistant mechanic, gopher, co-driver), so the right people see the right work.
4. As a crew chief, I want to revoke a crew member's access after an event, so departed crew don't retain access to team data.
5. As a crew member, I want a "my todos" view that shows only what's assigned to me, so I'm not buried in everyone else's work.
6. As a crew chief, I want a full event board view, so I can see overall status across every crew member.

### Season & event lifecycle

7. As a driver, I want to create a new Event with a name, date, location, and ARA round number, so it appears on the season dashboard.
8. As a driver, I want to see all upcoming and past events on a season dashboard, so I can navigate quickly.
9. As a driver, I want each Event to move through phases (Planning → Prep → On-event → Post-event), so the UI surfaces the work appropriate to the current phase.
10. As a driver, I want to manually advance an event to the next phase, so phase transitions are explicit.
11. As a driver, I want a post-event debrief view to capture what went well and what didn't, so lessons carry into the next event.

### Vehicles, work orders, and parts

12. As a driver, I want a Vehicle record for the rally car, the service truck, and the trailer, so all three have their own histories.
13. As a crew chief, I want to open a work order against a vehicle (title, description, status, assignee, photos), so pending work is visible to whoever needs to see it.
14. As a mechanic, I want to update a work order's status (open / in-progress / done) and add notes, so progress is visible without verbal handoffs.
15. As a driver, I want condition-based issues I report after a stage to auto-create work orders, so nothing said in service is lost.
16. As a crew chief, I want each event to have a "parts to order" list aggregated from work orders and crew input, so the order goes out before the deadline.
17. As a crew chief, I want to mark each parts-list item as ordered / received / packed, so I know its status at a glance.
18. As a crew chief, I want a per-event tires-needed list (compound, count) separate from parts, so the tire order is its own line.
19. As a crew chief, I want a chronological maintenance log per vehicle assembled from completed work orders and checklists, so I can answer "when was the last time we did X" instantly.

### Checklists (pre-event, post-event, packing)

20. As a crew chief, I want a reusable pre-event mandatory inspection checklist template per vehicle, so I don't recreate it every event.
21. As a crew chief, I want a reusable post-event teardown checklist template per vehicle, so the post-event work is consistent.
22. As a crew chief, I want a per-vehicle packing checklist (rally car, service truck, trailer) for each event, so we don't forget the laptop with the ECU software.
23. As a mechanic, I want to check off checklist items with my name and timestamp, so accountability is recorded.
24. As a crew chief, I want to see overall checklist completion percentages per vehicle per event, so I know what's blocking departure.

### Travel, itinerary, hotels, food

25. As a driver, I want a full leg-by-leg itinerary per event (truck departs Wed 6am, arrives venue Thu 2pm, recce Fri, race Sat, depart Sun 6pm), so every crew member knows the plan.
26. As a crew member, I want to see only the itinerary legs assigned to me, so I'm not parsing everyone's schedule.
27. As a crew chief, I want to record hotel bookings (confirmation #, address, check-in/out, room assignments), so room confusion at 11pm doesn't happen.
28. As a gopher, I want to see the food/meal plan per event (when, where, who's bringing what), so I know what to grab.

### Recce

29. As a driver, I want to schedule recce passes per stage (which day, which pair, first or second pass), so we don't miss a stage.
30. As a co-driver, I want to upload organizer-provided road book and GPX tracks per stage, so they're available offline-ish on phones.
31. As a co-driver, I want recce logistics (where to refuel during recce, where to eat, transit times between stages), so we don't run out of time.

### Documents (Sportity, ARA, organizer emails)

32. As a driver, I want to upload PDFs and tag them by event and category (entry, supp regs, bulletins, schedules), so they're findable later.
33. As a driver, I want to upload a new version of an existing document and have the app show a structured diff against the prior version, so I see exactly what changed in a bulletin.
34. As a crew member, I want to see a feed of new/updated documents for events I'm on, so I don't miss a bulletin.
35. As a crew chief, I want to mark a document as "crew must acknowledge," so each crew member confirms they've read it.

### Budget

36. As a driver, I want to enter a budget per event broken into categories (entry fees, fuel, parts, hotels, food, transport, other), so I know what I'm planning to spend.
37. As any crew member, I want to log an actual expense (amount, category, vendor, receipt photo), so reconciliation isn't a post-event archaeology project.
38. As a driver, I want to see budget vs actuals per category and overall per event, so I know where I overran.
39. As a driver, I want a season rollup of total spend by category, so I can plan next year.

### Safety equipment & licensing/medical

40. As a driver, I want to register each piece of safety gear (helmets, HANS, suits, harnesses, fuel cell, fire extinguisher) with FIA/SA spec, serial number, and expiry date, so tech inspection has no surprises.
41. As a driver, I want to register driver and co-driver ARA licenses, FIA licenses, and medical certificates with expiry dates, so we don't show up unlicensed.
42. As a driver, I want the app to warn me at 6 months, 3 months, 1 month, and 1 week before any safety/licensing/medical item expires, so I have lead time to order/renew.
43. As a driver, I want a "tech-ready" report per event listing every required gear/license item and its current expiry status, so I have one place to verify before each tech inspection.

### Other equipment

44. As a crew chief, I want to register service tools (jacks, generators, compressor, tools), comms gear (radios, intercoms, GoPros), and in-car filming equipment, so we can confirm what's packed and where it lives.

### Live mode (on-event)

45. As a driver, I want to log an incident from my phone in 3 taps (photo, stage number, short note) when I return to service, so nothing is forgotten.
46. As a crew chief, I want incidents to optionally auto-create work orders, so the mechanic team picks them up immediately.
47. As a crew chief, I want a service-stop timer (e.g. 30 min) with a service checklist, so the stop runs to plan.
48. As a crew chief, I want to mark each service-stop item complete in real time, so the team sees status during the stop.
49. As a crew member, I want a feed of new bulletins/documents pushed to my phone, so I see them without having to remember to check.
50. As a crew chief, I want to see who acknowledged each bulletin, so I know who's caught up.
51. As a crew chief, I want a simple crew status board (at service / at paddock / on a parts run / at hotel), so I know where everyone is without calling around.

### Notifications

52. As a crew member, I want a weekly email digest of my upcoming todos and event activity, so I don't have to open the app to stay current.
53. As a crew chief, I want to send an SMS to crew (or a subset) for time-critical alerts (e.g. "service stop in 10 min"), so urgent messages don't get lost in email.
54. As a driver, I want safety-gear expiry warnings to appear in the digest at 6 months, 3 months, and 1 month, with SMS at 1 week, so they're impossible to miss.

### Printable handouts

55. As a crew chief, I want to print a clean per-vehicle packing checklist, so crew who prefer paper can use it.
56. As a crew chief, I want to print a per-event itinerary handout, so the gopher has a reference.
57. As a crew chief, I want to print a crew-roster handout with assignments, so it's posted in the service area.

### Open-source / self-host (other teams)

58. As another rally team, I want to clone the repo and deploy my own instance with one Fly.io launch, so I can use it without depending on the originating team.
59. As a self-hosting team, I want my data fully isolated (own database, own credentials), so my recce notes and budgets aren't shared.

## Implementation Decisions

### Scope decisions

- **Single-tenant in production, multi-tenant-ready in schema.** Every table includes `team_id`. Only one team is provisioned in the initial deployment. Other teams self-host.
- **No offline-first.** Service park has connectivity. PWA installable for "feels like an app" + push, but no IndexedDB sync layer.
- **No pace note authoring or storage.** Co-driver uses Jemba/RaceNote/paper.
- **No real shelf inventory.** Per-event "to order" lists only. No on-hand counts, no reorder points.
- **No mileage/hours-based maintenance intervals.** Pre/post-event mandatory checklists + condition-based reports drive maintenance.
- **No external API integrations with Sportity or ARA.** Manual upload + change-detection diff.
- **No sponsor management, no championship points, no photo/video library** in v1.

### Stack & deployment

- Next.js (App Router) on Fly.io
- Postgres on Fly.io
- Magic-link email auth (NextAuth or equivalent)
- Twilio for SMS (estimated ~$1/year at expected volume)
- PWA manifest + service worker for installability and basic offline shell, no full offline data sync
- Public GitHub repo from day one
- Same operational pattern as LTE Fleet Manager (`fly deploy` from PowerShell)

### Core entities

- `Team` (one row in production; `team_id` on every other table for isolation-readiness)
- `User` with role enum: `chief`, `lead_mechanic`, `assistant`, `gopher`, `co_driver`, `driver`
- `Vehicle` with type: `rally_car`, `service_truck`, `trailer`
- `SafetyItem` (helmet, HANS, suit, harness, fuel cell, fire extinguisher, etc.) with FIA/SA spec, serial, expiry
- `LicenseDoc` (ARA license, FIA license, medical certificate) with expiry
- `Equipment` (service tool, comms, filming) with location/notes
- `Event` with phase enum: `planning`, `prep`, `on_event`, `post_event`
- `WorkOrder` with status: `open`, `in_progress`, `done`; assignee; parts list; photo attachments
- `MaintenanceLogEntry` (derived from completed work orders and checklist completions)
- `Todo` (assigned to a user, scoped to an event)
- `ChecklistTemplate` (reusable per vehicle) and `ChecklistInstance` (per event, with sign-offs)
- `OrderListItem` (per event; type: part or tire)
- `PackingChecklistItem` (per event per vehicle)
- `ItineraryLeg` (per event, with assigned crew)
- `HotelBooking` (per event)
- `MealPlanItem` (per event)
- `RecceSchedule` (per event per stage)
- `RoadbookFile` (per event per stage; PDF/GPX upload)
- `Document` (per event; uploaded, versioned, with diff against prior version)
- `Acknowledgment` (per document per user)
- `BudgetLine` (per event; estimated)
- `ExpenseEntry` (per event; actual; receipt photo)
- `Incident` (per event; stage, photo, note; optionally linked to a work order)
- `ServiceStop` (per event; timer, checklist of items)
- `CrewStatus` (per event per user; current location/state)
- `Notification` (queued: SMS or digest entry)

### Modules to build

Most modules are thin orchestration over the Postgres schema. The following deep modules deserve isolation and tests:

- **DocumentDiffer** — given two text-extracted document versions, produce a structured diff (sections added, removed, changed). Pure function. Reused by document upload flow and bulletin feed.
- **SafetyExpiryWarner** — given a set of items with expiry dates and a warning ladder (6mo / 3mo / 1mo / 1wk), produce the active warnings for a reference date. Pure function. Reused by dashboard, email digest, and SMS scheduler.
- **ChecklistEngine** — given a checklist template, an instance, and a stream of sign-off events, return the current state (per-item status, completion %, who-signed-what-when). Pure function. Reused by every checklist surface (pre-event, post-event, packing, service-stop).
- **BudgetReconciler** — given budget lines and actual expenses for an event, return per-category and total variance. Pure function.
- **EventLifecycle** — state machine for phase transitions with validation rules (e.g. cannot enter `on_event` until vehicle pre-event checklist is signed off). Pure logic.
- **NotificationDigestComposer** — given events, todos, expirations, and bulletins for a period and a user, return the digest message body. Pure function.

Shallow modules (CRUD over schema with thin business rules) include user/role management, work order CRUD, hotel/itinerary CRUD, expense entry, document upload, incident logging, and crew status updates.

### Auth & roles

- Email magic link via NextAuth (or equivalent). No passwords.
- Role assigned at invite time by the chief; can be edited.
- Crew chief can revoke access (soft delete on the user record; data retained).
- Roles control which views are default, but all crew can see all event data (the chief/per-person filtering is a UX layer, not an authorization boundary).

### Notifications

- Critical pings: Twilio SMS (rate-limited; chief approval before bulk send)
- Routine: weekly email digest per user composed by `NotificationDigestComposer`
- Safety-gear expiry warnings: digest entries at 6mo / 3mo / 1mo; SMS at 1wk

### Documents

- Files stored in Fly.io volume (or S3-compatible if preferred at scale)
- Text extracted via `pdf-parse` (or equivalent) for diffing
- New uploads compared to most recent prior version of the same logical document; diff stored alongside the new version

### Build sequence (phased v1)

Each phase is independently usable:

1. **Foundation** — Auth + magic-link invites + roles + Event + per-person todos
2. **Car/prep core** — Vehicles + work orders + parts/tires order list + per-vehicle packing checklists + pre/post-event inspection checklists
3. **Logistics** — Itinerary + hotel tracking + meal plan + budget vs actuals
4. **Live mode** — Incident logging + service-stop timer/checklist + bulletin feed + crew status
5. **Documents** — Upload + change-detection diffs (Sportity / ARA / organizer emails)
6. **Equipment & notifications** — Safety gear + licensing/medical with expiry tracking + service tools + comms + filming + SMS + weekly email digest

After Phase 1+2 the app is usable for a real event prep cycle.

## Testing Decisions

### What makes a good test here

Tests verify external behavior — the contract a module exposes — not internal implementation. A test should still pass after a refactor that doesn't change behavior, and fail when behavior actually breaks. Pure functions are tested with example inputs and expected outputs; stateful flows are tested through public APIs, never by reaching into private state. We do not test framework code (Next.js routing, NextAuth flows) or trivial CRUD.

### Modules that get tests in v1

- **DocumentDiffer** — table-driven tests with sample document pairs (added section, removed section, changed wording, no change). Verifies the diff contract, not the diff library.
- **SafetyExpiryWarner** — table-driven tests with a mix of items at varying expiry distances against a fixed reference date. Verifies which items appear in which warning band.
- **ChecklistEngine** — tests for: empty instance, partial sign-off, complete sign-off, sign-off attribution, % completion math.
- **BudgetReconciler** — tests for: under-budget, over-budget, missing categories on either side, mixed categories.

### Prior art

This is a greenfield repo. The LTE Fleet Manager codebase is the reference for general patterns (deployment, schema migrations, auth wiring) but is a separate project. Test patterns will be established as part of Phase 1.

## Out of Scope

- Pace note authoring or storage
- Real shelf parts inventory (qty on hand, reorder points, SKU catalog)
- Mileage/hours-based maintenance interval calculation
- Sponsor management (logos, decal placement, deliverables)
- Championship / season points tracker
- Photo/video library per event
- Native iOS/Android app (PWA only)
- ECU/tuning laptop and calibration file management
- Offline-first data sync (no IndexedDB / local-first DB)
- Sportity / ARA portal scraping or API integration
- Integration with Jobber or any other external business system
- Multi-tenant signup, billing, or onboarding UI (schema is multi-tenant-ready; no UI for it in v1)
- Public marketing site for Rally Commander (the GitHub README is the marketing surface for v1)

## Further Notes

- Owner runs a tree-service business (LTE Fleet Manager) and is technically comfortable but not a developer. Prefers explicit, simple deployment instructions.
- Owner has a developer friend who advises on architecture; this PRD should be reviewed by them before Phase 1 begins.
- Recommended next step after PRD approval: run the `prd-to-plan` skill to produce a phased implementation plan saved under `./plans/`.
- The four phases of an Event (`planning`, `prep`, `on_event`, `post_event`) are the most important UX organizing principle. The interface should look meaningfully different in each phase.
- Open-sourcing from day one means commit hygiene matters: no secrets in commits, README starts with a self-host quickstart.
- Domain to register: `rallycommander.app` (verify availability before locking).
- Repo to create: `rally-commander` (kebab-case is conventional for repos; the app/brand is "Rally Commander").
