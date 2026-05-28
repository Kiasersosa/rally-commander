import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  checklistTemplateItems,
  checklistTemplates,
  equipmentItems,
  vehicles,
  type ChecklistKind,
  type UserRole,
} from "@/lib/db/schema";
import { getCurrentUser, isFullAccessRole, requireFullAccess } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import {
  ALL_KINDS,
  KIND_LABEL,
  parseToolIds,
  stringifyToolIds,
} from "@/lib/checklists";

type Params = Promise<{ vehicleId: string; kind: string }>;
type SearchParams = Promise<{ edit?: string }>;

const ROLE_OPTIONS: { value: UserRole; label: string }[] = [
  { value: "chief", label: "Chief" },
  { value: "lead_mechanic", label: "Lead mechanic" },
  { value: "assistant", label: "Assistant" },
  { value: "gopher", label: "Gopher" },
  { value: "co_driver", label: "Co-driver" },
  { value: "driver", label: "Driver" },
];

export default async function TemplateEditorPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { vehicleId, kind: kindRaw } = await params;
  if (!ALL_KINDS.includes(kindRaw as ChecklistKind)) notFound();
  const kind = kindRaw as ChecklistKind;
  const { edit: editId } = await searchParams;

  if (!isFullAccessRole(me.role)) {
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

  // Team's equipment list — used to populate the "tools needed" selector.
  const teamEquipment = await db
    .select({
      id: equipmentItems.id,
      description: equipmentItems.description,
      category: equipmentItems.category,
    })
    .from(equipmentItems)
    .where(
      and(eq(equipmentItems.teamId, me.teamId), isNull(equipmentItems.deletedAt)),
    )
    .orderBy(asc(equipmentItems.category), asc(equipmentItems.description));

  const equipmentNameById = new Map(teamEquipment.map((e) => [e.id, e.description]));

  const isServiceSetup = kind === "service_setup";

  async function addItem(formData: FormData) {
    "use server";
    const u = await requireFullAccess();
    const label = String(formData.get("label") ?? "").trim();
    const description =
      String(formData.get("description") ?? "").trim() || null;
    const zone = String(formData.get("zone") ?? "").trim() || null;
    const targetRoleRaw = String(formData.get("target_role") ?? "");
    const targetRole = ROLE_OPTIONS.some((r) => r.value === targetRoleRaw)
      ? (targetRoleRaw as UserRole)
      : null;
    const toolIds = formData.getAll("tools").map((v) => String(v)).filter(Boolean);
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
      zone,
      targetRole,
      toolsNeeded: stringifyToolIds(toolIds),
    });
    revalidatePath(`/vehicles/${vehicleId}/templates/${kind}`);
  }

  async function updateItem(formData: FormData) {
    "use server";
    const u = await requireFullAccess();
    const itemId = String(formData.get("item_id") ?? "");
    if (!itemId) return;
    const label = String(formData.get("label") ?? "").trim();
    if (!label) return;
    const description =
      String(formData.get("description") ?? "").trim() || null;
    const zone = String(formData.get("zone") ?? "").trim() || null;
    const targetRoleRaw = String(formData.get("target_role") ?? "");
    const targetRole = ROLE_OPTIONS.some((r) => r.value === targetRoleRaw)
      ? (targetRoleRaw as UserRole)
      : null;
    const toolIds = formData.getAll("tools").map((v) => String(v)).filter(Boolean);
    await db
      .update(checklistTemplateItems)
      .set({
        label,
        description,
        zone,
        targetRole,
        toolsNeeded: stringifyToolIds(toolIds),
      })
      .where(
        and(
          eq(checklistTemplateItems.id, itemId),
          eq(checklistTemplateItems.teamId, u.teamId),
        ),
      );
    revalidatePath(`/vehicles/${vehicleId}/templates/${kind}`);
  }

  async function removeItem(formData: FormData) {
    "use server";
    const u = await requireFullAccess();
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
    const u = await requireFullAccess();
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

  function renderItemForm(
    submitLabel: string,
    formAction: (fd: FormData) => Promise<void>,
    defaults?: {
      itemId?: string;
      label?: string;
      description?: string | null;
      zone?: string | null;
      targetRole?: UserRole | null;
      toolIds?: string[];
    },
  ) {
    const defaultToolIds = new Set(defaults?.toolIds ?? []);
    return (
      <form action={formAction} className="rc-card grid grid-cols-1 gap-2 sm:grid-cols-12">
        {defaults?.itemId ? (
          <input type="hidden" name="item_id" value={defaults.itemId} />
        ) : null}
        <input
          name="label"
          required
          defaultValue={defaults?.label ?? ""}
          placeholder={
            isServiceSetup
              ? "Task (e.g., Position floor jack front-left)"
              : "Item label (e.g., Torque all lugs to 110 ft-lb)"
          }
          className="rc-input sm:col-span-6"
        />
        <input
          name="description"
          defaultValue={defaults?.description ?? ""}
          placeholder="Notes / spec (optional)"
          className="rc-input sm:col-span-6"
        />

        {/* Service-setup-specific fields (also shown for other kinds, optional) */}
        <input
          name="zone"
          defaultValue={defaults?.zone ?? ""}
          placeholder={
            isServiceSetup
              ? "Zone (e.g., Front-left, Fuel area, Tool bay) — optional"
              : "Zone / location (optional)"
          }
          className="rc-input sm:col-span-4"
        />
        <select
          name="target_role"
          defaultValue={defaults?.targetRole ?? ""}
          className="rc-select sm:col-span-3"
        >
          <option value="">Any role (optional)</option>
          {ROLE_OPTIONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <details className="sm:col-span-5">
          <summary className="cursor-pointer text-sm rc-muted hover:text-[var(--accent)] select-none list-none">
            Tools needed{" "}
            {defaultToolIds.size > 0
              ? `(${defaultToolIds.size} selected) ▾`
              : "(none) ▾"}
          </summary>
          <div className="rc-card mt-1 max-h-64 overflow-y-auto p-3">
            {teamEquipment.length === 0 ? (
              <p className="rc-muted text-xs">
                No equipment in registry yet. Add items on{" "}
                <Link href="/equipment" className="rc-link">
                  /equipment
                </Link>
                .
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {teamEquipment.map((e) => (
                  <li key={e.id}>
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        name="tools"
                        value={e.id}
                        defaultChecked={defaultToolIds.has(e.id)}
                      />
                      <span>{e.description}</span>
                      <span className="rc-muted text-xs">
                        ({e.category.replace(/_/g, " ")})
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>

        <div className="flex gap-2 sm:col-span-12">
          <button type="submit" className="rc-btn rc-btn-primary">
            {submitLabel}
          </button>
          {defaults?.itemId ? (
            <Link
              href={`/vehicles/${vehicleId}/templates/${kind}`}
              className="rc-btn rc-btn-ghost"
            >
              Cancel
            </Link>
          ) : null}
        </div>
      </form>
    );
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
            {isServiceSetup
              ? `Define how the service bay should be set up before ${vehicle.name} arrives. Group tasks by zone and assign a target role so everyone knows their job at a glance.`
              : `Reusable checklist for ${vehicle.name}. Edits apply to future event instantiations only — existing event checklists keep their snapshot.`}
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
              {items.map((it, idx) => {
                const isEditing = editId === it.id;
                if (isEditing) {
                  return (
                    <li key={it.id} className="px-3 py-3" style={{ background: "var(--surface-elevated)" }}>
                      {renderItemForm("Save", updateItem, {
                        itemId: it.id,
                        label: it.label,
                        description: it.description,
                        zone: it.zone,
                        targetRole: it.targetRole,
                        toolIds: parseToolIds(it.toolsNeeded),
                      })}
                    </li>
                  );
                }
                const toolIds = parseToolIds(it.toolsNeeded);
                return (
                  <li key={it.id} className="rc-list-row !items-start">
                    <div className="flex-1">
                      <div className="font-medium">
                        <span className="rc-muted mr-2 font-mono text-xs">
                          {idx + 1}.
                        </span>
                        {it.label}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                        {it.zone ? (
                          <span className="rc-badge rc-badge-planning">
                            {it.zone}
                          </span>
                        ) : null}
                        {it.targetRole ? (
                          <span className="rc-badge rc-badge-prep">
                            {it.targetRole.replace(/_/g, " ")}
                          </span>
                        ) : null}
                        {toolIds.length > 0 ? (
                          <span className="rc-muted">
                            🛠 {toolIds.map((id) => equipmentNameById.get(id) ?? "(deleted)").join(", ")}
                          </span>
                        ) : null}
                      </div>
                      {it.description ? (
                        <div className="rc-muted mt-1 text-sm">
                          {it.description}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1">
                      <Link
                        href={`/vehicles/${vehicleId}/templates/${kind}?edit=${it.id}`}
                        className="rc-btn rc-btn-ghost px-2 py-1 text-xs"
                      >
                        Edit
                      </Link>
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
                );
              })}
            </ul>
          )}

          {!editId ? renderItemForm("Add item", addItem) : null}
        </section>
      </main>
    </>
  );
}
