import { redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  budgetLines,
  documentAcknowledgments,
  documentVersions,
  documents,
  events,
  expenseEntries,
  licenseDocs,
  safetyItems,
} from "@/lib/db/schema";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/documents";
import {
  ATTENTION_BANDS,
  BAND_BADGE_CLASS,
  BAND_LABEL,
  deriveWarnings,
} from "@/lib/safety-expiry-warner";
import { getCurrentUser, requireChief } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import { instantiateChecklistsForEvent } from "@/lib/checklists";
import {
  ALL_BUDGET_CATEGORIES,
  BUDGET_CATEGORY_LABEL,
  formatCents,
  reconcile,
} from "@/lib/budget-reconciler";

export default async function EventsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.teamId, user.teamId), isNull(events.deletedAt)))
    .orderBy(desc(events.eventDate));

  // Season rollup for the current year — aggregates budgets + expenses across
  // all events whose event_date is in YYYY-01-01..YYYY-12-31.
  const currentYear = new Date().getUTCFullYear();
  const yearStart = `${currentYear}-01-01`;
  const yearEnd = `${currentYear}-12-31`;

  const seasonBudgets = await db
    .select({
      category: budgetLines.category,
      total: sql<number>`COALESCE(SUM(${budgetLines.estimatedCents}), 0)::int`,
    })
    .from(budgetLines)
    .innerJoin(events, eq(events.id, budgetLines.eventId))
    .where(
      and(
        eq(budgetLines.teamId, user.teamId),
        sql`${events.eventDate} BETWEEN ${yearStart} AND ${yearEnd}`,
      ),
    )
    .groupBy(budgetLines.category);

  const seasonExpenses = await db
    .select({
      category: expenseEntries.category,
      total: sql<number>`COALESCE(SUM(${expenseEntries.amountCents}), 0)::int`,
    })
    .from(expenseEntries)
    .innerJoin(events, eq(events.id, expenseEntries.eventId))
    .where(
      and(
        eq(expenseEntries.teamId, user.teamId),
        sql`${events.eventDate} BETWEEN ${yearStart} AND ${yearEnd}`,
      ),
    )
    .groupBy(expenseEntries.category);

  // Documents the current user must acknowledge but hasn't (or has acked
  // an older version). One row per stale doc.
  const pendingAcks = await db
    .select({
      id: documents.id,
      name: documents.name,
      category: documents.category,
      eventId: documents.eventId,
      eventName: events.name,
      latestVersionNumber: sql<number>`(SELECT version_number FROM ${documentVersions} v WHERE v.team_id = ${documents.teamId} AND v.document_id = ${documents.id} ORDER BY v.version_number DESC LIMIT 1)::int`,
      latestVersionId: sql<string>`(SELECT id FROM ${documentVersions} v WHERE v.team_id = ${documents.teamId} AND v.document_id = ${documents.id} ORDER BY v.version_number DESC LIMIT 1)`,
      myAckVersionId: sql<string | null>`(SELECT version_id FROM ${documentAcknowledgments} a WHERE a.team_id = ${documents.teamId} AND a.document_id = ${documents.id} AND a.user_id = ${user.userId} LIMIT 1)`,
    })
    .from(documents)
    .leftJoin(events, eq(events.id, documents.eventId))
    .where(
      and(
        eq(documents.teamId, user.teamId),
        eq(documents.mustAcknowledge, true),
        isNull(documents.deletedAt),
      ),
    );
  const stalePendingAcks = pendingAcks.filter(
    (p) => p.latestVersionId && p.myAckVersionId !== p.latestVersionId,
  );

  // Expiry warnings across safety + licenses (team-wide)
  const safetyForWarnings = await db
    .select({
      id: safetyItems.id,
      type: safetyItems.type,
      serial: safetyItems.serial,
      expiryDate: safetyItems.expiryDate,
    })
    .from(safetyItems)
    .where(and(eq(safetyItems.teamId, user.teamId), isNull(safetyItems.deletedAt)));
  const licensesForWarnings = await db
    .select({
      id: licenseDocs.id,
      kind: licenseDocs.kind,
      expiryDate: licenseDocs.expiryDate,
      holderId: licenseDocs.holderUserId,
    })
    .from(licenseDocs)
    .where(and(eq(licenseDocs.teamId, user.teamId), isNull(licenseDocs.deletedAt)));

  const today = new Date();
  const allExpiryWarnings = deriveWarnings(
    [
      ...safetyForWarnings.map((s) => ({
        id: `safety:${s.id}`,
        label: `${s.type.replace(/_/g, " ")}${s.serial ? ` · ${s.serial}` : ""}`,
        expiryDate: s.expiryDate ? new Date(`${s.expiryDate}T00:00:00Z`) : null,
      })),
      ...licensesForWarnings.map((l) => ({
        id: `license:${l.id}`,
        label: `${l.kind} license`,
        expiryDate: l.expiryDate ? new Date(`${l.expiryDate}T00:00:00Z`) : null,
      })),
    ],
    today,
  );
  const attentionWarnings = allExpiryWarnings.filter((w) =>
    ATTENTION_BANDS.includes(w.band),
  );

  const seasonVariance = reconcile(
    seasonBudgets.map((r) => ({
      category: r.category,
      estimatedCents: Number(r.total),
    })),
    seasonExpenses.map((r) => ({
      category: r.category,
      amountCents: Number(r.total),
    })),
  );

  async function createEvent(formData: FormData) {
    "use server";
    const u = await requireChief();
    const name = String(formData.get("name") ?? "").trim();
    const eventDate = String(formData.get("event_date") ?? "").trim();
    const location = String(formData.get("location") ?? "").trim();
    const roundRaw = String(formData.get("ara_round_number") ?? "").trim();
    const araRoundNumber = roundRaw ? Number.parseInt(roundRaw, 10) : null;

    if (!name || !eventDate || !location) {
      throw new Error("name, date, and location are required");
    }
    const [created] = await db
      .insert(events)
      .values({
        teamId: u.teamId,
        name,
        eventDate,
        location,
        araRoundNumber: Number.isFinite(araRoundNumber) ? araRoundNumber : null,
      })
      .returning({ id: events.id });
    // Auto-instantiate checklist templates for every active vehicle.
    await instantiateChecklistsForEvent(u.teamId, created.id);
    revalidatePath("/events");
  }

  return (
    <>
      <Nav user={user} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Season dashboard</h1>
          <p className="rc-muted mt-1 text-sm">
            Every rally on the calendar. Click in for prep, todos, debrief.
          </p>
        </header>

        {user.role === "chief" ? (
          <form
            action={createEvent}
            className="rc-card mb-8 grid grid-cols-1 gap-3 sm:grid-cols-12"
          >
            <input
              name="name"
              required
              placeholder="Event name (e.g., Olympus 2026)"
              className="rc-input sm:col-span-5"
            />
            <input
              name="event_date"
              type="date"
              required
              className="rc-input sm:col-span-3"
            />
            <input
              name="location"
              required
              placeholder="Location"
              className="rc-input sm:col-span-2"
            />
            <input
              name="ara_round_number"
              type="number"
              min={1}
              placeholder="Round #"
              className="rc-input sm:col-span-2"
            />
            <button
              type="submit"
              className="rc-btn rc-btn-primary sm:col-span-12"
            >
              Create event
            </button>
          </form>
        ) : null}

        {attentionWarnings.length > 0 ? (
          <section className="mb-8">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-base font-semibold uppercase tracking-wide rc-muted">
                Expiry warnings
              </h2>
              <Link href="/safety" className="rc-link text-xs">
                Manage →
              </Link>
            </div>
            <ul className="rc-list">
              {attentionWarnings.slice(0, 8).map((w) => (
                <li key={w.item.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">{w.item.label}</div>
                    <div className="rc-muted text-sm">
                      {w.item.expiryDate
                        ? `expires ${w.item.expiryDate.toISOString().slice(0, 10)} · ${w.daysUntilExpiry} days`
                        : "no expiry"}
                    </div>
                  </div>
                  <span className={`rc-badge ${BAND_BADGE_CLASS[w.band]}`}>
                    {BAND_LABEL[w.band]}
                  </span>
                </li>
              ))}
            </ul>
            {attentionWarnings.length > 8 ? (
              <p className="rc-muted mt-2 text-xs">
                + {attentionWarnings.length - 8} more on{" "}
                <Link href="/safety" className="rc-link">
                  /safety
                </Link>
              </p>
            ) : null}
          </section>
        ) : null}

        {stalePendingAcks.length > 0 ? (
          <section className="mb-8">
            <h2 className="mb-3 text-base font-semibold uppercase tracking-wide rc-muted">
              Needs your acknowledgment
            </h2>
            <ul className="rc-list">
              {stalePendingAcks.map((p) => (
                <li key={p.id} className="rc-list-row">
                  <div className="flex-1">
                    <Link
                      href={`/documents/${p.id}`}
                      className="rc-link font-medium"
                    >
                      {p.name}
                    </Link>
                    <div className="rc-muted text-sm">
                      {DOCUMENT_CATEGORY_LABEL[p.category]} · v
                      {p.latestVersionNumber}
                      {p.eventName ? ` · ${p.eventName}` : ""}
                    </div>
                  </div>
                  <span className="rc-badge rc-badge-post_event">Pending</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {seasonVariance.byCategory.length > 0 ? (
          <section className="mb-8">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-semibold uppercase tracking-wide rc-muted">
                {currentYear} season spend by category
              </h2>
              <div className="text-sm">
                <span className="rc-muted">Est </span>
                <span className="font-medium">
                  {formatCents(seasonVariance.totalEstimatedCents)}
                </span>
                <span className="rc-muted"> · Actual </span>
                <span className="font-medium">
                  {formatCents(seasonVariance.totalActualCents)}
                </span>
                <span className="rc-muted"> · Var </span>
                <span
                  className={
                    seasonVariance.totalVarianceCents < 0
                      ? "font-semibold text-rose-600 dark:text-rose-400"
                      : "font-semibold text-emerald-600 dark:text-emerald-400"
                  }
                >
                  {formatCents(seasonVariance.totalVarianceCents)}
                </span>
              </div>
            </div>
            <ul className="rc-list">
              {ALL_BUDGET_CATEGORIES.filter((cat) =>
                seasonVariance.byCategory.some((c) => c.category === cat),
              ).map((cat) => {
                const c = seasonVariance.byCategory.find((x) => x.category === cat)!;
                return (
                  <li key={cat} className="rc-list-row">
                    <div className="flex-1">
                      <div className="font-medium">
                        {BUDGET_CATEGORY_LABEL[cat]}
                      </div>
                      <div className="rc-muted text-sm">
                        Est {formatCents(c.estimatedCents)} · Actual{" "}
                        {formatCents(c.actualCents)}
                      </div>
                    </div>
                    <span
                      className={`rc-badge rc-badge-${
                        c.status === "over" || c.status === "no_budget"
                          ? "post_event"
                          : c.status === "no_actuals"
                          ? "planning"
                          : c.status === "on_budget"
                          ? "prep"
                          : "on_event"
                      }`}
                    >
                      {formatCents(c.varianceCents)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {rows.length === 0 ? (
          <div className="rc-empty-section text-center">
            No events yet.{" "}
            {user.role === "chief"
              ? "Add your first one above."
              : "Your chief hasn't scheduled one."}
          </div>
        ) : (
          <ul className="rc-list">
            {rows.map((e) => (
              <li key={e.id} className="rc-list-row">
                <div>
                  <Link
                    href={`/events/${e.id}`}
                    className="rc-link text-base font-semibold"
                  >
                    {e.name}
                  </Link>
                  <div className="rc-muted text-sm">
                    {e.eventDate} · {e.location}
                    {e.araRoundNumber ? ` · ARA round ${e.araRoundNumber}` : ""}
                  </div>
                </div>
                <span className={`rc-badge rc-badge-${e.phase}`}>
                  {e.phase.replace("_", " ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
