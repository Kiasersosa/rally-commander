import { notFound, redirect } from "next/navigation";
import { aliasedTable, and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  events,
  eventStages,
  recceScheduleEntries,
  users,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/authz";

type Params = Promise<{ eventId: string }>;

export default async function RecceprintPage({
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
    .where(and(eq(events.id, eventId), eq(events.teamId, me.teamId)))
    .limit(1);
  if (!event) notFound();

  const stages = await db
    .select()
    .from(eventStages)
    .where(
      and(
        eq(eventStages.teamId, me.teamId),
        eq(eventStages.eventId, eventId),
      ),
    )
    .orderBy(asc(eventStages.stageNumber));

  const driverUsers = aliasedTable(users, "driver_users");
  const coDriverUsers = aliasedTable(users, "codriver_users");

  const entries = await db
    .select({
      id: recceScheduleEntries.id,
      stageNumber: eventStages.stageNumber,
      stageName: eventStages.name,
      day: recceScheduleEntries.day,
      passNumber: recceScheduleEntries.passNumber,
      driverName: driverUsers.name,
      coDriverName: coDriverUsers.name,
      notes: recceScheduleEntries.notes,
    })
    .from(recceScheduleEntries)
    .innerJoin(eventStages, eq(eventStages.id, recceScheduleEntries.stageId))
    .leftJoin(driverUsers, eq(driverUsers.id, recceScheduleEntries.driverUserId))
    .leftJoin(coDriverUsers, eq(coDriverUsers.id, recceScheduleEntries.coDriverUserId))
    .where(
      and(
        eq(recceScheduleEntries.teamId, me.teamId),
        eq(recceScheduleEntries.eventId, eventId),
      ),
    )
    .orderBy(
      asc(recceScheduleEntries.day),
      asc(eventStages.stageNumber),
      asc(recceScheduleEntries.passNumber),
    );

  return (
    <main className="print-page mx-auto max-w-4xl bg-white px-10 py-10 text-black">
      <style>{`
        @media print {
          @page { margin: 0.5in; }
          body { background: white !important; }
        }
        .print-page { color: #000; }
        .print-page table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        .print-page th, .print-page td {
          border: 1px solid #999;
          padding: 6px 8px;
          font-size: 12px;
          text-align: left;
          vertical-align: top;
        }
        .print-page th { background: #f3f4f6; font-weight: 600; }
        .print-page h2 { margin-top: 18px; margin-bottom: 4px; }
      `}</style>

      <header className="mb-6 border-b border-gray-300 pb-4">
        <h1 className="text-2xl font-bold">Recce — {event.name}</h1>
        <p className="text-sm">
          {event.eventDate} · {event.location}
          {event.araRoundNumber ? ` · ARA round ${event.araRoundNumber}` : ""}
        </p>
      </header>

      <h2 className="text-lg font-semibold">Stages</h2>
      <table>
        <thead>
          <tr>
            <th style={{ width: "8%" }}>#</th>
            <th style={{ width: "27%" }}>Name</th>
            <th style={{ width: "65%" }}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {stages.length === 0 ? (
            <tr>
              <td colSpan={3} style={{ color: "#888" }}>
                No stages defined.
              </td>
            </tr>
          ) : (
            stages.map((s) => (
              <tr key={s.id}>
                <td>SS{s.stageNumber}</td>
                <td style={{ fontWeight: 600 }}>{s.name}</td>
                <td>{s.notes ?? ""}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h2 className="text-lg font-semibold">Recce schedule</h2>
      <table>
        <thead>
          <tr>
            <th style={{ width: "10%" }}>Day</th>
            <th style={{ width: "8%" }}>Stage</th>
            <th style={{ width: "22%" }}>Name</th>
            <th style={{ width: "8%" }}>Pass</th>
            <th style={{ width: "16%" }}>Driver</th>
            <th style={{ width: "16%" }}>Co-driver</th>
            <th style={{ width: "20%" }}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={7} style={{ color: "#888" }}>
                No recce passes scheduled.
              </td>
            </tr>
          ) : (
            entries.map((e) => (
              <tr key={e.id}>
                <td>{e.day ?? ""}</td>
                <td>SS{e.stageNumber}</td>
                <td style={{ fontWeight: 600 }}>{e.stageName}</td>
                <td>{e.passNumber}</td>
                <td>{e.driverName ?? ""}</td>
                <td>{e.coDriverName ?? ""}</td>
                <td>{e.notes ?? ""}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {event.recceLogisticsNotes ? (
        <>
          <h2 className="text-lg font-semibold">Logistics</h2>
          <p
            style={{
              border: "1px solid #999",
              padding: "8px",
              fontSize: 12,
              whiteSpace: "pre-wrap",
            }}
          >
            {event.recceLogisticsNotes}
          </p>
        </>
      ) : null}

      <footer className="mt-8 text-xs text-gray-600">
        Printed from Rally Commander on{" "}
        {new Date().toISOString().slice(0, 10)}.
      </footer>
    </main>
  );
}
