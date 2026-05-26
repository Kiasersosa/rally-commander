import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { conditionReports, events, users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import { QuickLogModal } from "@/components/QuickLogModal";
import { createConditionReport } from "@/lib/actions/condition-reports";

type Params = Promise<{ eventId: string }>;

function ratingTag(n: number | null, label: string) {
  if (n === null) return null;
  const tone =
    n <= 2
      ? "bg-emerald-50 text-emerald-700 border-emerald-300"
      : n === 3
      ? "bg-amber-50 text-amber-700 border-amber-300"
      : "bg-rose-50 text-rose-700 border-rose-300";
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${tone}`}
    >
      <span className="rc-muted font-normal">{label}</span> {n}
    </span>
  );
}

export default async function ConditionReportsPage({
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

  const reports = await db
    .select({
      id: conditionReports.id,
      fatigueRating: conditionReports.fatigueRating,
      hydrationRating: conditionReports.hydrationRating,
      tempRating: conditionReports.tempRating,
      carConcerns: conditionReports.carConcerns,
      notes: conditionReports.notes,
      location: conditionReports.location,
      createdAt: conditionReports.createdAt,
      loggedByName: users.name,
    })
    .from(conditionReports)
    .innerJoin(users, eq(users.id, conditionReports.loggedByUserId))
    .where(
      and(
        eq(conditionReports.teamId, me.teamId),
        eq(conditionReports.eventId, eventId),
      ),
    )
    .orderBy(desc(conditionReports.createdAt));

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rc-muted mb-2 text-sm">
          <Link href="/events" className="rc-link">Events</Link>
          {" / "}
          <Link href={`/events/${eventId}`} className="rc-link">{event.name}</Link>
        </div>
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Condition reports</h1>
            <p className="rc-muted mt-1 text-sm">
              Driver + car condition log. Anyone in the car can submit while in transit.
            </p>
          </div>
          <QuickLogModal
            events={[{ id: eventId, name: event.name }]}
            action={createConditionReport}
          />
        </header>

        {reports.length === 0 ? (
          <div className="rc-empty-section text-center">
            No reports yet. Use the &ldquo;Quick log&rdquo; button above (or in the
            top nav) to log a report while in transit.
          </div>
        ) : (
          <ul className="rc-list">
            {reports.map((r) => (
              <li key={r.id} className="rc-list-row !items-start">
                <div className="flex-1">
                  <div className="flex flex-wrap items-baseline gap-2 mb-1">
                    <span className="font-semibold">{r.loggedByName}</span>
                    <span className="rc-muted text-xs">
                      {r.createdAt.toISOString().replace("T", " ").slice(0, 16)}
                    </span>
                    {r.location ? (
                      <span className="rc-muted text-xs">· {r.location}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {ratingTag(r.fatigueRating, "fatigue")}
                    {ratingTag(r.hydrationRating, "hydration")}
                    {ratingTag(r.tempRating, "temp")}
                  </div>
                  {r.carConcerns ? (
                    <div className="text-sm">
                      <span className="rc-muted text-xs font-semibold mr-1">CAR</span>
                      {r.carConcerns}
                    </div>
                  ) : null}
                  {r.notes ? (
                    <div className="text-sm mt-1 rc-muted">{r.notes}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
