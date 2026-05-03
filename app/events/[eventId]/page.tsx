import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  checklistInstanceItems,
  checklistInstances,
  checklistSignoffs,
  events,
  orderListItems,
  tireNeeds,
  todos,
  users,
  vehicles,
  workOrders,
  type OrderListStatus,
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

  // Order list items
  const orderListRows = await db
    .select({
      id: orderListItems.id,
      title: orderListItems.title,
      qty: orderListItems.qty,
      status: orderListItems.status,
      notes: orderListItems.notes,
      workOrderId: orderListItems.workOrderId,
      workOrderTitle: workOrders.title,
      vehicleName: vehicles.name,
    })
    .from(orderListItems)
    .leftJoin(workOrders, eq(workOrders.id, orderListItems.workOrderId))
    .leftJoin(vehicles, eq(vehicles.id, workOrders.vehicleId))
    .where(
      and(
        eq(orderListItems.teamId, me.teamId),
        eq(orderListItems.eventId, eventId),
      ),
    )
    .orderBy(asc(orderListItems.status), asc(orderListItems.createdAt));

  // Open work orders for this team — used to suggest order-list source linkage
  const openWosForLink = await db
    .select({
      id: workOrders.id,
      title: workOrders.title,
      vehicleName: vehicles.name,
    })
    .from(workOrders)
    .innerJoin(vehicles, eq(vehicles.id, workOrders.vehicleId))
    .where(
      and(
        eq(workOrders.teamId, me.teamId),
        isNull(workOrders.closedAt),
      ),
    )
    .orderBy(asc(vehicles.name));

  // Tire needs
  const tireRows = await db
    .select()
    .from(tireNeeds)
    .where(
      and(eq(tireNeeds.teamId, me.teamId), eq(tireNeeds.eventId, eventId)),
    )
    .orderBy(asc(tireNeeds.createdAt));

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

  // ---- Order list actions ----
  async function addOrderItem(formData: FormData) {
    "use server";
    const u = await requireSession();
    const title = String(formData.get("title") ?? "").trim();
    const qty = Number.parseInt(String(formData.get("qty") ?? "1"), 10) || 1;
    const woRaw = String(formData.get("work_order_id") ?? "");
    const workOrderId = woRaw || null;
    if (!title) return;
    await db.insert(orderListItems).values({
      teamId: u.teamId,
      eventId,
      title,
      qty,
      workOrderId,
    });
    revalidatePath(`/events/${eventId}`);
  }

  async function setOrderStatus(formData: FormData) {
    "use server";
    const u = await requireSession();
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "") as OrderListStatus;
    if (!id || !["needed", "ordered", "received", "packed"].includes(status)) return;
    await db
      .update(orderListItems)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(orderListItems.id, id), eq(orderListItems.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteOrderItem(formData: FormData) {
    "use server";
    const u = await requireSession();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(orderListItems)
      .where(and(eq(orderListItems.id, id), eq(orderListItems.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  // ---- Tire actions ----
  async function addTire(formData: FormData) {
    "use server";
    const u = await requireSession();
    const compound = String(formData.get("compound") ?? "").trim();
    const count = Number.parseInt(String(formData.get("count") ?? "4"), 10) || 4;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    if (!compound) return;
    await db.insert(tireNeeds).values({
      teamId: u.teamId,
      eventId,
      compound,
      count,
      notes,
    });
    revalidatePath(`/events/${eventId}`);
  }

  async function toggleTireFlag(formData: FormData) {
    "use server";
    const u = await requireSession();
    const id = String(formData.get("id") ?? "");
    const which = String(formData.get("which") ?? "");
    const isOn = String(formData.get("on") ?? "") === "1";
    if (!id || (which !== "ordered" && which !== "received")) return;
    const ts = isOn ? new Date() : null;
    if (which === "ordered") {
      await db
        .update(tireNeeds)
        .set({ orderedAt: ts, updatedAt: new Date() })
        .where(and(eq(tireNeeds.id, id), eq(tireNeeds.teamId, u.teamId)));
    } else {
      await db
        .update(tireNeeds)
        .set({ receivedAt: ts, updatedAt: new Date() })
        .where(and(eq(tireNeeds.id, id), eq(tireNeeds.teamId, u.teamId)));
    }
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteTire(formData: FormData) {
    "use server";
    const u = await requireSession();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(tireNeeds)
      .where(and(eq(tireNeeds.id, id), eq(tireNeeds.teamId, u.teamId)));
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

  // % ready to ship across all packing instances on this event
  const packingRows = checklistRows.filter((r) => r.kind === "packing");
  const packingTotal = packingRows.reduce((n, r) => n + Number(r.total), 0);
  const packingSigned = packingRows.reduce((n, r) => n + Number(r.signed), 0);
  const readyPct =
    packingTotal === 0 ? null : Math.round((packingSigned / packingTotal) * 100);

  const ORDER_STATUSES: OrderListStatus[] = [
    "needed",
    "ordered",
    "received",
    "packed",
  ];

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
            {readyPct !== null ? (
              <span
                className={`rc-badge rc-badge-${readyPct === 100 ? "on_event" : readyPct === 0 ? "post_event" : "prep"}`}
                title="Ready to ship: signed packing items / total"
              >
                {readyPct}% ready
              </span>
            ) : null}
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
            Parts to order
          </h2>
          <form
            action={addOrderItem}
            className="rc-card mb-4 grid grid-cols-1 gap-2 sm:grid-cols-12"
          >
            <input
              name="title"
              required
              placeholder="Part (e.g., Front strut)"
              className="rc-input sm:col-span-5"
            />
            <input
              name="qty"
              type="number"
              min={1}
              defaultValue={1}
              className="rc-input sm:col-span-1"
            />
            <select
              name="work_order_id"
              defaultValue=""
              className="rc-select sm:col-span-4"
            >
              <option value="">Linked WO (optional)</option>
              {openWosForLink.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.vehicleName} · {w.title}
                </option>
              ))}
            </select>
            <button type="submit" className="rc-btn rc-btn-primary sm:col-span-2">
              Add
            </button>
          </form>
          {orderListRows.length === 0 ? (
            <p className="rc-muted text-sm">No parts to order yet.</p>
          ) : (
            <ul className="rc-list">
              {orderListRows.map((it) => (
                <li key={it.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">
                      {it.qty}× {it.title}
                    </div>
                    {it.workOrderTitle ? (
                      <div className="rc-muted text-xs">
                        For {it.vehicleName} · {it.workOrderTitle}
                      </div>
                    ) : null}
                  </div>
                  <form action={setOrderStatus} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={it.id} />
                    <select
                      name="status"
                      defaultValue={it.status}
                      className="rc-select py-1 text-sm"
                    >
                      {ORDER_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="rc-btn rc-btn-ghost text-xs">
                      Save
                    </button>
                  </form>
                  <form action={deleteOrderItem}>
                    <input type="hidden" name="id" value={it.id} />
                    <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            Tires needed
          </h2>
          <form
            action={addTire}
            className="rc-card mb-4 grid grid-cols-1 gap-2 sm:grid-cols-12"
          >
            <input
              name="compound"
              required
              placeholder="Compound (e.g., DMACK Gravel Hard)"
              className="rc-input sm:col-span-5"
            />
            <input
              name="count"
              type="number"
              min={1}
              defaultValue={4}
              className="rc-input sm:col-span-1"
            />
            <input
              name="notes"
              placeholder="Notes"
              className="rc-input sm:col-span-4"
            />
            <button type="submit" className="rc-btn rc-btn-primary sm:col-span-2">
              Add
            </button>
          </form>
          {tireRows.length === 0 ? (
            <p className="rc-muted text-sm">No tires logged yet.</p>
          ) : (
            <ul className="rc-list">
              {tireRows.map((t) => (
                <li key={t.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">
                      {t.count}× {t.compound}
                    </div>
                    {t.notes ? (
                      <div className="rc-muted text-xs">{t.notes}</div>
                    ) : null}
                    <div className="rc-muted mt-0.5 text-xs">
                      {t.orderedAt
                        ? `Ordered ${t.orderedAt.toISOString().slice(0, 10)}`
                        : "Not ordered"}
                      {" · "}
                      {t.receivedAt
                        ? `Received ${t.receivedAt.toISOString().slice(0, 10)}`
                        : "Not received"}
                    </div>
                  </div>
                  <form action={toggleTireFlag}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="which" value="ordered" />
                    <input type="hidden" name="on" value={t.orderedAt ? "0" : "1"} />
                    <button type="submit" className="rc-btn rc-btn-ghost text-xs">
                      {t.orderedAt ? "Un-order" : "Mark ordered"}
                    </button>
                  </form>
                  <form action={toggleTireFlag}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="which" value="received" />
                    <input type="hidden" name="on" value={t.receivedAt ? "0" : "1"} />
                    <button type="submit" className="rc-btn rc-btn-ghost text-xs">
                      {t.receivedAt ? "Un-receive" : "Mark received"}
                    </button>
                  </form>
                  <form action={deleteTire}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
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
