// Phase 10 end-to-end smoke test against a live Postgres.
// Twilio + Resend send paths are NOT exercised here (they require real
// API keys and would actually deliver messages). The smoke covers the
// data plumbing: digest gathering, audit-log writes, opt-in filtering.
// Run: npx tsx --env-file=.env tests/phase10-smoke.ts

import { and, eq, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import {
  documentVersions,
  documents,
  events,
  licenseDocs,
  notifications,
  safetyItems,
  teams,
  todos,
  users,
  vehicles,
} from "../src/lib/db/schema";
import { runDigestForUser } from "../src/lib/digest";
import { composeDigest } from "../src/lib/notification-digest-composer";
import { deriveWarnings } from "../src/lib/safety-expiry-warner";

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
  console.log("\n=== Phase 10 smoke test ===\n");

  const [team] = await db.insert(teams).values({ name: "P10 Smoke" }).returning();
  const [chief] = await db
    .insert(users)
    .values({
      teamId: team.id,
      email: "chief@p10.test",
      name: "Chief",
      role: "chief",
      phoneNumber: "+15555550101",
      smsOptIn: true,
    })
    .returning();
  const [mech] = await db
    .insert(users)
    .values({
      teamId: team.id,
      email: "mech@p10.test",
      name: "Mech",
      role: "lead_mechanic",
      phoneNumber: null,
      smsOptIn: false,
    })
    .returning();
  const [car] = await db
    .insert(vehicles)
    .values({ teamId: team.id, type: "rally_car", name: "#46 BRZ" })
    .returning();
  const ref = new Date("2026-06-01T00:00:00Z");
  const [evt] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Olympus 2026",
      eventDate: "2026-06-04", // 3 days out — within 7-day window
      location: "Shelton, WA",
    })
    .returning();
  const [evtFar] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Far away",
      eventDate: "2026-09-01",
      location: "PA",
    })
    .returning();

  // 1. Schema fields on users
  console.log("[1] users phone + sms_opt_in fields");
  check("chief phone stored", chief.phoneNumber === "+15555550101");
  check("chief opted in", chief.smsOptIn === true);
  check("mech phone null", mech.phoneNumber === null);
  check("mech opted out", mech.smsOptIn === false);

  // 2. Build a DigestInput by hand and run the composer
  console.log("\n[2] composeDigest end-to-end");
  await db.insert(todos).values({
    teamId: team.id,
    eventId: evt.id,
    assigneeUserId: chief.id,
    title: "Order brake pads",
  });
  await db.insert(safetyItems).values({
    teamId: team.id,
    type: "fuel_cell",
    spec: "FT3",
    expiryDate: "2026-06-08", // 7 days from ref → 1w
  });
  await db.insert(licenseDocs).values({
    teamId: team.id,
    holderUserId: chief.id,
    kind: "medical",
    expiryDate: "2026-05-25", // expired
  });

  const safety = await db.select().from(safetyItems).where(eq(safetyItems.teamId, team.id));
  const lics = await db.select().from(licenseDocs).where(eq(licenseDocs.teamId, team.id));
  const warnings = deriveWarnings(
    [
      ...safety.map((s) => ({
        id: `safety:${s.id}`,
        label: `${s.type}${s.serial ? ` · ${s.serial}` : ""}`,
        expiryDate: s.expiryDate ? new Date(`${s.expiryDate}T00:00:00Z`) : null,
      })),
      ...lics.map((l) => ({
        id: `license:${l.id}`,
        label: `${l.kind} license`,
        expiryDate: l.expiryDate ? new Date(`${l.expiryDate}T00:00:00Z`) : null,
      })),
    ],
    ref,
  );
  const digest = composeDigest({
    user: { id: chief.id, name: chief.name, role: chief.role },
    period: { fromIso: ref.toISOString(), toIso: ref.toISOString() },
    upcomingTodos: [{ id: "t", title: "Order brake pads", eventName: evt.name }],
    upcomingEvents: [
      { id: evt.id, name: evt.name, eventDate: evt.eventDate, location: evt.location },
    ],
    expirations: warnings.map((w) => ({
      id: w.item.id,
      label: w.item.label,
      band: w.band,
      daysUntilExpiry: w.daysUntilExpiry,
    })),
    newOrUpdatedDocuments: [],
  });
  check("digest hasContent", digest.hasContent);
  check("digest body mentions todo", digest.body.includes("Order brake pads"));
  check("digest body mentions event", digest.body.includes("Olympus 2026"));
  check("subject reflects expired item", digest.subject.includes("expired"));

  // 3. Notifications audit-log row created without sending (we won't have
  //    a Resend / Twilio key in CI; the recordAndSend should still write
  //    the row and mark it failed). Manually insert a `pending` row.
  console.log("\n[3] notifications audit log");
  const [logRow] = await db
    .insert(notifications)
    .values({
      teamId: team.id,
      userId: chief.id,
      channel: "email",
      kind: "digest",
      recipient: chief.email,
      subject: digest.subject,
      body: digest.body,
    })
    .returning();
  check("audit row created with status pending", logRow.status === "pending");
  check("audit row has body", logRow.body.length > 0);
  check("audit row recipient = chief email", logRow.recipient === chief.email);

  // 4. Within-window query semantics: only events within 7 days return.
  //    Run the gather logic via runDigestForUser but skip the actual send
  //    by intercepting via a fake Resend env (we expect it to fail
  //    gracefully). For purity here we simulate the gather by calling
  //    the same Drizzle queries used inside runDigestForUser.
  console.log("\n[4] window semantics");
  const upcomingEventsCount = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.teamId, team.id),
        sql`${events.eventDate} BETWEEN ${ref.toISOString().slice(0, 10)} AND ${new Date(ref.getTime() + 7 * 86400_000).toISOString().slice(0, 10)}`,
      ),
    );
  check("only the near event is in 7-day window", upcomingEventsCount.length === 1);

  // 5. Document new-since-window
  console.log("\n[5] new docs in window");
  const [doc] = await db
    .insert(documents)
    .values({
      teamId: team.id,
      eventId: evt.id,
      category: "bulletin",
      name: "Bulletin 1",
    })
    .returning();
  await db.insert(documentVersions).values({
    teamId: team.id,
    documentId: doc.id,
    versionNumber: 1,
    storageKey: "fake/key",
    contentType: "application/pdf",
    sizeBytes: 1234,
    uploadedByUserId: chief.id,
    // NOTE: createdAt defaults to now() — for the test we treat now as
    // within-window relative to ref by using the actual current clock.
  });
  const recentDocs = await db
    .select({ id: documents.id })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .where(eq(documents.teamId, team.id));
  check("at least one new doc visible", recentDocs.length >= 1);

  // 6. SMS opt-in filter for daily expiry alerts
  console.log("\n[6] SMS opt-in filter");
  const eligible = await db
    .select({ id: users.id, phoneNumber: users.phoneNumber, smsOptIn: users.smsOptIn })
    .from(users)
    .where(
      and(
        eq(users.teamId, team.id),
        eq(users.smsOptIn, true),
      ),
    );
  // Mech is opted out and has no phone; chief is opted in with a phone.
  check("only opted-in user is chief", eligible.length === 1 && eligible[0].id === chief.id);

  // 7. team_id integrity
  console.log("\n[7] team_id integrity");
  const orphans = await db.execute<{ table_name: string; cnt: number }>(sql`
    SELECT 'notifications' AS table_name, COUNT(*)::int AS cnt FROM notifications WHERE team_id IS NULL
  `);
  for (const row of orphans) {
    check(`no NULL team_id rows in ${row.table_name}`, Number(row.cnt) === 0);
  }

  // 8. runDigestForUser actually executes (will fail to send because no
  //    real Resend key in CI; we just check it returns a structured result
  //    rather than throwing).
  console.log("\n[8] runDigestForUser doesn't throw, returns summary");
  const summary = await runDigestForUser(
    {
      id: chief.id,
      teamId: team.id,
      email: chief.email,
      name: chief.name,
      role: chief.role,
    },
    ref,
  );
  check("summary has userId", summary.userId === chief.id);
  // delivered may be true (if RESEND_API_KEY in .env is real) or false; we
  // just check the field is present.
  check("summary has delivered field", typeof summary.delivered === "boolean");

  // ---- cleanup ----
  console.log("\n[cleanup]");
  await db.execute(sql`TRUNCATE TABLE notifications, crew_status_entries, service_stop_items, service_stops, incidents, equipment_items, license_docs, safety_items, document_acknowledgments, document_versions, documents, expense_entries, budget_lines, recce_schedule_entries, event_stages, meal_plan_items, hotel_bookings, itinerary_leg_assignees, itinerary_legs, checklist_signoffs, checklist_instance_items, checklist_instances, checklist_template_items, checklist_templates, work_order_notes, work_orders, vehicles, todos, tire_needs, order_list_items, events, accounts, sessions, verification_tokens, users, teams RESTART IDENTITY CASCADE`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
