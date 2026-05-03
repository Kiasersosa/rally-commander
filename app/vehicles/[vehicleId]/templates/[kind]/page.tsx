import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  checklistTemplateItems,
  checklistTemplates,
  vehicles,
  type ChecklistKind,
} from "@/lib/db/schema";
import { getCurrentUser, requireChief } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import { ALL_KINDS, KIND_LABEL } from "@/lib/checklists";

type Params = Promise<{ vehicleId: string; kind: string }>;

export default async function TemplateEditorPage({
  params,
}: {
  params: Params;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { vehicleId, kind: kindRaw } = await params;
  if (!ALL_KINDS.includes(kindRaw as ChecklistKind)) notFound();
  const kind = kindRaw as ChecklistKind;

  if (me.role !== "chief") {
    return (
      <>
        <Nav user={me} />
        <main className="mx-auto max-w-3xl px-6 py-10">
          <p className="rc-muted text-sm">Only the chief can edit templates.</p>
        </main>
      </>
    );
  }

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

  // Get-or-create the template (idempotent on the vehicle/kind unique index)
  let [template] = await db
    .select()
    .from(checklistTemplates)
    .where(
      and(
        eq(checklistTemplates.teamId, me.teamId),
        eq(checklistTemplates.vehicleId, vehicleId),
        eq(checklistTemplates.kind, kind),
        isNull(checklistTemplates.deletedAt),
      ),
    )
    .limit(1);

  if (!template) {
    const inserted = await db
      .insert(checklistTemplates)
      .values({
        teamId: me.teamId,
        vehicleId,
        kind,
        name: `${KIND_LABEL[kind]} — ${vehicle.name}`,
      })
      .returning();
    template = inserted[0];
  }

  const items = await db
    .select()
    .from(checklistTemplateItems)
    .where(
      and(
        eq(checklistTemplateItems.teamId, me.teamId),
        eq(checklistTemplateItems.templateId, template.id),
      ),
    )
    .orderBy(asc(checklistTemplateItems.orderIndex));

  async function addItem(formData: FormData) {
    "use server";
    const u = await requireChief();
    const label = String(formData.get("label") ?? "").trim();
    const description =
      String(formData.get("description") ?? "").trim() || null;
    if (!label) return;
    if (!template) return;
    // Ensure max-order + 1 placement
    const last = await db
      .select({ orderIndex: checklistTemplateItems.orderIndex })
      .from(checklistTemplateItems)
      .where(
        and(
          eq(checklistTemplateItems.teamId, u.teamId),
          eq(checklistTemplateItems.templateId, template.id),
        ),
      )
      .orderBy(asc(checklistTemplateItems.orderIndex));
    const next = last.length ? last[last.length - 1].orderIndex + 1 : 0;
    await db.insert(checklistTemplateItems).values({
      teamId: u.teamId,
      templateId: template.id,
      orderIndex: next,
      label,
      description,
    });
    revalidatePath(`/vehicles/${vehicleId}/templates/${kind}`);
  }

  async function removeItem(formData: FormData) {
    "use server";
    const u = await requireChief();
    const itemId = String(formData.get("item_id") ?? "");
    if (!itemId) return;
    await db
      .delete(checklistTemplateItems)
      .where(
        and(
          eq(checklistTemplateItems.id, itemId),
          eq(checklistTemplateItems.teamId, u.teamId),
        ),
      );
    revalidatePath(`/vehicles/${vehicleId}/templates/${kind}`);
  }

  async function moveItem(formData: FormData) {
    "use server";
    const u = await requireChief();
    const itemId = String(formData.get("item_id") ?? "");
    const dir = String(formData.get("dir") ?? "");
    if (!itemId || (dir !== "up" && dir !== "down")) return;
    if (!template) return;
    const all = await db
      .select()
      .from(checklistTemplateItems)
      .where(
        and(
          eq(checklistTemplateItems.teamId, u.teamId),
          eq(checklistTemplateItems.templateId, template.id),
        ),
      )
      .orderBy(asc(checklistTemplateItems.orderIndex));
    const idx = all.findIndex((i) => i.id === itemId);
    if (idx === -1) return;
    const swapWith = dir === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= all.length) return;
    const a = all[idx];
    const b = all[swapWith];
    await db
      .update(checklistTemplateItems)
      .set({ orderIndex: b.orderIndex })
      .where(eq(checklistTemplateItems.id, a.id));
    await db
      .update(checklistTemplateItems)
      .set({ orderIndex: a.orderIndex })
      .where(eq(checklistTemplateItems.id, b.id));
    revalidatePath(`/vehicles/${vehicleId}/templates/${kind}`);
  }

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rc-muted mb-2 text-sm">
          <Link href={`/vehicles/${vehicleId}`} className="rc-link">
            ← {vehicle.name}
          </Link>
        </div>
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            {KIND_LABEL[kind]}
          </h1>
          <p className="rc-muted mt-1 text-sm">
            Reusable checklist for {vehicle.name}. Edits apply to future event
            instantiations only — existing event checklists keep their snapshot.
          </p>
        </header>

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">
            Items ({items.length})
          </h2>
          {items.length === 0 ? (
            <p className="rc-muted mb-4 text-sm">No items yet. Add one below.</p>
          ) : (
            <ul className="rc-list mb-4">
              {items.map((it, idx) => (
                <li key={it.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">
                      <span className="rc-muted mr-2 font-mono text-xs">
                        {idx + 1}.
                      </span>
                      {it.label}
                    </div>
                    {it.description ? (
                      <div className="rc-muted mt-0.5 text-sm">
                        {it.description}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <form action={moveItem}>
                      <input type="hidden" name="item_id" value={it.id} />
                      <input type="hidden" name="dir" value="up" />
                      <button
                        type="submit"
                        disabled={idx === 0}
                        className="rc-btn rc-btn-ghost px-2 py-1 text-xs disabled:opacity-30"
                      >
                        ↑
                      </button>
                    </form>
                    <form action={moveItem}>
                      <input type="hidden" name="item_id" value={it.id} />
                      <input type="hidden" name="dir" value="down" />
                      <button
                        type="submit"
                        disabled={idx === items.length - 1}
                        className="rc-btn rc-btn-ghost px-2 py-1 text-xs disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </form>
                    <form action={removeItem}>
                      <input type="hidden" name="item_id" value={it.id} />
                      <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                        ×
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form
            action={addItem}
            className="rc-card grid grid-cols-1 gap-2 sm:grid-cols-12"
          >
            <input
              name="label"
              required
              placeholder="Item label (e.g., Torque all lugs to 110 ft-lb)"
              className="rc-input sm:col-span-6"
            />
            <input
              name="description"
              placeholder="Notes / spec (optional)"
              className="rc-input sm:col-span-4"
            />
            <button type="submit" className="rc-btn rc-btn-primary sm:col-span-2">
              Add item
            </button>
          </form>
        </section>
      </main>
    </>
  );
}
