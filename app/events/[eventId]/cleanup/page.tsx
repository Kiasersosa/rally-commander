import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  equipmentItems,
  equipmentCleanupSignoffs,
  events,
  users,
  type EquipmentCategory,
} from "@/lib/db/schema";
import { getCurrentUser, requireSession } from "@/lib/authz";
import { Nav } from "@/components/Nav";

type Params = Promise<{ eventId: string }>;
type SearchParams = Promise<{ cat?: string }>;

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
  tools: "Tools",
  mechanics: "Mechanics",
  cooking: "Cooking",
  transport: "Transport",
  comms: "Comms",
  filming: "Filming",
  electronics: "Electronics",
  service_tool: "Service tools",
  other: "Other",
};

export default async function CleanupPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { eventId } = await params;
  const { cat: activeCat } = await searchParams;

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

  const items = await db
    .select({
      id: equipmentItems.id,
      category: equipmentItems.category,
      description: equipmentItems.description,
      qty: equipmentItems.qty,
      packedIn: equipmentItems.packedIn,
      belongsToUserId: equipmentItems.belongsToUserId,
      belongsToName: users.name,
    })
    .from(equipmentItems)
    .leftJoin(users, eq(users.id, equipmentItems.belongsToUserId))
    .where(
      and(eq(equipmentItems.teamId, me.teamId), isNull(equipmentItems.deletedAt)),
    )
    .orderBy(asc(equipmentItems.category), asc(equipmentItems.description));

  const signoffs = await db
    .select({
      equipmentItemId: equipmentCleanupSignoffs.equipmentItemId,
      signedAt: equipmentCleanupSignoffs.signedAt,
      signedByName: users.name,
      signedByUserId: equipmentCleanupSignoffs.signedByUserId,
    })
    .from(equipmentCleanupSignoffs)
    .innerJoin(users, eq(users.id, equipmentCleanupSignoffs.signedByUserId))
    .where(
      and(
        eq(equipmentCleanupSignoffs.teamId, me.teamId),
        eq(equipmentCleanupSignoffs.eventId, eventId),
      ),
    );
  const signoffByItem = new Map(signoffs.map((s) => [s.equipmentItemId, s]));

  const byCategory = new Map<EquipmentCategory, typeof items>();
  for (const c of CATEGORIES) byCategory.set(c, []);
  for (const item of items) byCategory.get(item.category)?.push(item);

  const usedCats = CATEGORIES.filter((c) => (byCategory.get(c)?.length ?? 0) > 0);
  const displayCat =
    (activeCat as EquipmentCategory | undefined) ?? usedCats[0] ?? CATEGORIES[0];

  const totalItems = items.length;
  const signedItems = signoffs.length;
  const pct = totalItems === 0 ? 0 : Math.round((signedItems / totalItems) * 100);

  async function signOff(formData: FormData) {
    "use server";
    const u = await requireSession();
    const itemId = String(formData.get("item_id") ?? "");
    if (!itemId) return;
    await db
      .insert(equipmentCleanupSignoffs)
      .values({
        teamId: u.teamId,
        eventId,
        equipmentItemId: itemId,
        signedByUserId: u.userId,
      })
      .onConflictDoNothing();
    revalidatePath(`/events/${eventId}/cleanup`);
  }

  async function unsignOff(formData: FormData) {
    "use server";
    const u = await requireSession();
    const itemId = String(formData.get("item_id") ?? "");
    if (!itemId) return;
    await db
      .delete(equipmentCleanupSignoffs)
      .where(
        and(
          eq(equipmentCleanupSignoffs.teamId, u.teamId),
          eq(equipmentCleanupSignoffs.eventId, eventId),
          eq(equipmentCleanupSignoffs.equipmentItemId, itemId),
        ),
      );
    revalidatePath(`/events/${eventId}/cleanup`);
  }

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <div className="rc-muted mb-2 text-sm">
          <Link href="/events" className="rc-link">Events</Link>
          {" / "}
          <Link href={`/events/${eventId}`} className="rc-link">{event.name}</Link>
        </div>
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Post-race cleanup</h1>
            <p className="rc-muted mt-1 text-sm">
              Tick each item as it goes back into its bag and the proper vehicle.
              {totalItems === 0 ? " (No equipment registered yet — add items on /equipment first.)" : ""}
            </p>
          </div>
          {totalItems > 0 ? (
            <span
              className={`rc-badge rc-badge-${
                signedItems === totalItems
                  ? "on_event"
                  : signedItems === 0
                  ? "post_event"
                  : "prep"
              }`}
            >
              {signedItems} / {totalItems} · {pct}%
            </span>
          ) : null}
        </header>

        {totalItems === 0 ? (
          <div className="rc-empty-section text-center">
            No equipment registered. Add items on the{" "}
            <Link href="/equipment" className="rc-link">Equipment</Link> page first.
          </div>
        ) : (
          <>
            {/* Category tab bar */}
            <div
              className="mb-4 flex flex-wrap gap-2 border-b pb-3"
              style={{ borderColor: "var(--border)" }}
            >
              {CATEGORIES.map((cat) => {
                const catItems = byCategory.get(cat) ?? [];
                const count = catItems.length;
                if (count === 0) return null;
                const signed = catItems.filter((it) => signoffByItem.has(it.id)).length;
                const isActive = cat === displayCat;
                const allSigned = signed === count;
                const base =
                  "px-3 py-1.5 rounded-full text-sm font-semibold border transition-colors";
                const cls = isActive
                  ? "bg-[var(--accent)] text-white border-[var(--accent)] shadow-sm"
                  : allSigned
                  ? "text-emerald-700 border-emerald-300 bg-emerald-50 hover:border-emerald-500"
                  : "text-[var(--foreground)] bg-[var(--surface)] border-[var(--border-strong)] hover:border-[var(--accent)] hover:text-[var(--accent)]";
                return (
                  <Link
                    key={cat}
                    href={`/events/${eventId}/cleanup?cat=${cat}`}
                    className={`${base} ${cls}`}
                  >
                    {CATEGORY_LABEL[cat]}
                    <span className="ml-1.5 opacity-80">
                      ({signed}/{count})
                    </span>
                  </Link>
                );
              })}
            </div>

            {/* Items in active category */}
            {(() => {
              const catItems = byCategory.get(displayCat) ?? [];
              if (catItems.length === 0) {
                return <p className="rc-empty-section">No {CATEGORY_LABEL[displayCat].toLowerCase()} items.</p>;
              }
              return (
                <ul className="rc-list">
                  {catItems.map((item) => {
                    const s = signoffByItem.get(item.id);
                    return (
                      <li key={item.id} className="rc-list-row">
                        <div className="flex-1">
                          <div
                            className={`font-medium ${
                              s ? "line-through opacity-60" : ""
                            }`}
                          >
                            {item.qty > 1 ? (
                              <span className="rc-badge rc-badge-prep mr-2 text-[10px]">
                                ×{item.qty}
                              </span>
                            ) : null}
                            {item.description}
                          </div>
                          <div className="rc-muted text-xs mt-0.5">
                            {item.packedIn ? `packs into: ${item.packedIn}` : "no bag set"}
                            {item.belongsToName ? ` · owner: ${item.belongsToName}` : ""}
                          </div>
                          {s ? (
                            <div className="rc-muted text-xs mt-1">
                              ✓ signed off by {s.signedByName} ·{" "}
                              {s.signedAt.toISOString().replace("T", " ").slice(0, 16)}
                            </div>
                          ) : null}
                        </div>
                        {s ? (
                          <form action={unsignOff}>
                            <input type="hidden" name="item_id" value={item.id} />
                            <button
                              type="submit"
                              className="rc-btn rc-btn-ghost text-xs"
                            >
                              Undo
                            </button>
                          </form>
                        ) : (
                          <form action={signOff}>
                            <input type="hidden" name="item_id" value={item.id} />
                            <button
                              type="submit"
                              className="rc-btn rc-btn-primary text-sm"
                            >
                              Packed
                            </button>
                          </form>
                        )}
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
          </>
        )}
      </main>
    </>
  );
}
