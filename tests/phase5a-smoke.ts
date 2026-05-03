// Phase 5a end-to-end smoke test against a live Postgres.
// Run: npx tsx --env-file=.env tests/phase5a-smoke.ts

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  events,
  hotelBookings,
  itineraryLegAssignees,
  itineraryLegs,
  mealPlanItems,
  teams,
  users,
  vehicles,
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
  console.log("\n=== Phase 5a smoke test ===\n");

  const [team] = await db.insert(teams).values({ name: "P5a Smoke" }).returning();
  const [chief] = await db
    .insert(users)
    .values({ teamId: team.id, email: "chief@p5a.test", name: "Chief", role: "chief" })
    .returning();
  const [mech] = await db
    .insert(users)
    .values({ teamId: team.id, email: "mech@p5a.test", name: "Mech", role: "lead_mechanic" })
    .returning();
  const [gopher] = await db
    .insert(users)
    .values({ teamId: team.id, email: "gopher@p5a.test", name: "Gopher", role: "gopher" })
    .returning();
  const [truck] = await db
    .insert(vehicles)
    .values({ teamId: team.id, type: "service_truck", name: "Service 1" })
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

  // 1. Itinerary leg with assignees
  console.log("[1] itinerary leg + assignees");
  const [leg1] = await db
    .insert(itineraryLegs)
    .values({
      teamId: team.id,
      eventId: evt.id,
      orderIndex: 0,
      fromLocation: "Shop",
      toLocation: "Service park",
      vehicleId: truck.id,
      departAt: new Date("2026-06-12T06:00:00Z"),
      arriveAt: new Date("2026-06-12T18:00:00Z"),
    })
    .returning();
  await db.insert(itineraryLegAssignees).values([
    { teamId: team.id, legId: leg1.id, userId: mech.id },
    { teamId: team.id, legId: leg1.id, userId: gopher.id },
  ]);
  check("leg created with team_id", leg1.teamId === team.id);
  check("leg vehicle_id linked", leg1.vehicleId === truck.id);

  const ass1 = await db
    .select()
    .from(itineraryLegAssignees)
    .where(eq(itineraryLegAssignees.legId, leg1.id));
  check("2 assignees on leg1", ass1.length === 2);

  // 2. "My legs" filter logic — mech should see leg1, chief should not
  console.log("\n[2] my-legs query");
  async function myLegs(userId: string) {
    return db
      .select({ legId: itineraryLegs.id })
      .from(itineraryLegs)
      .innerJoin(
        itineraryLegAssignees,
        eq(itineraryLegAssignees.legId, itineraryLegs.id),
      )
      .where(
        and(
          eq(itineraryLegs.teamId, team.id),
          eq(itineraryLegs.eventId, evt.id),
          eq(itineraryLegAssignees.userId, userId),
        ),
      );
  }
  const mechLegs = await myLegs(mech.id);
  const chiefLegs = await myLegs(chief.id);
  check("mech sees 1 leg", mechLegs.length === 1);
  check("chief sees 0 legs", chiefLegs.length === 0);

  // 3. Reorder legs — add second leg, swap order
  console.log("\n[3] reorder legs");
  const [leg2] = await db
    .insert(itineraryLegs)
    .values({
      teamId: team.id,
      eventId: evt.id,
      orderIndex: 1,
      fromLocation: "Service park",
      toLocation: "Shop",
      vehicleId: truck.id,
    })
    .returning();
  // Swap orderIndex 0<->1
  await db.update(itineraryLegs).set({ orderIndex: 1 }).where(eq(itineraryLegs.id, leg1.id));
  await db.update(itineraryLegs).set({ orderIndex: 0 }).where(eq(itineraryLegs.id, leg2.id));
  const ordered = await db
    .select()
    .from(itineraryLegs)
    .where(and(eq(itineraryLegs.eventId, evt.id), eq(itineraryLegs.teamId, team.id)))
    .orderBy(asc(itineraryLegs.orderIndex));
  check("after swap, leg2 first", ordered[0]?.id === leg2.id);
  check("after swap, leg1 second", ordered[1]?.id === leg1.id);

  // 4. Hotel booking
  console.log("\n[4] hotel booking");
  const [hotel] = await db
    .insert(hotelBookings)
    .values({
      teamId: team.id,
      eventId: evt.id,
      name: "Hotel Olympus",
      address: "100 Main St, Shelton WA",
      confirmationNumber: "ABC123",
      checkInDate: "2026-06-12",
      checkOutDate: "2026-06-15",
      roomAssignments: "Rm 12 — chief+codriver, Rm 14 — mech+gopher",
    })
    .returning();
  check("hotel created", hotel.name === "Hotel Olympus");
  check("hotel team_id", hotel.teamId === team.id);
  check("room assignments stored", hotel.roomAssignments?.includes("Rm 12") === true);

  // 5. Meal plan
  console.log("\n[5] meal plan");
  const [meal] = await db
    .insert(mealPlanItems)
    .values({
      teamId: team.id,
      eventId: evt.id,
      what: "Breakfast: bagels + coffee",
      whereAt: "Service truck",
      whenAt: new Date("2026-06-13T07:00:00Z"),
      assigneeUserId: gopher.id,
    })
    .returning();
  check("meal created", meal.what.includes("Breakfast"));
  check("meal assigned to gopher", meal.assigneeUserId === gopher.id);

  // 6. Cascade on event delete: legs, hotels, meals all gone
  console.log("\n[6] cascade on event delete");
  const [evt2] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Throwaway",
      eventDate: "2026-09-01",
      location: "X",
    })
    .returning();
  const [throwLeg] = await db
    .insert(itineraryLegs)
    .values({
      teamId: team.id,
      eventId: evt2.id,
      orderIndex: 0,
      fromLocation: "A",
      toLocation: "B",
    })
    .returning();
  await db.insert(itineraryLegAssignees).values({
    teamId: team.id,
    legId: throwLeg.id,
    userId: mech.id,
  });
  await db.insert(hotelBookings).values({
    teamId: team.id,
    eventId: evt2.id,
    name: "Throwaway hotel",
  });
  await db.insert(mealPlanItems).values({
    teamId: team.id,
    eventId: evt2.id,
    what: "Throwaway meal",
  });
  await db.delete(events).where(eq(events.id, evt2.id));
  const remainingLegs = await db
    .select()
    .from(itineraryLegs)
    .where(eq(itineraryLegs.eventId, evt2.id));
  const remainingHotels = await db
    .select()
    .from(hotelBookings)
    .where(eq(hotelBookings.eventId, evt2.id));
  const remainingMeals = await db
    .select()
    .from(mealPlanItems)
    .where(eq(mealPlanItems.eventId, evt2.id));
  const remainingAssignees = await db
    .select()
    .from(itineraryLegAssignees)
    .where(eq(itineraryLegAssignees.legId, throwLeg.id));
  check("legs cascade-deleted", remainingLegs.length === 0);
  check("hotels cascade-deleted", remainingHotels.length === 0);
  check("meals cascade-deleted", remainingMeals.length === 0);
  check("leg assignees cascade-deleted", remainingAssignees.length === 0);

  // 7. team_id integrity
  console.log("\n[7] team_id integrity");
  const orphans = await db.execute<{ table_name: string; cnt: number }>(sql`
    SELECT 'itinerary_legs' AS table_name, COUNT(*)::int AS cnt FROM itinerary_legs WHERE team_id IS NULL
    UNION ALL SELECT 'itinerary_leg_assignees', COUNT(*)::int FROM itinerary_leg_assignees WHERE team_id IS NULL
    UNION ALL SELECT 'hotel_bookings', COUNT(*)::int FROM hotel_bookings WHERE team_id IS NULL
    UNION ALL SELECT 'meal_plan_items', COUNT(*)::int FROM meal_plan_items WHERE team_id IS NULL
  `);
  for (const row of orphans) {
    check(`no NULL team_id rows in ${row.table_name}`, Number(row.cnt) === 0);
  }

  // ---- cleanup ----
  console.log("\n[cleanup]");
  await db.execute(sql`TRUNCATE TABLE meal_plan_items, hotel_bookings, itinerary_leg_assignees, itinerary_legs, checklist_signoffs, checklist_instance_items, checklist_instances, checklist_template_items, checklist_templates, work_order_notes, work_orders, vehicles, todos, tire_needs, order_list_items, events, accounts, sessions, verification_tokens, users, teams RESTART IDENTITY CASCADE`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
