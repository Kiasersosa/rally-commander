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

const ROLE_LABEL: Record<UserRole, string> = {
  chief: "Crew chief",
  lead_mechanic: "Lead mechanic",
  assistant: "Assistant",
  gopher: "Gopher",
  co_driver: "Co-driver",
  driver: "Driver",
};

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

    const [existing] = await db
      .select({ id: users.id, deletedAt: users.deletedAt })
      .from(users)
      .where(and(eq(users.teamId, u.teamId), eq(users.email, email)))
      .limit(1);

    if (existing) {
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
      <main className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Team</h1>
          <p className="rc-muted mt-1 text-sm">
            Crew, roles, and invites. Magic-link login means no passwords to manage.
          </p>
        </header>

        {me.role === "chief" ? (
          <form
            action={invite}
            className="rc-card mb-8 grid grid-cols-1 gap-3 sm:grid-cols-12"
          >
            <input
              name="name"
              required
              placeholder="Crew member name"
              className="rc-input sm:col-span-3"
            />
            <input
              name="email"
              type="email"
              required
              placeholder="email@example.com"
              className="rc-input sm:col-span-4"
            />
            <select
              name="role"
              required
              className="rc-select sm:col-span-3"
              defaultValue=""
            >
              <option value="" disabled>
                Role…
              </option>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABEL[r]}
                </option>
              ))}
            </select>
            <button type="submit" className="rc-btn rc-btn-primary sm:col-span-2">
              Invite
            </button>
          </form>
        ) : null}

        <ul className="rc-list">
          {crew.map((c) => (
            <li key={c.id} className="rc-list-row">
              <div>
                <div
                  className={
                    c.deletedAt
                      ? "line-through decoration-[var(--muted)] text-[color:var(--muted)]"
                      : "font-medium"
                  }
                >
                  {c.name}
                </div>
                <div className="rc-muted text-sm">
                  {ROLE_LABEL[c.role]} · {c.email}
                  {c.deletedAt ? " · revoked" : ""}
                </div>
              </div>
              {me.role === "chief" && c.id !== me.userId ? (
                c.deletedAt ? (
                  <form action={restore}>
                    <input type="hidden" name="user_id" value={c.id} />
                    <button type="submit" className="rc-btn rc-btn-ghost text-sm">
                      Restore
                    </button>
                  </form>
                ) : (
                  <form action={revoke}>
                    <input type="hidden" name="user_id" value={c.id} />
                    <button type="submit" className="rc-btn rc-btn-danger text-sm">
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
