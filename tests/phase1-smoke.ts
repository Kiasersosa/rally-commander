// Phase 1 end-to-end smoke test against a live Postgres.
// Run: npx tsx --env-file=.env tests/phase1-smoke.ts
//
// This file is intentionally NOT in the Vitest include glob — it touches the
// real DB and is run manually before deploys. It is gitignored.

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../src/lib/db";
import { events, teams, todos, users } from "../src/lib/db/schema";
import { advance, canAdvance, ALL_PHASES } from "../src/lib/event-lifecycle";

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
  console.log("\n=== Phase 1 smoke test ===\n");

  // 1. Bootstrap: chief + team exist exactly once
  console.log("[1] bootstrap state");
  const allTeams = await db.select().from(teams);
  check("exactly one team after bootstrap", allTeams.length === 1, allTeams.length);
  const team = allTeams[0];

  const allUsers = await db.select().from(users);
  check("exactly one chief user after bootstrap", allUsers.length === 1, allUsers.length);
  const chief = allUsers[0];
  check("chief.role === 'chief'", chief.role === "chief", chief.role);
  check("chief.team_id matches team.id", chief.teamId === team.id);
  check("chief.deleted_at is null", chief.deletedAt === null);

  // 2. Invite a second user (mimics chief invite path; auth-side magic-link is stubbed)
  console.log("\n[2] invite a second user");
  const [mechanic] = await db
    .insert(users)
    .values({
      teamId: team.id,
      email: "mech@smoke.test",
      name: "Smoke Mechanic",
      role: "lead_mechanic",
    })
    .returning();
  check("mechanic user created", !!mechanic.id);
  check("mechanic.team_id matches team", mechanic.teamId === team.id);

  // 3. Create an event
  console.log("\n[3] create event");
  const [event] = await db
    .insert(events)
    .values({
      teamId: team.id,
      name: "Olympus 2026",
      eventDate: "2026-06-14",
      location: "Shelton, WA",
      araRoundNumber: 3,
    })
    .returning();
  check("event created", !!event.id);
  check("event.team_id matches team", event.teamId === team.id);
  check("event.phase defaults to 'planning'", event.phase === "planning");

  // 4. Advance through all four phases (chief)
  console.log("\n[4] advance phases (chief)");
  let currentPhase = event.phase;
  for (const _ of ALL_PHASES.slice(0, 3)) {
    const result = advance(currentPhase, "chief");
    if (!result.ok) {
      check(`advance from ${currentPhase}`, false, result.reason);
      break;
    }
    await db
      .update(events)
      .set({ phase: result.phase, updatedAt: new Date() })
      .where(eq(events.id, event.id));
    const [refreshed] = await db
      .select({ phase: events.phase })
      .from(events)
      .where(eq(events.id, event.id))
      .limit(1);
    check(`advanced ${currentPhase} -> ${result.phase}`, refreshed.phase === result.phase);
    currentPhase = result.phase;
  }
  check("event reached terminal phase post_event", currentPhase === "post_event");

  // 5. Cannot advance past terminal
  console.log("\n[5] guards");
  const past = advance("post_event", "chief");
  check("chief cannot advance from post_event", !past.ok);

  const notChief = advance("planning", "lead_mechanic");
  check("non-chief cannot advance", !notChief.ok);
  check("canAdvance(planning, lead_mechanic) === false", !canAdvance("planning", "lead_mechanic"));

  // 6. Create todos
  console.log("\n[6] todos");
  const [todoForMech] = await db
    .insert(todos)
    .values({
      teamId: team.id,
      eventId: event.id,
      assigneeUserId: mechanic.id,
      title: "Replace front struts",
      description: "Mechanic to handle pre-event",
    })
    .returning();
  check("todo created", !!todoForMech.id);
  check("todo.team_id matches", todoForMech.teamId === team.id);
  check("todo.event_id matches", todoForMech.eventId === event.id);
  check("todo.assignee matches mechanic", todoForMech.assigneeUserId === mechanic.id);

  // 7. Mechanic marks own todo complete
  console.log("\n[7] complete todo as assignee");
  const completedAt = new Date();
  await db
    .update(todos)
    .set({
      completedAt,
      completedByUserId: mechanic.id,
      updatedAt: new Date(),
    })
    .where(and(eq(todos.id, todoForMech.id), eq(todos.teamId, team.id)));
  const [refreshed] = await db.select().from(todos).where(eq(todos.id, todoForMech.id)).limit(1);
  check("todo.completed_at set", refreshed.completedAt !== null);
  check("todo.completed_by matches mechanic", refreshed.completedByUserId === mechanic.id);

  // 8. Save debrief
  console.log("\n[8] debrief");
  const debriefText = "Stage 4 brake fade. Need pad upgrade for next event.";
  await db
    .update(events)
    .set({ debriefNotes: debriefText, updatedAt: new Date() })
    .where(and(eq(events.id, event.id), eq(events.teamId, team.id)));
  const [withDebrief] = await db.select().from(events).where(eq(events.id, event.id)).limit(1);
  check("debrief notes persisted", withDebrief.debriefNotes === debriefText);

  // 9. Revoke mechanic (soft delete)
  console.log("\n[9] revoke mechanic");
  await db
    .update(users)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(users.id, mechanic.id), eq(users.teamId, team.id)));
  const [revoked] = await db.select().from(users).where(eq(users.id, mechanic.id)).limit(1);
  check("mechanic.deleted_at set", revoked.deletedAt !== null);

  const activeUsers = await db
    .select()
    .from(users)
    .where(and(eq(users.teamId, team.id), isNull(users.deletedAt)));
  check("active users now = 1 (chief only)", activeUsers.length === 1);

  // 10. Cross-team scoping safety: insert a second team + user, ensure original
  //     team's queries don't see them
  console.log("\n[10] team_id scoping");
  const [otherTeam] = await db.insert(teams).values({ name: "Other Team" }).returning();
  await db.insert(users).values({
    teamId: otherTeam.id,
    email: "other@smoke.test",
    name: "Other Chief",
    role: "chief",
  });
  const ourTeamUsers = await db.select().from(users).where(eq(users.teamId, team.id));
  check("scoped query does not leak across teams", ourTeamUsers.every((u) => u.teamId === team.id));
  check("scoped query count == 2 for our team", ourTeamUsers.length === 2);

  // 11. team_id columns: every row must have one matching its parent team
  console.log("\n[11] team_id integrity");
  const orphans = await db.execute<{ table_name: string; cnt: number }>(sql`
    SELECT 'users' AS table_name, COUNT(*)::int AS cnt FROM users WHERE team_id IS NULL
    UNION ALL SELECT 'events', COUNT(*)::int FROM events WHERE team_id IS NULL
    UNION ALL SELECT 'todos', COUNT(*)::int FROM todos WHERE team_id IS NULL
  `);
  for (const row of orphans) {
    check(`no NULL team_id rows in ${row.table_name}`, Number(row.cnt) === 0, row);
  }

  // ---- cleanup so the script is re-runnable from a clean bootstrap ----
  console.log("\n[cleanup] truncating smoke data");
  await db.execute(sql`TRUNCATE TABLE todos, events, accounts, sessions, verification_tokens, users, teams RESTART IDENTITY CASCADE`);

  console.log(`\n=== ${pass} passed, ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err);
  process.exit(2);
});
