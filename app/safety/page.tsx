import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/lib/db";
import {
  events,
  licenseDocs,
  safetyItems,
  users,
  type LicenseKind,
  type SafetyItemType,
} from "@/lib/db/schema";
import { getCurrentUser, isFullAccessRole, requireFullAccess } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import {
  BAND_BADGE_CLASS,
  BAND_LABEL,
  deriveWarnings,
} from "@/lib/safety-expiry-warner";

const SAFETY_TYPES: SafetyItemType[] = [
  "helmet",
  "hans",
  "suit",
  "harness",
  "fuel_cell",
  "fire_extinguisher",
  "other",
];
const SAFETY_LABEL: Record<SafetyItemType, string> = {
  helmet: "Helmet",
  hans: "HANS / FHR",
  suit: "Suit",
  harness: "Harness",
  fuel_cell: "Fuel cell",
  fire_extinguisher: "Fire extinguisher",
  other: "Other",
};

const LICENSE_KINDS: LicenseKind[] = ["ara", "fia", "medical"];
const LICENSE_LABEL: Record<LicenseKind, string> = {
  ara: "ARA license",
  fia: "FIA license",
  medical: "Medical certificate",
};

export default async function SafetyPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const safety = await db
    .select({
      id: safetyItems.id,
      type: safetyItems.type,
      spec: safetyItems.spec,
      serial: safetyItems.serial,
      expiryDate: safetyItems.expiryDate,
      ownerName: users.name,
      ownerUserId: safetyItems.ownerUserId,
      notes: safetyItems.notes,
    })
    .from(safetyItems)
    .leftJoin(users, eq(users.id, safetyItems.ownerUserId))
    .where(and(eq(safetyItems.teamId, me.teamId), isNull(safetyItems.deletedAt)))
    .orderBy(asc(safetyItems.type));

  const licenses = await db
    .select({
      id: licenseDocs.id,
      kind: licenseDocs.kind,
      licenseNumber: licenseDocs.licenseNumber,
      expiryDate: licenseDocs.expiryDate,
      holderName: users.name,
      holderUserId: licenseDocs.holderUserId,
      notes: licenseDocs.notes,
    })
    .from(licenseDocs)
    .innerJoin(users, eq(users.id, licenseDocs.holderUserId))
    .where(and(eq(licenseDocs.teamId, me.teamId), isNull(licenseDocs.deletedAt)))
    .orderBy(asc(users.name), asc(licenseDocs.kind));

  const crew = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(and(eq(users.teamId, me.teamId), isNull(users.deletedAt)))
    .orderBy(asc(users.name));

  const upcomingEvents = await db
    .select({
      id: events.id,
      name: events.name,
      eventDate: events.eventDate,
      phase: events.phase,
    })
    .from(events)
    .where(and(eq(events.teamId, me.teamId), isNull(events.deletedAt)))
    .orderBy(desc(events.eventDate))
    .limit(10);

  const referenceDate = new Date();
  const safetyWarnings = deriveWarnings(
    safety.map((s) => ({
      id: s.id,
      label: `${SAFETY_LABEL[s.type]}${s.serial ? ` · ${s.serial}` : ""}${s.ownerName ? ` (${s.ownerName})` : ""}`,
      expiryDate: s.expiryDate ? new Date(`${s.expiryDate}T00:00:00Z`) : null,
    })),
    referenceDate,
  );
  const licenseWarnings = deriveWarnings(
    licenses.map((l) => ({
      id: l.id,
      label: `${l.holderName} · ${LICENSE_LABEL[l.kind]}`,
      expiryDate: l.expiryDate ? new Date(`${l.expiryDate}T00:00:00Z`) : null,
    })),
    referenceDate,
  );
  const safetyBandById = new Map(safetyWarnings.map((w) => [w.item.id, w]));
  const licenseBandById = new Map(licenseWarnings.map((w) => [w.item.id, w]));

  // ---- server actions ----

  async function addSafetyItem(formData: FormData) {
    "use server";
    const u = await requireFullAccess();
    const type = String(formData.get("type") ?? "") as SafetyItemType;
    if (!SAFETY_TYPES.includes(type)) return;
    const spec = String(formData.get("spec") ?? "").trim() || null;
    const serial = String(formData.get("serial") ?? "").trim() || null;
    const expiryRaw = String(formData.get("expiry_date") ?? "").trim();
    const ownerRaw = String(formData.get("owner_user_id") ?? "");
    const notes = String(formData.get("notes") ?? "").trim() || null;
    await db.insert(safetyItems).values({
      teamId: u.teamId,
      type,
      spec,
      serial,
      expiryDate: expiryRaw || null,
      ownerUserId: ownerRaw || null,
      notes,
    });
    revalidatePath("/safety");
  }

  async function deleteSafetyItem(formData: FormData) {
    "use server";
    const u = await requireFullAccess();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .update(safetyItems)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(safetyItems.id, id), eq(safetyItems.teamId, u.teamId)));
    revalidatePath("/safety");
  }

  async function addLicense(formData: FormData) {
    "use server";
    const u = await requireFullAccess();
    const holderUserId = String(formData.get("holder_user_id") ?? "");
    const kind = String(formData.get("kind") ?? "") as LicenseKind;
    if (!holderUserId || !LICENSE_KINDS.includes(kind)) return;
    const licenseNumber = String(formData.get("license_number") ?? "").trim() || null;
    const expiryRaw = String(formData.get("expiry_date") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim() || null;
    await db.insert(licenseDocs).values({
      teamId: u.teamId,
      holderUserId,
      kind,
      licenseNumber,
      expiryDate: expiryRaw || null,
      notes,
    });
    revalidatePath("/safety");
  }

  async function deleteLicense(formData: FormData) {
    "use server";
    const u = await requireFullAccess();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .update(licenseDocs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(licenseDocs.id, id), eq(licenseDocs.teamId, u.teamId)));
    revalidatePath("/safety");
  }

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">
            Safety &amp; licensing
          </h1>
          <p className="rc-muted mt-1 text-sm">
            Tech-ready inventory. Expiry warnings ladder at 6mo / 3mo / 1mo / 1wk. Equipment is tracked under the{" "}
            <a href="/equipment" className="rc-link">Equipment tab</a>.
          </p>
        </header>

        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Tech-ready by event</h2>
          <p className="rc-muted mb-3 text-sm">
            Per-event red/yellow/green status for safety + licensing items, computed
            against each event&apos;s date.
          </p>
          {upcomingEvents.length === 0 ? (
            <p className="rc-empty-section">No events to check.</p>
          ) : (
            <ul className="rc-list">
              {upcomingEvents.map((e) => (
                <li key={e.id} className="rc-list-row">
                  <div>
                    <Link
                      href={`/events/${e.id}/tech-ready`}
                      className="rc-link font-medium"
                    >
                      {e.name}
                    </Link>
                    <div className="rc-muted text-sm">{e.eventDate}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`rc-badge rc-badge-${e.phase}`}>
                      {e.phase.replace("_", " ")}
                    </span>
                    <Link
                      href={`/events/${e.id}/tech-ready`}
                      className="rc-btn rc-btn-ghost text-xs"
                    >
                      View →
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Safety gear</h2>
          {isFullAccessRole(me.role) ? (
            <form
              action={addSafetyItem}
              className="rc-card mb-3 grid grid-cols-1 gap-2 sm:grid-cols-12"
            >
              <select
                name="type"
                required
                defaultValue=""
                className="rc-select sm:col-span-2"
              >
                <option value="" disabled>
                  Type…
                </option>
                {SAFETY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {SAFETY_LABEL[t]}
                  </option>
                ))}
              </select>
              <input
                name="spec"
                placeholder="FIA spec (e.g., 8859-2015)"
                className="rc-input sm:col-span-3"
              />
              <input
                name="serial"
                placeholder="Serial #"
                className="rc-input sm:col-span-2"
              />
              <input
                name="expiry_date"
                type="date"
                className="rc-input sm:col-span-2"
                title="Expiry"
              />
              <select
                name="owner_user_id"
                defaultValue=""
                className="rc-select sm:col-span-2"
              >
                <option value="">Owner</option>
                {crew.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="rc-btn rc-btn-primary sm:col-span-1">
                Add
              </button>
            </form>
          ) : null}
          {safety.length === 0 ? (
            <p className="rc-muted text-sm">No safety items registered.</p>
          ) : (
            <ul className="rc-list">
              {safety.map((s) => {
                const w = safetyBandById.get(s.id);
                return (
                  <li key={s.id} className="rc-list-row">
                    <div className="flex-1">
                      <div className="font-medium">
                        {SAFETY_LABEL[s.type]}
                        {s.spec ? <span className="rc-muted text-sm"> · {s.spec}</span> : null}
                      </div>
                      <div className="rc-muted text-sm">
                        {s.serial ? `S/N ${s.serial}` : "no serial"}
                        {s.ownerName ? ` · ${s.ownerName}` : ""}
                        {s.expiryDate ? ` · expires ${s.expiryDate}` : " · no expiry set"}
                      </div>
                    </div>
                    {w ? (
                      <span className={`rc-badge ${BAND_BADGE_CLASS[w.band]}`}>
                        {BAND_LABEL[w.band]}
                      </span>
                    ) : null}
                    {isFullAccessRole(me.role) ? (
                      <form action={deleteSafetyItem}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                          ×
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Licenses & medical</h2>
          {isFullAccessRole(me.role) ? (
            <form
              action={addLicense}
              className="rc-card mb-3 grid grid-cols-1 gap-2 sm:grid-cols-12"
            >
              <select
                name="holder_user_id"
                required
                defaultValue=""
                className="rc-select sm:col-span-3"
              >
                <option value="" disabled>
                  Holder…
                </option>
                {crew.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <select
                name="kind"
                required
                defaultValue=""
                className="rc-select sm:col-span-3"
              >
                <option value="" disabled>
                  Kind…
                </option>
                {LICENSE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {LICENSE_LABEL[k]}
                  </option>
                ))}
              </select>
              <input
                name="license_number"
                placeholder="License #"
                className="rc-input sm:col-span-3"
              />
              <input
                name="expiry_date"
                type="date"
                className="rc-input sm:col-span-2"
                title="Expiry"
              />
              <button type="submit" className="rc-btn rc-btn-primary sm:col-span-1">
                Add
              </button>
            </form>
          ) : null}
          {licenses.length === 0 ? (
            <p className="rc-muted text-sm">No licenses registered.</p>
          ) : (
            <ul className="rc-list">
              {licenses.map((l) => {
                const w = licenseBandById.get(l.id);
                return (
                  <li key={l.id} className="rc-list-row">
                    <div className="flex-1">
                      <div className="font-medium">
                        {l.holderName} · {LICENSE_LABEL[l.kind]}
                      </div>
                      <div className="rc-muted text-sm">
                        {l.licenseNumber ? `# ${l.licenseNumber}` : "no #"}
                        {l.expiryDate ? ` · expires ${l.expiryDate}` : " · no expiry set"}
                      </div>
                    </div>
                    {w ? (
                      <span className={`rc-badge ${BAND_BADGE_CLASS[w.band]}`}>
                        {BAND_LABEL[w.band]}
                      </span>
                    ) : null}
                    {isFullAccessRole(me.role) ? (
                      <form action={deleteLicense}>
                        <input type="hidden" name="id" value={l.id} />
                        <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                          ×
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

      </main>
    </>
  );
}
