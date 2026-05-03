import NextAuth from "next-auth";
import Resend from "next-auth/providers/resend";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  accounts,
  sessions,
  users,
  verificationTokens,
  type UserRole,
} from "./db/schema";

const adapter = DrizzleAdapter(db, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

// Invite-only: chief creates the user row at invite time. Auth.js must never
// create a fresh user from a magic-link verification.
adapter.createUser = async () => {
  throw new Error(
    "Self-signup is disabled. Ask the crew chief to invite you before logging in.",
  );
};

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter,
  session: { strategy: "database" },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM,
    }),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login?check=email",
    error: "/login",
  },
  callbacks: {
    async signIn({ user }) {
      if (!user?.email) return false;
      const rows = await db
        .select({ deletedAt: users.deletedAt })
        .from(users)
        .where(eq(users.email, user.email.toLowerCase()))
        .limit(1);
      if (rows.length === 0) return false; // not invited
      if (rows[0].deletedAt) return false; // revoked
      return true;
    },
    async session({ session, user }) {
      // database sessions: `user` is the row from `users`. Augment with role + teamId.
      const rows = await db
        .select({ role: users.role, teamId: users.teamId })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (rows.length > 0) {
        session.user.role = rows[0].role;
        session.user.teamId = rows[0].teamId;
        session.user.id = user.id;
      }
      return session;
    },
  },
});

// Type augmentation — exposed on session.user
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: UserRole;
      teamId: string;
      image?: string | null;
    };
  }
}
