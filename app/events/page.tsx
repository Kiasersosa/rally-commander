import { redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { getCurrentUser, requireChief } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import { instantiateChecklistsForEvent } from "@/lib/checklists";

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
