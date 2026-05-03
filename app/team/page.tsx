import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, type UserRole } from "@/lib/db/schema";
import { signIn } from "@/lib/auth";
import { getCurrentUser, requireChief } from "@/lib/authz";
import { Nav } from "@/components/Nav";

const ROLES: UserRole[] = [
  "chief",
  "lead_mechanic",
  "assistant",
  "gopher",
  "co_driver",
  "driver",
];

export default async function TeamPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const crew = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      deletedAt: users.deletedAt,
    })
    .from(users)
    .where(eq(users.teamId, me.teamId))
    .orderBy(asc(users.deletedAt), asc(users.name));

  async function invite(formData: FormData) {
    "use server";
    const u = await requireChief();
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    const name = String(formData.get("name") ?? "").trim();
    const role = String(formData.get("role") ?? "") as UserRole;
    if (!email || !name || !ROLES.includes(role)) {
      throw new Error("email, name, and role required");
    }

    // Find any existing row (active or revoked) on this team for this email.
    const [existing] = await db
      .select({ id: users.id, deletedAt: users.deletedAt })
      .from(users)
      .where(and(eq(users.teamId, u.teamId), eq(users.email, email)))
      .limit(1);

    if (existing) {
      // Restore + update role+name if previously revoked.
      await db
        .update(users)
        .set({ name, role, deletedAt: null, updatedAt: new Date() })
        .where(eq(users.id, existing.id));
    } else {
      await db.insert(users).values({
        teamId: u.teamId,
        email,
        name,
        role,
      });
    }

    // Send magic link.
    await signIn("resend", { email, redirect: false });
    revalidatePath("/team");
  }

  async function revoke(formData: FormData) {
    "use server";
    const u = await requireChief();
    const userId = String(formData.get("user_id") ?? "");
    if (!userId) return;
    if (userId === u.userId) {
      throw new Error("You cannot revoke yourself.");
    }
    await db
      .update(users)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.teamId, u.teamId)));
    revalidatePath("/team");
  }

  async function restore(formData: FormData) {
    "use server";
    const u = await requireChief();
    const userId = String(formData.get("user_id") ?? "");
    if (!userId) return;
    await db
      .update(users)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(and(eq(users.id, userId), eq(users.teamId, u.teamId)));
    revalidatePath("/team");
  }

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-semibold">Team</h1>

        {me.role === "chief" ? (
          <form
            action={invite}
            className="mb-8 grid grid-cols-1 gap-3 rounded border border-neutral-200 p-4 sm:grid-cols-4"
          >
            <input
              name="name"
              required
              placeholder="Crew member name"
              className="rounded border border-neutral-300 px-3 py-2"
            />
            <input
              name="email"
              type="email"
              required
              placeholder="email@example.com"
              className="rounded border border-neutral-300 px-3 py-2"
            />
            <select
              name="role"
              required
              className="rounded border border-neutral-300 px-3 py-2"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded bg-neutral-900 px-3 py-2 text-white hover:bg-neutral-800"
            >
              Invite
            </button>
          </form>
        ) : null}

        <ul className="divide-y divide-neutral-200 rounded border border-neutral-200">
          {crew.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div>
                <div className={c.deletedAt ? "text-neutral-400 line-through" : ""}>
                  {c.name}{" "}
                  <span className="text-sm text-neutral-500">({c.role})</span>
                </div>
                <div className="text-sm text-neutral-500">{c.email}</div>
              </div>
              {me.role === "chief" && c.id !== me.userId ? (
                c.deletedAt ? (
                  <form action={restore}>
                    <input type="hidden" name="user_id" value={c.id} />
                    <button
                      type="submit"
                      className="rounded border border-neutral-300 px-3 py-1 text-sm hover:bg-neutral-50"
                    >
                      Restore
                    </button>
                  </form>
                ) : (
                  <form action={revoke}>
                    <input type="hidden" name="user_id" value={c.id} />
                    <button
                      type="submit"
                      className="rounded border border-rose-300 px-3 py-1 text-sm text-rose-700 hover:bg-rose-50"
                    >
                      Revoke
                    </button>
                  </form>
                )
              ) : null}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
