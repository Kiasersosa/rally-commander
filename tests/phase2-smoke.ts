// Phase 2 end-to-end smoke test against a live Postgres.
// Run: npx tsx --env-file=.env tests/phase2-smoke.ts
//
// Truncates Phase 1 + 2 tables at the end so the script is re-runnable
// from a fresh bootstrap.

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { teams, users, vehicles, workOrderNotes, workOrders } from "../src/lib/db/schema";
import { nextStatus, statusLabel } from "../src/lib/work-order-lifecycle";

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
  console.log("\n=== Phase 2 smoke test ===\n");

  // Bootstrap a team + chief + mechanic
  const [team] = await db.insert(teams).values({ name: "P2 Smoke" }).returning();
  const [chief] = await db
    .insert(users)
    .values({
      teamId: team.id,
      email: "chief@p2.test",
      name: "Chief",
      role: "chief",
    })
    .returning();
  const [mech] = await db
    .insert(users)
    .values({
      teamId: team.id,
      email: "mech@p2.test",
      name: "Mech",
      role: "lead_mechanic",
    })
    .returning();

  // 1. Register vehicles of each type
  console.log("[1] register vehicles");
  const [car] = await db
    .insert(vehicles)
    .values({
      teamId: team.id,
      type: "rally_car",
      name: "#46 BRZ",
      year: 2018,
      make: "Subaru",
      model: "BRZ",
    })
    .returning();
  const [truck] = await db
    .insert(vehicles)
    .values({
      teamId: team.id,
      type: "service_truck",
      name: "Service 1",
    })
    .returning();
  const [trailer] = await db
    .insert(vehicles)
    .values({
      teamId: team.id,
      type: "trailer",
      name: "Hauler",
    })
    .returning();
  check("rally_car created", car.type === "rally_car");
  check("service_truck created", truck.type === "service_truck");
  check("trailer created", trailer.type === "trailer");
  check("all team_id match", [car, truck, trailer].every((v) => v.teamId === team.id));

  // 2. Open a work order against the rally car, assigned to mech
  console.log("\n[2] open work order");
  const [wo] = await db
    .insert(workOrders)
    .values({
      teamId: team.id,
      vehicleId: car.id,
      title: "Replace front struts",
      description: "Hit a rock at OBR.",
      assigneeUserId: mech.id,
      openedByUserId: chief.id,
    })
    .returning();
  check("WO created with status open", wo.status === "open");
  check("WO assigned to mech", wo.assigneeUserId === mech.id);
  check("WO opened_by chief", wo.openedByUserId === chief.id);
  check("WO closed_at null", wo.closedAt === null);

  // 3. Lifecycle helpers
  console.log("\n[3] lifecycle module");
  check("nextStatus(open) = in_progress", nextStatus("open") === "in_progress");
  check("nextStatus(in_progress) = done", nextStatus("in_progress") === "done");
  check("nextStatus(done) = null", nextStatus("done") === null);
  check("statusLabel maps", statusLabel("in_progress") === "In progress");

  // 4. Transition open → in_progress with a note
  console.log("\n[4] transition + notes");
  await db
    .update(workOrders)
    .set({ status: "in_progress", updatedAt: new Date() })
    .where(eq(workOrders.id, wo.id));
  await db.insert(workOrderNotes).values({
    teamId: team.id,
    workOrderId: wo.id,
    authorUserId: mech.id,
    body: "Parts ordered.",
    statusTo: "in_progress",
  });
  await db.insert(workOrderNotes).values({
    teamId: team.id,
    workOrderId: wo.id,
    authorUserId: mech.id,
    body: "Pulled the strut tower brace, found bent control arm too.",
  });

  const allNotes = await db
    .select()
    .from(workOrderNotes)
    .where(eq(workOrderNotes.workOrderId, wo.id));
  check("two notes recorded", allNotes.length === 2);
  check("status transition note tagged", allNotes.some((n) => n.statusTo === "in_progress"));

  // 5. Close the work order — it should become a maintenance log entry
  console.log("\n[5] close work order (becomes maintenance log)");
  const closeTime = new Date();
  await db
    .update(workOrders)
    .set({
      status: "done",
      closedAt: closeTime,
      closedByUserId: mech.id,
      updatedAt: new Date(),
    })
    .where(eq(workOrders.id, wo.id));
  const [closed] = await db.select().from(workOrders).where(eq(workOrders.id, wo.id)).limit(1);
  check("WO closed_at set", closed.closedAt !== null);
  check("WO closed_by mech", closed.closedByUserId === mech.id);

  // Maintenance log = closed work orders for the vehicle
  const log = await db
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.teamId, team.id),
        eq(workOrders.vehicleId, car.id),
        isNotNull(workOrders.closedAt),
      ),
    );
  check("maintenance log has 1 entry", log.length === 1);

  // 6. Driver report creates a draft WO with stage number
  console.log("\n[6] driver report → draft WO");
  const [drvWo] = await db
    .insert(workOrders)
    .values({
      teamId: team.id,
      vehicleId: car.id,
      title: "[Driver report · stage 4] Brake fade in long downhill",
      description: "Lost pedal feel by end of stage.",
      openedByUserId: chief.id,
      driverReportStageNumber: 4,
    })
    .returning();
  check("driver-report WO has stage #", drvWo.driverReportStageNumber === 4);
  check("driver-report WO is unassigned", drvWo.assigneeUserId === null);
  check("driver-report WO is open", drvWo.status === "open");

  // 7. Open work orders query (vehicle detail page logic)
  console.log("\n[7] open WOs query");
  const openWos = await db
    .select()
    .from(workOrders)
    .where(
      and(
        eq(workOrders.teamId, team.id),
        eq(workOrders.vehicleId, car.id),
        isNull(workOrders.closedAt),
      ),
    );
  check("one open WO on car (driver report only)", openWos.length === 1);
  check("the open one is the driver report", openWos[0]?.id === drvWo.id);

  // 8. team_id integrity across the new tables
  console.log("\n[8] team_id integrity");
  const orphans = await db.execute<{ table_name: string; cnt: number }>(sql`
    SELECT 'vehicles' AS table_name, COUNT(*)::int AS cnt FROM vehicles WHERE team_id IS NULL
    UNION ALL SELECT 'work_orders', COUNT(*)::int FROM work_orders WHERE team_id IS NULL
    UNION ALL SELECT 'work_order_notes', COUNT(*)::int FROM work_order_notes WHERE team_id IS NULL
  `);
  for (const row of orphans) {
    check(`no NULL team_id rows in ${row.table_name}`, Number(row.cnt) === 0, row);
  }

  // 9. Cross-team scoping: another team's WOs shouldn't surface in our query
  console.log("\n[9] cross-team scoping");
  const [otherTeam] = await db.insert(teams).values({ name: "Other P2" }).returning();
  const [otherChief] = await db
    .insert(users)
    .values({
      teamId: otherTeam.id,
      email: "other-chief@p2.test",
      name: "Other Chief",
      role: "chief",
    })
    .returning();
  const [otherCar] = await db
    .insert(vehicles)
    .values({ teamId: otherTeam.id, type: "rally_car", name: "Other Car" })
    .returning();
  await db.insert(workOrders).values({
    teamId: otherTeam.id,
    vehicleId: otherCar.id,
    title: "Other team WO",
    openedByUserId: otherChief.id,
  });
  const ourWos = await db
    .select()
    .from(workOrders)
    .where(eq(workOrders.teamId, team.id));
  check("our team WO query does not leak", ourWos.every((w) => w.teamId === team.id));
  check("our team has 2 WOs (closed + driver report)", ourWos.length === 2);

  // ---- cleanup ----
  console.log("\n[cleanup]");
  await db.execute(sql`TRUNCATE TABLE work_order_notes, work_orders, vehicles, todos, events, accounts, sessions, verification_tokens, users, teams RESTART IDENTITY CASCADE`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
