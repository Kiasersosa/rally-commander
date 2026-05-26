import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  equipmentItems,
  users,
  type EquipmentCategory,
} from "@/lib/db/schema";
import { getCurrentUser, isFullAccessRole, requireFullAccess } from "@/lib/authz";
import { Nav } from "@/components/Nav";

// ─── category config ─────────────────────────────────────────────────────────

const CATEGORIES: EquipmentCategory[] = [
  "tools",
  "mechanics",
  "cooking",
  "transport",
  "comms",
  "filming",
  "electronics",
  "service_tool",
  "other",
];

const CATEGORY_LABEL: Record<EquipmentCategory, string> = {
  tools:        "Tools",
  mechanics:    "Mechanics",
  cooking:      "Cooking",
  transport:    "Transport",
  comms:        "Comms",
  filming:      "Filming",
  electronics:  "Electronics",
  service_tool: "Service tools",
  other:        "Other",
};

// ─── server actions ───────────────────────────────────────────────────────────

async function addEquipment(formData: FormData) {
  "use server";
  const u = await requireFullAccess();
  const category = (formData.get("category") as string | null) as EquipmentCategory | null;
  if (!category || !CATEGORIES.includes(category)) return;
  const description = (formData.get("description") as string | null)?.trim();
  if (!description) return;
  const qtyRaw = parseInt((formData.get("qty") as string | null) ?? "1", 10);
  const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
  await db.insert(equipmentItems).values({
    teamId: u.teamId,
    category,
    description,
    qty,
    packedIn: (formData.get("packedIn") as string | null)?.trim() || null,
    location: (formData.get("location") as string | null)?.trim() || null,
    belongsToUserId: (formData.get("belongsToUserId") as string | null) || null,
    notes: (formData.get("notes") as string | null)?.trim() || null,
  });
  revalidatePath("/equipment");
}

async function updateEquipment(formData: FormData) {
  "use server";
  const u = await requireFullAccess();
  const id = (formData.get("id") as string | null)?.trim();
  const category = (formData.get("category") as string | null) as EquipmentCategory | null;
  const description = (formData.get("description") as string | null)?.trim();
  if (!id || !category || !description) return;
  const qtyRaw = parseInt((formData.get("qty") as string | null) ?? "1", 10);
  const qty = Number.isFinite(qtyRaw) && qtyRaw > 0 ? qtyRaw : 1;
  await db
    .update(equipmentItems)
    .set({
      category,
      description,
      qty,
      packedIn: (formData.get("packedIn") as string | null)?.trim() || null,
      location: (formData.get("location") as string | null)?.trim() || null,
      belongsToUserId: (formData.get("belongsToUserId") as string | null) || null,
      notes: (formData.get("notes") as string | null)?.trim() || null,
      updatedAt: new Date(),
    })
    .where(and(eq(equipmentItems.id, id), eq(equipmentItems.teamId, u.teamId)));
  revalidatePath("/equipment");
}

async function deleteEquipment(formData: FormData) {
  "use server";
  const u = await requireFullAccess();
  const id = (formData.get("id") as string | null)?.trim();
  if (!id) return;
  await db
    .update(equipmentItems)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(equipmentItems.id, id), eq(equipmentItems.teamId, u.teamId)));
  revalidatePath("/equipment");
}

// ─── page ─────────────────────────────────────────────────────────────────────

type SearchParams = Promise<{ edit?: string; cat?: string }>;

