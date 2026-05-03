// Pure deep module that composes a weekly digest body for a user. No DB,
// no I/O. Tests live in tests/notification-digest-composer.test.ts.
//
// Sixth deep module (5 v1-required + 1 bonus + this one).

import type { ExpiryBand } from "./safety-expiry-warner";

export type DigestUser = {
  id: string;
  name: string;
  role: string;
};

export type DigestPeriod = {
  fromIso: string;
  toIso: string;
};

export type DigestTodo = {
  id: string;
  title: string;
  eventName: string | null;
};

export type DigestEvent = {
  id: string;
  name: string;
  eventDate: string; // YYYY-MM-DD
  location: string;
};

export type DigestExpiration = {
  id: string;
  label: string;
  band: ExpiryBand;
  daysUntilExpiry: number | null;
};

export type DigestDocument = {
  id: string;
  name: string;
  eventName: string | null;
  versionNumber: number;
  mustAcknowledge: boolean;
};

export type DigestInput = {
  user: DigestUser;
  period: DigestPeriod;
  upcomingTodos: DigestTodo[];
  upcomingEvents: DigestEvent[];
  expirations: DigestExpiration[];
  newOrUpdatedDocuments: DigestDocument[];
};

export type Digest = {
  subject: string;
  /** Plain-text body. Multi-line with section headers. */
  body: string;
  hasContent: boolean;
  todoCount: number;
  expirationCount: number;
  documentCount: number;
};

const ATTENTION_BANDS: ExpiryBand[] = [
  "expired",
  "1w",
  "1mo",
  "3mo",
  "6mo",
];

const BAND_HEADER: Record<ExpiryBand, string> = {
  expired: "Expired",
  "1w": "Within 1 week",
  "1mo": "Within 1 month",
  "3mo": "Within 3 months",
  "6mo": "Within 6 months",
  ok: "OK",
  no_expiry: "No expiry on file",
};

function escapePlain(s: string): string {
  return s.replace(/<[^>]+>/g, "");
}

export function composeDigest(input: DigestInput): Digest {
  const expirations = input.expirations.filter((e) =>
    ATTENTION_BANDS.includes(e.band),
  );

  const todoCount = input.upcomingTodos.length;
  const expirationCount = expirations.length;
  const documentCount = input.newOrUpdatedDocuments.length;
  const eventCount = input.upcomingEvents.length;
  const hasContent =
    todoCount > 0 ||
    expirationCount > 0 ||
    documentCount > 0 ||
    eventCount > 0;

  const lines: string[] = [];
  lines.push(`Hi ${escapePlain(input.user.name)},`);
  lines.push("");

  if (!hasContent) {
    lines.push("Nothing on the calendar this week — quiet week ahead.");
  } else {
    if (eventCount > 0) {
      lines.push("Upcoming events");
      lines.push("---------------");
      for (const e of input.upcomingEvents) {
        lines.push(`• ${escapePlain(e.name)} — ${e.eventDate} (${escapePlain(e.location)})`);
      }
      lines.push("");
    }

    if (todoCount > 0) {
      lines.push("Your todos");
      lines.push("----------");
      for (const t of input.upcomingTodos) {
        const ev = t.eventName ? ` [${escapePlain(t.eventName)}]` : "";
        lines.push(`• ${escapePlain(t.title)}${ev}`);
      }
      lines.push("");
    }

    if (expirationCount > 0) {
      lines.push("Expirations coming up");
      lines.push("---------------------");
      // Group by band in attention order
      for (const band of ATTENTION_BANDS) {
        const inBand = expirations.filter((e) => e.band === band);
        if (inBand.length === 0) continue;
        lines.push(`${BAND_HEADER[band]}:`);
        for (const e of inBand) {
          const days =
            e.daysUntilExpiry === null
              ? ""
              : e.daysUntilExpiry < 0
              ? ` (expired ${-e.daysUntilExpiry}d ago)`
              : ` (${e.daysUntilExpiry}d)`;
          lines.push(`  • ${escapePlain(e.label)}${days}`);
        }
      }
      lines.push("");
    }

    if (documentCount > 0) {
      lines.push("New and updated documents");
      lines.push("-------------------------");
      for (const d of input.newOrUpdatedDocuments) {
        const ev = d.eventName ? ` — ${escapePlain(d.eventName)}` : "";
        const mustAck = d.mustAcknowledge ? " (must acknowledge)" : "";
        lines.push(`• ${escapePlain(d.name)} · v${d.versionNumber}${ev}${mustAck}`);
      }
      lines.push("");
    }
  }

  lines.push("— Rally Commander");

  // Subject line: prioritize the most urgent thing
  let subject = "Rally Commander · weekly digest";
  const expired = expirations.find((e) => e.band === "expired");
  const oneWeek = expirations.find((e) => e.band === "1w");
  if (expired) {
    subject = `Rally Commander · attention: ${escapePlain(expired.label)} expired`;
  } else if (oneWeek) {
    subject = `Rally Commander · alert: ${escapePlain(oneWeek.label)} expiring this week`;
  } else if (eventCount > 0) {
    subject = `Rally Commander · ${escapePlain(input.upcomingEvents[0].name)} this week`;
  } else if (hasContent) {
    subject = `Rally Commander · weekly digest (${todoCount} todo${todoCount === 1 ? "" : "s"}, ${expirationCount} expiration${expirationCount === 1 ? "" : "s"})`;
  }

  return {
    subject,
    body: lines.join("\n"),
    hasContent,
    todoCount,
    expirationCount,
    documentCount,
  };
}
