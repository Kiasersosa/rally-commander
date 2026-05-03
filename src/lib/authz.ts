// Server-only authorization helpers. Every API route and server-rendered page
// that touches data should call these.

import { auth } from "./auth";
import type { UserRole } from "./db/schema";

export class UnauthorizedError extends Error {
  status = 401;
}
export class ForbiddenError extends Error {
  status = 403;
}

export type SessionUser = {
  userId: string;
  teamId: string;
  role: UserRole;
  email: string;
  name: string;
};

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth();
  if (!session?.user?.id || !session.user.teamId || !session.user.role) {
    return null;
  }
  return {
    userId: session.user.id,
    teamId: session.user.teamId,
    role: session.user.role,
    email: session.user.email,
    name: session.user.name,
  };
}

export async function requireSession(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError("Not signed in");
  return user;
}

export async function requireChief(): Promise<SessionUser> {
  const user = await requireSession();
  if (user.role !== "chief") {
    throw new ForbiddenError("Crew-chief only.");
  }
  return user;
}

export function jsonError(err: unknown): Response {
  if (err instanceof UnauthorizedError) {
    return Response.json({ error: err.message }, { status: 401 });
  }
  if (err instanceof ForbiddenError) {
    return Response.json({ error: err.message }, { status: 403 });
  }
  const message = err instanceof Error ? err.message : "Internal error";
  console.error("[api]", err);
  return Response.json({ error: message }, { status: 500 });
}
