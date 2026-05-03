// Server-side digest gathering: builds DigestInput per active user from the
// DB and feeds it through NotificationDigestComposer + recordAndSend.

import { and, asc, desc, eq, gte, isNotNull, isNull, lte, or } from "drizzle-orm";
import { db } from "./db";
import {
  documentVersions,
  documents,
  events,
  licenseDocs,
  safetyItems,
  todos,
  users,
} from "./db/schema";
import { composeDigest, type DigestInput } from "./notification-digest-composer";
import { recordAndSend } from "./notifications";
import { deriveWarnings } from "./safety-expiry-warner";

export type DigestSummary = {
  userId: string;
  email: string;
  delivered: boolean;
  hasContent: boolean;
  error?: string;
};

/**
 * Compose & send the weekly digest for every active user on every team.
 * Returns a per-user delivery summary.
 *
 * The window for "upcoming" is the next 7 days from the reference date;
 * "new documents" is documents whose latest version was created in the
 * last 7 days.
 */
export async function runWeeklyDigests(referenceDate: Date = new Date()): Promise<DigestSummary[]> {
  const allUsers = await db
    .select({
      id: users.id,
      teamId: users.teamId,
      email: users.email,
      name: users.name,
      role: users.role,
    })
    .from(users)
    .where(isNull(users.deletedAt));

  const summaries: DigestSummary[] = [];
  for (const u of allUsers) {
    summaries.push(await runDigestForUser(u, referenceDate));
  }
  return summaries;
}

export async function runDigestForUser(
  user: {
    id: string;
    teamId: string;
    email: string;
    name: string;
    role: string;
  },
  referenceDate: Date,
): Promise<DigestSummary> {
  const windowStart = new Date(referenceDate);
  const windowEnd = new Date(referenceDate);
  windowEnd.setUTCDate(windowEnd.getUTCDate() + 7);
  const startIso = windowStart.toISOString();
  const endIso = windowEnd.toISOString();
  const startDate = startIso.slice(0, 10);
  const endDate = endIso.slice(0, 10);

  // Upcoming events for this team within the window
  const upcomingEvents = await db
    .select({
      id: events.id,
      name: events.name,
      eventDate: events.eventDate,
      location: events.location,
    })
    .from(events)
    .where(
      and(
        eq(events.teamId, user.teamId),
        isNull(events.deletedAt),
        gte(events.eventDate, startDate),
        lte(events.eventDate, endDate),
      ),
    )
    .orderBy(asc(events.eventDate));

  // Open todos assigned to this user
  const upcomingTodos = await db
    .select({
      id: todos.id,
      title: todos.title,
      eventName: events.name,
    })
    .from(todos)
    .innerJoin(events, eq(events.id, todos.eventId))
    .where(
      and(
        eq(todos.teamId, user.teamId),
        eq(todos.assigneeUserId, user.id),
        isNull(todos.completedAt),
      ),
    )
    .orderBy(asc(events.eventDate));

  // Expirations: safety items + licenses, classified vs referenceDate
  const safety = await db
    .select({
      id: safetyItems.id,
      type: safetyItems.type,
      serial: safetyItems.serial,
      expiryDate: safetyItems.expiryDate,
    })
    .from(safetyItems)
    .where(
      and(eq(safetyItems.teamId, user.teamId), isNull(safetyItems.deletedAt)),
    );
  const lics = await db
    .select({
      id: licenseDocs.id,
      kind: licenseDocs.kind,
      expiryDate: licenseDocs.expiryDate,
      holderName: users.name,
      holderId: licenseDocs.holderUserId,
    })
    .from(licenseDocs)
    .innerJoin(users, eq(users.id, licenseDocs.holderUserId))
    .where(and(eq(licenseDocs.teamId, user.teamId), isNull(licenseDocs.deletedAt)));

  const warnings = deriveWarnings(
    [
      ...safety.map((s) => ({
        id: `safety:${s.id}`,
        label: `${s.type.replace(/_/g, " ")}${s.serial ? ` · ${s.serial}` : ""}`,
        expiryDate: s.expiryDate ? new Date(`${s.expiryDate}T00:00:00Z`) : null,
      })),
      ...lics.map((l) => ({
        id: `license:${l.id}`,
        label: `${l.kind} license · ${l.holderName}`,
        expiryDate: l.expiryDate ? new Date(`${l.expiryDate}T00:00:00Z`) : null,
      })),
    ],
    referenceDate,
  );

  // New / updated documents in the last 7 days
  const recentDocs = await db
    .select({
      id: documents.id,
      name: documents.name,
      eventName: events.name,
      versionNumber: documentVersions.versionNumber,
      createdAt: documentVersions.createdAt,
      mustAcknowledge: documents.mustAcknowledge,
    })
    .from(documentVersions)
    .innerJoin(documents, eq(documents.id, documentVersions.documentId))
    .leftJoin(events, eq(events.id, documents.eventId))
    .where(
      and(
        eq(documents.teamId, user.teamId),
        isNull(documents.deletedAt),
        gte(documentVersions.createdAt, windowStart),
      ),
    )
    .orderBy(desc(documentVersions.createdAt));
  const seenDocs = new Set<string>();
  const dedupedDocs = recentDocs.filter((d) => {
    if (seenDocs.has(d.id)) return false;
    seenDocs.add(d.id);
    return true;
  });

  const input: DigestInput = {
    user: { id: user.id, name: user.name, role: user.role },
    period: { fromIso: startIso, toIso: endIso },
    upcomingTodos: upcomingTodos.map((t) => ({
      id: t.id,
      title: t.title,
      eventName: t.eventName ?? null,
    })),
    upcomingEvents: upcomingEvents.map((e) => ({
      id: e.id,
      name: e.name,
      eventDate: e.eventDate,
      location: e.location,
    })),
    expirations: warnings.map((w) => ({
      id: w.item.id,
      label: w.item.label,
      band: w.band,
      daysUntilExpiry: w.daysUntilExpiry,
    })),
    newOrUpdatedDocuments: dedupedDocs.map((d) => ({
      id: d.id,
      name: d.name,
      eventName: d.eventName ?? null,
      versionNumber: d.versionNumber,
      mustAcknowledge: d.mustAcknowledge,
    })),
  };

  const digest = composeDigest(input);

  // Email is mandatory while account is active; we send even on quiet weeks
  // unless the user is revoked (already filtered).
  const result = await recordAndSend({
    teamId: user.teamId,
    userId: user.id,
    channel: "email",
    kind: "digest",
    recipient: user.email,
    subject: digest.subject,
    body: digest.body,
  });

  return {
    userId: user.id,
    email: user.email,
    delivered: result.delivered,
    hasContent: digest.hasContent,
    error: result.error,
  };
}

