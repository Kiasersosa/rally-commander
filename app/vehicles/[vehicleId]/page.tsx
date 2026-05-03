import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  vehicles,
  workOrders,
  users,
  events,
  checklistTemplates,
  checklistTemplateItems,
  type VehicleType,
} from "@/lib/db/schema";
import { getCurrentUser, requireChief, requireSession } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import { statusLabel } from "@/lib/work-order-lifecycle";
import { ALL_KINDS, KIND_LABEL } from "@/lib/checklists";
import { sql } from "drizzle-orm";

type Params = Promise<{ vehicleId: string }>;

const TYPE_LABEL: Record<VehicleType, string> = {
  rally_car: "Rally car",
  service_truck: "Service truck",
  trailer: "Trailer",
};

export default async function VehicleDetailPage({
  params,
}: {
  params: Params;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { vehicleId } = await params;

  const [vehicle] = await db
    .select()
    .from(vehicles)
    .where(
      and(
        eq(vehicles.id, vehicleId),
        eq(vehicles.teamId, me.teamId),
        isNull(vehicles.deletedAt),
      ),
    )
    .limit(1);
  if (!vehicle) notFound();

  const crew = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.teamId, me.teamId), isNull(users.deletedAt)))
    .orderBy(asc(users.name));

  const upcomingEvents = await db
    .select({ id: events.id, name: events.name })
    .from(events)
    .where(and(eq(events.teamId, me.teamId), isNull(events.deletedAt)))
    .orderBy(desc(events.eventDate))
    .limit(20);

  const open = await db
    .select({
      id: workOrders.id,
      title: workOrders.title,
      description: workOrders.description,
      status: workOrders.status,
      assigneeName: users.name,
      assigneeId: workOrders.assigneeUserId,
      driverReportStageNumber: workOrders.driverReportStageNumber,
      createdAt: workOrders.createdAt,
    })
    .from(workOrders)
    .leftJoin(users, eq(users.id, workOrders.assigneeUserId))
    .where(
      and(
        eq(workOrders.teamId, me.teamId),
        eq(workOrders.vehicleId, vehicleId),
        isNull(workOrders.closedAt),
      ),
    )
    .orderBy(desc(workOrders.createdAt));

  // Per-kind template item counts for this vehicle
  const templateCounts = await db
    .select({
      kind: checklistTemplates.kind,
      itemCount: sql<number>`COALESCE((SELECT COUNT(*)::int FROM ${checklistTemplateItems} ti WHERE ti.team_id = ${checklistTemplates.teamId} AND ti.template_id = ${checklistTemplates.id}), 0)`,
    })
    .from(checklistTemplates)
    .where(
      and(
        eq(checklistTemplates.teamId, me.teamId),
        eq(checklistTemplates.vehicleId, vehicleId),
        isNull(checklistTemplates.deletedAt),
      ),
    );
  const itemsByKind = new Map(templateCounts.map((t) => [t.kind, t.itemCount]));

  const log = await db
    .select({
      id: workOrders.id,
      title: workOrders.title,
      description: workOrders.description,
      closedAt: workOrders.closedAt,
      closedByName: users.name,
      driverReportStageNumber: workOrders.driverReportStageNumber,
    })
    .from(workOrders)
    .leftJoin(users, eq(users.id, workOrders.closedByUserId))
    .where(
      and(
        eq(workOrders.teamId, me.teamId),
        eq(workOrders.vehicleId, vehicleId),
        isNotNull(workOrders.closedAt),
      ),
    )
    .orderBy(desc(workOrders.closedAt));

  // ---- server actions ----

  async function createWorkOrder(formData: FormData) {
    "use server";
    const u = await requireSession();
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    const assigneeRaw = String(formData.get("assignee_user_id") ?? "");
    const assigneeUserId = assigneeRaw || null;
    if (!title) throw new Error("title required");
    await db.insert(workOrders).values({
      teamId: u.teamId,
      vehicleId,
      title,
      description,
      assigneeUserId,
      openedByUserId: u.userId,
    });
    revalidatePath(`/vehicles/${vehicleId}`);
  }

  async function createDriverReport(formData: FormData) {
    "use server";
    const u = await requireSession();
    const stageRaw = String(formData.get("stage_number") ?? "");
    const stageNumber = Number.parseInt(stageRaw, 10);
    const note = String(formData.get("note") ?? "").trim();
    const eventRaw = String(formData.get("event_id") ?? "");
    const eventId = eventRaw || null;
    if (!Number.isFinite(stageNumber) || !note) {
      throw new Error("stage # and note required");
    }
    await db.insert(workOrders).values({
      teamId: u.teamId,
      vehicleId,
      title: `[Driver report · stage ${stageNumber}] ${note.slice(0, 60)}${note.length > 60 ? "…" : ""}`,
      description: note,
      assigneeUserId: null,
      openedByUserId: u.userId,
      driverReportStageNumber: stageNumber,
      eventId,
    });
    revalidatePath(`/vehicles/${vehicleId}`);
  }

  async function deleteVehicle() {
    "use server";
    const u = await requireChief();
    await db
      .update(vehicles)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.teamId, u.teamId)));
    revalidatePath("/vehicles");
    redirect("/vehicles");
  }

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{vehicle.name}</h1>
            <div className="rc-muted mt-1 text-sm">
              {TYPE_LABEL[vehicle.type]}
              {vehicle.year ? ` · ${vehicle.year}` : ""}
              {vehicle.make ? ` · ${vehicle.make}` : ""}
              {vehicle.model ? ` ${vehicle.model}` : ""}
              {vehicle.vin ? ` · VIN ${vehicle.vin}` : ""}
              {vehicle.plate ? ` · ${vehicle.plate}` : ""}
            </div>
          </div>
          {me.role === "chief" ? (
            <form action={deleteVehicle}>
              <button type="submit" className="rc-btn rc-btn-danger text-sm">
                Remove vehicle
              </button>
            </form>
          ) : null}
        </header>

        {vehicle.notes ? (
          <div className="rc-card rc-muted mb-8 whitespace-pre-wrap text-sm">
            {vehicle.notes}
          </div>
        ) : null}

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            New work order
          </h2>
          <form
            action={createWorkOrder}
            className="rc-card grid grid-cols-1 gap-2 sm:grid-cols-12"
          >
            <input
              name="title"
              required
              placeholder="Title (e.g., replace front struts)"
              className="rc-input sm:col-span-5"
            />
            <input
              name="description"
              placeholder="Details"
              className="rc-input sm:col-span-4"
            />
            <select
              name="assignee_user_id"
              className="rc-select sm:col-span-2"
              defaultValue=""
            >
              <option value="">Unassigned</option>
              {crew.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button type="submit" className="rc-btn rc-btn-primary sm:col-span-1">
              Open
            </button>
          </form>
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            Open work orders
          </h2>
          {open.length === 0 ? (
            <p className="rc-muted text-sm">No open work orders.</p>
          ) : (
            <ul className="rc-list">
              {open.map((w) => (
                <li key={w.id} className="rc-list-row">
                  <div>
                    <Link
                      href={`/vehicles/${vehicleId}/work-orders/${w.id}`}
                      className="rc-link text-base font-medium"
                    >
                      {w.title}
                    </Link>
                    {w.description ? (
                      <div className="rc-muted mt-0.5 text-sm">
                        {w.description}
                      </div>
                    ) : null}
                    <div className="rc-muted mt-1 text-xs">
                      {w.assigneeName ? `Assigned to ${w.assigneeName}` : "Unassigned"}
                      {w.driverReportStageNumber !== null
                        ? ` · driver report (stage ${w.driverReportStageNumber})`
                        : ""}
                    </div>
                  </div>
                  <span
                    className={`rc-badge rc-badge-${w.status === "open" ? "planning" : w.status === "in_progress" ? "prep" : "on_event"}`}
                  >
                    {statusLabel(w.status)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {vehicle.type === "rally_car" ? (
          <section className="mb-10">
            <h2 className="mb-4 text-lg font-semibold tracking-tight">
              Driver condition report
            </h2>
            <p className="rc-muted mb-3 text-sm">
              Log an in-stage issue. Creates a draft work order tagged with the
              stage number for the mechanics.
            </p>
            <form
              action={createDriverReport}
              className="rc-card grid grid-cols-1 gap-2 sm:grid-cols-12"
            >
              <input
                name="stage_number"
                type="number"
                min={1}
                required
                placeholder="Stage #"
                className="rc-input sm:col-span-2"
              />
              <select
                name="event_id"
                className="rc-select sm:col-span-3"
                defaultValue=""
              >
                <option value="">Event (optional)</option>
                {upcomingEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
              <input
                name="note"
                required
                placeholder="What happened?"
                className="rc-input sm:col-span-6"
              />
              <button type="submit" className="rc-btn rc-btn-primary sm:col-span-1">
                Log
              </button>
            </form>
          </section>
        ) : null}

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            Checklist templates
          </h2>
          <ul className="rc-list">
            {ALL_KINDS.map((k) => {
              const count = itemsByKind.get(k) ?? 0;
              return (
                <li key={k} className="rc-list-row">
                  <div>
                    <Link
                      href={`/vehicles/${vehicleId}/templates/${k}`}
                      className="rc-link font-medium"
                    >
                      {KIND_LABEL[k]}
                    </Link>
                    <div className="rc-muted text-sm">
                      {count === 0
                        ? "No items yet"
                        : `${count} item${count === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  <span className="rc-muted text-xs">
                    {me.role === "chief" ? "Edit →" : "View →"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            Maintenance log
          </h2>
          {log.length === 0 ? (
            <p className="rc-muted text-sm">No completed work yet.</p>
          ) : (
            <ul className="rc-list">
              {log.map((w) => (
                <li key={w.id} className="rc-list-row">
                  <div>
                    <Link
                      href={`/vehicles/${vehicleId}/work-orders/${w.id}`}
                      className="rc-link font-medium"
                    >
                      {w.title}
                    </Link>
                    {w.description ? (
                      <div className="rc-muted mt-0.5 text-sm">
                        {w.description}
                      </div>
                    ) : null}
                    <div className="rc-muted mt-1 text-xs">
                      Closed {w.closedAt!.toISOString().slice(0, 10)}
                      {w.closedByName ? ` by ${w.closedByName}` : ""}
                      {w.driverReportStageNumber !== null
                        ? ` · driver report (stage ${w.driverReportStageNumber})`
                        : ""}
                    </div>
                  </div>
                  <span className="rc-badge rc-badge-post_event">Done</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}
