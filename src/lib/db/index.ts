import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// During `next build`, env-var-bound services (like Fly secrets) aren't
// available. The build only collects page metadata — it does not execute
// queries. postgres-js connects lazily on first query, so a placeholder URL
// during the build phase is safe; runtime always provides the real one.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";

const url = process.env.DATABASE_URL;
if (!url && !isBuildPhase) {
  throw new Error("DATABASE_URL is not set");
}
const connectionString = url ?? "postgres://build-placeholder:build@127.0.0.1:5432/build";

declare global {
  // eslint-disable-next-line no-var
  var __pgClient: ReturnType<typeof postgres> | undefined;
}

const client =
  globalThis.__pgClient ??
  postgres(connectionString, {
    max: 10,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__pgClient = client;
}

export const db = drizzle(client, { schema });
export type DB = typeof db;
