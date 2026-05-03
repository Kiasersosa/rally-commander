// Optional PIN-based login alongside magic-link. Bypasses NextAuth's
// Credentials provider entirely (which would force JWT sessions); instead
// we create a database session row directly so /api/auth/[...nextauth]
// and `auth()` keep working unchanged.

import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db } from "./db";
import { sessions, users } from "./db/schema";

const BCRYPT_COST = 10;
const SESSION_DAYS = 30;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export const PIN_MIN_LEN = 4;
export const PIN_MAX_LEN = 8;

export function isValidPinFormat(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, BCRYPT_COST);
}

export type PinLoginResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "locked"; lockedUntil?: Date };

/**
 * Verify email + PIN. On success: clear failed attempts, create a database
 * session row, set the auth.js session cookie. On failure: increment failed
 * attempts, lock account if threshold reached. Always uses bcrypt to make
 * timing attacks impractical.
 *
 * Generic 'invalid' error for both wrong email and wrong PIN — no leaking
 * which.
 */
export async function loginWithPin(
  emailRaw: string,
  pin: string,
): Promise<PinLoginResult> {
  const email = emailRaw.trim().toLowerCase();
  if (!email || !isValidPinFormat(pin)) {
    return { ok: false, reason: "invalid" };
  }

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  // Always run bcrypt against *something* to keep timing constant on missing
  // users. Use a fixed throwaway hash.
  const dummy = "$2b$10$0000000000000000000000000000000000000000000000000000aa";
  const hashToCheck = user?.pinHash ?? dummy;

  // Check lockout before doing the comparison so a locked user still pays
  // bcrypt time (no timing oracle).
  const now = new Date();
  const isLocked =
    user?.pinLockedUntil && user.pinLockedUntil.getTime() > now.getTime();

  // Run bcrypt regardless.
  const matches = await bcrypt.compare(pin, hashToCheck);

  if (!user || !user.pinHash || user.deletedAt) {
    return { ok: false, reason: "invalid" };
  }

  if (isLocked) {
    return { ok: false, reason: "locked", lockedUntil: user.pinLockedUntil! };
  }

  if (!matches) {
    const attempts = user.pinFailedAttempts + 1;
    const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
    await db
      .update(users)
      .set({
        pinFailedAttempts: attempts,
        pinLockedUntil: shouldLock
          ? new Date(now.getTime() + LOCKOUT_MINUTES * 60_000)
          : user.pinLockedUntil,
      })
      .where(eq(users.id, user.id));
    if (shouldLock) {
      return {
        ok: false,
        reason: "locked",
        lockedUntil: new Date(now.getTime() + LOCKOUT_MINUTES * 60_000),
      };
    }
    return { ok: false, reason: "invalid" };
  }

  // Success — clear counters, create session, set cookie.
  await db
    .update(users)
    .set({ pinFailedAttempts: 0, pinLockedUntil: null })
    .where(eq(users.id, user.id));

  const sessionToken = randomUUID();
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
  await db.insert(sessions).values({
    sessionToken,
    userId: user.id,
    expires,
  });

  // Auth.js v5 cookie naming. Production over HTTPS uses the __Secure- prefix
  // when AUTH_URL starts with https://.
  const authUrl = process.env.AUTH_URL ?? "";
  const isSecure = authUrl.startsWith("https://");
  const cookieName = isSecure
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
  const store = await cookies();
  store.set({
    name: cookieName,
    value: sessionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,
    path: "/",
    expires,
  });

  return { ok: true };
}
