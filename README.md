# Rally Commander

Open-source race-weekend management for rally teams.

Built for [American Rally Association](https://www.americanrallyassociation.org/) competitors. Self-hostable on Fly.io. Use it for one team or fork it for your own.

## What it does

Rally Commander organizes the entire arc of a rally weekend in one place:

- **Vehicles & work orders** — rally car, service truck, trailer; open work, status, photos, full maintenance log
- **Crew & assignments** — invite by email magic link, per-person todos, role-based views
- **Checklists** — pre-event inspection, post-event teardown, per-vehicle packing
- **Parts & tires** — per-event order list aggregated from work orders
- **Logistics** — full leg-by-leg itinerary, hotel bookings, meal plans
- **Recce** — schedule per stage, road book / GPX storage, transit logistics
- **Documents** — manual upload of supp regs and bulletins with structured diff between versions; crew acknowledgment tracking
- **Budget** — per-event budget vs actuals; receipt photos; season rollup
- **Safety, licensing, equipment** — expiry tracking with warnings at 6mo / 3mo / 1mo / 1wk for helmets, HANS, suits, harnesses, fuel cells, fire extinguishers, ARA/FIA licenses, medical certificates
- **Live mode** — mobile-first incident logging, service-stop timer + checklist, bulletin feed, crew status board
- **Notifications** — Twilio SMS for critical alerts, weekly email digest

## Status

🚧 **Pre-alpha.** Phase 1 (Foundation: auth, team, events, todos) is shipping. The rest of v1 is on the build plan.

- **PRD:** [PRD.md](PRD.md) — problem statement, 59 user stories, scope decisions
- **Build plan:** [plans/v1-build.md](plans/v1-build.md) — 11 phased vertical slices with acceptance criteria

## Self-host quickstart

### Local development

```bash
# 1. clone and install
git clone https://github.com/Kiasersosa/rally-commander.git
cd rally-commander
npm install

# 2. configure env
cp .env.example .env
# edit .env: set DATABASE_URL, AUTH_SECRET (openssl rand -base64 32),
# RESEND_API_KEY, EMAIL_FROM, and the RC_BOOTSTRAP_* vars

# 3. provision schema and bootstrap the first team + chief
npm run db:push
npm run bootstrap

# 4. run
npm run dev
# → http://localhost:3000
```

### Fly.io

```bash
fly launch --no-deploy            # creates the app
fly postgres create               # separate Postgres cluster
fly postgres attach <pg-app-name> # wires DATABASE_URL into the app
fly secrets set \
  AUTH_SECRET=$(openssl rand -base64 32) \
  AUTH_URL=https://<your-app>.fly.dev \
  RESEND_API_KEY=re_xxx \
  EMAIL_FROM='Rally Commander <noreply@example.com>' \
  RC_BOOTSTRAP_TEAM_NAME='My Rally Team' \
  RC_BOOTSTRAP_CHIEF_EMAIL=chief@example.com \
  RC_BOOTSTRAP_CHIEF_NAME='Crew Chief'
fly deploy
```

The Docker entrypoint runs Drizzle migrations and the bootstrap script on each boot, then starts the Next.js server on port 3000.

## Stack

- Next.js (App Router)
- Postgres
- Fly.io (app + db)
- NextAuth (email magic-link)
- Twilio (SMS)
- PWA (installable, no offline data sync)

## Multi-tenancy

Single-tenant in production. The schema includes `team_id` on every table from day one, so other teams self-host their own copy with full data isolation.

## License

MIT. See [LICENSE](LICENSE).

## Contributing

Not accepting external PRs until Phase 1+2 ship and the architecture stabilizes. Issues and discussion welcome.
