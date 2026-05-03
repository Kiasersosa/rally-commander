import { redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { getCurrentUser, requireChief } from "@/lib/authz";
import { Nav } from "@/components/Nav";

export default async function EventsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const rows = await db
    .select()
    .from(events)
    .where(and(eq(events.teamId, user.teamId), isNull(events.deletedAt)))
    .orderBy(desc(events.eventDate));

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
    await db.insert(events).values({
      teamId: u.teamId,
      name,
      eventDate,
      location,
      araRoundNumber: Number.isFinite(araRoundNumber) ? araRoundNumber : null,
    });
    revalidatePath("/events");
  }

  return (
    <>
      <Nav user={user} />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-semibold">Season dashboard</h1>

        {user.role === "chief" ? (
          <form
            action={createEvent}
            className="mb-8 grid grid-cols-1 gap-3 rounded border border-neutral-200 p-4 sm:grid-cols-4"
          >
            <input
              name="name"
              required
              placeholder="Event name (e.g., Olympus 2026)"
              className="rounded border border-neutral-300 px-3 py-2 sm:col-span-2"
            />
            <input
              name="event_date"
              type="date"
              required
              className="rounded border border-neutral-300 px-3 py-2"
            />
            <input
              name="location"
              required
              placeholder="Location"
              className="rounded border border-neutral-300 px-3 py-2"
            />
            <input
              name="ara_round_number"
              type="number"
              min={1}
              placeholder="ARA round #"
              className="rounded border border-neutral-300 px-3 py-2"
            />
            <button
              type="submit"
              className="rounded bg-neutral-900 px-3 py-2 text-white hover:bg-neutral-800 sm:col-span-3"
            >
              Create event
            </button>
          </form>
        ) : null}

        {rows.length === 0 ? (
          <p className="text-neutral-500">No events yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
            {rows.map((e) => (
              <li key={e.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <Link
                    href={`/events/${e.id}`}
                    className="font-medium hover:underline"
                  >
                    {e.name}
                  </Link>
                  <div className="text-sm text-neutral-500">
                    {e.eventDate} · {e.location}
                    {e.araRoundNumber ? ` · ARA round ${e.araRoundNumber}` : ""}
                  </div>
                </div>
                <span className="rounded bg-neutral-100 px-2 py-1 text-xs uppercase tracking-wide text-neutral-600">
                  {e.phase}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
