import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { events, todos, users } from "@/lib/db/schema";
import { getCurrentUser, requireChief, requireSession } from "@/lib/authz";
import { advance } from "@/lib/event-lifecycle";
import { Nav } from "@/components/Nav";

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
