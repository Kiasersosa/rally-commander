import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser, requireSession } from "@/lib/authz";
import { Nav } from "@/components/Nav";

export default async function ProfilePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const [self] = await db
    .select({
      phoneNumber: users.phoneNumber,
      smsOptIn: users.smsOptIn,
    })
    .from(users)
    .where(and(eq(users.id, me.userId), eq(users.teamId, me.teamId)))
    .limit(1);

  async function save(formData: FormData) {
    "use server";
    const u = await requireSession();
    const phoneRaw = String(formData.get("phone_number") ?? "").trim();
    const smsOptIn = String(formData.get("sms_opt_in") ?? "") === "on";
    // Light validation: must be empty OR start with + and have ≥10 digits
    let phoneNumber: string | null = null;
    if (phoneRaw) {
      const digits = phoneRaw.replace(/[^\d]/g, "");
      if (digits.length < 10) {
        throw new Error("Phone number must have at least 10 digits");
      }
      phoneNumber = phoneRaw.startsWith("+") ? phoneRaw : `+${digits}`;
    }
    await db
      .update(users)
      .set({ phoneNumber, smsOptIn, updatedAt: new Date() })
      .where(and(eq(users.id, u.userId), eq(users.teamId, u.teamId)));
    revalidatePath("/profile");
  }

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-2xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
          <p className="rc-muted mt-1 text-sm">
            Your contact preferences. Email digest is mandatory while your
            account is active.
          </p>
        </header>

        <form action={save} className="rc-card flex flex-col gap-4">
          <div>
            <label className="mb-1 block text-sm font-medium">Email</label>
            <div className="rc-muted text-sm">{me.email}</div>
            <div className="rc-muted mt-1 text-xs">
              Set by your chief at invite. Contact them to change.
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="phone_number">
              Phone number
            </label>
            <input
              id="phone_number"
              name="phone_number"
              type="tel"
              inputMode="tel"
              defaultValue={self?.phoneNumber ?? ""}
              placeholder="+15551234567"
              className="rc-input"
            />
            <div className="rc-muted mt-1 text-xs">
              International format with country code. Leave blank to opt out
              of SMS entirely.
            </div>
          </div>
          <label className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              name="sms_opt_in"
              defaultChecked={self?.smsOptIn ?? true}
              className="h-5 w-5"
            />
            <span>
              Send me SMS for time-critical alerts (1-week expiry warnings)
            </span>
          </label>
          <button type="submit" className="rc-btn rc-btn-primary self-start">
            Save profile
          </button>
        </form>
      </main>
    </>
  );
}
