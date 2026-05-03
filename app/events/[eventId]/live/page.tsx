import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  crewStatusEntries,
  documentVersions,
  documents,
  events,
  incidents,
  serviceStopItems,
  serviceStops,
  users,
  vehicles,
  workOrders,
  type CrewStatus,
} from "@/lib/db/schema";
import { getCurrentUser, requireChief, requireSession } from "@/lib/authz";
import { DOCUMENT_CATEGORY_LABEL } from "@/lib/documents";
import { ServiceStopTimer } from "./ServiceStopTimer";

type Params = Promise<{ eventId: string }>;

const STATUS_OPTIONS: { value: CrewStatus; label: string }[] = [
  { value: "at_service", label: "At service" },
  { value: "paddock", label: "Paddock" },
  { value: "parts_run", label: "Parts run" },
  { value: "hotel", label: "Hotel" },
  { value: "recce", label: "Recce" },
  { value: "other", label: "Other" },
];
const STATUS_LABEL: Record<CrewStatus, string> = {
  at_service: "At service",
  paddock: "Paddock",
  parts_run: "Parts run",
  hotel: "Hotel",
  recce: "Recce",
  other: "Other",
};

function fmtRelative(d: Date): string {
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default async function LivePage({ params }: { params: Params }) {
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

  const teamVehicles = await db
    .select({ id: vehicles.id, name: vehicles.name, type: vehicles.type })
    .from(vehicles)
    .where(and(eq(vehicles.teamId, me.teamId), isNull(vehicles.deletedAt)))
    .orderBy(asc(vehicles.name));
  const rallyCar = teamVehicles.find((v) => v.type === "rally_car");

  const recentIncidents = await db
    .select({
      id: incidents.id,
      stageNumber: incidents.stageNumber,
      note: incidents.note,
      reportedByName: users.name,
      vehicleName: vehicles.name,
      workOrderId: incidents.workOrderId,
      createdAt: incidents.createdAt,
    })
    .from(incidents)
    .innerJoin(users, eq(users.id, incidents.reportedByUserId))
    .innerJoin(vehicles, eq(vehicles.id, incidents.vehicleId))
    .where(
      and(
        eq(incidents.teamId, me.teamId),
        eq(incidents.eventId, eventId),
      ),
    )
    .orderBy(desc(incidents.createdAt))
    .limit(20);

  const [activeStop] = await db
    .select()
    .from(serviceStops)
    .where(
      and(
        eq(serviceStops.teamId, me.teamId),
        eq(serviceStops.eventId, eventId),
        isNull(serviceStops.endedAt),
      ),
    )
    .orderBy(desc(serviceStops.startedAt))
    .limit(1);

  const stopItems = activeStop
    ? await db
        .select({
          id: serviceStopItems.id,
          label: serviceStopItems.label,
          orderIndex: serviceStopItems.orderIndex,
          completedAt: serviceStopItems.completedAt,
          completedByName: users.name,
        })
        .from(serviceStopItems)
        .leftJoin(users, eq(users.id, serviceStopItems.completedByUserId))
        .where(
          and(
            eq(serviceStopItems.teamId, me.teamId),
            eq(serviceStopItems.serviceStopId, activeStop.id),
          ),
        )
        .orderBy(asc(serviceStopItems.orderIndex))
    : [];

  // Bulletin feed: all event documents, sorted by latest version date
  const bulletins = await db
    .select({
      id: documents.id,
      name: documents.name,
      category: documents.category,
      mustAcknowledge: documents.mustAcknowledge,
      latestUploadedAt: documentVersions.createdAt,
      latestVersionNumber: documentVersions.versionNumber,
    })
    .from(documents)
    .innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
    .where(
      and(
        eq(documents.teamId, me.teamId),
        eq(documents.eventId, eventId),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documentVersions.createdAt))
    .limit(20);
  // Dedupe to one row per document (keep newest version)
  const seenDocs = new Set<string>();
  const bulletinFeed = bulletins.filter((b) => {
    if (seenDocs.has(b.id)) return false;
    seenDocs.add(b.id);
    return true;
  });

  // Crew status
  const crewBoard = await db
    .select({
      userId: users.id,
      userName: users.name,
      role: users.role,
      status: crewStatusEntries.status,
      notes: crewStatusEntries.notes,
      updatedAt: crewStatusEntries.updatedAt,
    })
    .from(users)
    .leftJoin(
      crewStatusEntries,
      and(
        eq(crewStatusEntries.userId, users.id),
        eq(crewStatusEntries.eventId, eventId),
      ),
    )
    .where(and(eq(users.teamId, me.teamId), isNull(users.deletedAt)))
    .orderBy(asc(users.name));

  const myStatus = crewBoard.find((c) => c.userId === me.userId);

  // ---- server actions ----

  async function logIncident(formData: FormData) {
    "use server";
    const u = await requireSession();
    const vehicleId = String(formData.get("vehicle_id") ?? "");
    const stageRaw = String(formData.get("stage_number") ?? "");
    const stageNumber = stageRaw ? Number.parseInt(stageRaw, 10) : null;
    const note = String(formData.get("note") ?? "").trim();
    const createWo = String(formData.get("create_wo") ?? "") === "on";
    if (!vehicleId || !note) throw new Error("vehicle and note required");

    let workOrderId: string | null = null;
    if (createWo) {
      const [wo] = await db
        .insert(workOrders)
        .values({
          teamId: u.teamId,
          vehicleId,
          title: `[Incident${stageNumber ? ` · stage ${stageNumber}` : ""}] ${note.slice(0, 60)}${note.length > 60 ? "…" : ""}`,
          description: note,
          openedByUserId: u.userId,
          driverReportStageNumber: stageNumber,
          eventId,
        })
        .returning();
      workOrderId = wo.id;
    }

    await db.insert(incidents).values({
      teamId: u.teamId,
      eventId,
      vehicleId,
      stageNumber: Number.isFinite(stageNumber as number) ? stageNumber : null,
      note,
      reportedByUserId: u.userId,
      workOrderId,
    });
    revalidatePath(`/events/${eventId}/live`);
  }

  async function startServiceStop(formData: FormData) {
    "use server";
    const u = await requireChief();
    const name = String(formData.get("name") ?? "").trim() || "Service stop";
    const minutesRaw = String(formData.get("minutes") ?? "30");
    const minutes = Math.max(1, Number.parseInt(minutesRaw, 10) || 30);
    await db.insert(serviceStops).values({
      teamId: u.teamId,
      eventId,
      name,
      plannedDurationSeconds: minutes * 60,
      startedByUserId: u.userId,
    });
    revalidatePath(`/events/${eventId}/live`);
  }

  async function endServiceStop() {
    "use server";
    const u = await requireChief();
    if (!activeStop) return;
    await db
      .update(serviceStops)
      .set({ endedAt: new Date() })
      .where(
        and(
          eq(serviceStops.id, activeStop.id),
          eq(serviceStops.teamId, u.teamId),
        ),
      );
    revalidatePath(`/events/${eventId}/live`);
  }

  async function addStopItem(formData: FormData) {
    "use server";
    const u = await requireSession();
    if (!activeStop) return;
    const label = String(formData.get("label") ?? "").trim();
    if (!label) return;
    const all = await db
      .select({ orderIndex: serviceStopItems.orderIndex })
      .from(serviceStopItems)
      .where(eq(serviceStopItems.serviceStopId, activeStop.id))
      .orderBy(asc(serviceStopItems.orderIndex));
    const next = all.length ? all[all.length - 1].orderIndex + 1 : 0;
    await db.insert(serviceStopItems).values({
      teamId: u.teamId,
      serviceStopId: activeStop.id,
      orderIndex: next,
      label,
    });
    revalidatePath(`/events/${eventId}/live`);
  }

  async function toggleStopItem(formData: FormData) {
    "use server";
    const u = await requireSession();
    const id = String(formData.get("id") ?? "");
    const isOn = String(formData.get("on") ?? "") === "1";
    if (!id) return;
    if (isOn) {
      await db
        .update(serviceStopItems)
        .set({
          completedAt: new Date(),
          completedByUserId: u.userId,
        })
        .where(
          and(
            eq(serviceStopItems.id, id),
            eq(serviceStopItems.teamId, u.teamId),
          ),
        );
    } else {
      await db
        .update(serviceStopItems)
        .set({ completedAt: null, completedByUserId: null })
        .where(
          and(
            eq(serviceStopItems.id, id),
            eq(serviceStopItems.teamId, u.teamId),
          ),
        );
    }
    revalidatePath(`/events/${eventId}/live`);
  }

  async function setMyStatus(formData: FormData) {
    "use server";
    const u = await requireSession();
    const status = String(formData.get("status") ?? "") as CrewStatus;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    if (
      !["at_service", "paddock", "parts_run", "hotel", "recce", "other"].includes(
        status,
      )
    ) {
      return;
    }
    await db
      .insert(crewStatusEntries)
      .values({
        teamId: u.teamId,
        eventId,
        userId: u.userId,
        status,
        notes,
      })
      .onConflictDoUpdate({
        target: [crewStatusEntries.eventId, crewStatusEntries.userId],
        set: { status, notes, updatedAt: new Date() },
      });
    revalidatePath(`/events/${eventId}/live`);
  }

  return (
    <div className="rc-live">
      <header className="border-b-2 border-black">
        <div className="flex items-center justify-between gap-3">
          <div>
            <Link href={`/events/${eventId}`} className="text-sm underline">
              ← {event.name}
            </Link>
            <h1 className="mt-1 text-2xl font-bold">Live mode</h1>
          </div>
          <span className="rc-badge bg-black text-white">
            {event.phase.replace("_", " ")}
          </span>
        </div>
      </header>

      {/* My status */}
      <section className="border-b border-neutral-300">
        <h2 className="mb-3 text-lg font-bold">My status</h2>
        <form action={setMyStatus} className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((s) => (
              <button
                key={s.value}
                type="submit"
                name="status"
                value={s.value}
                className={`rc-status-pill rc-status-${s.value} ${
                  myStatus?.status === s.value ? "ring-4 ring-black" : ""
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <input
            name="notes"
            placeholder="Note (optional, e.g., 'on parts run, ETA 15 min')"
            defaultValue={myStatus?.notes ?? ""}
            className="rc-input"
          />
          <button type="submit" name="status" value={myStatus?.status ?? "other"} className="rc-btn rc-btn-ghost self-start">
            Update note only
          </button>
        </form>
        {myStatus?.status ? (
          <p className="rc-muted mt-2 text-sm">
            Currently: {STATUS_LABEL[myStatus.status]} ·{" "}
            {fmtRelative(myStatus.updatedAt!)}
          </p>
        ) : null}
      </section>

      {/* Incident logger */}
      <section className="border-b border-neutral-300">
        <h2 className="mb-3 text-lg font-bold">Log an incident</h2>
        <form action={logIncident} className="flex flex-col gap-3">
          <select
            name="vehicle_id"
            required
            defaultValue={rallyCar?.id ?? ""}
            className="rc-select"
          >
            {teamVehicles.length === 0 ? (
              <option value="" disabled>
                No vehicles registered
              </option>
            ) : null}
            {teamVehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.type === "rally_car" ? " (rally car)" : ""}
              </option>
            ))}
          </select>
          <input
            name="stage_number"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder="Stage # (optional)"
            className="rc-input"
          />
          <textarea
            name="note"
            required
            rows={3}
            placeholder="What happened? (e.g., 'brake fade in long downhill')"
            className="rc-textarea"
          />
          <label className="flex items-center gap-3 text-base">
            <input type="checkbox" name="create_wo" className="h-5 w-5" />
            <span>Auto-create work order for the mechanics</span>
          </label>
          <button type="submit" className="rc-btn rc-btn-primary">
            Log incident
          </button>
        </form>

        {recentIncidents.length > 0 ? (
          <>
            <h3 className="mt-5 mb-2 text-base font-bold">Recent incidents</h3>
            <ul className="rc-list">
              {recentIncidents.map((i) => (
                <li key={i.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-semibold">
                      {i.stageNumber ? `SS${i.stageNumber} · ` : ""}
                      {i.vehicleName}
                    </div>
                    <div className="rc-muted text-sm">{i.note}</div>
                    <div className="rc-muted text-xs">
                      {i.reportedByName} · {fmtRelative(i.createdAt)}
                      {i.workOrderId ? " · WO opened" : ""}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </section>

      {/* Service stop */}
      <section className="border-b border-neutral-300">
        <h2 className="mb-3 text-lg font-bold">Service stop</h2>
        {activeStop ? (
          <div className="flex flex-col gap-3">
            <div className="rc-card flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-base font-bold">{activeStop.name}</div>
                <ServiceStopTimer
                  startedAtIso={activeStop.startedAt.toISOString()}
                  plannedSeconds={activeStop.plannedDurationSeconds}
                />
              </div>
              {me.role === "chief" ? (
                <form action={endServiceStop}>
                  <button type="submit" className="rc-btn rc-btn-ghost">
                    End service stop
                  </button>
                </form>
              ) : null}
            </div>

            {stopItems.length > 0 ? (
              <ul className="rc-list">
                {stopItems.map((it) => (
                  <li key={it.id} className="rc-list-row">
                    <div className="flex-1">
                      <div
                        className={
                          it.completedAt
                            ? "line-through opacity-60"
                            : "font-semibold"
                        }
                      >
                        {it.label}
                      </div>
                      {it.completedByName ? (
                        <div className="rc-muted text-xs">
                          ✓ {it.completedByName}
                        </div>
                      ) : null}
                    </div>
                    <form action={toggleStopItem}>
                      <input type="hidden" name="id" value={it.id} />
                      <input
                        type="hidden"
                        name="on"
                        value={it.completedAt ? "0" : "1"}
                      />
                      <button
                        type="submit"
                        className={`rc-btn ${it.completedAt ? "rc-btn-ghost" : "rc-btn-primary"}`}
                      >
                        {it.completedAt ? "Undo" : "Done"}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rc-muted text-sm">No items yet. Add one below.</p>
            )}

            <form action={addStopItem} className="flex gap-2">
              <input
                name="label"
                required
                placeholder="Add item (e.g., 'Refuel rally car')"
                className="rc-input flex-1"
              />
              <button type="submit" className="rc-btn rc-btn-primary">
                Add
              </button>
            </form>
          </div>
        ) : me.role === "chief" ? (
          <form action={startServiceStop} className="flex flex-col gap-3">
            <input
              name="name"
              defaultValue="Service A"
              placeholder="Stop name"
              className="rc-input"
            />
            <input
              name="minutes"
              type="number"
              inputMode="numeric"
              min={1}
              defaultValue={30}
              className="rc-input"
            />
            <button type="submit" className="rc-btn rc-btn-primary">
              Start service stop
            </button>
          </form>
        ) : (
          <p className="rc-muted text-sm">No active service stop.</p>
        )}
      </section>

      {/* Bulletin feed */}
      <section className="border-b border-neutral-300">
        <h2 className="mb-3 text-lg font-bold">Bulletin feed</h2>
        {bulletinFeed.length === 0 ? (
          <p className="rc-muted text-sm">No documents uploaded yet.</p>
        ) : (
          <ul className="rc-list">
            {bulletinFeed.map((b) => (
              <li key={b.id} className="rc-list-row">
                <div className="flex-1">
                  <Link
                    href={`/documents/${b.id}`}
                    className="text-base font-semibold underline"
                  >
                    {b.name}
                  </Link>
                  <div className="rc-muted text-sm">
                    {DOCUMENT_CATEGORY_LABEL[b.category]} · v
                    {b.latestVersionNumber} · {fmtRelative(b.latestUploadedAt!)}
                  </div>
                </div>
                {b.mustAcknowledge ? (
                  <span className="rc-badge bg-black text-white">Must ack</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Crew status board */}
      <section>
        <h2 className="mb-3 text-lg font-bold">Crew status</h2>
        <ul className="rc-list">
          {crewBoard.map((c) => (
            <li key={c.userId} className="rc-list-row">
              <div className="flex-1">
                <div className="font-semibold">{c.userName}</div>
                <div className="rc-muted text-xs">
                  {c.role.replace(/_/g, " ")}
                  {c.status && c.updatedAt
                    ? ` · ${fmtRelative(c.updatedAt)}`
                    : ""}
                  {c.notes ? ` · ${c.notes}` : ""}
                </div>
              </div>
              {c.status ? (
                <span className={`rc-status-pill rc-status-${c.status}`}>
                  {STATUS_LABEL[c.status]}
                </span>
              ) : (
                <span className="rc-muted text-xs">No status</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
