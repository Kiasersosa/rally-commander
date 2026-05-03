import { notFound, redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  events,
  hotelBookings,
  itineraryLegAssignees,
  itineraryLegs,
  mealPlanItems,
  users,
  vehicles,
} from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/authz";

type Params = Promise<{ eventId: string }>;

function fmtDateTime(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16);
}

export default async function ItineraryPrintPage({
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

  const legs = await db
    .select({
      id: itineraryLegs.id,
      orderIndex: itineraryLegs.orderIndex,
      fromLocation: itineraryLegs.fromLocation,
      toLocation: itineraryLegs.toLocation,
      vehicleName: vehicles.name,
      departAt: itineraryLegs.departAt,
      arriveAt: itineraryLegs.arriveAt,
      notes: itineraryLegs.notes,
    })
    .from(itineraryLegs)
    .leftJoin(vehicles, eq(vehicles.id, itineraryLegs.vehicleId))
    .where(
      and(
        eq(itineraryLegs.teamId, me.teamId),
        eq(itineraryLegs.eventId, eventId),
      ),
    )
    .orderBy(asc(itineraryLegs.orderIndex));

  const assignees = await db
    .select({
      legId: itineraryLegAssignees.legId,
      userName: users.name,
    })
    .from(itineraryLegAssignees)
    .innerJoin(users, eq(users.id, itineraryLegAssignees.userId))
    .where(eq(itineraryLegAssignees.teamId, me.teamId));
  const byLeg = new Map<string, string[]>();
  for (const a of assignees) {
    const list = byLeg.get(a.legId) ?? [];
    list.push(a.userName);
    byLeg.set(a.legId, list);
  }

  const hotels = await db
    .select()
    .from(hotelBookings)
    .where(
      and(
        eq(hotelBookings.teamId, me.teamId),
        eq(hotelBookings.eventId, eventId),
      ),
    )
    .orderBy(asc(hotelBookings.checkInDate));

  const meals = await db
    .select({
      id: mealPlanItems.id,
      whenAt: mealPlanItems.whenAt,
      whereAt: mealPlanItems.whereAt,
      what: mealPlanItems.what,
      assigneeName: users.name,
    })
    .from(mealPlanItems)
    .leftJoin(users, eq(users.id, mealPlanItems.assigneeUserId))
    .where(
      and(
        eq(mealPlanItems.teamId, me.teamId),
        eq(mealPlanItems.eventId, eventId),
      ),
    )
    .orderBy(asc(mealPlanItems.whenAt));

  return (
    <main className="print-page mx-auto max-w-4xl bg-white px-10 py-10 text-black">
      <style>{`
        @media print {
          @page { margin: 0.5in; }
          body { background: white !important; }
        }
        .print-page { color: #000; }
        .print-page table { width: 100%; border-collapse: collapse; }
        .print-page th, .print-page td {
          border: 1px solid #999;
          padding: 6px 8px;
          font-size: 12px;
          text-align: left;
          vertical-align: top;
        }
        .print-page th { background: #f3f4f6; font-weight: 600; }
        .print-page h2 { margin-top: 18px; margin-bottom: 8px; }
      `}</style>

      <header className="mb-6 border-b border-gray-300 pb-4">
        <h1 className="text-2xl font-bold">Itinerary — {event.name}</h1>
        <p className="text-sm">
          {event.eventDate} · {event.location}
          {event.araRoundNumber ? ` · ARA round ${event.araRoundNumber}` : ""}
        </p>
      </header>

      <h2 className="text-lg font-semibold">Legs</h2>
      <table>
        <thead>
          <tr>
            <th style={{ width: "3%" }}>#</th>
            <th style={{ width: "22%" }}>From → To</th>
            <th style={{ width: "13%" }}>Vehicle</th>
            <th style={{ width: "16%" }}>Depart</th>
            <th style={{ width: "16%" }}>Arrive</th>
            <th style={{ width: "30%" }}>Crew / Notes</th>
          </tr>
        </thead>
        <tbody>
          {legs.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ color: "#888" }}>
                No legs scheduled.
              </td>
            </tr>
          ) : (
            legs.map((l, idx) => (
              <tr key={l.id}>
                <td>{idx + 1}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{l.fromLocation}</div>
                  <div>→ {l.toLocation}</div>
                </td>
                <td>{l.vehicleName ?? ""}</td>
                <td>{fmtDateTime(l.departAt)}</td>
                <td>{fmtDateTime(l.arriveAt)}</td>
                <td>
                  {(byLeg.get(l.id) ?? []).join(", ")}
                  {l.notes ? (
                    <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
                      {l.notes}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h2 className="text-lg font-semibold">Hotels</h2>
      <table>
        <thead>
          <tr>
            <th style={{ width: "20%" }}>Hotel</th>
            <th style={{ width: "22%" }}>Address</th>
            <th style={{ width: "12%" }}>Conf #</th>
            <th style={{ width: "8%" }}>In</th>
            <th style={{ width: "8%" }}>Out</th>
            <th style={{ width: "30%" }}>Rooms</th>
          </tr>
        </thead>
        <tbody>
          {hotels.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ color: "#888" }}>
                No hotel bookings.
              </td>
            </tr>
          ) : (
            hotels.map((h) => (
              <tr key={h.id}>
                <td style={{ fontWeight: 600 }}>{h.name}</td>
                <td>{h.address ?? ""}</td>
                <td>{h.confirmationNumber ?? ""}</td>
                <td>{h.checkInDate ?? ""}</td>
                <td>{h.checkOutDate ?? ""}</td>
                <td>
                  {h.roomAssignments ?? ""}
                  {h.notes ? (
                    <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>
                      {h.notes}
                    </div>
                  ) : null}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <h2 className="text-lg font-semibold">Meal plan</h2>
      <table>
        <thead>
          <tr>
            <th style={{ width: "20%" }}>When</th>
            <th style={{ width: "20%" }}>Where</th>
            <th style={{ width: "40%" }}>What</th>
            <th style={{ width: "20%" }}>Brought by</th>
          </tr>
        </thead>
        <tbody>
          {meals.length === 0 ? (
            <tr>
              <td colSpan={4} style={{ color: "#888" }}>
                No meals planned.
              </td>
            </tr>
          ) : (
            meals.map((m) => (
              <tr key={m.id}>
                <td>{fmtDateTime(m.whenAt)}</td>
                <td>{m.whereAt ?? ""}</td>
                <td style={{ fontWeight: 600 }}>{m.what}</td>
                <td>{m.assigneeName ?? ""}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <footer className="mt-8 text-xs text-gray-600">
        Printed from Rally Commander on{" "}
        {new Date().toISOString().slice(0, 10)}.
      </footer>
    </main>
  );
}
