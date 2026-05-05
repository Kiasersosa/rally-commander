import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, movementPlanDays, movementPlanEntries } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/authz";

type Params = Promise<{ eventId: string }>;

export default async function MovementPlanPrintPage({ params }: { params: Params }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { eventId } = await params;

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.teamId, me.teamId)))
    .limit(1);
  if (!event) notFound();

  const days = await db
    .select()
    .from(movementPlanDays)
    .where(and(eq(movementPlanDays.teamId, me.teamId), eq(movementPlanDays.eventId, eventId)))
    .orderBy(asc(movementPlanDays.orderIndex));

  const entries = await db
    .select()
    .from(movementPlanEntries)
    .where(and(eq(movementPlanEntries.teamId, me.teamId), eq(movementPlanEntries.eventId, eventId)))
    .orderBy(asc(movementPlanEntries.dayId), asc(movementPlanEntries.orderIndex));

  const byDay = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = byDay.get(e.dayId) ?? [];
    list.push(e);
    byDay.set(e.dayId, list);
  }

  return (
    <main className="print-page mx-auto max-w-5xl bg-white px-10 py-10 text-black">
      <style>{`
        @media print {
          @page { margin: 0.5in; size: landscape; }
          body { background: white !important; }
        }
        .print-page { color: #000; }
        .print-page table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
        .print-page th, .print-page td {
          border: 1px solid #aaa;
          padding: 5px 7px;
          font-size: 11px;
          text-align: left;
          vertical-align: top;
        }
        .print-page th { background: #f3f4f6; font-weight: 700; }
        .print-page h2 { margin-top: 22px; margin-bottom: 6px; font-size: 14px; font-weight: 700; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
        .print-page a { color: #1d4ed8; text-decoration: underline; }
        .no-print { display: none; }
        @media screen {
          .no-print { display: inline; }
        }
      `}</style>

      <header className="mb-6 border-b border-gray-300 pb-4 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold">Movement Plan — {event.name}</h1>
          <p className="text-sm text-gray-600">{event.eventDate} · {event.location}</p>
        </div>
        <button
          className="no-print text-sm underline text-blue-600 cursor-pointer"
          onClick={() => window.print()}
        >
          Print / Save PDF
        </button>
      </header>

      {days.length === 0 && (
        <p className="text-gray-500 italic">No movement plan entries.</p>
      )}

      {days.map((day) => {
        const dayEntries = byDay.get(day.id) ?? [];
        return (
          <section key={day.id}>
            <h2>{day.label}</h2>
            <table>
              <thead>
                <tr>
                  <th style={{ width: "12%" }}>Who</th>
                  <th style={{ width: "18%" }}>What</th>
                  <th style={{ width: "18%" }}>Where</th>
                  <th style={{ width: "10%" }}>When</th>
                  <th style={{ width: "9%" }}>Travel</th>
                  <th>Comments</th>
                </tr>
              </thead>
              <tbody>
                {dayEntries.length === 0 ? (
                  <tr><td colSpan={6} style={{ color: "#888", fontStyle: "italic" }}>No entries.</td></tr>
                ) : (
                  dayEntries.map((e) => (
                    <tr key={e.id}>
                      <td>{e.who || "—"}</td>
                      <td style={{ fontWeight: 600 }}>{e.what}</td>
                      <td>
                        {e.whereLabel ? (
                          e.whereUrl ? (
                            <a href={e.whereUrl} target="_blank" rel="noopener noreferrer">{e.whereLabel}</a>
                          ) : e.whereLabel
                        ) : "—"}
                      </td>
                      <td>{e.whenTime ?? "—"}</td>
                      <td style={{ color: "#555" }}>{e.travelTime ?? "—"}</td>
                      <td style={{ color: "#555", fontSize: 10 }}>{e.comments ?? ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        );
      })}

      <footer className="mt-8 text-xs text-gray-500 border-t border-gray-200 pt-4">
        Printed from Rally Commander on {new Date().toISOString().slice(0, 10)}.
      </footer>
    </main>
  );
}
