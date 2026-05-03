import { signIn, auth } from "@/lib/auth";
import { redirect } from "next/navigation";

type SearchParams = Promise<{ check?: string; error?: string }>;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const session = await auth();
  if (session) {
    redirect("/events");
  }
  const { check, error } = await searchParams;

  async function send(formData: FormData) {
    "use server";
    const email = String(formData.get("email") ?? "").trim().toLowerCase();
    if (!email) return;
    await signIn("resend", { email, redirectTo: "/events" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <div className="mb-8 text-center">
        <h1 className="rc-logo text-3xl">Rally Commander</h1>
        <p className="rc-muted mt-2 text-sm">
          Race-weekend management for rally teams.
        </p>
      </div>

      {check === "email" ? (
        <div className="rc-card mb-4 border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-700 dark:text-emerald-300">
          Check your inbox for the sign-in link.
        </div>
      ) : null}
      {error ? (
        <div className="rc-card mb-4 border-rose-500/30 bg-rose-500/10 text-sm text-rose-700 dark:text-rose-300">
          That email isn&apos;t recognized. Ask your chief for an invite.
        </div>
      ) : null}

      <form action={send} className="rc-card flex flex-col gap-3">
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rc-input"
          placeholder="you@example.com"
        />
        <button type="submit" className="rc-btn rc-btn-primary mt-1">
          Send magic link
        </button>
        <a
          href="/login/pin"
          className="rc-link mt-1 text-center text-xs"
        >
          Use PIN instead
        </a>
        <p className="rc-muted mt-1 text-center text-xs">
          Sign in with the email your crew chief invited.
        </p>
      </form>
    </main>
  );
}