export default async function EquipmentPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { edit: editId, cat: activeCat } = await searchParams;
  const isChief = isFullAccessRole(me.role);

  const allItems = await db
    .select({
      id: equipmentItems.id,
      category: equipmentItems.category,
      description: equipmentItems.description,
      qty: equipmentItems.qty,
      packedIn: equipmentItems.packedIn,
      location: equipmentItems.location,
      belongsToUserId: equipmentItems.belongsToUserId,
      belongsToName: users.name,
      notes: equipmentItems.notes,
    })
    .from(equipmentItems)
    .leftJoin(users, eq(users.id, equipmentItems.belongsToUserId))
    .where(and(eq(equipmentItems.teamId, me.teamId), isNull(equipmentItems.deletedAt)))
    .orderBy(asc(equipmentItems.category), asc(equipmentItems.description));

  const crew = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.teamId, me.teamId), isNull(users.deletedAt)))
    .orderBy(asc(users.name));

  // Group by category
  const byCategory = new Map<EquipmentCategory, typeof allItems>();
  for (const cat of CATEGORIES) byCategory.set(cat, []);
  for (const item of allItems) {
    byCategory.get(item.category)?.push(item);
  }

  // Which categories have items (for the tab bar)
  const usedCats = CATEGORIES.filter((c) => (byCategory.get(c)?.length ?? 0) > 0);
  const displayCat = (activeCat as EquipmentCategory | undefined) ?? usedCats[0] ?? CATEGORIES[0];

  const totalItems = allItems.length;

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Equipment</h1>
            <p className="rc-muted mt-1 text-sm">
              {totalItems} item{totalItems !== 1 ? "s" : ""} across {usedCats.length || CATEGORIES.length} categories
            </p>
          </div>
        </header>

        {/* Add form — chief only */}
        {isChief && (
          <details className="rc-card mb-6 group">
            <summary className="cursor-pointer font-semibold select-none list-none flex items-center gap-2">
              <span className="text-[var(--accent)] text-lg leading-none">+</span> Add item
            </summary>
            <form action={addEquipment} className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-12">
              <select name="category" required defaultValue="" className="rc-select sm:col-span-2">
                <option value="" disabled>Category…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                ))}
              </select>
              <input name="description" required placeholder="Description *" className="rc-input sm:col-span-4" />
              <input name="qty" type="number" min={1} defaultValue={1} placeholder="Qty" className="rc-input sm:col-span-1" />
              <input name="packedIn" placeholder="Packed in (bag/case)" className="rc-input sm:col-span-2" />
              <input name="location" placeholder="Stored at" className="rc-input sm:col-span-2" />
              <select name="belongsToUserId" defaultValue="" className="rc-select sm:col-span-2">
                <option value="">Belongs to…</option>
                {crew.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <input name="notes" placeholder="Notes" className="rc-input sm:col-span-3" />
              <button type="submit" className="rc-btn rc-btn-primary sm:col-span-1">Add</button>
            </form>
          </details>
        )}

        {/* Category tab bar */}
        <div className="mb-4 flex flex-wrap gap-2 border-b pb-3" style={{ borderColor: "var(--border)" }}>
          {CATEGORIES.map((cat) => {
            const count = byCategory.get(cat)?.length ?? 0;
            const isActive = cat === displayCat;
            const base =
              "px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors";
            const cls = isActive
              ? "bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm"
              : count === 0
              ? "text-[var(--foreground)]/55 border-[var(--border)] hover:text-[var(--foreground)] hover:border-[var(--border-strong)]"
              : "text-[var(--foreground)] bg-[var(--surface)] border-[var(--border-strong)] hover:border-[var(--accent)] hover:text-[var(--accent)]";
            return (
              <Link
                key={cat}
                href={`/equipment?cat=${cat}`}
                className={`${base} ${cls}`}
              >
                {CATEGORY_LABEL[cat]}
                {count > 0 && (
                  <span className={`ml-1.5 ${isActive ? "opacity-90" : "opacity-70"}`}>
                    ({count})
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* Active category items */}
        {(() => {
          const items = byCategory.get(displayCat) ?? [];
          return (
            <section>
              <h2 className="mb-3 text-lg font-semibold tracking-tight">
                {CATEGORY_LABEL[displayCat]}
              </h2>

              {items.length === 0 ? (
                <p className="rc-empty-section">No {CATEGORY_LABEL[displayCat].toLowerCase()} items yet.</p>
              ) : (
                <div className="rc-card overflow-x-auto p-0">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b" style={{ borderColor: "var(--border-strong)" }}>
                        <th className="text-left py-2 px-3 rc-muted font-semibold w-8">Qty</th>
                        <th className="text-left py-2 px-3 rc-muted font-semibold">Description</th>
                        <th className="text-left py-2 px-3 rc-muted font-semibold">Packed in</th>
                        <th className="text-left py-2 px-3 rc-muted font-semibold">Stored at</th>
                        <th className="text-left py-2 px-3 rc-muted font-semibold">Belongs to</th>
                        <th className="text-left py-2 px-3 rc-muted font-semibold">Notes</th>
                        {isChief && <th className="w-[90px]" />}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const isEditing = editId === item.id;
                        return isEditing && isChief ? (
                          <tr key={item.id} style={{ background: "var(--surface-elevated)" }}>
                            <td colSpan={isChief ? 7 : 6} className="px-3 py-3">
                              <form action={updateEquipment} className="grid grid-cols-1 gap-2 sm:grid-cols-12">
                                <input type="hidden" name="id" value={item.id} />
                                <select name="category" defaultValue={item.category} className="rc-select sm:col-span-2">
                                  {CATEGORIES.map((c) => (
                                    <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                                  ))}
                                </select>
                                <input name="description" required defaultValue={item.description} placeholder="Description *" className="rc-input sm:col-span-4" />
                                <input name="qty" type="number" min={1} defaultValue={item.qty} className="rc-input sm:col-span-1" />
                                <input name="packedIn" defaultValue={item.packedIn ?? ""} placeholder="Packed in" className="rc-input sm:col-span-2" />
                                <input name="location" defaultValue={item.location ?? ""} placeholder="Stored at" className="rc-input sm:col-span-2" />
                                <select name="belongsToUserId" defaultValue={item.belongsToUserId ?? ""} className="rc-select sm:col-span-2">
                                  <option value="">Belongs to…</option>
                                  {crew.map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </select>
                                <input name="notes" defaultValue={item.notes ?? ""} placeholder="Notes" className="rc-input sm:col-span-3" />
                                <div className="flex gap-1 sm:col-span-1">
                                  <button type="submit" className="rc-btn rc-btn-primary text-xs px-2">Save</button>
                                  <Link href="/equipment" className="rc-btn rc-btn-ghost text-xs px-2">✕</Link>
                                </div>
                              </form>
                            </td>
                          </tr>
                        ) : (
                          <tr key={item.id} className="border-b rc-list-row" style={{ borderColor: "var(--border)" }}>
                            <td className="py-2 px-3 align-top text-center font-medium">
                              {item.qty > 1 ? <span className="rc-badge rc-badge-prep">{item.qty}</span> : "1"}
                            </td>
                            <td className="py-2 px-3 align-top font-semibold">{item.description}</td>
                            <td className="py-2 px-3 align-top">
                              {item.packedIn ?? <span className="rc-muted">—</span>}
                            </td>
                            <td className="py-2 px-3 align-top rc-muted">
                              {item.location ?? "—"}
                            </td>
                            <td className="py-2 px-3 align-top">
                              {item.belongsToName
                                ? <span className="font-medium">{item.belongsToName}</span>
                                : <span className="rc-muted">—</span>}
                            </td>
                            <td className="py-2 px-3 align-top rc-muted text-xs">
                              {item.notes ?? ""}
                            </td>
                            {isChief && (
                              <td className="py-2 px-3 align-top">
                                <div className="flex gap-1">
                                  <Link
                                    href={`/equipment?edit=${item.id}&cat=${displayCat}`}
                                    className="rc-btn rc-btn-ghost text-xs px-2 py-1"
                                  >
                                    Edit
                                  </Link>
                                  <form action={deleteEquipment}>
                                    <input type="hidden" name="id" value={item.id} />
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
          );
        })()}
      </main>
    </>
  );
}
