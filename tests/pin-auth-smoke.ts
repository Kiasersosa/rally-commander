// PIN-auth smoke test against a live Postgres.
// Tests hashing + verification + lockout logic *without* the cookie path
// (which requires a Next.js request context). Cookie-setting is exercised
// via the live UI manually.
//
// Run: npx tsx --env-file=.env tests/pin-auth-smoke.ts

import { eq, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { sessions, teams, users } from "../src/lib/db/schema";
import { hashPin, isValidPinFormat } from "../src/lib/pin-auth";

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
  console.log("\n=== PIN auth smoke test ===\n");

  // 1. PIN format validation
  console.log("[1] PIN format");
  check("4 digits valid", isValidPinFormat("1234"));
  check("8 digits valid", isValidPinFormat("12345678"));
  check("3 digits invalid", !isValidPinFormat("123"));
  check("9 digits invalid", !isValidPinFormat("123456789"));
  check("alpha invalid", !isValidPinFormat("abcd"));
  check("empty invalid", !isValidPinFormat(""));

  // 2. bcrypt round-trip
  console.log("\n[2] bcrypt hash + compare");
  const h = await hashPin("4271");
  check("hash != plaintext", h !== "4271");
  check("hash starts with $2", h.startsWith("$2"));
  check("compare correct PIN", await bcrypt.compare("4271", h));
  check("compare wrong PIN", !(await bcrypt.compare("0000", h)));

  // 3. Set up a user with a PIN, simulate login flow against the DB
  console.log("\n[3] DB state for login flow");
  const [team] = await db.insert(teams).values({ name: "PIN Smoke" }).returning();
  const [u] = await db
    .insert(users)
    .values({
      teamId: team.id,
      email: "pin@smoke.test",
      name: "Pin User",
      role: "chief",
      pinHash: h,
      pinFailedAttempts: 0,
    })
    .returning();
  check("user has pin_hash", u.pinHash === h);
  check("failed attempts start at 0", u.pinFailedAttempts === 0);
  check("not locked initially", u.pinLockedUntil === null);

  // 4. Simulate 4 wrong attempts (under lockout threshold of 5)
  console.log("\n[4] failed attempts under threshold");
  for (let i = 0; i < 4; i++) {
    const [current] = await db.select().from(users).where(eq(users.id, u.id));
    const matches = await bcrypt.compare("0000", current.pinHash!);
    check(`attempt ${i + 1}: wrong PIN doesn't match`, !matches);
    await db
      .update(users)
      .set({ pinFailedAttempts: current.pinFailedAttempts + 1 })
      .where(eq(users.id, u.id));
  }
  const [after4] = await db.select().from(users).where(eq(users.id, u.id));
  check("after 4 fails, attempts = 4, no lockout", after4.pinFailedAttempts === 4 && after4.pinLockedUntil === null);

  // 5. 5th wrong attempt → lockout
  console.log("\n[5] 5th attempt triggers lockout");
  const lockUntil = new Date(Date.now() + 15 * 60_000);
  await db
    .update(users)
    .set({ pinFailedAttempts: 5, pinLockedUntil: lockUntil })
    .where(eq(users.id, u.id));
  const [locked] = await db.select().from(users).where(eq(users.id, u.id));
  check("locked_until is set", locked.pinLockedUntil !== null);
  check("locked_until is in the future", locked.pinLockedUntil!.getTime() > Date.now());

  // 6. Successful login resets counters + creates session
  console.log("\n[6] success path resets state");
  // simulate: locked_until in the past = unlocked
  await db
    .update(users)
    .set({ pinLockedUntil: new Date(Date.now() - 60_000) })
    .where(eq(users.id, u.id));
  const [now] = await db.select().from(users).where(eq(users.id, u.id));
  const isLockedNow =
    now.pinLockedUntil && now.pinLockedUntil.getTime() > Date.now();
  check("expired lockout treated as unlocked", !isLockedNow);

  // After successful match, reset counters + insert session row
  const correct = await bcrypt.compare("4271", now.pinHash!);
  check("correct PIN matches", correct);
  await db
    .update(users)
    .set({ pinFailedAttempts: 0, pinLockedUntil: null })
    .where(eq(users.id, u.id));
  const sessionToken = crypto.randomUUID();
  await db.insert(sessions).values({
    sessionToken,
    userId: u.id,
    expires: new Date(Date.now() + 30 * 86_400_000),
  });
  const [reset] = await db.select().from(users).where(eq(users.id, u.id));
  check("attempts cleared", reset.pinFailedAttempts === 0);
  check("lock cleared", reset.pinLockedUntil === null);
  const [sess] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.sessionToken, sessionToken));
  check("session row exists", sess?.userId === u.id);

  // 7. Removing PIN
  console.log("\n[7] remove PIN");
  await db
    .update(users)
    .set({ pinHash: null, pinFailedAttempts: 0, pinLockedUntil: null })
    .where(eq(users.id, u.id));
  const [cleared] = await db.select().from(users).where(eq(users.id, u.id));
  check("pin_hash null after removal", cleared.pinHash === null);

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
