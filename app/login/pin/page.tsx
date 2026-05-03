import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { loginWithPin } from "@/lib/pin-auth";

type SearchParams = Promise<{ error?: string; locked_until?: string }>;

export default async function PinLoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (session) redirect("/events");
  const { error, locked_until } = await searchParams;

  async function submit(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "");
    const pin = String(formData.get("pin") ?? "");
    const result = await loginWithPin(email, pin);
    if (result.ok) {
      redirect("/events");
    }
    if (result.reason === "locked") {
      redirect(
        `/login/pin?error=locked&locked_until=${encodeURIComponent(
          result.lockedUntil?.toISOString() ?? "",
        )}`,
      );
    }
    redirect("/login/pin?error=invalid");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="rc-logo text-3xl">Rally Commander</h1>
        <p className="rc-muted mt-2 text-sm">PIN sign-in</p>
      </div>

      {error === "locked" ? (
        <div className="rc-card mb-4 border-rose-500/30 bg-rose-500/10 text-sm text-rose-700 dark:text-rose-300">
          Too many failed attempts. Locked until{" "}
          {locked_until
            ? new Date(locked_until).toLocaleTimeString()
            : "later"}
          . Use a magic link if you need in sooner.
        </div>
      ) : error === "invalid" ? (
        <div className="rc-card mb-4 border-rose-500/30 bg-rose-500/10 text-sm text-rose-700 dark:text-rose-300">
          Wrong email or PIN.
        </div>
      ) : null}

      <form action={submit} className="rc-card flex flex-col gap-3">
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="username"
          className="rc-input"
          placeholder="you@example.com"
        />
        <label className="text-sm font-medium" htmlFor="pin">
          PIN
        </label>
        <input
          id="pin"
          name="pin"
          type="password"
          required
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{4,8}"
          minLength={4}
          maxLength={8}
          className="rc-input tracking-widest"
          placeholder="••••"
        />
        <button type="submit" className="rc-btn rc-btn-primary mt-1">
          Sign in
        </button>
        <Link
          href="/login"
          className="rc-link mt-1 text-center text-xs"
        >
          Use magic link instead
        </Link>
      </form>
    </main>
  );
}
