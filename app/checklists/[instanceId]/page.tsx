import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  checklistInstances,
  checklistSignoffs,
  events,
  vehicles,
} from "@/lib/db/schema";
import { getCurrentUser, requireSession } from "@/lib/authz";
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
