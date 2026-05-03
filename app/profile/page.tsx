import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getCurrentUser, requireSession } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import { hashPin, isValidPinFormat } from "@/lib/pin-auth";

export default async function ProfilePage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");

  const [self] = await db
    .select({
      phoneNumber: users.phoneNumber,
      smsOptIn: users.smsOptIn,
      pinHash: users.pinHash,
    })
    .from(users)
    .where(and(eq(users.id, me.userId), eq(users.teamId, me.teamId)))
    .limit(1);
  const hasPin = Boolean(self?.pinHash);

  async function setPin(formData: FormData) {
    "use server";
    const u = await requireSession();
    const pin = String(formData.get("pin") ?? "");
    const confirm = String(formData.get("confirm") ?? "");
    if (!isValidPinFormat(pin)) {
      throw new Error("PIN must be 4–8 digits");
    }
    if (pin !== confirm) {
      throw new Error("PINs don't match");
    }
    const hash = await hashPin(pin);
    await db
      .update(users)
      .set({
        pinHash: hash,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, u.userId), eq(users.teamId, u.teamId)));
    revalidatePath("/profile");
  }

  async function clearPin() {
    "use server";
    const u = await requireSession();
    await db
      .update(users)
      .set({
        pinHash: null,
        pinFailedAttempts: 0,
        pinLockedUntil: null,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, u.userId), eq(users.teamId, u.teamId)));
    revalidatePath("/profile");
  }

  // Suppress lint for unused isNotNull (kept for future).
  void isNotNull;

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
              International format with country code. Stored for future SMS —
              currently inactive (see below).
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
              SMS opt-in (for future 1-week expiry alerts)
            </span>
          </label>
          <div className="rc-card mt-1 border-amber-500/30 bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
            <strong>SMS is not active yet.</strong> US carriers require A2P 10DLC
            registration before SMS will deliver from our number. Until that's
            in place (or a toll-free number is set up), expiry warnings come
            via the weekly email digest instead — it already covers the 1-week
            band.
          </div>
          <button type="submit" className="rc-btn rc-btn-primary self-start">
            Save profile
          </button>
        </form>

        <h2 className="mt-10 mb-3 text-lg font-semibold tracking-tight">
          PIN sign-in
        </h2>
        <p className="rc-muted mb-3 text-sm">
          Set a 4–8 digit PIN to skip magic-link emails on devices you trust.
          Sessions still last 30 days, so you only need this when re-authing.
          5 wrong PINs locks you out for 15 minutes.
        </p>
        {hasPin ? (
          <div className="rc-card flex flex-col gap-3">
            <p className="text-sm">
              ✓ A PIN is set for <span className="font-medium">{me.email}</span>.
            </p>
            <div className="flex gap-2">
              <details className="flex-1">
                <summary className="rc-btn rc-btn-ghost cursor-pointer self-start">
                  Change PIN
                </summary>
                <form action={setPin} className="mt-3 flex flex-col gap-2">
                  <input
                    name="pin"
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4,8}"
                    minLength={4}
                    maxLength={8}
                    required
                    placeholder="New PIN"
                    className="rc-input tracking-widest"
                  />
                  <input
                    name="confirm"
                    type="password"
                    inputMode="numeric"
                    pattern="\d{4,8}"
                    minLength={4}
                    maxLength={8}
                    required
                    placeholder="Confirm new PIN"
                    className="rc-input tracking-widest"
                  />
                  <button type="submit" className="rc-btn rc-btn-primary self-start">
                    Save new PIN
                  </button>
                </form>
              </details>
              <form action={clearPin}>
                <button type="submit" className="rc-btn rc-btn-danger">
                  Remove PIN
                </button>
              </form>
            </div>
          </div>
        ) : (
          <form action={setPin} className="rc-card flex flex-col gap-3">
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="\d{4,8}"
              minLength={4}
              maxLength={8}
              required
              placeholder="PIN (4–8 digits)"
              className="rc-input tracking-widest"
            />
            <input
              name="confirm"
              type="password"
              inputMode="numeric"
              pattern="\d{4,8}"
              minLength={4}
              maxLength={8}
              required
              placeholder="Confirm PIN"
              className="rc-input tracking-widest"
            />
            <button type="submit" className="rc-btn rc-btn-primary self-start">
              Set PIN
            </button>
          </form>
        )}
      </main>
    </>
  );
}
