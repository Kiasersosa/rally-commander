import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  events,
  movementPlanDays,
  movementPlanEntries,
  users,
} from "@/lib/db/schema";
import { getCurrentUser, requireChief } from "@/lib/authz";
import { Nav } from "@/components/Nav";

type Params = Promise<{ eventId: string }>;
type SearchParams = Promise<{ editEntry?: string; editDay?: string }>;

// ─── helpers ────────────────────────────────────────────────────────────────

function revalidate(eventId: string) {
  revalidatePath(`/events/${eventId}/movement-plan`);
}

// ─── server actions ──────────────────────────────────────────────────────────

async function addDay(eventId: string, teamId: string, formData: FormData) {
  "use server";
  const label = (formData.get("label") as string | null)?.trim();
  if (!label) return;
  const existing = await db
    .select({ orderIndex: movementPlanDays.orderIndex })
    .from(movementPlanDays)
    .where(and(eq(movementPlanDays.teamId, teamId), eq(movementPlanDays.eventId, eventId)))
    .orderBy(asc(movementPlanDays.orderIndex));
  const next = existing.length > 0 ? existing[existing.length - 1].orderIndex + 1 : 0;
  await db.insert(movementPlanDays).values({ teamId, eventId, label, orderIndex: next });
  revalidate(eventId);
}

async function updateDay(eventId: string, teamId: string, dayId: string, formData: FormData) {
  "use server";
  const label = (formData.get("label") as string | null)?.trim();
  if (!label) return;
  await db
    .update(movementPlanDays)
    .set({ label, updatedAt: new Date() })
    .where(and(eq(movementPlanDays.id, dayId), eq(movementPlanDays.teamId, teamId)));
  revalidate(eventId);
}

async function deleteDay(eventId: string, teamId: string, dayId: string) {
  "use server";
  await db
    .delete(movementPlanDays)
    .where(and(eq(movementPlanDays.id, dayId), eq(movementPlanDays.teamId, teamId)));
  revalidate(eventId);
}

async function addEntry(eventId: string, teamId: string, dayId: string, formData: FormData) {
  "use server";
  const what = (formData.get("what") as string | null)?.trim();
  if (!what) return;
  const existing = await db
    .select({ orderIndex: movementPlanEntries.orderIndex })
    .from(movementPlanEntries)
    .where(and(eq(movementPlanEntries.teamId, teamId), eq(movementPlanEntries.dayId, dayId)))
    .orderBy(asc(movementPlanEntries.orderIndex));
  const next = existing.length > 0 ? existing[existing.length - 1].orderIndex + 1 : 0;
  await db.insert(movementPlanEntries).values({
    teamId,
    eventId,
    dayId,
    orderIndex: next,
    who: (formData.get("who") as string | null)?.trim() ?? "",
    what,
    whereLabel: (formData.get("whereLabel") as string | null)?.trim() || null,
    whereUrl: (formData.get("whereUrl") as string | null)?.trim() || null,
    whenTime: (formData.get("whenTime") as string | null)?.trim() || null,
    travelTime: (formData.get("travelTime") as string | null)?.trim() || null,
    comments: (formData.get("comments") as string | null)?.trim() || null,
  });
  revalidate(eventId);
}

async function updateEntry(eventId: string, teamId: string, entryId: string, formData: FormData) {
  "use server";
  const what = (formData.get("what") as string | null)?.trim();
  if (!what) return;
  await db
    .update(movementPlanEntries)
    .set({
      who: (formData.get("who") as string | null)?.trim() ?? "",
      what,
      whereLabel: (formData.get("whereLabel") as string | null)?.trim() || null,
      whereUrl: (formData.get("whereUrl") as string | null)?.trim() || null,
      whenTime: (formData.get("whenTime") as string | null)?.trim() || null,
      travelTime: (formData.get("travelTime") as string | null)?.trim() || null,
      comments: (formData.get("comments") as string | null)?.trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(movementPlanEntries.id, entryId), eq(movementPlanEntries.teamId, teamId)));
  revalidate(eventId);
}

