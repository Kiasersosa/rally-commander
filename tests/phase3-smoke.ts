// Phase 3 end-to-end smoke test against a live Postgres.
// Run: npx tsx --env-file=.env tests/phase3-smoke.ts

import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  checklistInstanceItems,
  checklistInstances,
  checklistSignoffs,
  checklistTemplateItems,
  checklistTemplates,
  events,
  teams,
  users,
  vehicles,
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
  console.log("\n=== Phase 3 smoke test ===\n");

  const [team] = await db.insert(teams).values({ name: "P3 Smoke" }).returning();
  const [chief] = await db
    .insert(users)
    .values({
      teamId: team.id,
      email: "chief@p3.test",
      name: "Chief",
      role: "chief",
    })
    .returning();
  const [mech] = await db
    .insert(users)
    .values({
      teamId: team.id,
      email: "mech@p3.test",
      name: "Mech",
      role: "lead_mechanic",
    })
    .returning();
  const [car] = await db
    .insert(vehicles)
    .values({
      teamId: team.id,
      type: "rally_car",
      name: "#46 BRZ",
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

  // 1. Author a pre-event template for the rally car with 3 items
  console.log("[1] author template");
  const [tpl] = await db
    .insert(checklistTemplates)
    .values({
      teamId: team.id,
      vehicleId: car.id,
      kind: "pre_event_inspection",
      name: "Pre-event inspection — #46 BRZ",
    })
    .returning();
  await db.insert(checklistTemplateItems).values([
    { teamId: team.id, templateId: tpl.id, orderIndex: 0, label: "Torque lugs to spec" },
    { teamId: team.id, templateId: tpl.id, orderIndex: 1, label: "Check fluid levels" },
    { teamId: team.id, templateId: tpl.id, orderIndex: 2, label: "Verify safety harnesses in date" },
  ]);
  const tplItems = await db
    .select()
    .from(checklistTemplateItems)
    .where(eq(checklistTemplateItems.templateId, tpl.id));
  check("template has 3 items", tplItems.length === 3);

  // 2. Create an event and auto-instantiate checklists
  console.log("\n[2] create event + auto-instantiate");
  const [evt] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Olympus 2026",
      eventDate: "2026-06-14",
      location: "Shelton, WA",
    })
    .returning();
  const result = await instantiateChecklistsForEvent(team.id, evt.id);
  check("instantiate created 1 checklist (only car has a template)", result.created === 1);

  const instances = await db
    .select()
    .from(checklistInstances)
    .where(eq(checklistInstances.eventId, evt.id));
  check("one instance for the event", instances.length === 1);
  check("instance.vehicle_id == car.id", instances[0].vehicleId === car.id);
  check("instance.kind == pre_event_inspection", instances[0].kind === "pre_event_inspection");
  check("instance.source_template_id == template.id", instances[0].sourceTemplateId === tpl.id);

  const inst = instances[0];
  const instItems = await db
    .select()
    .from(checklistInstanceItems)
    .where(eq(checklistInstanceItems.instanceId, inst.id));
  check("3 instance items snapshotted", instItems.length === 3);
  check(
    "instance items preserve labels",
    instItems.every((ii) => tplItems.some((ti) => ti.label === ii.label)),
  );

  // 3. Re-running instantiation is idempotent
  console.log("\n[3] idempotency");
  const result2 = await instantiateChecklistsForEvent(team.id, evt.id);
  check("second instantiate creates 0", result2.created === 0);
  const stillOne = await db
    .select()
    .from(checklistInstances)
    .where(eq(checklistInstances.eventId, evt.id));
  check("still exactly one instance", stillOne.length === 1);

  // 4. Verify ChecklistEngine state for empty signoff set
  console.log("\n[4] empty state");
  let state = await loadChecklistState(team.id, inst.id);
  check("totalItems = 3", state.totalItems === 3);
  check("signedItems = 0", state.signedItems === 0);
  check("percentage = 0", state.percentage === 0);
  check("complete = false", !state.complete);

  // 5. Sign one item
  console.log("\n[5] partial signoff");
  await db.insert(checklistSignoffs).values({
    teamId: team.id,
    instanceItemId: instItems[0].id,
    userId: mech.id,
  });
  state = await loadChecklistState(team.id, inst.id);
  check("signedItems = 1", state.signedItems === 1);
  check("percentage = 33", state.percentage === 33);
  const signed0 = state.items.find((i) => i.item.id === instItems[0].id);
  check("attribution: signed by Mech", signed0?.signoff?.userName === "Mech");

  // 6. Idempotent signoff (one per item — uniqueIndex blocks dup, server uses onConflictDoNothing)
  console.log("\n[6] dup signoff blocked");
  let dupBlocked = false;
  try {
    await db.insert(checklistSignoffs).values({
      teamId: team.id,
      instanceItemId: instItems[0].id,
      userId: chief.id,
    });
  } catch {
    dupBlocked = true;
  }
  check("duplicate signoff rejected by unique index", dupBlocked);

  // 7. Complete the rest
  console.log("\n[7] complete state");
  await db.insert(checklistSignoffs).values([
    { teamId: team.id, instanceItemId: instItems[1].id, userId: chief.id },
    { teamId: team.id, instanceItemId: instItems[2].id, userId: chief.id },
  ]);
  state = await loadChecklistState(team.id, inst.id);
  check("signedItems = 3", state.signedItems === 3);
  check("percentage = 100", state.percentage === 100);
  check("complete = true", state.complete);

  // 8. Cross-team scoping: another team's template doesn't pollute our instantiation
  console.log("\n[8] cross-team scoping");
  const [otherTeam] = await db.insert(teams).values({ name: "Other P3" }).returning();
  const [otherCar] = await db
    .insert(vehicles)
    .values({ teamId: otherTeam.id, type: "rally_car", name: "Other car" })
    .returning();
  await db.insert(checklistTemplates).values({
    teamId: otherTeam.id,
    vehicleId: otherCar.id,
    kind: "pre_event_inspection",
    name: "Their template",
  });
  const result3 = await instantiateChecklistsForEvent(team.id, evt.id);
  check("our team's instantiation ignores other team's template", result3.created === 0);

  // 9. Add the truck a template AFTER the event — manual rebuild picks it up
  console.log("\n[9] manual rebuild after template added");
  const [truckTpl] = await db
    .insert(checklistTemplates)
    .values({
      teamId: team.id,
      vehicleId: truck.id,
      kind: "post_event_teardown",
      name: "Post-event teardown — Service 1",
    })
    .returning();
  await db.insert(checklistTemplateItems).values({
    teamId: team.id,
    templateId: truckTpl.id,
    orderIndex: 0,
    label: "Drain cooler",
  });
  const result4 = await instantiateChecklistsForEvent(team.id, evt.id);
  check("rebuild creates 1 new (truck post-event)", result4.created === 1);

  // 10. team_id integrity
  console.log("\n[10] team_id integrity");
  const orphans = await db.execute<{ table_name: string; cnt: number }>(sql`
    SELECT 'checklist_templates' AS table_name, COUNT(*)::int AS cnt FROM checklist_templates WHERE team_id IS NULL
    UNION ALL SELECT 'checklist_template_items', COUNT(*)::int FROM checklist_template_items WHERE team_id IS NULL
    UNION ALL SELECT 'checklist_instances', COUNT(*)::int FROM checklist_instances WHERE team_id IS NULL
    UNION ALL SELECT 'checklist_instance_items', COUNT(*)::int FROM checklist_instance_items WHERE team_id IS NULL
    UNION ALL SELECT 'checklist_signoffs', COUNT(*)::int FROM checklist_signoffs WHERE team_id IS NULL
  `);
  for (const row of orphans) {
    check(`no NULL team_id rows in ${row.table_name}`, Number(row.cnt) === 0, row);
  }

  // ---- cleanup ----
  console.log("\n[cleanup]");
  await db.execute(sql`TRUNCATE TABLE checklist_signoffs, checklist_instance_items, checklist_instances, checklist_template_items, checklist_templates, work_order_notes, work_orders, vehicles, todos, events, accounts, sessions, verification_tokens, users, teams RESTART IDENTITY CASCADE`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
