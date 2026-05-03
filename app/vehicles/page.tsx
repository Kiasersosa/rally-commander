import { redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { vehicles, workOrders, type VehicleType } from "@/lib/db/schema";
import { getCurrentUser, requireChief } from "@/lib/authz";
import { Nav } from "@/components/Nav";

const TYPES: VehicleType[] = ["rally_car", "service_truck", "trailer"];
const TYPE_LABEL: Record<VehicleType, string> = {
  rally_car: "Rally car",
  service_truck: "Service truck",
  trailer: "Trailer",
};

export default async function VehiclesPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const rows = await db
    .select({
      id: vehicles.id,
      type: vehicles.type,
      name: vehicles.name,
      year: vehicles.year,
      make: vehicles.make,
      model: vehicles.model,
      openWoCount: sql<number>`COALESCE((SELECT COUNT(*)::int FROM ${workOrders} wo WHERE wo.team_id = ${vehicles.teamId} AND wo.vehicle_id = ${vehicles.id} AND wo.closed_at IS NULL), 0)`,
    })
    .from(vehicles)
    .where(and(eq(vehicles.teamId, me.teamId), isNull(vehicles.deletedAt)))
    .orderBy(asc(vehicles.type), asc(vehicles.name));

  async function createVehicle(formData: FormData) {
    "use server";
    const u = await requireChief();
    const type = String(formData.get("type") ?? "") as VehicleType;
    const name = String(formData.get("name") ?? "").trim();
    const year = Number.parseInt(String(formData.get("year") ?? ""), 10);
    const make = String(formData.get("make") ?? "").trim() || null;
    const model = String(formData.get("model") ?? "").trim() || null;

    if (!TYPES.includes(type) || !name) {
      throw new Error("type and name are required");
    }
    await db.insert(vehicles).values({
      teamId: u.teamId,
      type,
      name,
      year: Number.isFinite(year) ? year : null,
      make,
      model,
    });
    revalidatePath("/vehicles");
  }

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Vehicles</h1>
          <p className="rc-muted mt-1 text-sm">
            Rally car, service truck, trailer. Each gets its own work-order log.
          </p>
        </header>

        {me.role === "chief" ? (
          <form
            action={createVehicle}
            className="rc-card mb-8 grid grid-cols-1 gap-3 sm:grid-cols-12"
          >
            <select
              name="type"
              required
              className="rc-select sm:col-span-3"
              defaultValue=""
            >
              <option value="" disabled>
                Type…
              </option>
              {TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <input
              name="name"
              required
              placeholder="Name (e.g., #46 BRZ)"
              className="rc-input sm:col-span-3"
            />
            <input
              name="year"
              type="number"
              min={1980}
              max={2099}
              placeholder="Year"
              className="rc-input sm:col-span-2"
            />
            <input
              name="make"
              placeholder="Make"
              className="rc-input sm:col-span-2"
            />
            <input
              name="model"
              placeholder="Model"
              className="rc-input sm:col-span-2"
            />
            <button type="submit" className="rc-btn rc-btn-primary sm:col-span-12">
              Register vehicle
            </button>
          </form>
        ) : null}

        {rows.length === 0 ? (
          <div className="rc-empty-section text-center">
            No vehicles yet.{" "}
            {me.role === "chief"
              ? "Add one above."
              : "Your chief hasn't registered any."}
          </div>
        ) : (
          <ul className="rc-list">
            {rows.map((v) => (
              <li key={v.id} className="rc-list-row">
                <div>
                  <Link
                    href={`/vehicles/${v.id}`}
                    className="rc-link text-base font-semibold"
                  >
                    {v.name}
                  </Link>
                  <div className="rc-muted text-sm">
                    {TYPE_LABEL[v.type]}
                    {v.year ? ` · ${v.year}` : ""}
                    {v.make ? ` · ${v.make}` : ""}
                    {v.model ? ` ${v.model}` : ""}
                  </div>
                </div>
                <span className="rc-muted text-sm">
                  {v.openWoCount} open WO{v.openWoCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
