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
      <h1 className="mb-2 text-2xl font-semibold">Rally Commander</h1>
      <p className="mb-6 text-sm text-neutral-500">
        Sign in with the email your crew chief invited.
      </p>

      {check === "email" ? (
        <div className="mb-4 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Check your inbox for a sign-in link.
        </div>
      ) : null}
      {error ? (
        <div className="mb-4 rounded border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
          That email isn&apos;t recognized. Ask your chief for an invite.
        </div>
      ) : null}

      <form action={send} className="flex flex-col gap-3">
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="rounded border border-neutral-300 px-3 py-2 text-base"
          placeholder="you@example.com"
        />
        <button
          type="submit"
          className="rounded bg-neutral-900 px-3 py-2 text-base font-medium text-white hover:bg-neutral-800"
        >
          Send magic link
        </button>
      </form>
    </main>
  );
}
