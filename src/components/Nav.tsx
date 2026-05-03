import Link from "next/link";
import { signOut } from "@/lib/auth";
import type { SessionUser } from "@/lib/authz";

export function Nav({ user }: { user: SessionUser }) {
  return (
    <nav className="flex items-center justify-between border-b border-neutral-200 px-6 py-3">
      <div className="flex items-center gap-6">
        <Link href="/events" className="font-semibold">
          Rally Commander
        </Link>
        <Link href="/events" className="text-sm hover:underline">
          Events
        </Link>
        <Link href="/team" className="text-sm hover:underline">
          Team
        </Link>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-neutral-500">
          {user.name} <span className="text-neutral-400">({user.role})</span>
        </span>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button type="submit" className="text-sm text-neutral-500 hover:underline">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
