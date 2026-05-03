import Link from "next/link";
import { signOut } from "@/lib/auth";
import type { SessionUser } from "@/lib/authz";

export function Nav({ user }: { user: SessionUser }) {
  return (
    <nav className="rc-nav">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/events" className="rc-logo text-lg">
            Rally Commander
          </Link>
          <Link href="/events" className="rc-link text-sm">
            Events
          </Link>
          <Link href="/team" className="rc-link text-sm">
            Team
          </Link>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="rc-muted">
            {user.name}{" "}
            <span className="opacity-60">· {user.role.replace(/_/g, " ")}</span>
          </span>
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/login" });
            }}
          >
            <button type="submit" className="rc-link text-sm">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}
