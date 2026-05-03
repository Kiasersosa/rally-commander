// Phase 4 end-to-end smoke test against a live Postgres.
// Run: npx tsx --env-file=.env tests/phase4-smoke.ts

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  checklistInstanceItems,
  checklistInstances,
  checklistSignoffs,
  checklistTemplateItems,
  checklistTemplates,
  events,
  orderListItems,
  teams,
  tireNeeds,
  users,
  vehicles,
  workOrders,
} from "../src/lib/db/schema";
import { instantiateChecklistsForEvent, loadChecklistState } from "../src/lib/checklists";

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
  console.log("\n=== Phase 4 smoke test ===\n");

  const [team] = await db.insert(teams).values({ name: "P4 Smoke" }).returning();
  const [chief] = await db
    .insert(users)
    .values({ teamId: team.id, email: "chief@p4.test", name: "Chief", role: "chief" })
    .returning();
  const [car] = await db
    .insert(vehicles)
    .values({ teamId: team.id, type: "rally_car", name: "#46 BRZ" })
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

  // 1. Order list — add manual item
  console.log("[1] order list");
  const [item1] = await db
    .insert(orderListItems)
    .values({
      teamId: team.id,
      eventId: evt1.id,
      title: "Front strut pair",
      qty: 2,
    })
    .returning();
  check("order item created with default status 'needed'", item1.status === "needed");
  check("order item team_id matches", item1.teamId === team.id);

  // 1b. Order list — link to work order
  const [wo] = await db
    .insert(workOrders)
    .values({
      teamId: team.id,
      vehicleId: car.id,
      title: "Replace front struts",
      openedByUserId: chief.id,
    })
    .returning();
  const [item2] = await db
    .insert(orderListItems)
    .values({
      teamId: team.id,
      eventId: evt1.id,
      title: "Lower control arm",
      workOrderId: wo.id,
    })
    .returning();
  check("order item linked to WO", item2.workOrderId === wo.id);

  // 1c. Status transitions: needed -> ordered -> received -> packed
  console.log("\n[2] order list status flow");
  for (const status of ["ordered", "received", "packed"] as const) {
    await db
      .update(orderListItems)
      .set({ status, updatedAt: new Date() })
      .where(eq(orderListItems.id, item1.id));
    const [refreshed] = await db
      .select({ status: orderListItems.status })
      .from(orderListItems)
      .where(eq(orderListItems.id, item1.id));
    check(`item1 → ${status}`, refreshed.status === status);
  }

  // 2. Tires
  console.log("\n[3] tire needs");
  const [tire] = await db
    .insert(tireNeeds)
    .values({
      teamId: team.id,
      eventId: evt1.id,
      compound: "DMACK Gravel Hard",
      count: 8,
    })
    .returning();
  check("tire need created", tire.compound === "DMACK Gravel Hard" && tire.count === 8);
  check("tire need not yet ordered/received", tire.orderedAt === null && tire.receivedAt === null);

  await db
    .update(tireNeeds)
    .set({ orderedAt: new Date(), updatedAt: new Date() })
    .where(eq(tireNeeds.id, tire.id));
  const [tireOrdered] = await db.select().from(tireNeeds).where(eq(tireNeeds.id, tire.id));
  check("tire ordered_at set", tireOrdered.orderedAt !== null);
  check("tire received_at still null", tireOrdered.receivedAt === null);

  // 3. Packing kind enum + auto-instantiation via template
  console.log("\n[4] packing template + auto-instantiation");
  const [packTpl] = await db
    .insert(checklistTemplates)
    .values({
      teamId: team.id,
      vehicleId: car.id,
      kind: "packing",
      name: "Packing — #46 BRZ",
    })
    .returning();
  await db.insert(checklistTemplateItems).values([
    { teamId: team.id, templateId: packTpl.id, orderIndex: 0, label: "ECU laptop" },
    { teamId: team.id, templateId: packTpl.id, orderIndex: 1, label: "Helmet bag" },
    { teamId: team.id, templateId: packTpl.id, orderIndex: 2, label: "Spare wheel set" },
  ]);
  const result = await instantiateChecklistsForEvent(team.id, evt1.id);
  check("packing instance created (and only packing — no other tpl exists)", result.created === 1);
  const [packInst1] = await db
    .select()
    .from(checklistInstances)
    .where(
      and(
        eq(checklistInstances.eventId, evt1.id),
        eq(checklistInstances.kind, "packing"),
      ),
    );
  check("packing instance has source_template_id", packInst1.sourceTemplateId === packTpl.id);

  // 4. Sign one of three packing items — verify ready-to-ship math
  console.log("\n[5] ready-to-ship %");
  const items1 = await db
    .select()
    .from(checklistInstanceItems)
    .where(eq(checklistInstanceItems.instanceId, packInst1.id))
    .orderBy(asc(checklistInstanceItems.orderIndex));
  await db.insert(checklistSignoffs).values({
    teamId: team.id,
    instanceItemId: items1[0].id,
    userId: chief.id,
  });
  const state = await loadChecklistState(team.id, packInst1.id);
  check("packing state: 1 of 3 signed", state.signedItems === 1 && state.totalItems === 3);
  check("packing % = 33", state.percentage === 33);

  // 5. Second event + copy-from-prior-event flow
  console.log("\n[6] copy from prior event");
  const [evt2] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Susquehannock 2026",
      eventDate: "2026-08-22",
      location: "PA",
    })
    .returning();
  // Auto-instantiate creates a new packing instance from the template (3 items).
  await instantiateChecklistsForEvent(team.id, evt2.id);
  const [packInst2] = await db
    .select()
    .from(checklistInstances)
    .where(
      and(
        eq(checklistInstances.eventId, evt2.id),
        eq(checklistInstances.kind, "packing"),
      ),
    );
  check("evt2 has its own packing instance", packInst2 && packInst2.id !== packInst1.id);

  // Add an ad-hoc item to evt1's packing instance ("Tire pressure gauge")
  await db.insert(checklistInstanceItems).values({
    teamId: team.id,
    instanceId: packInst1.id,
    orderIndex: 99,
    label: "Tire pressure gauge",
  });

  // Now run "copy from prior event" on evt2's packing instance — it should
  // pick up "Tire pressure gauge" (label not already in evt2 instance items).
  const [prior] = await db
    .select({ id: checklistInstances.id })
    .from(checklistInstances)
    .innerJoin(events, eq(events.id, checklistInstances.eventId))
    .where(
      and(
        eq(checklistInstances.teamId, team.id),
        eq(checklistInstances.vehicleId, car.id),
        eq(checklistInstances.kind, "packing"),
        ne(checklistInstances.eventId, evt2.id),
      ),
    )
    .orderBy(desc(events.eventDate), desc(checklistInstances.createdAt))
    .limit(1);
  check("prior packing instance found", prior?.id === packInst1.id);

  const priorItems = await db
    .select({
      label: checklistInstanceItems.label,
      description: checklistInstanceItems.description,
    })
    .from(checklistInstanceItems)
    .where(eq(checklistInstanceItems.instanceId, prior!.id));
  const evt2Items = await db
    .select({ label: checklistInstanceItems.label })
    .from(checklistInstanceItems)
    .where(eq(checklistInstanceItems.instanceId, packInst2.id));
  const have = new Set(evt2Items.map((i) => i.label));
  const [{ maxOrder }] = await db
    .select({
      maxOrder: sql<number>`COALESCE(MAX(${checklistInstanceItems.orderIndex}), -1)::int`,
    })
    .from(checklistInstanceItems)
    .where(eq(checklistInstanceItems.instanceId, packInst2.id));
  let next = (Number(maxOrder) ?? -1) + 1;
  const toInsert = priorItems
    .filter((i) => !have.has(i.label))
    .map((i) => ({
      teamId: team.id,
      instanceId: packInst2.id,
      orderIndex: next++,
      label: i.label,
      description: i.description,
    }));
  if (toInsert.length > 0) {
    await db.insert(checklistInstanceItems).values(toInsert);
  }
  check("copy added exactly 1 item (tire pressure gauge)", toInsert.length === 1);
  check("copied item is the gauge", toInsert[0]?.label === "Tire pressure gauge");

  const evt2After = await db
    .select()
    .from(checklistInstanceItems)
    .where(eq(checklistInstanceItems.instanceId, packInst2.id));
  check("evt2 packing now has 4 items (3 from template + 1 copied)", evt2After.length === 4);

  // 6. Re-run copy — already-present items skipped
  console.log("\n[7] copy idempotency");
  const evt2Items2 = await db
    .select({ label: checklistInstanceItems.label })
    .from(checklistInstanceItems)
    .where(eq(checklistInstanceItems.instanceId, packInst2.id));
  const have2 = new Set(evt2Items2.map((i) => i.label));
  const toInsert2 = priorItems.filter((i) => !have2.has(i.label));
  check("second copy run finds 0 missing items", toInsert2.length === 0);

  // 7. team_id integrity
  console.log("\n[8] team_id integrity");
  const orphans = await db.execute<{ table_name: string; cnt: number }>(sql`
    SELECT 'order_list_items' AS table_name, COUNT(*)::int AS cnt FROM order_list_items WHERE team_id IS NULL
    UNION ALL SELECT 'tire_needs', COUNT(*)::int FROM tire_needs WHERE team_id IS NULL
  `);
  for (const row of orphans) {
    check(`no NULL team_id rows in ${row.table_name}`, Number(row.cnt) === 0);
  }

  // ---- cleanup ----
  console.log("\n[cleanup]");
  await db.execute(sql`TRUNCATE TABLE checklist_signoffs, checklist_instance_items, checklist_instances, checklist_template_items, checklist_templates, work_order_notes, work_orders, vehicles, todos, tire_needs, order_list_items, events, accounts, sessions, verification_tokens, users, teams RESTART IDENTITY CASCADE`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
