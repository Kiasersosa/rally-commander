import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  vehicles,
  vehiclePartsRefs,
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
type SearchParams = Promise<{ edit?: string }>;

const TYPE_LABEL: Record<VehicleType, string> = {
  rally_car: "Rally car",
  service_truck: "Service truck",
  trailer: "Trailer",
};

export default async function VehicleDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { vehicleId } = await params;
  const { edit: editId } = await searchParams;

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

  const partsRefs = await db
    .select()
    .from(vehiclePartsRefs)
    .where(
      and(
        eq(vehiclePartsRefs.teamId, me.teamId),
        eq(vehiclePartsRefs.vehicleId, vehicleId),
      ),
    )
    .orderBy(asc(vehiclePartsRefs.createdAt));

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

  async function addPartsRef(formData: FormData) {
    "use server";
    const u = await requireChief();
    const component = (formData.get("component") as string | null)?.trim();
    if (!component) return;
    await db.insert(vehiclePartsRefs).values({
      teamId: u.teamId,
      vehicleId,
      component,
      sourceVehicle: (formData.get("sourceVehicle") as string | null)?.trim() || null,
      partNumber: (formData.get("partNumber") as string | null)?.trim() || null,
      supplier: (formData.get("supplier") as string | null)?.trim() || null,
      notes: (formData.get("notes") as string | null)?.trim() || null,
    });
    revalidatePath(`/vehicles/${vehicleId}`);
  }

  async function updatePartsRef(formData: FormData) {
    "use server";
    const u = await requireChief();
    const id = (formData.get("id") as string | null)?.trim();
    const component = (formData.get("component") as string | null)?.trim();
    if (!id || !component) return;
    await db
      .update(vehiclePartsRefs)
      .set({
        component,
        sourceVehicle: (formData.get("sourceVehicle") as string | null)?.trim() || null,
        partNumber: (formData.get("partNumber") as string | null)?.trim() || null,
        supplier: (formData.get("supplier") as string | null)?.trim() || null,
        notes: (formData.get("notes") as string | null)?.trim() || null,
        updatedAt: new Date(),
      })
      .where(and(eq(vehiclePartsRefs.id, id), eq(vehiclePartsRefs.teamId, u.teamId)));
    revalidatePath(`/vehicles/${vehicleId}`);
  }

  async function deletePartsRef(formData: FormData) {
    "use server";
    const u = await requireChief();
    const id = (formData.get("id") as string | null)?.trim();
    if (!id) return;
    await db
      .delete(vehiclePartsRefs)
      .where(and(eq(vehiclePartsRefs.id, id), eq(vehiclePartsRefs.teamId, u.teamId)));
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

        <section className="mb-10">
          <div className="mb-4 flex items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Parts reference</h2>
            <span className="rc-muted text-xs">Aftermarket &amp; cross-platform components</span>
          </div>

          {/* Add form */}
          {me.role === "chief" && (
            <form action={addPartsRef} className="rc-card mb-4 grid grid-cols-1 gap-2 sm:grid-cols-12">
              <input name="component"    required placeholder="Component *"        className="rc-input sm:col-span-3" />
              <input name="sourceVehicle"        placeholder="Source vehicle / brand"  className="rc-input sm:col-span-3" />
              <input name="partNumber"           placeholder="Part number(s)"          className="rc-input sm:col-span-2" />
              <input name="supplier"             placeholder="Supplier / vendor"        className="rc-input sm:col-span-2" />
              <input name="notes"                placeholder="Notes"                    className="rc-input sm:col-span-1" />
              <button type="submit" className="rc-btn rc-btn-primary sm:col-span-1">Add</button>
            </form>
          )}

          {partsRefs.length === 0 ? (
            <p className="rc-empty-section">No parts reference entries yet.</p>
          ) : (
            <div className="rc-card overflow-x-auto p-0">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b" style={{ borderColor: "var(--border-strong)" }}>
                    <th className="text-left py-2 px-3 font-semibold rc-muted">Component</th>
                    <th className="text-left py-2 px-3 font-semibold rc-muted">Source vehicle / brand</th>
                    <th className="text-left py-2 px-3 font-semibold rc-muted">Part number</th>
                    <th className="text-left py-2 px-3 font-semibold rc-muted">Supplier</th>
                    <th className="text-left py-2 px-3 font-semibold rc-muted">Notes</th>
                    {me.role === "chief" && <th className="w-[90px]" />}
                  </tr>
                </thead>
                <tbody>
                  {partsRefs.map((ref) => {
                    const isEditing = editId === ref.id;
                    return isEditing && me.role === "chief" ? (
                      <tr key={ref.id} style={{ background: "var(--surface-elevated)" }}>
                        <td colSpan={me.role === "chief" ? 6 : 5} className="px-3 py-3">
                          <form action={updatePartsRef} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                            <input type="hidden" name="id" value={ref.id} />
                            <input name="component"     required defaultValue={ref.component}          placeholder="Component *"           className="rc-input sm:col-span-2" />
                            <input name="sourceVehicle"          defaultValue={ref.sourceVehicle ?? ""} placeholder="Source vehicle / brand" className="rc-input sm:col-span-3" />
                            <input name="partNumber"             defaultValue={ref.partNumber ?? ""}    placeholder="Part number(s)"         className="rc-input sm:col-span-2" />
                            <input name="supplier"               defaultValue={ref.supplier ?? ""}      placeholder="Supplier / vendor"       className="rc-input sm:col-span-2" />
                            <input name="notes"                  defaultValue={ref.notes ?? ""}         placeholder="Notes"                   className="rc-input sm:col-span-2" />
                            <div className="flex gap-1 sm:col-span-1">
                              <button type="submit" className="rc-btn rc-btn-primary text-xs px-2">Save</button>
                              <Link href={`/vehicles/${vehicleId}`} className="rc-btn rc-btn-ghost text-xs px-2">✕</Link>
                            </div>
                          </form>
                        </td>
                      </tr>
                    ) : (
                      <tr key={ref.id} className="border-b rc-list-row" style={{ borderColor: "var(--border)" }}>
                        <td className="py-2 px-3 font-semibold align-top">{ref.component}</td>
                        <td className="py-2 px-3 align-top">{ref.sourceVehicle ?? <span className="rc-muted">—</span>}</td>
                        <td className="py-2 px-3 align-top font-mono text-xs">{ref.partNumber ?? <span className="rc-muted">—</span>}</td>
                        <td className="py-2 px-3 align-top">{ref.supplier ?? <span className="rc-muted">—</span>}</td>
                        <td className="py-2 px-3 align-top rc-muted text-xs">{ref.notes ?? ""}</td>
                        {me.role === "chief" && (
                          <td className="py-2 px-3 align-top">
                            <div className="flex gap-1">
                              <Link href={`/vehicles/${vehicleId}?edit=${ref.id}`} className="rc-btn rc-btn-ghost text-xs px-2 py-1">Edit</Link>
                              <form action={deletePartsRef}>
                                <input type="hidden" name="id" value={ref.id} />
                                <button type="submit" className="rc-btn rc-btn-danger text-xs px-2 py-1">×</button>
                              </form>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
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
