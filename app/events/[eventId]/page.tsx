import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  checklistInstanceItems,
  checklistInstances,
  checklistSignoffs,
  events,
  todos,
  users,
  vehicles,
} from "@/lib/db/schema";
import { getCurrentUser, requireChief, requireSession } from "@/lib/authz";
import { advance } from "@/lib/event-lifecycle";
import { Nav } from "@/components/Nav";
import { instantiateChecklistsForEvent, KIND_LABEL } from "@/lib/checklists";
import { sql } from "drizzle-orm";
import Link from "next/link";

type Params = Promise<{ eventId: string }>;

const PHASE_HINT: Record<string, string> = {
  planning:
    "Planning phase — events, hotels, and initial logistics modules will appear here in later phases.",
  prep: "Prep phase — work orders, parts ordering, and packing checklists will appear here.",
  on_event:
    "On-event phase — incident logging, service-stop timer, and crew status will appear here.",
  post_event:
    "Post-event phase — receipts reconciliation and post-event teardown checklists will appear here.",
};

export default async function EventDetailPage({ params }: { params: Params }) {
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

  const crew = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.teamId, me.teamId), isNull(users.deletedAt)))
    .orderBy(asc(users.name));

  // Per-vehicle checklist instances with completion stats
  const checklistRows = await db
    .select({
      id: checklistInstances.id,
      kind: checklistInstances.kind,
      name: checklistInstances.name,
      vehicleId: checklistInstances.vehicleId,
      vehicleName: vehicles.name,
      total: sql<number>`COALESCE((SELECT COUNT(*)::int FROM ${checklistInstanceItems} ii WHERE ii.team_id = ${checklistInstances.teamId} AND ii.instance_id = ${checklistInstances.id}), 0)`,
      signed: sql<number>`COALESCE((SELECT COUNT(*)::int FROM ${checklistSignoffs} s INNER JOIN ${checklistInstanceItems} ii ON ii.id = s.instance_item_id WHERE s.team_id = ${checklistInstances.teamId} AND ii.instance_id = ${checklistInstances.id}), 0)`,
    })
    .from(checklistInstances)
    .innerJoin(vehicles, eq(vehicles.id, checklistInstances.vehicleId))
    .where(
      and(
        eq(checklistInstances.teamId, me.teamId),
        eq(checklistInstances.eventId, eventId),
      ),
    )
    .orderBy(asc(vehicles.name), asc(checklistInstances.kind));

  const todoRows = await db
    .select({
      id: todos.id,
      title: todos.title,
      description: todos.description,
      assigneeUserId: todos.assigneeUserId,
      assigneeName: users.name,
      completedAt: todos.completedAt,
      completedByUserId: todos.completedByUserId,
    })
    .from(todos)
    .innerJoin(users, eq(users.id, todos.assigneeUserId))
    .where(
      me.role === "chief"
        ? and(eq(todos.teamId, me.teamId), eq(todos.eventId, eventId))
        : and(
            eq(todos.teamId, me.teamId),
            eq(todos.eventId, eventId),
            eq(todos.assigneeUserId, me.userId),
          ),
    )
    .orderBy(asc(todos.completedAt), asc(todos.createdAt));

  // ---- server actions ----

  async function advancePhase() {
    "use server";
    const u = await requireChief();
    const [current] = await db
      .select({ phase: events.phase })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.teamId, u.teamId)))
      .limit(1);
    if (!current) throw new Error("Event not found");
    const result = advance(current.phase, u.role);
    if (!result.ok) throw new Error(result.reason);
    await db
      .update(events)
      .set({ phase: result.phase, updatedAt: new Date() })
      .where(and(eq(events.id, eventId), eq(events.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
    revalidatePath("/events");
  }

  async function saveDebrief(formData: FormData) {
    "use server";
    const u = await requireChief();
    const notes = String(formData.get("debrief_notes") ?? "");
    await db
      .update(events)
      .set({ debriefNotes: notes, updatedAt: new Date() })
      .where(and(eq(events.id, eventId), eq(events.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  async function createTodo(formData: FormData) {
    "use server";
    const u = await requireChief();
    const title = String(formData.get("title") ?? "").trim();
    const description =
      String(formData.get("description") ?? "").trim() || null;
    const assigneeUserId = String(formData.get("assignee_user_id") ?? "");
    if (!title || !assigneeUserId) throw new Error("title and assignee required");
    await db.insert(todos).values({
      teamId: u.teamId,
      eventId,
      assigneeUserId,
      title,
      description,
    });
    revalidatePath(`/events/${eventId}`);
  }

  async function rebuildChecklists() {
    "use server";
    const u = await requireChief();
    await instantiateChecklistsForEvent(u.teamId, eventId);
    revalidatePath(`/events/${eventId}`);
  }

  async function completeTodo(formData: FormData) {
    "use server";
    const u = await requireSession();
    const todoId = String(formData.get("todo_id") ?? "");
    if (!todoId) return;
    const [t] = await db
      .select({ assigneeUserId: todos.assigneeUserId })
      .from(todos)
      .where(and(eq(todos.id, todoId), eq(todos.teamId, u.teamId)))
      .limit(1);
    if (!t) throw new Error("Todo not found");
    if (u.role !== "chief" && t.assigneeUserId !== u.userId) {
      throw new Error("You can only complete your own todos.");
    }
    await db
      .update(todos)
      .set({
        completedAt: new Date(),
        completedByUserId: u.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(todos.id, todoId), eq(todos.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  const canAdvance = me.role === "chief" && event.phase !== "post_event";

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{event.name}</h1>
            <div className="rc-muted mt-1 text-sm">
              {event.eventDate} · {event.location}
              {event.araRoundNumber ? ` · ARA round ${event.araRoundNumber}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`rc-badge rc-badge-${event.phase}`}>
              {event.phase.replace("_", " ")}
            </span>
            {canAdvance ? (
              <form action={advancePhase}>
                <button type="submit" className="rc-btn rc-btn-primary text-sm">
                  Advance phase →
                </button>
              </form>
            ) : null}
          </div>
        </header>

        <section className="rc-empty-section mb-10">
          {PHASE_HINT[event.phase]}
        </section>

        <section className="mb-10">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Checklists</h2>
            {me.role === "chief" ? (
              <form action={rebuildChecklists}>
                <button type="submit" className="rc-btn rc-btn-ghost text-xs">
                  Rebuild from templates
                </button>
              </form>
            ) : null}
          </div>
          {checklistRows.length === 0 ? (
            <p className="rc-muted text-sm">
              No checklists. Add items to a vehicle template, then rebuild.
            </p>
          ) : (
            <ul className="rc-list">
              {checklistRows.map((c) => {
                const total = Number(c.total);
                const signed = Number(c.signed);
                const pct =
                  total === 0 ? 100 : Math.round((signed / total) * 100);
                return (
                  <li key={c.id} className="rc-list-row">
                    <div className="flex-1">
                      <Link
                        href={`/checklists/${c.id}`}
                        className="rc-link font-medium"
                      >
                        {c.vehicleName} · {KIND_LABEL[c.kind]}
                      </Link>
                      <div className="rc-muted text-sm">
                        {signed} of {total} signed off
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--border)]">
                        <div
                          className="h-full rounded-full bg-[color:var(--accent)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span
                      className={`rc-badge rc-badge-${pct === 100 ? "on_event" : pct === 0 ? "post_event" : "prep"}`}
                    >
                      {pct}%
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            {me.role === "chief" ? "Event todos" : "My todos"}
          </h2>

          {me.role === "chief" ? (
            <form
              action={createTodo}
              className="rc-card mb-4 grid grid-cols-1 gap-2 sm:grid-cols-12"
            >
              <input
                name="title"
                required
                placeholder="What needs doing?"
                className="rc-input sm:col-span-5"
              />
              <input
                name="description"
                placeholder="Description (optional)"
                className="rc-input sm:col-span-4"
              />
              <select
                name="assignee_user_id"
                required
                className="rc-select sm:col-span-2"
                defaultValue=""
              >
                <option value="" disabled>
                  Assign to…
                </option>
                {crew.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rc-btn rc-btn-primary sm:col-span-1"
              >
                Add
              </button>
            </form>
          ) : null}

          {todoRows.length === 0 ? (
            <p className="rc-muted text-sm">No todos.</p>
          ) : (
            <ul className="rc-list">
              {todoRows.map((t) => {
                const canComplete =
                  !t.completedAt &&
                  (me.role === "chief" || t.assigneeUserId === me.userId);
                return (
                  <li key={t.id} className="rc-list-row">
                    <div>
                      <div
                        className={
                          t.completedAt
                            ? "line-through decoration-[var(--muted)] text-[color:var(--muted)]"
                            : "font-medium"
                        }
                      >
                        {t.title}
                      </div>
                      {t.description ? (
                        <div className="rc-muted mt-0.5 text-sm">
                          {t.description}
                        </div>
                      ) : null}
                      <div className="rc-muted mt-1 text-xs">
                        Assigned to {t.assigneeName}
                        {t.completedAt
                          ? ` · done ${t.completedAt.toISOString().slice(0, 10)}`
                          : ""}
                      </div>
                    </div>
                    {canComplete ? (
                      <form action={completeTodo}>
                        <input type="hidden" name="todo_id" value={t.id} />
                        <button type="submit" className="rc-btn rc-btn-ghost text-sm">
                          Mark done
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            Post-event debrief
          </h2>
          {me.role === "chief" ? (
            <form action={saveDebrief} className="rc-card flex flex-col gap-3">
              <textarea
                name="debrief_notes"
                defaultValue={event.debriefNotes ?? ""}
                placeholder="What went well, what didn't, lessons for next event."
                rows={6}
                className="rc-textarea"
              />
              <button type="submit" className="rc-btn rc-btn-primary self-start">
                Save debrief
              </button>
            </form>
          ) : (
            <div className="rc-card whitespace-pre-wrap text-sm">
              {event.debriefNotes ?? (
                <span className="rc-muted">No debrief yet.</span>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
