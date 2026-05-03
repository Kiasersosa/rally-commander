import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  checklistInstanceItems,
  checklistInstances,
  checklistSignoffs,
  events,
  vehicles,
} from "@/lib/db/schema";
import { getCurrentUser, requireChief, requireSession } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import { KIND_LABEL, loadChecklistState } from "@/lib/checklists";

type Params = Promise<{ instanceId: string }>;

export default async function ChecklistInstancePage({
  params,
}: {
  params: Params;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { instanceId } = await params;

  const [meta] = await db
    .select({
      id: checklistInstances.id,
      kind: checklistInstances.kind,
      name: checklistInstances.name,
      eventId: checklistInstances.eventId,
      eventName: events.name,
      vehicleId: checklistInstances.vehicleId,
      vehicleName: vehicles.name,
    })
    .from(checklistInstances)
    .innerJoin(events, eq(events.id, checklistInstances.eventId))
    .innerJoin(vehicles, eq(vehicles.id, checklistInstances.vehicleId))
    .where(
      and(
        eq(checklistInstances.id, instanceId),
        eq(checklistInstances.teamId, me.teamId),
      ),
    )
    .limit(1);
  if (!meta) notFound();

  const state = await loadChecklistState(me.teamId, instanceId);

  async function signItem(formData: FormData) {
    "use server";
    const u = await requireSession();
    const itemId = String(formData.get("instance_item_id") ?? "");
    if (!itemId) return;
    // Upsert: insert; if conflict (one signoff per item), do nothing.
    await db
      .insert(checklistSignoffs)
      .values({
        teamId: u.teamId,
        instanceItemId: itemId,
        userId: u.userId,
      })
      .onConflictDoNothing();
    revalidatePath(`/checklists/${instanceId}`);
  }

  async function addAdHocItem(formData: FormData) {
    "use server";
    const u = await requireSession();
    const label = String(formData.get("label") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim() || null;
    if (!label) return;
    const [{ maxOrder }] = await db
      .select({
        maxOrder: sql<number>`COALESCE(MAX(${checklistInstanceItems.orderIndex}), -1)::int`,
      })
      .from(checklistInstanceItems)
      .where(
        and(
          eq(checklistInstanceItems.teamId, u.teamId),
          eq(checklistInstanceItems.instanceId, instanceId),
        ),
      );
    await db.insert(checklistInstanceItems).values({
      teamId: u.teamId,
      instanceId,
      orderIndex: (Number(maxOrder) ?? -1) + 1,
      label,
      description,
    });
    revalidatePath(`/checklists/${instanceId}`);
  }

  async function copyFromPriorEvent() {
    "use server";
    const u = await requireChief();
    if (meta.kind !== "packing") return;
    // Find the most recent prior packing instance for this vehicle on a
    // DIFFERENT event, then copy any items not already present.
    const [prior] = await db
      .select({ id: checklistInstances.id })
      .from(checklistInstances)
      .innerJoin(events, eq(events.id, checklistInstances.eventId))
      .where(
        and(
          eq(checklistInstances.teamId, u.teamId),
          eq(checklistInstances.vehicleId, meta.vehicleId),
          eq(checklistInstances.kind, "packing"),
          ne(checklistInstances.eventId, meta.eventId),
        ),
      )
      .orderBy(desc(events.eventDate), desc(checklistInstances.createdAt))
      .limit(1);
    if (!prior) return;
    const priorItems = await db
      .select({
        label: checklistInstanceItems.label,
        description: checklistInstanceItems.description,
        orderIndex: checklistInstanceItems.orderIndex,
      })
      .from(checklistInstanceItems)
      .where(
        and(
          eq(checklistInstanceItems.teamId, u.teamId),
          eq(checklistInstanceItems.instanceId, prior.id),
        ),
      )
      .orderBy(asc(checklistInstanceItems.orderIndex));
    const currentItems = await db
      .select({ label: checklistInstanceItems.label })
      .from(checklistInstanceItems)
      .where(
        and(
          eq(checklistInstanceItems.teamId, u.teamId),
          eq(checklistInstanceItems.instanceId, instanceId),
        ),
      );
    const have = new Set(currentItems.map((i) => i.label));
    const [{ maxOrder }] = await db
      .select({
        maxOrder: sql<number>`COALESCE(MAX(${checklistInstanceItems.orderIndex}), -1)::int`,
      })
      .from(checklistInstanceItems)
      .where(
        and(
          eq(checklistInstanceItems.teamId, u.teamId),
          eq(checklistInstanceItems.instanceId, instanceId),
        ),
      );
    let next = (Number(maxOrder) ?? -1) + 1;
    const toInsert = priorItems
      .filter((i) => !have.has(i.label))
      .map((i) => ({
        teamId: u.teamId,
        instanceId,
        orderIndex: next++,
        label: i.label,
        description: i.description,
      }));
    if (toInsert.length > 0) {
      await db.insert(checklistInstanceItems).values(toInsert);
    }
    revalidatePath(`/checklists/${instanceId}`);
  }

  async function unsignItem(formData: FormData) {
    "use server";
    const u = await requireSession();
    const itemId = String(formData.get("instance_item_id") ?? "");
    if (!itemId) return;
    await db
      .delete(checklistSignoffs)
      .where(
        and(
          eq(checklistSignoffs.teamId, u.teamId),
          eq(checklistSignoffs.instanceItemId, itemId),
          eq(checklistSignoffs.userId, u.userId),
        ),
      );
    revalidatePath(`/checklists/${instanceId}`);
  }

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rc-muted mb-2 text-sm">
          <Link href={`/events/${meta.eventId}`} className="rc-link">
            ← {meta.eventName}
          </Link>
        </div>
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">
              {meta.vehicleName}
            </h1>
            <p className="rc-muted mt-1 text-sm">
              {KIND_LABEL[meta.kind]} · {meta.name}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`rc-badge rc-badge-${state.complete ? "on_event" : state.signedItems === 0 ? "post_event" : "prep"}`}
            >
              {state.signedItems} / {state.totalItems} · {state.percentage}%
            </span>
            <Link
              href={`/checklists/${instanceId}/print`}
              className="rc-btn rc-btn-ghost text-sm"
            >
              Print
            </Link>
          </div>
        </header>

        {meta.kind === "packing" ? (
          <section className="mb-6 grid gap-3 sm:grid-cols-2">
            <form
              action={addAdHocItem}
              className="rc-card flex flex-col gap-2"
            >
              <label className="text-sm font-medium">Add an ad-hoc item</label>
              <input
                name="label"
                required
                placeholder="e.g., ECU laptop"
                className="rc-input"
              />
              <input
                name="description"
                placeholder="Notes (optional)"
                className="rc-input"
              />
              <button type="submit" className="rc-btn rc-btn-primary self-start text-sm">
                Add
              </button>
            </form>
            {me.role === "chief" ? (
              <form action={copyFromPriorEvent} className="rc-card flex flex-col gap-2">
                <label className="text-sm font-medium">Copy from prior event</label>
                <p className="rc-muted text-xs">
                  Pulls items from this vehicle&apos;s most recent prior packing
                  list. Items already present (matched by label) are skipped.
                </p>
                <button type="submit" className="rc-btn rc-btn-ghost self-start text-sm">
                  Copy missing items
                </button>
              </form>
            ) : null}
          </section>
        ) : null}

        {state.totalItems === 0 ? (
          <div className="rc-empty-section text-center">
            No items in this checklist. Add items to the template on the vehicle
            page, then click &ldquo;Rebuild from templates&rdquo; on the event.
          </div>
        ) : (
          <ul className="rc-list">
            {state.items.map(({ item, signoff }, idx) => {
              const mineSignedThis = signoff?.userId === me.userId;
              return (
                <li key={item.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">
                      <span className="rc-muted mr-2 font-mono text-xs">
                        {idx + 1}.
                      </span>
                      {item.label}
                    </div>
                    {item.description ? (
                      <div className="rc-muted mt-0.5 text-sm">
                        {item.description}
                      </div>
                    ) : null}
                    {signoff ? (
                      <div className="rc-muted mt-1 text-xs">
                        ✓ Signed by {signoff.userName} ·{" "}
                        {signoff.signedAt
                          .toISOString()
                          .replace("T", " ")
                          .slice(0, 16)}
                      </div>
                    ) : null}
                  </div>
                  {signoff ? (
                    mineSignedThis ? (
                      <form action={unsignItem}>
                        <input type="hidden" name="instance_item_id" value={item.id} />
                        <button type="submit" className="rc-btn rc-btn-ghost text-xs">
                          Undo
                        </button>
                      </form>
                    ) : (
                      <span className="rc-muted text-xs">Signed</span>
                    )
                  ) : (
                    <form action={signItem}>
                      <input type="hidden" name="instance_item_id" value={item.id} />
                      <button type="submit" className="rc-btn rc-btn-primary text-sm">
                        Sign off
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
