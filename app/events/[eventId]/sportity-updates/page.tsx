import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documents,
  documentVersions,
  events,
  sportityItems,
  users,
  type SportityItemKind,
} from "@/lib/db/schema";
import { getCurrentUser, requireFullAccess } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import { uploadDocument } from "@/lib/documents";
import { getSignedDownloadUrl, isStorageConfigured } from "@/lib/storage";
import { recordAndSend } from "@/lib/notifications";
import { SportityScreenshotScanner } from "@/components/SportityScreenshotScanner";

type Params = Promise<{ eventId: string }>;

const KIND_LABEL: Record<SportityItemKind, string> = {
  bulletin: "Bulletin",
  document: "Document",
  schedule_change: "Schedule change",
};

const KIND_BADGE_CLASS: Record<SportityItemKind, string> = {
  bulletin: "rc-badge-planning",
  document: "rc-badge-prep",
  schedule_change: "rc-badge-on_event",
};

export default async function SportityUpdatesPage({
  params,
}: {
  params: Params;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { eventId } = await params;

  const [event] = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.teamId, me.teamId),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);
  if (!event) notFound();

  const rows = await db
    .select({
      id: sportityItems.id,
      kind: sportityItems.kind,
      title: sportityItems.title,
      summary: sportityItems.summary,
      bodyText: sportityItems.bodyText,
      documentId: sportityItems.documentId,
      sourceUrl: sportityItems.sourceUrl,
      notifiedCrew: sportityItems.notifiedCrew,
      postedAt: sportityItems.postedAt,
      createdAt: sportityItems.createdAt,
      postedByName: users.name,
      docName: documents.name,
    })
    .from(sportityItems)
    .innerJoin(users, eq(users.id, sportityItems.postedByUserId))
    .leftJoin(documents, eq(documents.id, sportityItems.documentId))
    .where(
      and(
        eq(sportityItems.teamId, me.teamId),
        eq(sportityItems.eventId, eventId),
      ),
    )
    .orderBy(desc(sportityItems.createdAt));

  // For items with documents, sign one-shot download URLs (5 min) so the crew
  // can read the attached PDF/photo without a round-trip.
  const docIds = rows
    .map((r) => r.documentId)
    .filter((d): d is string => Boolean(d));
  const downloadUrlByDoc = new Map<string, string>();
  if (docIds.length > 0 && isStorageConfigured()) {
    const latest = await db
      .select({
        docId: documentVersions.documentId,
        storageKey: documentVersions.storageKey,
        versionNumber: documentVersions.versionNumber,
      })
      .from(documentVersions)
      .where(eq(documentVersions.teamId, me.teamId))
      .orderBy(asc(documentVersions.documentId), desc(documentVersions.versionNumber));
    const byDoc = new Map<string, { storageKey: string }>();
    for (const v of latest) {
      if (docIds.includes(v.docId) && !byDoc.has(v.docId)) {
        byDoc.set(v.docId, { storageKey: v.storageKey });
      }
    }
    for (const [docId, v] of byDoc.entries()) {
      try {
        const url = await getSignedDownloadUrl(v.storageKey);
        downloadUrlByDoc.set(docId, url);
      } catch {
        // skip — handled in UI
      }
    }
  }

  async function createSportityItem(formData: FormData) {
    "use server";
    const u = await requireFullAccess();
    const kind = (String(formData.get("kind") ?? "bulletin") as SportityItemKind);
    const title = String(formData.get("title") ?? "").trim();
    if (!title) throw new Error("title required");
    const summary = String(formData.get("summary") ?? "").trim() || null;
    const bodyText = String(formData.get("body_text") ?? "").trim() || null;
    const sourceUrl = String(formData.get("source_url") ?? "").trim() || null;
    const postedAtRaw = String(formData.get("posted_at") ?? "").trim();
    let postedAt: Date | null = null;
    if (postedAtRaw) {
      const parsed = new Date(postedAtRaw);
      if (!Number.isNaN(parsed.getTime())) postedAt = parsed;
    }
    const notify = String(formData.get("notify") ?? "") === "on";

    // Verify event ownership.
    const [own] = await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.id, eventId),
          eq(events.teamId, u.teamId),
          isNull(events.deletedAt),
        ),
      )
      .limit(1);
    if (!own) throw new Error("event not found");

    // Optional file upload — reuses the Documents module + R2.
    let documentId: string | null = null;
    const file = formData.get("file") as File | null;
    if (file && file.size > 0 && isStorageConfigured()) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const docCategory =
        kind === "schedule_change" ? "schedule" : "bulletin";
      const r = await uploadDocument({
        teamId: u.teamId,
        userId: u.userId,
        eventId,
        category: docCategory,
        name: file.name.replace(/\.[^.]+$/, ""),
        filename: file.name,
        contentType: file.type || "application/octet-stream",
        bytes,
        mustAcknowledge: false,
      });
      documentId = r.documentId;
    }

    // Try to send the notification BEFORE inserting so we can record the
    // delivered state. Email-only for now (SMS deferred on A2P 10DLC).
    let notified = false;
    if (notify) {
      const crew = await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(and(eq(users.teamId, u.teamId), isNull(users.deletedAt)));
      const subject = `[Sportity · ${event.name}] ${title}`;
      const bodyLines = [
        `${KIND_LABEL[kind]} from Sportity, logged by ${u.name}.`,
        ``,
        title,
      ];
      if (bodyText) {
        bodyLines.push(``, bodyText);
      }
      if (sourceUrl) {
        bodyLines.push(``, `Source: ${sourceUrl}`);
      }
      const body = bodyLines.join("\n");
      // Fire all recipients in parallel, swallow individual failures.
      const results = await Promise.allSettled(
        crew
          .filter((c) => c.email && c.email.includes("@"))
          .map((c) =>
            recordAndSend({
              teamId: u.teamId,
              userId: c.id,
              channel: "email",
              kind: "bulletin",
              recipient: c.email,
              subject,
              body,
            }),
          ),
      );
      notified = results.some(
        (r) => r.status === "fulfilled" && r.value.delivered,
      );
    }

    await db.insert(sportityItems).values({
      teamId: u.teamId,
      eventId,
      kind,
      title,
      summary,
      bodyText,
      documentId,
      sourceUrl,
      postedAt,
      notifiedCrew: notified,
      postedByUserId: u.userId,
    });
    revalidatePath(`/events/${eventId}/sportity-updates`);
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteSportityItem(formData: FormData) {
    "use server";
    const u = await requireFullAccess();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(sportityItems)
      .where(
        and(eq(sportityItems.id, id), eq(sportityItems.teamId, u.teamId)),
      );
    revalidatePath(`/events/${eventId}/sportity-updates`);
  }

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="rc-muted mb-2 text-sm">
          <Link href="/events" className="rc-link">Events</Link>
          {" / "}
          <Link href={`/events/${eventId}`} className="rc-link">{event.name}</Link>
        </div>
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Sportity updates</h1>
            <p className="rc-muted mt-1 text-sm">
              Log organizer bulletins, documents, and schedule changes from
              the Sportity app. Toggle <em>Notify crew</em> to fire an
              immediate email to every active crew member.
            </p>
          </div>
        </header>

        {process.env.ANTHROPIC_API_KEY ? (
          <SportityScreenshotScanner eventId={eventId} />
        ) : null}

        {/* Add form */}
        <details className="rc-card mb-6" open={rows.length === 0}>
          <summary className="cursor-pointer font-semibold select-none list-none flex items-center gap-2">
            <span className="text-[var(--accent)] text-lg leading-none">+</span>
            Log a Sportity update
          </summary>
          <form
            action={createSportityItem}
            encType="multipart/form-data"
            className="mt-4 flex flex-col gap-3"
          >
            <div className="flex flex-wrap gap-3 text-sm">
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="kind" value="bulletin" defaultChecked />
                <span>Bulletin</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="kind" value="document" />
                <span>Document</span>
              </label>
              <label className="inline-flex items-center gap-1.5 cursor-pointer">
                <input type="radio" name="kind" value="schedule_change" />
                <span>Schedule change</span>
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Title *</span>
              <input
                name="title"
                required
                placeholder="e.g., Bulletin #3 — Stage 4 cancelled"
                className="rc-input"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Summary (one sentence)</span>
              <input
                name="summary"
                maxLength={240}
                placeholder="e.g., SS6 cancelled, restart at TC6B"
                className="rc-input"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Body</span>
              <textarea
                name="body_text"
                rows={4}
                placeholder="Paste the bulletin text"
                className="rc-textarea"
              />
            </label>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">Source URL (optional)</span>
                <input
                  name="source_url"
                  placeholder="https://sportity.com/..."
                  className="rc-input"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold">Posted at (optional)</span>
                <input
                  name="posted_at"
                  type="datetime-local"
                  className="rc-input"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold">Attach file (PDF / photo)</span>
              <input
                name="file"
                type="file"
                accept="application/pdf,image/*"
                className="rc-input"
              />
              {!isStorageConfigured() && (
                <span className="rc-muted text-xs">
                  R2 storage not configured — uploads will be skipped.
                </span>
              )}
            </label>

            <label className="inline-flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" name="notify" className="h-4 w-4" />
              <span>Notify crew (email)</span>
            </label>

            <div>
              <button type="submit" className="rc-btn rc-btn-primary text-sm">
                Log update
              </button>
            </div>
          </form>
        </details>

        {/* Feed */}
        {rows.length === 0 ? (
          <div className="rc-empty-section text-center">
            No Sportity updates logged yet for this event.
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {rows.map((r) => {
              const downloadUrl = r.documentId
                ? downloadUrlByDoc.get(r.documentId)
                : null;
              const shownTime = (r.postedAt ?? r.createdAt)
                .toISOString()
                .replace("T", " ")
                .slice(0, 16);
              return (
                <li key={r.id} className="rc-card">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className={`rc-badge ${KIND_BADGE_CLASS[r.kind]}`}>
                        {KIND_LABEL[r.kind]}
                      </span>
                      <h3 className="text-base font-semibold">{r.title}</h3>
                    </div>
                    <div className="rc-muted text-xs">
                      {shownTime}
                      {r.postedAt ? " (Sportity)" : ""} · {r.postedByName}
                      {r.notifiedCrew ? " · ✓ notified" : ""}
                    </div>
                  </div>
                  {r.summary ? (
                    <p className="mt-2 text-sm font-medium">{r.summary}</p>
                  ) : null}
                  {r.bodyText ? (
                    <details className="mt-2">
                      <summary className="cursor-pointer rc-muted text-xs hover:text-[var(--accent)] select-none list-none">
                        {r.summary ? "Full text" : "Read more"} ▾
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap text-sm rc-muted">
                        {r.bodyText}
                      </p>
                    </details>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {downloadUrl ? (
                      <a
                        href={downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rc-btn rc-btn-ghost text-xs"
                      >
                        Open attachment ({r.docName ?? "file"}) ↗
                      </a>
                    ) : r.documentId ? (
                      <span className="rc-muted">Attachment unavailable</span>
                    ) : null}
                    {r.sourceUrl ? (
                      <a
                        href={r.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rc-link text-xs"
                      >
                        View on Sportity ↗
                      </a>
                    ) : null}
                    {r.kind === "schedule_change" ? (
                      <Link
                        href={`/events/${eventId}#itinerary`}
                        className="rc-btn rc-btn-ghost text-xs"
                      >
                        Apply to itinerary →
                      </Link>
                    ) : null}
                    <form action={deleteSportityItem} className="ml-auto">
                      <input type="hidden" name="id" value={r.id} />
                      <button
                        type="submit"
                        className="rc-btn rc-btn-danger text-xs px-2 py-1"
                      >
                        ×
                      </button>
                    </form>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </>
  );
}