async function deleteEntry(eventId: string, teamId: string, entryId: string) {
  "use server";
  await db
    .delete(movementPlanEntries)
    .where(and(eq(movementPlanEntries.id, entryId), eq(movementPlanEntries.teamId, teamId)));
  revalidate(eventId);
}

async function seedSOFR(eventId: string, teamId: string) {
  "use server";
  // Pre-populate SOFR 2026 movement plan based on supp regs.
  // Only seeds if no days exist yet.
  const existing = await db
    .select({ id: movementPlanDays.id })
    .from(movementPlanDays)
    .where(and(eq(movementPlanDays.teamId, teamId), eq(movementPlanDays.eventId, eventId)))
    .limit(1);
  if (existing.length > 0) return;

  const dayDefs = [
    {
      label: "Wednesday June 10 — Test Day / Recce Day 1",
      entries: [
        { who: "Jason, Gio", what: "Recce Day 1", whereLabel: "Ohio Division of Forestry", whenTime: "6:00am–8:00pm", travelTime: "", comments: "Recce open 06:00–20:00. Speed limit 30 mph on stages." },
        { who: "Crew", what: "Testing (session 1)", whereLabel: "Shakedown location (TBD on Sportity)", whenTime: "8:30am", travelTime: "", comments: "Morning session 08:30–11:30. Pay during entry or add via Sportity." },
        { who: "Crew", what: "Testing (session 2)", whereLabel: "Shakedown location (TBD on Sportity)", whenTime: "1:30pm", travelTime: "", comments: "Afternoon session 13:30–16:30." },
        { who: "Jason, Gio", what: "Driver/Co-Driver Check In", whereLabel: "Fairfield Inn & Suites, 300 N Plaza Blvd, Chillicothe OH", whenTime: "7:00pm–10:00pm", travelTime: "", comments: "Check in open 19:00–22:00." },
      ],
    },
    {
      label: "Thursday June 11 — Scrutineering / Parc Exposé / Leg 1",
      entries: [
        { who: "Jason, Gio", what: "Driver/Co-Driver Check In (if not done Wed)", whereLabel: "Fairfield Inn & Suites, 300 N Plaza Blvd, Chillicothe OH", whenTime: "6:00am–7:00am", travelTime: "", comments: "By appointment only — contact Event Registrar." },
        { who: "Jason, Gio", what: "Recce Day 2", whereLabel: "Ohio Division of Forestry", whenTime: "5:30am–4:00pm", travelTime: "", comments: "Recce closes 16:00 Thursday." },
        { who: "All", what: "Driver, Co-Driver & Crew Check In", whereLabel: "Chillicothe Transit Garage, 575 E 7th St, Chillicothe OH 45601", whenTime: "7:00am–12:00pm / 1:00pm–3:00pm", travelTime: "", comments: "" },
        { who: "Crew Chief", what: "Technical Inspection (scrutineering)", whereLabel: "Chillicothe Transit Garage, 575 E 7th St, Chillicothe OH 45601", whenTime: "By appt 7:00am–4:00pm", travelTime: "", comments: "Appointment required — email sofrtech@southernohioforestrally.com. RallySafe fitting kit must be installed on arrival." },
        { who: "All", what: "Parc Exposé check-in", whereLabel: "Chillicothe High School, 425 Yoctangee Pkwy, Chillicothe OH 45601", whenTime: "5:30pm (pos 1–25) / 5:45pm (26–50) / 6:00pm (50+)", travelTime: "", comments: "Check in early is fine, not before your window. Arrive in start order." },
        { who: "Jason, Gio", what: "Seeded draw", whereLabel: "CHS – ARA Stage", whenTime: "6:55pm", travelTime: "", comments: "" },
        { who: "Jason, Gio", what: "Drivers Meeting", whereLabel: "CHS – ARA Stage", whenTime: "7:00pm", travelTime: "", comments: "" },
        { who: "Jason, Gio", what: "First Car Out TC0 (MTC1)", whereLabel: "Chillicothe High School", whenTime: "7:46pm", travelTime: "", comments: "SS1 starts 20:00 at Yoctangee Park." },
        { who: "All", what: "End of Leg 1 — TC2A (MTC2)", whereLabel: "Chillicothe High School", whenTime: "~9:15pm", travelTime: "", comments: "Approx. No service park Thursday night." },
      ],
    },
    {
      label: "Friday June 12 — Leg 2 (Shawnee State Forest)",
      entries: [
        { who: "Crew", what: "Service Park opens", whereLabel: "Portsmouth West High School, 15332 US-52, West Portsmouth OH 45663", whenTime: "7:00am", travelTime: "", comments: "Oversize/heavy rigs park on lower-level gravel bus lot." },
        { who: "Crew", what: "Set up service bay", whereLabel: "Portsmouth West High School", whenTime: "7:00am", travelTime: "", comments: "Service spot 20×50 ft standard." },
        { who: "Jason, Gio", what: "First Car Out TC2B (MTC3)", whereLabel: "Portsmouth West High School", whenTime: "10:35am", travelTime: "", comments: "Be in MTC area ~4 min before assigned start time." },
        { who: "All", what: "Service / Tech Zone (45 min)", whereLabel: "Portsmouth West High School", whenTime: "~1:00pm", travelTime: "", comments: "FCI at TC6A. 45-minute service window." },
        { who: "All", what: "Service / Tech Zone (45 min)", whereLabel: "Portsmouth West High School", whenTime: "~4:25pm", travelTime: "", comments: "End of Leg 2 at TC10A (MTC4). Friday competition ends." },
        { who: "All", what: "Clean up service, load trailer", whereLabel: "Portsmouth West High School → Hotel", whenTime: "~5:00pm", travelTime: "", comments: "Drive to hotel once car is loaded." },
        { who: "Crew", what: "Reseed start list published", whereLabel: "Sportity app", whenTime: "~8:00pm", travelTime: "", comments: "Check Sportity for Saturday start order." },
      ],
    },
    {
      label: "Saturday June 13 — Leg 3 (Zaleski State Forest) / Finish",
      entries: [
        { who: "Crew", what: "Service Park opens", whereLabel: "Vinton County High School, 63910 US-50, McArthur OH 45651", whenTime: "7:00am", travelTime: "", comments: "" },
        { who: "Crew", what: "Set up service bay", whereLabel: "Vinton County High School", whenTime: "7:00am", travelTime: "", comments: "" },
        { who: "All", what: "Parc Exposé check-in", whereLabel: "Route 50, downtown McArthur OH", whenTime: "9:30am (pos 1–25) / 9:45am (26–50) / 10:00am (50+)", travelTime: "", comments: "" },
        { who: "Jason, Gio", what: "First Car Out TC10B (MTC5)", whereLabel: "McArthur OH", whenTime: "10:35am", travelTime: "", comments: "" },
        { who: "All", what: "Service / Tech Zone (45 min)", whereLabel: "Vinton County High School", whenTime: "~12:34pm", travelTime: "", comments: "FCI at TC14A. 45-minute service window." },
        { who: "All", what: "Regional finish — TC19A (MTC6) Parc Fermé", whereLabel: "Vinton County High School", whenTime: "~3:56pm", travelTime: "", comments: "Regional rally competition ends. Cars impounded for final checks." },
        { who: "All", what: "National TZ (20 min service)", whereLabel: "Vinton County High School", whenTime: "~3:56pm", travelTime: "", comments: "National FCI TC19B. 20-minute service." },
        { who: "All", what: "Regional Podium", whereLabel: "Vinton County High School", whenTime: "~4:45pm", travelTime: "", comments: "Alcohol-free zone — no alcohol on school property." },
        { who: "Jason, Gio", what: "National power stage SS20 + finish TC20A", whereLabel: "Vinton County High School", whenTime: "~5:28pm", travelTime: "", comments: "2-minute gaps on SS20 (Church of the Raccoons 2). National competition ends." },
        { who: "All", what: "National Podium + load out", whereLabel: "Vinton County High School", whenTime: "~6:00pm", travelTime: "", comments: "Hand RallySafe unit to ARA official after Parc Fermé." },
      ],
    },
  ];

  for (let di = 0; di < dayDefs.length; di++) {
    const def = dayDefs[di];
    const [day] = await db
      .insert(movementPlanDays)
      .values({ teamId, eventId, label: def.label, orderIndex: di })
      .returning();
    for (let ei = 0; ei < def.entries.length; ei++) {
      const e = def.entries[ei];
      await db.insert(movementPlanEntries).values({
        teamId,
        eventId,
        dayId: day.id,
        orderIndex: ei,
        who: e.who,
        what: e.what,
        whereLabel: e.whereLabel || null,
        whereUrl: null,
        whenTime: e.whenTime || null,
        travelTime: e.travelTime || null,
        comments: e.comments || null,
      });
    }
  }
  revalidate(eventId);
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default async function MovementPlanPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { eventId } = await params;
  const { editEntry, editDay } = await searchParams;

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.teamId, me.teamId)))
    .limit(1);
  if (!event) notFound();

  const isChief = me.role === "chief";

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

  // Bound server actions
  const addDayAction = addDay.bind(null, eventId, me.teamId);
  const seedSOFRAction = seedSOFR.bind(null, eventId, me.teamId);

  return (
    <div className="min-h-screen">
      <Nav user={me} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 text-sm rc-muted">
              <Link href="/events" className="rc-link">Events</Link>
              {" / "}
              <Link href={`/events/${eventId}`} className="rc-link">{event.name}</Link>
            </div>
            <h1 className="text-2xl font-bold">Movement Plan</h1>
            <p className="rc-muted text-sm mt-1">
              {event.eventDate} · {event.location}
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/events/${eventId}/movement-plan/print`}
              className="rc-btn rc-btn-ghost text-sm"
              target="_blank"
            >
              Print
            </Link>
          </div>
        </div>

        {/* Empty state with SOFR seed */}
        {days.length === 0 && isChief && (
          <div className="rc-card mb-6 text-center py-10">
            <p className="rc-muted mb-4">No movement plan yet. Add days manually or seed from the SOFR 2026 schedule.</p>
            <form action={seedSOFRAction}>
              <button type="submit" className="rc-btn rc-btn-primary">
                Seed SOFR 2026 Movement Plan
              </button>
            </form>
          </div>
        )}
        {days.length === 0 && !isChief && (
          <p className="rc-empty-section">No movement plan created yet.</p>
        )}

        {/* Days */}
        {days.map((day) => {
          const dayEntries = byDay.get(day.id) ?? [];
          const isEditingDay = editDay === day.id;
          const updateDayAction = updateDay.bind(null, eventId, me.teamId, day.id);
          const deleteDayAction = deleteDay.bind(null, eventId, me.teamId, day.id);
          const addEntryAction = addEntry.bind(null, eventId, me.teamId, day.id);

          return (
            <section key={day.id} className="rc-card mb-6">
              {/* Day header */}
              <div className="flex items-center justify-between gap-3 mb-4">
                {isEditingDay && isChief ? (
                  <form action={updateDayAction} className="flex gap-2 flex-1">
                    <input
                      name="label"
                      defaultValue={day.label}
                      className="rc-input flex-1 text-lg font-semibold"
                      autoFocus
                    />
                    <button type="submit" className="rc-btn rc-btn-primary text-sm">Save</button>
                    <Link href={`/events/${eventId}/movement-plan`} className="rc-btn rc-btn-ghost text-sm">Cancel</Link>
                  </form>
                ) : (
                  <>
                    <h2 className="text-lg font-semibold">{day.label}</h2>
                    {isChief && (
                      <div className="flex gap-2 shrink-0">
                        <Link
                          href={`/events/${eventId}/movement-plan?editDay=${day.id}`}
                          className="rc-btn rc-btn-ghost text-xs"
                        >
                          Rename
                        </Link>
                        <form action={deleteDayAction} onSubmit={(e) => { if (!confirm(`Delete "${day.label}" and all its entries?`)) e.preventDefault(); }}>
                          <button type="submit" className="rc-btn rc-btn-danger text-xs">Delete day</button>
                        </form>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Entries table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "var(--border-strong)" }}>
                      <th className="text-left py-2 px-2 font-semibold rc-muted w-[14%]">Who</th>
                      <th className="text-left py-2 px-2 font-semibold rc-muted w-[18%]">What</th>
                      <th className="text-left py-2 px-2 font-semibold rc-muted w-[18%]">Where</th>
                      <th className="text-left py-2 px-2 font-semibold rc-muted w-[10%]">When</th>
                      <th className="text-left py-2 px-2 font-semibold rc-muted w-[10%]">Travel</th>
                      <th className="text-left py-2 px-2 font-semibold rc-muted">Comments</th>
                      {isChief && <th className="w-[80px]" />}
                    </tr>
                  </thead>
                  <tbody>
                    {dayEntries.length === 0 && (
                      <tr>
                        <td colSpan={isChief ? 7 : 6} className="py-3 px-2 rc-muted text-center italic text-xs">
                          No entries yet.
                        </td>
                      </tr>
                    )}
                    {dayEntries.map((entry) => {
                      const isEditing = editEntry === entry.id;
                      const updateEntryAction = updateEntry.bind(null, eventId, me.teamId, entry.id);
                      const deleteEntryAction = deleteEntry.bind(null, eventId, me.teamId, entry.id);

                      if (isEditing && isChief) {
                        return (
                          <tr key={entry.id} style={{ background: "var(--surface-elevated)" }}>
                            <td colSpan={isChief ? 7 : 6} className="py-3 px-2">
                              <form action={updateEntryAction} className="grid gap-2">
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                  <div>
                                    <label className="block text-xs rc-muted mb-1">Who</label>
                                    <input name="who" defaultValue={entry.who} className="rc-input w-full text-sm" placeholder="Jack, Jason…" />
                                  </div>
                                  <div>
                                    <label className="block text-xs rc-muted mb-1">What *</label>
                                    <input name="what" defaultValue={entry.what} required className="rc-input w-full text-sm" placeholder="Drive to service…" />
                                  </div>
                                  <div>
                                    <label className="block text-xs rc-muted mb-1">When</label>
                                    <input name="whenTime" defaultValue={entry.whenTime ?? ""} className="rc-input w-full text-sm" placeholder="9:00am" />
                                  </div>
                                  <div>
                                    <label className="block text-xs rc-muted mb-1">Where (label)</label>
                                    <input name="whereLabel" defaultValue={entry.whereLabel ?? ""} className="rc-input w-full text-sm" placeholder="Sidnaw Service Park" />
                                  </div>
                                  <div>
                                    <label className="block text-xs rc-muted mb-1">Where (Maps URL)</label>
                                    <input name="whereUrl" defaultValue={entry.whereUrl ?? ""} className="rc-input w-full text-sm" placeholder="https://maps.app.goo.gl/…" />
                                  </div>
                                  <div>
                                    <label className="block text-xs rc-muted mb-1">Travel time</label>
                                    <input name="travelTime" defaultValue={entry.travelTime ?? ""} className="rc-input w-full text-sm" placeholder="1hr 12min" />
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-xs rc-muted mb-1">Comments</label>
                                  <input name="comments" defaultValue={entry.comments ?? ""} className="rc-input w-full text-sm" placeholder="Notes…" />
                                </div>
                                <div className="flex gap-2">
                                  <button type="submit" className="rc-btn rc-btn-primary text-sm">Save</button>
                                  <Link href={`/events/${eventId}/movement-plan`} className="rc-btn rc-btn-ghost text-sm">Cancel</Link>
                                </div>
                              </form>
                            </td>
                          </tr>
                        );
                      }

                      return (
                        <tr
                          key={entry.id}
                          className="border-b rc-list-row"
                          style={{ borderColor: "var(--border)" }}
                        >
                          <td className="py-2 px-2 align-top font-medium">{entry.who || <span className="rc-muted">—</span>}</td>
                          <td className="py-2 px-2 align-top font-semibold">{entry.what}</td>
                          <td className="py-2 px-2 align-top">
                            {entry.whereLabel ? (
                              entry.whereUrl ? (
                                <a href={entry.whereUrl} target="_blank" rel="noopener noreferrer" className="rc-link">
                                  {entry.whereLabel}
                                </a>
                              ) : (
                                <span>{entry.whereLabel}</span>
                              )
                            ) : (
                              <span className="rc-muted">—</span>
                            )}
                          </td>
                          <td className="py-2 px-2 align-top">{entry.whenTime ?? <span className="rc-muted">—</span>}</td>
                          <td className="py-2 px-2 align-top rc-muted">{entry.travelTime ?? "—"}</td>
                          <td className="py-2 px-2 align-top rc-muted text-xs">{entry.comments ?? ""}</td>
                          {isChief && (
                            <td className="py-2 px-2 align-top">
                              <div className="flex gap-1">
                                <Link
                                  href={`/events/${eventId}/movement-plan?editEntry=${entry.id}`}
                                  className="rc-btn rc-btn-ghost text-xs px-2 py-1"
                                >
                                  Edit
                                </Link>
                                <form action={deleteEntryAction}>
                                  <button type="submit" className="rc-btn rc-btn-danger text-xs px-2 py-1">×</button>
                                </form>
                              </div>
                            </td>
                          )}
                        </tr>
                      );
                    })}

                    {/* Add entry row */}
                    {isChief && (
                      <tr>
                        <td colSpan={7} className="pt-3 pb-1 px-2">
                          <details className="group">
                            <summary className="cursor-pointer text-xs rc-muted hover:text-[var(--accent)] select-none list-none flex items-center gap-1">
                              <span className="text-base leading-none">+</span> Add entry
                            </summary>
                            <form action={addEntryAction} className="mt-2 grid gap-2">
                              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                                <div>
                                  <label className="block text-xs rc-muted mb-1">Who</label>
                                  <input name="who" className="rc-input w-full text-sm" placeholder="Jack, Jason…" />
                                </div>
                                <div>
                                  <label className="block text-xs rc-muted mb-1">What *</label>
                                  <input name="what" required className="rc-input w-full text-sm" placeholder="Drive to service…" />
                                </div>
                                <div>
                                  <label className="block text-xs rc-muted mb-1">When</label>
                                  <input name="whenTime" className="rc-input w-full text-sm" placeholder="9:00am" />
                                </div>
                                <div>
                                  <label className="block text-xs rc-muted mb-1">Where (label)</label>
                                  <input name="whereLabel" className="rc-input w-full text-sm" placeholder="Sidnaw Service Park" />
                                </div>
                                <div>
                                  <label className="block text-xs rc-muted mb-1">Where (Maps URL)</label>
                                  <input name="whereUrl" className="rc-input w-full text-sm" placeholder="https://maps.app.goo.gl/…" />
                                </div>
                                <div>
                                  <label className="block text-xs rc-muted mb-1">Travel time</label>
                                  <input name="travelTime" className="rc-input w-full text-sm" placeholder="1hr 12min" />
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs rc-muted mb-1">Comments</label>
                                <input name="comments" className="rc-input w-full text-sm" placeholder="Notes…" />
                              </div>
                              <button type="submit" className="rc-btn rc-btn-primary text-sm w-fit">Add entry</button>
                            </form>
                          </details>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}

        {/* Add day */}
        {isChief && (
          <div className="rc-card">
            <h3 className="font-semibold mb-3">Add day</h3>
            <form action={addDayAction} className="flex gap-2">
              <input
                name="label"
                className="rc-input flex-1"
                placeholder="e.g. Thursday June 11 — Scrutineering / Leg 1"
                required
              />
              <button type="submit" className="rc-btn rc-btn-primary shrink-0">Add day</button>
            </form>
          </div>
        )}
      </main>
    </div>
  );
}
