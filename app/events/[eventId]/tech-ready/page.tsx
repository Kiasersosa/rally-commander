import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  events,
  licenseDocs,
  safetyItems,
  users,
  type LicenseKind,
  type SafetyItemType,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import {
  BAND_BADGE_CLASS,
  BAND_LABEL,
  deriveWarnings,
} from "@/lib/safety-expiry-warner";

type Params = Promise<{ eventId: string }>;

const SAFETY_LABEL: Record<SafetyItemType, string> = {
  helmet: "Helmet",
  hans: "HANS / FHR",
  suit: "Suit",
  harness: "Harness",
  fuel_cell: "Fuel cell",
  fire_extinguisher: "Fire extinguisher",
  other: "Other",
};

const LICENSE_LABEL: Record<LicenseKind, string> = {
  ara: "ARA license",
  fia: "FIA license",
  medical: "Medical certificate",
};

export default async function TechReadyPage({
  params,
}: {
  params: Params;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { eventId } = await params;

  const [event] = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.teamId, me.teamId),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);
  if (!event) notFound();

  const safety = await db
    .select({
      id: safetyItems.id,
      type: safetyItems.type,
      spec: safetyItems.spec,
      serial: safetyItems.serial,
      expiryDate: safetyItems.expiryDate,
      ownerName: users.name,
    })
    .from(safetyItems)
    .leftJoin(users, eq(users.id, safetyItems.ownerUserId))
    .where(and(eq(safetyItems.teamId, me.teamId), isNull(safetyItems.deletedAt)))
    .orderBy(asc(safetyItems.type));

  const licenses = await db
    .select({
      id: licenseDocs.id,
      kind: licenseDocs.kind,
      licenseNumber: licenseDocs.licenseNumber,
      expiryDate: licenseDocs.expiryDate,
      holderName: users.name,
    })
    .from(licenseDocs)
    .innerJoin(users, eq(users.id, licenseDocs.holderUserId))
    .where(and(eq(licenseDocs.teamId, me.teamId), isNull(licenseDocs.deletedAt)))
    .orderBy(asc(users.name), asc(licenseDocs.kind));

  // Reference date = the event date — that's the day this report needs to be green.
  const referenceDate = new Date(`${event.eventDate}T00:00:00Z`);

  const safetyWarnings = deriveWarnings(
    safety.map((s) => ({
      id: s.id,
      label: `${SAFETY_LABEL[s.type]}${s.serial ? ` · ${s.serial}` : ""}${s.ownerName ? ` (${s.ownerName})` : ""}`,
      expiryDate: s.expiryDate ? new Date(`${s.expiryDate}T00:00:00Z`) : null,
    })),
    referenceDate,
  );
  const licenseWarnings = deriveWarnings(
    licenses.map((l) => ({
      id: l.id,
      label: `${l.holderName} · ${LICENSE_LABEL[l.kind]}`,
      expiryDate: l.expiryDate ? new Date(`${l.expiryDate}T00:00:00Z`) : null,
    })),
    referenceDate,
  );

  const allWarnings = [...safetyWarnings, ...licenseWarnings];
  const greenCount = allWarnings.filter((w) => w.band === "ok").length;
  const yellowCount = allWarnings.filter((w) =>
    ["6mo", "3mo", "1mo"].includes(w.band),
  ).length;
  const redCount = allWarnings.filter((w) =>
    ["1w", "expired"].includes(w.band),
  ).length;
  const noExpiryCount = allWarnings.filter((w) => w.band === "no_expiry").length;
  const overallStatus = redCount > 0 ? "red" : yellowCount > 0 ? "yellow" : "green";

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="rc-muted mb-2 text-sm">
          <Link href={`/events/${eventId}`} className="rc-link">
            ← {event.name}
          </Link>
        </div>
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Tech-ready</h1>
            <p className="rc-muted mt-1 text-sm">
              Status as of event date {event.eventDate}. Items expiring before
              or on the event date are flagged.
            </p>
          </div>
          <span
            className={`rc-badge rc-badge-${overallStatus === "green" ? "on_event" : overallStatus === "yellow" ? "prep" : "post_event"}`}
          >
            {overallStatus.toUpperCase()} · {redCount} red · {yellowCount} yellow ·{" "}
            {greenCount} green
            {noExpiryCount > 0 ? ` · ${noExpiryCount} unknown` : ""}
          </span>
        </header>

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Safety gear</h2>
          {safetyWarnings.length === 0 ? (
            <p className="rc-muted text-sm">
              No safety items registered.{" "}
              <Link href="/safety" className="rc-link">
                Add some on /safety
              </Link>
              .
            </p>
          ) : (
            <ul className="rc-list">
              {safetyWarnings.map((w) => (
                <li key={w.item.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">{w.item.label}</div>
                    <div className="rc-muted text-sm">
                      {w.item.expiryDate
                        ? `expires ${w.item.expiryDate.toISOString().slice(0, 10)} · ${w.daysUntilExpiry} days from event`
                        : "no expiry recorded"}
                    </div>
                  </div>
                  <span className={`rc-badge ${BAND_BADGE_CLASS[w.band]}`}>
                    {BAND_LABEL[w.band]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Licenses & medical</h2>
          {licenseWarnings.length === 0 ? (
            <p className="rc-muted text-sm">
              No licenses registered.{" "}
              <Link href="/safety" className="rc-link">
                Add some on /safety
              </Link>
              .
            </p>
          ) : (
            <ul className="rc-list">
              {licenseWarnings.map((w) => (
                <li key={w.item.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">{w.item.label}</div>
                    <div className="rc-muted text-sm">
                      {w.item.expiryDate
                        ? `expires ${w.item.expiryDate.toISOString().slice(0, 10)} · ${w.daysUntilExpiry} days from event`
                        : "no expiry recorded"}
                    </div>
                  </div>
                  <span className={`rc-badge ${BAND_BADGE_CLASS[w.band]}`}>
                    {BAND_LABEL[w.band]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
