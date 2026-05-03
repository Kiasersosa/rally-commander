// Idempotent first-deploy bootstrap. Reads env vars; if no team exists, creates
// one Team plus one chief User. Runs as part of the Docker entry script.
//
// Required env vars:
//   RC_BOOTSTRAP_TEAM_NAME
//   RC_BOOTSTRAP_CHIEF_EMAIL
//   RC_BOOTSTRAP_CHIEF_NAME

import { db } from "./index";
import { teams, users } from "./schema";

export async function bootstrap(): Promise<{
  status: "skipped" | "created";
  reason?: string;
  teamId?: string;
  chiefUserId?: string;
}> {
  const teamName = process.env.RC_BOOTSTRAP_TEAM_NAME;
  const chiefEmail = process.env.RC_BOOTSTRAP_CHIEF_EMAIL;
  const chiefName = process.env.RC_BOOTSTRAP_CHIEF_NAME;

  if (!teamName || !chiefEmail || !chiefName) {
    return { status: "skipped", reason: "RC_BOOTSTRAP_* env vars not set" };
  }

  // Idempotent: if any team already exists, do nothing.
  const existing = await db.select({ id: teams.id }).from(teams).limit(1);
  if (existing.length > 0) {
    return { status: "skipped", reason: "team already exists" };
  }

  const [team] = await db.insert(teams).values({ name: teamName }).returning();
  const [chief] = await db
    .insert(users)
    .values({
      teamId: team.id,
      email: chiefEmail.toLowerCase(),
      name: chiefName,
      role: "chief",
    })
    .returning();

  return { status: "created", teamId: team.id, chiefUserId: chief.id };
}

// Allow running directly: `tsx src/lib/db/bootstrap.ts`
if (process.argv[1] && process.argv[1].endsWith("bootstrap.ts")) {
  bootstrap()
    .then((result) => {
      console.log("[bootstrap]", JSON.stringify(result));
      process.exit(0);
    })
    .catch((err) => {
      console.error("[bootstrap] failed:", err);
      process.exit(1);
    });
}
