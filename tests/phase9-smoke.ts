// Phase 9 end-to-end smoke test against a live Postgres.
// Run: npx tsx --env-file=.env tests/phase9-smoke.ts

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  crewStatusEntries,
  events,
  incidents,
  serviceStopItems,
  serviceStops,
  teams,
  users,
  vehicles,
  workOrders,
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
  console.log("\n=== Phase 9 smoke test ===\n");

  const [team] = await db.insert(teams).values({ name: "P9 Smoke" }).returning();
  const [chief] = await db
    .insert(users)
    .values({ teamId: team.id, email: "chief@p9.test", name: "Chief", role: "chief" })
    .returning();
  const [driver] = await db
    .insert(users)
    .values({ teamId: team.id, email: "drv@p9.test", name: "Driver D", role: "driver" })
    .returning();
  const [mech] = await db
    .insert(users)
    .values({ teamId: team.id, email: "mech@p9.test", name: "Mech", role: "lead_mechanic" })
    .returning();
  const [car] = await db
    .insert(vehicles)
    .values({ teamId: team.id, type: "rally_car", name: "#46 BRZ" })
    .returning();
  const [evt] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Olympus 2026",
      eventDate: "2026-06-14",
      location: "Shelton, WA",
      phase: "on_event",
    })
    .returning();

  // 1. Incident without WO
  console.log("[1] incident without WO");
  const [inc1] = await db
    .insert(incidents)
    .values({
      teamId: team.id,
      eventId: evt.id,
      vehicleId: car.id,
      stageNumber: 4,
      note: "Brake fade in long downhill",
      reportedByUserId: driver.id,
    })
    .returning();
  check("incident created", inc1.note.includes("Brake fade"));
  check("no WO linked", inc1.workOrderId === null);

  // 2. Incident WITH auto-WO
  console.log("\n[2] incident with auto WO");
  const [autoWo] = await db
    .insert(workOrders)
    .values({
      teamId: team.id,
      vehicleId: car.id,
      title: "[Incident · stage 5] Lost intercom",
      description: "Co-driver intercom died on stage 5",
      openedByUserId: driver.id,
      driverReportStageNumber: 5,
      eventId: evt.id,
    })
    .returning();
  const [inc2] = await db
    .insert(incidents)
    .values({
      teamId: team.id,
      eventId: evt.id,
      vehicleId: car.id,
      stageNumber: 5,
      note: "Co-driver intercom died on stage 5",
      reportedByUserId: driver.id,
      workOrderId: autoWo.id,
    })
    .returning();
  check("incident links to WO", inc2.workOrderId === autoWo.id);
  check("WO has stage number", autoWo.driverReportStageNumber === 5);
  check("WO is open status", autoWo.status === "open");

  // 3. Service stop start + timer math
  console.log("\n[3] service stop");
  const stopStart = new Date("2026-06-14T13:00:00Z");
  const [stop] = await db
    .insert(serviceStops)
    .values({
      teamId: team.id,
      eventId: evt.id,
      name: "Service A",
      plannedDurationSeconds: 1800,
      startedAt: stopStart,
      startedByUserId: chief.id,
    })
    .returning();
  check("service stop started, no end", stop.endedAt === null);
  check("planned 30 min", stop.plannedDurationSeconds === 1800);

  // Active stop query (no endedAt)
  const [active] = await db
    .select()
    .from(serviceStops)
    .where(
      and(
        eq(serviceStops.teamId, team.id),
        eq(serviceStops.eventId, evt.id),
        isNull(serviceStops.endedAt),
      ),
    )
    .orderBy(desc(serviceStops.startedAt))
    .limit(1);
  check("active stop query returns it", active?.id === stop.id);

  // 4. Service stop items + sign-off
  console.log("\n[4] stop items");
  await db.insert(serviceStopItems).values([
    {
      teamId: team.id,
      serviceStopId: stop.id,
      orderIndex: 0,
      label: "Refuel rally car",
    },
    {
      teamId: team.id,
      serviceStopId: stop.id,
      orderIndex: 1,
      label: "Tire pressure check",
    },
  ]);
  const items = await db
    .select()
    .from(serviceStopItems)
    .where(eq(serviceStopItems.serviceStopId, stop.id))
    .orderBy(asc(serviceStopItems.orderIndex));
  check("2 items created", items.length === 2);

  await db
    .update(serviceStopItems)
    .set({ completedAt: new Date(), completedByUserId: mech.id })
    .where(eq(serviceStopItems.id, items[0].id));
  const [refreshed] = await db
    .select()
    .from(serviceStopItems)
    .where(eq(serviceStopItems.id, items[0].id));
  check("item 0 completed_at set", refreshed.completedAt !== null);
  check("item 0 completed_by mech", refreshed.completedByUserId === mech.id);

  // 5. End service stop
  console.log("\n[5] end stop");
  await db
    .update(serviceStops)
    .set({ endedAt: new Date() })
    .where(eq(serviceStops.id, stop.id));
  const [ended] = await db.select().from(serviceStops).where(eq(serviceStops.id, stop.id));
  check("end timestamp set", ended.endedAt !== null);
  const [activeAfter] = await db
    .select()
    .from(serviceStops)
    .where(
      and(
        eq(serviceStops.teamId, team.id),
        eq(serviceStops.eventId, evt.id),
        isNull(serviceStops.endedAt),
      ),
    );
  check("no active stops after end", activeAfter === undefined);

  // 6. Crew status — upsert semantics (one row per (event, user))
  console.log("\n[6] crew status upsert");
  await db
    .insert(crewStatusEntries)
    .values({
      teamId: team.id,
      eventId: evt.id,
      userId: mech.id,
      status: "at_service",
    })
    .onConflictDoUpdate({
      target: [crewStatusEntries.eventId, crewStatusEntries.userId],
      set: { status: "at_service", updatedAt: new Date() },
    });

  // Update mech's status
  await db
    .insert(crewStatusEntries)
    .values({
      teamId: team.id,
      eventId: evt.id,
      userId: mech.id,
      status: "parts_run",
      notes: "Parts run, ETA 15 min",
    })
    .onConflictDoUpdate({
      target: [crewStatusEntries.eventId, crewStatusEntries.userId],
      set: { status: "parts_run", notes: "Parts run, ETA 15 min", updatedAt: new Date() },
    });

  const allMechStatus = await db
    .select()
    .from(crewStatusEntries)
    .where(eq(crewStatusEntries.userId, mech.id));
  check("upsert produced exactly 1 row", allMechStatus.length === 1);
  check("status updated to parts_run", allMechStatus[0].status === "parts_run");

  // 7. Cross-event isolation: chief on a different event has independent status
  console.log("\n[7] cross-event status isolation");
  const [evt2] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Susquehannock 2026",
      eventDate: "2026-08-22",
      location: "PA",
    })
    .returning();
  await db.insert(crewStatusEntries).values({
    teamId: team.id,
    eventId: evt2.id,
    userId: mech.id,
    status: "hotel",
  });
  const evt1Status = await db
    .select()
    .from(crewStatusEntries)
    .where(
      and(
        eq(crewStatusEntries.userId, mech.id),
        eq(crewStatusEntries.eventId, evt.id),
      ),
    );
  const evt2Status = await db
    .select()
    .from(crewStatusEntries)
    .where(
      and(
        eq(crewStatusEntries.userId, mech.id),
        eq(crewStatusEntries.eventId, evt2.id),
      ),
    );
  check("evt1 status still parts_run", evt1Status[0]?.status === "parts_run");
  check("evt2 status hotel", evt2Status[0]?.status === "hotel");

  // 8. Cascade: deleting event removes incidents, stops, status entries
  console.log("\n[8] event cascade");
  await db.delete(events).where(eq(events.id, evt2.id));
  const remStatus = await db
    .select()
    .from(crewStatusEntries)
    .where(eq(crewStatusEntries.eventId, evt2.id));
  check("evt2 status cascade-deleted", remStatus.length === 0);

  // 9. team_id integrity
  console.log("\n[9] team_id integrity");
  const orphans = await db.execute<{ table_name: string; cnt: number }>(sql`
    SELECT 'incidents' AS table_name, COUNT(*)::int AS cnt FROM incidents WHERE team_id IS NULL
    UNION ALL SELECT 'service_stops', COUNT(*)::int FROM service_stops WHERE team_id IS NULL
    UNION ALL SELECT 'service_stop_items', COUNT(*)::int FROM service_stop_items WHERE team_id IS NULL
    UNION ALL SELECT 'crew_status_entries', COUNT(*)::int FROM crew_status_entries WHERE team_id IS NULL
  `);
  for (const row of orphans) {
    check(`no NULL team_id rows in ${row.table_name}`, Number(row.cnt) === 0);
  }

  // ---- cleanup ----
  console.log("\n[cleanup]");
  await db.execute(sql`TRUNCATE TABLE crew_status_entries, service_stop_items, service_stops, incidents, equipment_items, license_docs, safety_items, document_acknowledgments, document_versions, documents, expense_entries, budget_lines, recce_schedule_entries, event_stages, meal_plan_items, hotel_bookings, itinerary_leg_assignees, itinerary_legs, checklist_signoffs, checklist_instance_items, checklist_instances, checklist_template_items, checklist_templates, work_order_notes, work_orders, vehicles, todos, tire_needs, order_list_items, events, accounts, sessions, verification_tokens, users, teams RESTART IDENTITY CASCADE`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
