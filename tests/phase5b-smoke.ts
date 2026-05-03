// Phase 5b end-to-end smoke test against a live Postgres.
// Run: npx tsx --env-file=.env tests/phase5b-smoke.ts

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  events,
  eventStages,
  recceScheduleEntries,
  teams,
  users,
} from "../src/lib/db/schema";

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
  console.log("\n=== Phase 5b smoke test ===\n");

  const [team] = await db.insert(teams).values({ name: "P5b Smoke" }).returning();
  const [chief] = await db
    .insert(users)
    .values({ teamId: team.id, email: "chief@p5b.test", name: "Chief", role: "chief" })
    .returning();
  const [driver] = await db
    .insert(users)
    .values({ teamId: team.id, email: "drv@p5b.test", name: "Driver D", role: "driver" })
    .returning();
  const [codriver] = await db
    .insert(users)
    .values({
      teamId: team.id,
      email: "co@p5b.test",
      name: "CoDriver C",
      role: "co_driver",
    })
    .returning();
  const [evt] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Olympus 2026",
      eventDate: "2026-06-14",
      location: "Shelton, WA",
    })
    .returning();

  // 1. Define stages
  console.log("[1] stages");
  const [s1] = await db
    .insert(eventStages)
    .values({ teamId: team.id, eventId: evt.id, stageNumber: 1, name: "Lulu" })
    .returning();
  const [s2] = await db
    .insert(eventStages)
    .values({ teamId: team.id, eventId: evt.id, stageNumber: 2, name: "Cougar Mtn" })
    .returning();
  check("stage 1 created", s1.stageNumber === 1);
  check("stage 2 created", s2.stageNumber === 2);

  // Unique constraint: same (team, event, stage_number) should fail
  let dupBlocked = false;
  try {
    await db.insert(eventStages).values({
      teamId: team.id,
      eventId: evt.id,
      stageNumber: 1,
      name: "dup",
    });
  } catch {
    dupBlocked = true;
  }
  check("dup stage_number rejected by unique index", dupBlocked);

  // 2. Recce schedule entries (driver/codriver pair, day, pass#)
  console.log("\n[2] recce schedule entries");
  const [e1] = await db
    .insert(recceScheduleEntries)
    .values({
      teamId: team.id,
      eventId: evt.id,
      stageId: s1.id,
      day: "2026-06-13",
      passNumber: 1,
      driverUserId: driver.id,
      coDriverUserId: codriver.id,
      notes: "Wet — go slow on tight twisties",
    })
    .returning();
  check("recce entry created", e1.passNumber === 1);
  check("driver attribution", e1.driverUserId === driver.id);
  check("codriver attribution", e1.coDriverUserId === codriver.id);

  await db.insert(recceScheduleEntries).values({
    teamId: team.id,
    eventId: evt.id,
    stageId: s1.id,
    day: "2026-06-13",
    passNumber: 2,
    driverUserId: driver.id,
    coDriverUserId: codriver.id,
  });
  await db.insert(recceScheduleEntries).values({
    teamId: team.id,
    eventId: evt.id,
    stageId: s2.id,
    day: "2026-06-13",
    passNumber: 1,
    driverUserId: driver.id,
    coDriverUserId: codriver.id,
  });
  const all = await db
    .select()
    .from(recceScheduleEntries)
    .where(eq(recceScheduleEntries.eventId, evt.id))
    .orderBy(
      asc(recceScheduleEntries.day),
      asc(recceScheduleEntries.passNumber),
    );
  check("3 entries total", all.length === 3);

  // 3. Chronological ordering (by day, stage_number, pass_number)
  console.log("\n[3] chronological ordering");
  const ordered = await db
    .select({
      day: recceScheduleEntries.day,
      stageNumber: eventStages.stageNumber,
      passNumber: recceScheduleEntries.passNumber,
    })
    .from(recceScheduleEntries)
    .innerJoin(eventStages, eq(eventStages.id, recceScheduleEntries.stageId))
    .where(eq(recceScheduleEntries.eventId, evt.id))
    .orderBy(
      asc(recceScheduleEntries.day),
      asc(eventStages.stageNumber),
      asc(recceScheduleEntries.passNumber),
    );
  check(
    "ordered: ss1 pass1, ss1 pass2, ss2 pass1",
    ordered[0]?.stageNumber === 1 &&
      ordered[0]?.passNumber === 1 &&
      ordered[1]?.stageNumber === 1 &&
      ordered[1]?.passNumber === 2 &&
      ordered[2]?.stageNumber === 2 &&
      ordered[2]?.passNumber === 1,
  );

  // 4. Logistics notes on the event row
  console.log("\n[4] logistics notes");
  await db
    .update(events)
    .set({
      recceLogisticsNotes: "Fuel in town. Lunch at Olympia diner.",
      updatedAt: new Date(),
    })
    .where(eq(events.id, evt.id));
  const [refreshed] = await db.select().from(events).where(eq(events.id, evt.id));
  check(
    "recceLogisticsNotes persisted",
    refreshed.recceLogisticsNotes?.includes("Fuel in town") === true,
  );

  // 5. Cascade: deleting a stage should cascade-delete its recce entries
  console.log("\n[5] stage cascade");
  await db.delete(eventStages).where(eq(eventStages.id, s1.id));
  const remaining = await db
    .select()
    .from(recceScheduleEntries)
    .where(eq(recceScheduleEntries.stageId, s1.id));
  check("recce entries for deleted stage are gone", remaining.length === 0);
  const stillThere = await db
    .select()
    .from(recceScheduleEntries)
    .where(eq(recceScheduleEntries.eventId, evt.id));
  check("entries for other stages still present", stillThere.length === 1);

  // 6. Cascade on event delete
  console.log("\n[6] event cascade");
  const [evt2] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Throwaway",
      eventDate: "2026-09-01",
      location: "X",
    })
    .returning();
  const [throwStage] = await db
    .insert(eventStages)
    .values({
      teamId: team.id,
      eventId: evt2.id,
      stageNumber: 1,
      name: "trash",
    })
    .returning();
  await db.insert(recceScheduleEntries).values({
    teamId: team.id,
    eventId: evt2.id,
    stageId: throwStage.id,
    passNumber: 1,
  });
  await db.delete(events).where(eq(events.id, evt2.id));
  const remStages = await db
    .select()
    .from(eventStages)
    .where(eq(eventStages.eventId, evt2.id));
  const remEntries = await db
    .select()
    .from(recceScheduleEntries)
    .where(eq(recceScheduleEntries.eventId, evt2.id));
  check("stages cascade-deleted", remStages.length === 0);
  check("recce entries cascade-deleted", remEntries.length === 0);

  // 7. team_id integrity
  console.log("\n[7] team_id integrity");
  const orphans = await db.execute<{ table_name: string; cnt: number }>(sql`
    SELECT 'event_stages' AS table_name, COUNT(*)::int AS cnt FROM event_stages WHERE team_id IS NULL
    UNION ALL SELECT 'recce_schedule_entries', COUNT(*)::int FROM recce_schedule_entries WHERE team_id IS NULL
  `);
  for (const row of orphans) {
    check(`no NULL team_id rows in ${row.table_name}`, Number(row.cnt) === 0);
  }

  // ---- cleanup ----
  console.log("\n[cleanup]");
  await db.execute(sql`TRUNCATE TABLE recce_schedule_entries, event_stages, meal_plan_items, hotel_bookings, itinerary_leg_assignees, itinerary_legs, checklist_signoffs, checklist_instance_items, checklist_instances, checklist_template_items, checklist_templates, work_order_notes, work_orders, vehicles, todos, tire_needs, order_list_items, events, accounts, sessions, verification_tokens, users, teams RESTART IDENTITY CASCADE`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
