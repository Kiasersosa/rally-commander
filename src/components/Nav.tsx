import Link from "next/link";
import { and, desc, eq, isNull } from "drizzle-orm";
import { signOut } from "@/lib/auth";
import { db } from "@/lib/db";
import { events, equipmentCategoryEnum } from "@/lib/db/schema";
import { isFullAccessRole, type SessionUser } from "@/lib/authz";
import { QuickLogModal } from "@/components/QuickLogModal";
import { createConditionReport } from "@/lib/actions/condition-reports";

const EQUIPMENT_CATEGORIES = equipmentCategoryEnum.enumValues;

const EQUIPMENT_CATEGORY_LABEL: Record<string, string> = {
  tools: "Tools",
  mechanics: "Mechanics",
  cooking: "Cooking",
  transport: "Transport",
  comms: "Comms",
  filming: "Filming",
  electronics: "Electronics",
  service_tool: "Service tools",
  other: "Other",
};

export async function Nav({ user }: { user: SessionUser }) {
  const eventList = await db
    .select({
      id: events.id,
      name: events.name,
      phase: events.phase,
      eventDate: events.eventDate,
    })
    .from(events)
    .where(and(eq(events.teamId, user.teamId), isNull(events.deletedAt)))
    .orderBy(desc(events.eventDate))
    .limit(10);

  const canCreate = isFullAccessRole(user.role);

  return (
    <nav className="rc-nav">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-6">
          <Link href="/events" className="rc-logo text-lg">
            Rally Commander
          </Link>

          {/* Events */}
          <div className="rc-nav-item group relative">
            <Link href="/events" className="rc-link text-sm">
              Events
            </Link>
            <div className="rc-nav-dropdown">
              <Link href="/events" className="rc-nav-dropdown-link rc-nav-dropdown-link-strong">
                All events
              </Link>
              {eventList.length > 0 && (
                <>
                  <div className="rc-nav-dropdown-divider" />
                  {eventList.map((e) => (
                    <Link
                      key={e.id}
                      href={`/events/${e.id}`}
                      className="rc-nav-dropdown-link"
                    >
                      <span className="truncate">{e.name}</span>
                      <span className="rc-muted text-[10px] ml-2 shrink-0">
                        {e.eventDate}
                      </span>
                    </Link>
                  ))}
                </>
              )}
              {canCreate && (
                <>
                  <div className="rc-nav-dropdown-divider" />
                  <Link
                    href="/events?create=1"
                    className="rc-nav-dropdown-link rc-nav-dropdown-link-accent"
                  >
                    + Create new event
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* Vehicles */}
          <Link href="/vehicles" className="rc-link text-sm">
            Vehicles
          </Link>

          {/* Equipment */}
          <div className="rc-nav-item group relative">
            <Link href="/equipment" className="rc-link text-sm">
              Equipment
            </Link>
            <div className="rc-nav-dropdown">
              <Link href="/equipment" className="rc-nav-dropdown-link rc-nav-dropdown-link-strong">
                All equipment
              </Link>
              <div className="rc-nav-dropdown-divider" />
              {EQUIPMENT_CATEGORIES.map((cat) => (
                <Link
                  key={cat}
                  href={`/equipment?cat=${cat}`}
                  className="rc-nav-dropdown-link"
                >
                  {EQUIPMENT_CATEGORY_LABEL[cat] ?? cat}
                </Link>
              ))}
            </div>
          </div>

          {/* Safety */}
          <Link href="/safety" className="rc-link text-sm">
            Safety
          </Link>

          {/* Team */}
          <Link href="/team" className="rc-link text-sm">
            Team
          </Link>
        </div>
        <div className="flex items-center gap-4 text-sm">
          {/* Quick log appears when any rally is in on_event phase */}
          <QuickLogModal
            events={eventList
              .filter((e) => e.phase === "on_event")
              .map((e) => ({ id: e.id, name: e.name }))}
            action={createConditionReport}
          />
          <Link href="/profile" className="rc-muted rc-link">
            {user.name}{" "}
            <span className="opacity-60">· {user.role.replace(/_/g, " ")}</span>
          </Link>
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
