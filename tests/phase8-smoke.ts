// Phase 8 end-to-end smoke test against a live Postgres.
// Run: npx tsx --env-file=.env tests/phase8-smoke.ts

import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  equipmentItems,
  events,
  licenseDocs,
  safetyItems,
  teams,
  users,
} from "../src/lib/db/schema";
import {
  ATTENTION_BANDS,
  bandFor,
  deriveWarnings,
} from "../src/lib/safety-expiry-warner";

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
  console.log("\n=== Phase 8 smoke test ===\n");

  const [team] = await db.insert(teams).values({ name: "P8 Smoke" }).returning();
  const [chief] = await db
    .insert(users)
    .values({ teamId: team.id, email: "chief@p8.test", name: "Chief", role: "chief" })
    .returning();
  const [driver] = await db
    .insert(users)
    .values({ teamId: team.id, email: "drv@p8.test", name: "Driver D", role: "driver" })
    .returning();

  // 1. Safety items
  console.log("[1] safety items");
  const [helmet] = await db
    .insert(safetyItems)
    .values({
      teamId: team.id,
      type: "helmet",
      spec: "FIA 8859-2015",
      serial: "H-001",
      expiryDate: "2027-04-01",
      ownerUserId: driver.id,
    })
    .returning();
  await db.insert(safetyItems).values({
    teamId: team.id,
    type: "fuel_cell",
    spec: "FT3-1999",
    expiryDate: "2026-06-08", // expires in ~5 days from a 2026-06-03 reference
    ownerUserId: null,
  });
  check("helmet created", helmet.type === "helmet" && helmet.expiryDate === "2027-04-01");

  // 2. License docs
  console.log("\n[2] licenses");
  const [araLicense] = await db
    .insert(licenseDocs)
    .values({
      teamId: team.id,
      holderUserId: driver.id,
      kind: "ara",
      licenseNumber: "ARA-1234",
      expiryDate: "2026-12-31",
    })
    .returning();
  await db.insert(licenseDocs).values({
    teamId: team.id,
    holderUserId: driver.id,
    kind: "medical",
    expiryDate: "2026-05-25", // expired by ~9 days from a 2026-06-03 ref
  });
  check("ara license created", araLicense.kind === "ara");

  // 3. Equipment
  console.log("\n[3] equipment");
  await db.insert(equipmentItems).values({
    teamId: team.id,
    category: "service_tool",
    description: "Floor jack 3-ton",
    location: "Service truck",
  });
  await db.insert(equipmentItems).values({
    teamId: team.id,
    category: "comms",
    description: "Motorola CP200",
    location: "Service truck",
  });
  const equip = await db
    .select()
    .from(equipmentItems)
    .where(eq(equipmentItems.teamId, team.id));
  check("2 equipment items", equip.length === 2);

  // 4. SafetyExpiryWarner — bandFor unit semantics on real data
  console.log("\n[4] band classification at reference date 2026-06-03");
  const ref = new Date("2026-06-03T00:00:00Z");
  const allSafety = await db
    .select()
    .from(safetyItems)
    .where(and(eq(safetyItems.teamId, team.id)));
  const allLicenses = await db
    .select()
    .from(licenseDocs)
    .where(and(eq(licenseDocs.teamId, team.id)));

  const warnings = deriveWarnings(
    [
      ...allSafety.map((s) => ({
        id: `safety:${s.id}`,
        label: s.type,
        expiryDate: s.expiryDate ? new Date(`${s.expiryDate}T00:00:00Z`) : null,
      })),
      ...allLicenses.map((l) => ({
        id: `license:${l.id}`,
        label: l.kind,
        expiryDate: l.expiryDate ? new Date(`${l.expiryDate}T00:00:00Z`) : null,
      })),
    ],
    ref,
  );
  // Expected breakdown:
  //   helmet expires 2027-04-01 (>180 days) → ok
  //   fuel_cell expires 2026-06-08 (5 days)  → 1w
  //   ara license expires 2026-12-31 (~211d) → ok
  //   medical expires 2026-05-25 (-9 days)   → expired
  const byBand = warnings.reduce<Record<string, number>>((m, w) => {
    m[w.band] = (m[w.band] ?? 0) + 1;
    return m;
  }, {});
  check("1 expired (medical)", byBand.expired === 1);
  check("1 in 1w band (fuel cell)", byBand["1w"] === 1);
  check("2 ok (helmet, ara)", byBand.ok === 2);

  // 5. Sort order: expired first
  console.log("\n[5] urgency sort");
  check(
    "first warning is expired",
    warnings[0].band === "expired",
  );

  // 6. ATTENTION_BANDS filter
  console.log("\n[6] attention filter");
  const attention = warnings.filter((w) => ATTENTION_BANDS.includes(w.band));
  check("attention list has 2 (expired + 1w)", attention.length === 2);

  // 7. Tech-ready math: red/yellow/green for an event 2026-06-15 (12 days from ref)
  console.log("\n[7] tech-ready vs event date 2026-06-15");
  const eventDate = new Date("2026-06-15T00:00:00Z");
  const techReady = deriveWarnings(
    [
      ...allSafety.map((s) => ({
        id: `safety:${s.id}`,
        label: s.type,
        expiryDate: s.expiryDate ? new Date(`${s.expiryDate}T00:00:00Z`) : null,
      })),
      ...allLicenses.map((l) => ({
        id: `license:${l.id}`,
        label: l.kind,
        expiryDate: l.expiryDate ? new Date(`${l.expiryDate}T00:00:00Z`) : null,
      })),
    ],
    eventDate,
  );
  // Relative to 2026-06-15:
  //   helmet 2027-04-01 (~290 days) → ok
  //   fuel_cell 2026-06-08 (-7 days) → expired (red)
  //   ara 2026-12-31 (~199 days) → ok (>180)
  //   medical 2026-05-25 (-21 days) → expired (red)
  const tr = techReady.reduce<Record<string, number>>((m, w) => {
    m[w.band] = (m[w.band] ?? 0) + 1;
    return m;
  }, {});
  check("event-date red count = 2 (fuel cell + medical expired)", tr.expired === 2);
  check("event-date ok count = 2 (helmet + ara)", tr.ok === 2);

  // 8. Soft delete hides items
  console.log("\n[8] soft delete");
  await db
    .update(safetyItems)
    .set({ deletedAt: new Date() })
    .where(eq(safetyItems.id, helmet.id));
  const visible = await db
    .select()
    .from(safetyItems)
    .where(
      and(
        eq(safetyItems.teamId, team.id),
        sql`${safetyItems.deletedAt} IS NULL`,
      ),
    );
  check("helmet hidden after soft delete", visible.every((s) => s.id !== helmet.id));

  // 9. team_id integrity
  console.log("\n[9] team_id integrity");
  const orphans = await db.execute<{ table_name: string; cnt: number }>(sql`
    SELECT 'safety_items' AS table_name, COUNT(*)::int AS cnt FROM safety_items WHERE team_id IS NULL
    UNION ALL SELECT 'license_docs', COUNT(*)::int FROM license_docs WHERE team_id IS NULL
    UNION ALL SELECT 'equipment_items', COUNT(*)::int FROM equipment_items WHERE team_id IS NULL
  `);
  for (const row of orphans) {
    check(`no NULL team_id rows in ${row.table_name}`, Number(row.cnt) === 0);
  }

  // 10. Quick standalone bandFor sanity
  check("bandFor(0) === '1w'", bandFor(0) === "1w");
  check("bandFor(null) === 'no_expiry'", bandFor(null) === "no_expiry");

  // ---- cleanup ----
  console.log("\n[cleanup]");
  await db.execute(sql`TRUNCATE TABLE equipment_items, license_docs, safety_items, document_acknowledgments, document_versions, documents, expense_entries, budget_lines, recce_schedule_entries, event_stages, meal_plan_items, hotel_bookings, itinerary_leg_assignees, itinerary_legs, checklist_signoffs, checklist_instance_items, checklist_instances, checklist_template_items, checklist_templates, work_order_notes, work_orders, vehicles, todos, tire_needs, order_list_items, events, accounts, sessions, verification_tokens, users, teams RESTART IDENTITY CASCADE`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
