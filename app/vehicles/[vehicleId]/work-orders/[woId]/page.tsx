import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  vehicles,
  workOrders,
  workOrderNotes,
  users,
  type WorkOrderStatus,
} from "@/lib/db/schema";
import { getCurrentUser, requireSession } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import {
  ALL_STATUSES,
  nextStatus,
  statusLabel,
} from "@/lib/work-order-lifecycle";

type Params = Promise<{ vehicleId: string; woId: string }>;

const STATUS_BADGE: Record<WorkOrderStatus, string> = {
  open: "planning",
  in_progress: "prep",
  done: "post_event",
};

export default async function WorkOrderDetailPage({
  params,
}: {
  params: Params;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { vehicleId, woId } = await params;

  const [wo] = await db
    .select({
      id: workOrders.id,
      title: workOrders.title,
      description: workOrders.description,
      status: workOrders.status,
      assigneeUserId: workOrders.assigneeUserId,
      assigneeName: users.name,
      driverReportStageNumber: workOrders.driverReportStageNumber,
      closedAt: workOrders.closedAt,
      createdAt: workOrders.createdAt,
      vehicleName: vehicles.name,
    })
    .from(workOrders)
    .leftJoin(users, eq(users.id, workOrders.assigneeUserId))
    .innerJoin(vehicles, eq(vehicles.id, workOrders.vehicleId))
    .where(
      and(
        eq(workOrders.id, woId),
        eq(workOrders.teamId, me.teamId),
        eq(workOrders.vehicleId, vehicleId),
        isNull(vehicles.deletedAt),
      ),
    )
    .limit(1);
  if (!wo) notFound();

  const crew = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.teamId, me.teamId), isNull(users.deletedAt)))
    .orderBy(asc(users.name));

  const notes = await db
    .select({
      id: workOrderNotes.id,
      body: workOrderNotes.body,
      statusTo: workOrderNotes.statusTo,
      authorName: users.name,
      createdAt: workOrderNotes.createdAt,
    })
    .from(workOrderNotes)
    .innerJoin(users, eq(users.id, workOrderNotes.authorUserId))
    .where(
      and(
        eq(workOrderNotes.teamId, me.teamId),
        eq(workOrderNotes.workOrderId, woId),
      ),
    )
    .orderBy(asc(workOrderNotes.createdAt));

  // ---- server actions ----

  async function addNote(formData: FormData) {
    "use server";
    const u = await requireSession();
    const body = String(formData.get("body") ?? "").trim();
    if (!body) return;
    await db.insert(workOrderNotes).values({
      teamId: u.teamId,
      workOrderId: woId,
      authorUserId: u.userId,
      body,
    });
    await db
      .update(workOrders)
      .set({ updatedAt: new Date() })
      .where(and(eq(workOrders.id, woId), eq(workOrders.teamId, u.teamId)));
    revalidatePath(`/vehicles/${vehicleId}/work-orders/${woId}`);
  }

  async function transitionStatus(formData: FormData) {
    "use server";
    const u = await requireSession();
    const target = String(formData.get("status") ?? "") as WorkOrderStatus;
    const body = String(formData.get("body") ?? "").trim() || null;
    if (!ALL_STATUSES.includes(target)) {
      throw new Error("invalid status");
    }
    const [current] = await db
      .select({ status: workOrders.status })
      .from(workOrders)
      .where(and(eq(workOrders.id, woId), eq(workOrders.teamId, u.teamId)))
      .limit(1);
    if (!current) throw new Error("Work order not found");
    if (current.status === target) return;

    const closing = target === "done";
    await db
      .update(workOrders)
      .set({
        status: target,
        closedAt: closing ? new Date() : null,
        closedByUserId: closing ? u.userId : null,
        updatedAt: new Date(),
      })
      .where(and(eq(workOrders.id, woId), eq(workOrders.teamId, u.teamId)));
    await db.insert(workOrderNotes).values({
      teamId: u.teamId,
      workOrderId: woId,
      authorUserId: u.userId,
      body: body ?? `Status → ${statusLabel(target)}`,
      statusTo: target,
    });
    revalidatePath(`/vehicles/${vehicleId}/work-orders/${woId}`);
    revalidatePath(`/vehicles/${vehicleId}`);
  }

  async function reassign(formData: FormData) {
    "use server";
    const u = await requireSession();
    const raw = String(formData.get("assignee_user_id") ?? "");
    const assigneeUserId = raw || null;
    await db
      .update(workOrders)
      .set({ assigneeUserId, updatedAt: new Date() })
      .where(and(eq(workOrders.id, woId), eq(workOrders.teamId, u.teamId)));
    revalidatePath(`/vehicles/${vehicleId}/work-orders/${woId}`);
  }

  const next = nextStatus(wo.status);

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rc-muted mb-2 text-sm">
          <Link href={`/vehicles/${vehicleId}`} className="rc-link">
            ← {wo.vehicleName}
          </Link>
        </div>
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{wo.title}</h1>
            {wo.description ? (
              <p className="rc-muted mt-2 max-w-2xl whitespace-pre-wrap text-sm">
                {wo.description}
              </p>
            ) : null}
            <div className="rc-muted mt-2 text-xs">
              Opened {wo.createdAt.toISOString().slice(0, 10)}
              {wo.driverReportStageNumber !== null
                ? ` · driver report (stage ${wo.driverReportStageNumber})`
                : ""}
            </div>
          </div>
          <span className={`rc-badge rc-badge-${STATUS_BADGE[wo.status]}`}>
            {statusLabel(wo.status)}
          </span>
        </header>

        <section className="mb-8 grid gap-3 sm:grid-cols-2">
          <form action={reassign} className="rc-card flex flex-col gap-2">
            <label className="text-sm font-medium">Assignee</label>
            <select
              name="assignee_user_id"
              defaultValue={wo.assigneeUserId ?? ""}
              className="rc-select"
            >
              <option value="">Unassigned</option>
              {crew.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="submit" className="rc-btn rc-btn-ghost text-sm">
              Update assignee
            </button>
          </form>

          {next ? (
            <form action={transitionStatus} className="rc-card flex flex-col gap-2">
              <label className="text-sm font-medium">Advance status</label>
              <input type="hidden" name="status" value={next} />
              <input
                name="body"
                placeholder="Optional note (e.g., parts ordered)"
                className="rc-input"
              />
              <button type="submit" className="rc-btn rc-btn-primary text-sm">
                {statusLabel(wo.status)} → {statusLabel(next)}
              </button>
            </form>
          ) : (
            <div className="rc-card rc-muted text-sm">
              Closed{wo.closedAt ? ` ${wo.closedAt.toISOString().slice(0, 10)}` : ""}.
              In the maintenance log.
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Activity</h2>
          {notes.length === 0 ? (
            <p className="rc-muted mb-4 text-sm">No activity yet.</p>
          ) : (
            <ul className="rc-list mb-4">
              {notes.map((n) => (
                <li key={n.id} className="px-4 py-3">
                  <div className="rc-muted text-xs">
                    {n.authorName} ·{" "}
                    {n.createdAt.toISOString().replace("T", " ").slice(0, 16)}
                    {n.statusTo ? ` · status → ${statusLabel(n.statusTo)}` : ""}
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm">{n.body}</div>
                </li>
              ))}
            </ul>
          )}
          <form action={addNote} className="rc-card flex flex-col gap-2">
            <textarea
              name="body"
              required
              rows={3}
              placeholder="Add a note (parts ordered, problem found, etc.)"
              className="rc-textarea"
            />
            <button type="submit" className="rc-btn rc-btn-primary self-start text-sm">
              Add note
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
