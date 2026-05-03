// Phase 7 end-to-end smoke test against a live Postgres.
// Storage layer is exercised via mocked bytes (no R2 dependency in CI).
// Run: npx tsx --env-file=.env tests/phase7-smoke.ts

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  documentAcknowledgments,
  documentVersions,
  documents,
  events,
  teams,
  users,
} from "../src/lib/db/schema";
import { diff } from "../src/lib/document-differ";

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
  console.log("\n=== Phase 7 smoke test ===\n");

  const [team] = await db.insert(teams).values({ name: "P7 Smoke" }).returning();
  const [chief] = await db
    .insert(users)
    .values({ teamId: team.id, email: "chief@p7.test", name: "Chief", role: "chief" })
    .returning();
  const [mech] = await db
    .insert(users)
    .values({ teamId: team.id, email: "mech@p7.test", name: "Mech", role: "lead_mechanic" })
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

  // 1. Create a logical document, then upload v1 (text) directly to bypass R2
  console.log("[1] document v1 (no diff)");
  const [doc] = await db
    .insert(documents)
    .values({
      teamId: team.id,
      eventId: evt.id,
      category: "bulletin",
      name: "Bulletin 1",
      mustAcknowledge: true,
    })
    .returning();
  const v1Text = "Stage 4 starts at 09:00.\n\nFuel cell check at 08:00.";
  const [v1] = await db
    .insert(documentVersions)
    .values({
      teamId: team.id,
      documentId: doc.id,
      versionNumber: 1,
      storageKey: `${team.id}/${evt.id}/${doc.id}/v1-bulletin1.txt`,
      contentType: "text/plain",
      sizeBytes: Buffer.byteLength(v1Text),
      extractedText: v1Text,
      diffJson: null,
      uploadedByUserId: chief.id,
    })
    .returning();
  check("v1 has no diff (no prior)", v1.diffJson === null);

  // 2. Mech acknowledges v1
  console.log("\n[2] mech acks v1");
  await db.insert(documentAcknowledgments).values({
    teamId: team.id,
    documentId: doc.id,
    userId: mech.id,
    versionId: v1.id,
  });
  const [ack1] = await db
    .select()
    .from(documentAcknowledgments)
    .where(
      and(
        eq(documentAcknowledgments.documentId, doc.id),
        eq(documentAcknowledgments.userId, mech.id),
      ),
    );
  check("mech ack recorded", ack1.versionId === v1.id);

  // 3. Upload v2 with structured diff stored
  console.log("\n[3] document v2 with diff");
  const v2Text = "Stage 4 starts at 10:30.\n\nFuel cell check at 08:00.\n\nNEW: Mandatory tech at 07:00.";
  const v2Diff = diff(v1Text, v2Text);
  check("diff has changes", v2Diff.hasChanges);
  check("diff has 1 added (new section) + 1 added/removed (start time change)", v2Diff.addedCount >= 1 && v2Diff.removedCount >= 1);

  const [v2] = await db
    .insert(documentVersions)
    .values({
      teamId: team.id,
      documentId: doc.id,
      versionNumber: 2,
      storageKey: `${team.id}/${evt.id}/${doc.id}/v2-bulletin1.txt`,
      contentType: "text/plain",
      sizeBytes: Buffer.byteLength(v2Text),
      extractedText: v2Text,
      diffJson: JSON.stringify(v2Diff),
      uploadedByUserId: chief.id,
    })
    .returning();
  check("v2 has diff stored", v2.diffJson !== null);

  // 4. Pending-ack feed: mech's ack was for v1, latest is now v2 → stale
  console.log("\n[4] stale ack detection");
  const pending = await db
    .select({
      docId: documents.id,
      latestVersionId: sql<string>`(SELECT id FROM ${documentVersions} v WHERE v.team_id = ${documents.teamId} AND v.document_id = ${documents.id} ORDER BY v.version_number DESC LIMIT 1)`,
      myAckVersionId: sql<string | null>`(SELECT version_id FROM ${documentAcknowledgments} a WHERE a.team_id = ${documents.teamId} AND a.document_id = ${documents.id} AND a.user_id = ${mech.id} LIMIT 1)`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.teamId, team.id),
        eq(documents.mustAcknowledge, true),
      ),
    );
  const stale = pending.filter((p) => p.latestVersionId !== p.myAckVersionId);
  check("mech has 1 stale pending ack", stale.length === 1);
  check("stale ack points at the test doc", stale[0]?.docId === doc.id);

  // 5. Re-ack to v2
  console.log("\n[5] re-ack to v2");
  await db
    .insert(documentAcknowledgments)
    .values({
      teamId: team.id,
      documentId: doc.id,
      userId: mech.id,
      versionId: v2.id,
    })
    .onConflictDoUpdate({
      target: [documentAcknowledgments.documentId, documentAcknowledgments.userId],
      set: { versionId: v2.id, acknowledgedAt: new Date() },
    });
  const [ack2] = await db
    .select()
    .from(documentAcknowledgments)
    .where(
      and(
        eq(documentAcknowledgments.documentId, doc.id),
        eq(documentAcknowledgments.userId, mech.id),
      ),
    );
  check("ack now points to v2", ack2.versionId === v2.id);
  const stillStale = await db
    .select({
      latestVersionId: sql<string>`(SELECT id FROM ${documentVersions} v WHERE v.document_id = ${doc.id} ORDER BY v.version_number DESC LIMIT 1)`,
      myAckVersionId: sql<string>`(SELECT version_id FROM ${documentAcknowledgments} a WHERE a.document_id = ${doc.id} AND a.user_id = ${mech.id})`,
    })
    .from(documents)
    .where(eq(documents.id, doc.id));
  check("after re-ack, no longer stale", stillStale[0].latestVersionId === stillStale[0].myAckVersionId);

  // 6. Logical-name uniqueness: same (team, event, category, name) blocked
  console.log("\n[6] logical-name uniqueness");
  let dupBlocked = false;
  try {
    await db.insert(documents).values({
      teamId: team.id,
      eventId: evt.id,
      category: "bulletin",
      name: "Bulletin 1",
    });
  } catch {
    dupBlocked = true;
  }
  check("dup logical name blocked by unique index", dupBlocked);

  // 7. Soft delete: hides from default queries
  console.log("\n[7] soft delete");
  await db
    .update(documents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(documents.id, doc.id));
  const visible = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.teamId, team.id),
        eq(documents.eventId, evt.id),
        sql`${documents.deletedAt} IS NULL`,
      ),
    );
  check("soft-deleted doc not in active list", visible.length === 0);

  // 8. team_id integrity
  console.log("\n[8] team_id integrity");
  const orphans = await db.execute<{ table_name: string; cnt: number }>(sql`
    SELECT 'documents' AS table_name, COUNT(*)::int AS cnt FROM documents WHERE team_id IS NULL
    UNION ALL SELECT 'document_versions', COUNT(*)::int FROM document_versions WHERE team_id IS NULL
    UNION ALL SELECT 'document_acknowledgments', COUNT(*)::int FROM document_acknowledgments WHERE team_id IS NULL
  `);
  for (const row of orphans) {
    check(`no NULL team_id rows in ${row.table_name}`, Number(row.cnt) === 0);
  }

  // ---- cleanup ----
  console.log("\n[cleanup]");
  await db.execute(sql`TRUNCATE TABLE document_acknowledgments, document_versions, documents, expense_entries, budget_lines, recce_schedule_entries, event_stages, meal_plan_items, hotel_bookings, itinerary_leg_assignees, itinerary_legs, checklist_signoffs, checklist_instance_items, checklist_instances, checklist_template_items, checklist_templates, work_order_notes, work_orders, vehicles, todos, tire_needs, order_list_items, events, accounts, sessions, verification_tokens, users, teams RESTART IDENTITY CASCADE`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