/**
 * Send a single SMS to every user with sms_opt_in=true and a phone_number,
 * for any item entering the 1-week expiry band today (i.e., daysUntilExpiry
 * crossed from 8 → 7). For v1 simplicity we send the alert as long as days
 * is in the 1w band — recipient-side dedup is the audit log if you want it.
 */
export async function runDailyExpiryAlerts(referenceDate: Date = new Date()): Promise<{
  sent: number;
  failed: number;
}> {
  const allUsers = await db
    .select({
      id: users.id,
      teamId: users.teamId,
      name: users.name,
      phoneNumber: users.phoneNumber,
      smsOptIn: users.smsOptIn,
    })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        eq(users.smsOptIn, true),
        isNotNull(users.phoneNumber),
      ),
    );

  let sent = 0;
  let failed = 0;

  // Group users by team — we send the same alert to every opted-in member of
  // the team that has any 1w-band items.
  const byTeam = new Map<string, typeof allUsers>();
  for (const u of allUsers) {
    const list = byTeam.get(u.teamId) ?? [];
    list.push(u);
    byTeam.set(u.teamId, list);
  }

  for (const [teamId, teamUsers] of byTeam.entries()) {
    const safety = await db
      .select({
        id: safetyItems.id,
        type: safetyItems.type,
        serial: safetyItems.serial,
        expiryDate: safetyItems.expiryDate,
      })
      .from(safetyItems)
      .where(and(eq(safetyItems.teamId, teamId), isNull(safetyItems.deletedAt)));
    const lics = await db
      .select({
        id: licenseDocs.id,
        kind: licenseDocs.kind,
        expiryDate: licenseDocs.expiryDate,
        holderName: users.name,
      })
      .from(licenseDocs)
      .innerJoin(users, eq(users.id, licenseDocs.holderUserId))
      .where(and(eq(licenseDocs.teamId, teamId), isNull(licenseDocs.deletedAt)));

    const warnings = deriveWarnings(
      [
        ...safety.map((s) => ({
          id: `safety:${s.id}`,
          label: `${s.type.replace(/_/g, " ")}${s.serial ? ` · ${s.serial}` : ""}`,
          expiryDate: s.expiryDate ? new Date(`${s.expiryDate}T00:00:00Z`) : null,
        })),
        ...lics.map((l) => ({
          id: `license:${l.id}`,
          label: `${l.kind} license · ${l.holderName}`,
          expiryDate: l.expiryDate ? new Date(`${l.expiryDate}T00:00:00Z`) : null,
        })),
      ],
      referenceDate,
    );
    const oneWeek = warnings.filter((w) => w.band === "1w" || w.band === "expired");
    if (oneWeek.length === 0) continue;

    const lines = oneWeek.map((w) => {
      const days = w.daysUntilExpiry;
      if (days === null) return `• ${w.item.label}`;
      if (days < 0) return `• ${w.item.label} (expired ${-days}d ago)`;
      return `• ${w.item.label} (${days}d)`;
    });
    const body = `Rally Commander: items expiring soon —\n${lines.join("\n")}`;

    for (const u of teamUsers) {
      if (!u.phoneNumber) continue;
      const r = await recordAndSend({
        teamId: u.teamId,
        userId: u.id,
        channel: "sms",
        kind: "expiry_alert",
        recipient: u.phoneNumber,
        subject: null,
        body,
      });
      if (r.delivered) sent++;
      else failed++;
    }
  }

  return { sent, failed };
}

// Suppress unused-import lint for the OR helper kept around for future
// refinement of digest queries.
void or;
