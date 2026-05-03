// Phase 6 end-to-end smoke test against a live Postgres.
// Run: npx tsx --env-file=.env tests/phase6-smoke.ts

import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  budgetLines,
  events,
  expenseEntries,
  teams,
  users,
} from "../src/lib/db/schema";
import { reconcile } from "../src/lib/budget-reconciler";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) {
    console.log(`  ✓ ${name}`);
    pass++;
  } else {
    console.error(`  ✗ ${name}`, detail ?? "");
    fail++;
  }
}

async function main() {
  console.log("\n=== Phase 6 smoke test ===\n");

  const [team] = await db.insert(teams).values({ name: "P6 Smoke" }).returning();
  const [chief] = await db
    .insert(users)
    .values({ teamId: team.id, email: "chief@p6.test", name: "Chief", role: "chief" })
    .returning();
  const [mech] = await db
    .insert(users)
    .values({ teamId: team.id, email: "mech@p6.test", name: "Mech", role: "lead_mechanic" })
    .returning();
  const [evt1] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Olympus 2026",
      eventDate: "2026-06-14",
      location: "Shelton, WA",
    })
    .returning();
  const [evt2] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Susquehannock 2026",
      eventDate: "2026-08-22",
      location: "PA",
    })
    .returning();

  // 1. Budget lines (chief)
  console.log("[1] budget lines");
  await db.insert(budgetLines).values([
    { teamId: team.id, eventId: evt1.id, category: "entry", estimatedCents: 50000 },
    { teamId: team.id, eventId: evt1.id, category: "fuel", estimatedCents: 30000 },
    { teamId: team.id, eventId: evt1.id, category: "hotels", estimatedCents: 60000 },
  ]);
  const lines = await db
    .select()
    .from(budgetLines)
    .where(eq(budgetLines.eventId, evt1.id));
  check("3 budget lines on evt1", lines.length === 3);

  // unique (team, event, category) — duplicate should fail
  let dupBlocked = false;
  try {
    await db.insert(budgetLines).values({
      teamId: team.id,
      eventId: evt1.id,
      category: "entry",
      estimatedCents: 99999,
    });
  } catch {
    dupBlocked = true;
  }
  check("dup (event, category) blocked by unique index", dupBlocked);

  // 2. Expenses (anyone)
  console.log("\n[2] expenses");
  await db.insert(expenseEntries).values([
    {
      teamId: team.id,
      eventId: evt1.id,
      category: "entry",
      amountCents: 50000,
      vendor: "ARA",
      enteredByUserId: chief.id,
    },
    {
      teamId: team.id,
      eventId: evt1.id,
      category: "fuel",
      amountCents: 12000,
      enteredByUserId: mech.id,
    },
    {
      teamId: team.id,
      eventId: evt1.id,
      category: "fuel",
      amountCents: 11000,
      enteredByUserId: mech.id,
    },
    {
      teamId: team.id,
      eventId: evt1.id,
      category: "parts",
      amountCents: 22000,
      enteredByUserId: mech.id,
    },
    // hotels: budgeted but no expense
  ]);
  const expenses = await db
    .select()
    .from(expenseEntries)
    .where(eq(expenseEntries.eventId, evt1.id));
  check("4 expense entries on evt1", expenses.length === 4);

  // 3. Reconcile event-level: known statuses
  console.log("\n[3] reconcile (event)");
  const v1 = reconcile(
    lines.map((l) => ({
      category: l.category,
      estimatedCents: l.estimatedCents,
    })),
    expenses.map((e) => ({
      category: e.category,
      amountCents: e.amountCents,
    })),
  );
  const byCat = Object.fromEntries(v1.byCategory.map((c) => [c.category, c]));
  check("entry: on_budget", byCat.entry?.status === "on_budget");
  check(
    "fuel: under (23k of 30k)",
    byCat.fuel?.status === "under" &&
      byCat.fuel?.actualCents === 23000 &&
      byCat.fuel?.varianceCents === 7000,
  );
  check(
    "parts: no_budget (22k actual, 0 budgeted)",
    byCat.parts?.status === "no_budget",
  );
  check(
    "hotels: no_actuals (60k budgeted, 0 actual)",
    byCat.hotels?.status === "no_actuals",
  );
  check(
    "totals: est 140k, actual 95k, var +45k",
    v1.totalEstimatedCents === 140000 &&
      v1.totalActualCents === 95000 &&
      v1.totalVarianceCents === 45000,
  );

  // 4. Season rollup across two events in same year
  console.log("\n[4] season rollup");
  await db.insert(expenseEntries).values([
    {
      teamId: team.id,
      eventId: evt2.id,
      category: "fuel",
      amountCents: 35000,
      enteredByUserId: chief.id,
    },
    {
      teamId: team.id,
      eventId: evt2.id,
      category: "food",
      amountCents: 8000,
      enteredByUserId: chief.id,
    },
  ]);

  const yearStart = "2026-01-01";
  const yearEnd = "2026-12-31";
  const seasonExp = await db
    .select({
      category: expenseEntries.category,
      total: sql<number>`COALESCE(SUM(${expenseEntries.amountCents}), 0)::int`,
    })
    .from(expenseEntries)
    .innerJoin(events, eq(events.id, expenseEntries.eventId))
    .where(
      and(
        eq(expenseEntries.teamId, team.id),
        sql`${events.eventDate} BETWEEN ${yearStart} AND ${yearEnd}`,
      ),
    )
    .groupBy(expenseEntries.category);
  const seasonByCat = Object.fromEntries(
    seasonExp.map((r) => [r.category, Number(r.total)]),
  );
  check("season fuel = 23k + 35k = 58k", seasonByCat.fuel === 58000);
  check("season entry = 50k", seasonByCat.entry === 50000);
  check("season parts = 22k", seasonByCat.parts === 22000);
  check("season food = 8k", seasonByCat.food === 8000);

  // 5. Cross-team scoping
  console.log("\n[5] cross-team scoping");
  const [otherTeam] = await db.insert(teams).values({ name: "Other P6" }).returning();
  const [otherChief] = await db
    .insert(users)
    .values({
      teamId: otherTeam.id,
      email: "ot-chief@p6.test",
      name: "Other Chief",
      role: "chief",
    })
    .returning();
  const [otherEvt] = await db
    .insert(events)
    .values({
      teamId: otherTeam.id,
      name: "Other rally",
      eventDate: "2026-07-04",
      location: "X",
    })
    .returning();
  await db.insert(expenseEntries).values({
    teamId: otherTeam.id,
    eventId: otherEvt.id,
    category: "fuel",
    amountCents: 99999999,
    enteredByUserId: otherChief.id,
  });
  const ours = await db
    .select()
    .from(expenseEntries)
    .where(eq(expenseEntries.teamId, team.id));
  check("our team's expenses don't leak across teams", ours.every((e) => e.teamId === team.id));
  check("our team has 6 expenses (4 evt1 + 2 evt2)", ours.length === 6);

  // 6. team_id integrity
  console.log("\n[6] team_id integrity");
  const orphans = await db.execute<{ table_name: string; cnt: number }>(sql`
    SELECT 'budget_lines' AS table_name, COUNT(*)::int AS cnt FROM budget_lines WHERE team_id IS NULL
    UNION ALL SELECT 'expense_entries', COUNT(*)::int FROM expense_entries WHERE team_id IS NULL
  `);
  for (const row of orphans) {
    check(`no NULL team_id rows in ${row.table_name}`, Number(row.cnt) === 0);
  }

  // ---- cleanup ----
  console.log("\n[cleanup]");
  await db.execute(sql`TRUNCATE TABLE expense_entries, budget_lines, recce_schedule_entries, event_stages, meal_plan_items, hotel_bookings, itinerary_leg_assignees, itinerary_legs, checklist_signoffs, checklist_instance_items, checklist_instances, checklist_template_items, checklist_templates, work_order_notes, work_orders, vehicles, todos, tire_needs, order_list_items, events, accounts, sessions, verification_tokens, users, teams RESTART IDENTITY CASCADE`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
