import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  documentAcknowledgments,
  documentVersions,
  documents,
  events,
  users,
} from "@/lib/db/schema";
import { getCurrentUser, requireSession, requireChief } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import {
  DOCUMENT_CATEGORY_LABEL,
  acknowledgeDocument,
} from "@/lib/documents";
import type { StructuredDiff } from "@/lib/document-differ";
import { getSignedDownloadUrl, isStorageConfigured } from "@/lib/storage";

type Params = Promise<{ documentId: string }>;

export default async function DocumentDetailPage({
  params,
}: {
  params: Params;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { documentId } = await params;

  const [doc] = await db
    .select({
      id: documents.id,
      name: documents.name,
      category: documents.category,
      mustAcknowledge: documents.mustAcknowledge,
      eventId: documents.eventId,
      eventName: events.name,
    })
    .from(documents)
    .leftJoin(events, eq(events.id, documents.eventId))
    .where(
      and(eq(documents.id, documentId), eq(documents.teamId, me.teamId)),
    )
    .limit(1);
  if (!doc) notFound();

  const versions = await db
    .select({
      id: documentVersions.id,
      versionNumber: documentVersions.versionNumber,
      storageKey: documentVersions.storageKey,
      contentType: documentVersions.contentType,
      sizeBytes: documentVersions.sizeBytes,
      diffJson: documentVersions.diffJson,
      uploadedAt: documentVersions.createdAt,
      uploadedByName: users.name,
    })
    .from(documentVersions)
    .innerJoin(users, eq(users.id, documentVersions.uploadedByUserId))
    .where(
      and(
        eq(documentVersions.teamId, me.teamId),
        eq(documentVersions.documentId, documentId),
      ),
    )
    .orderBy(desc(documentVersions.versionNumber));

  const latest = versions[0];
  const latestDiff: StructuredDiff | null = latest?.diffJson
    ? (JSON.parse(latest.diffJson) as StructuredDiff)
    : null;

  // Pre-sign download URLs server-side (5-minute lifetime).
  const downloadUrls = new Map<string, string>();
  if (isStorageConfigured()) {
    for (const v of versions) {
      try {
        const u = await getSignedDownloadUrl(v.storageKey);
        downloadUrls.set(v.id, u);
      } catch {
        // skip — handled in UI
      }
    }
  }

  // My ack + everyone-on-team's ack status for the latest version.
  const myAck = await db
    .select({ versionId: documentAcknowledgments.versionId })
    .from(documentAcknowledgments)
    .where(
      and(
        eq(documentAcknowledgments.teamId, me.teamId),
        eq(documentAcknowledgments.documentId, documentId),
        eq(documentAcknowledgments.userId, me.userId),
      ),
    )
    .limit(1);
  const myAckCurrent = myAck[0]?.versionId === latest?.id;

  const allAcks = await db
    .select({
      userId: documentAcknowledgments.userId,
      userName: users.name,
      versionId: documentAcknowledgments.versionId,
      acknowledgedAt: documentAcknowledgments.acknowledgedAt,
    })
    .from(documentAcknowledgments)
    .innerJoin(users, eq(users.id, documentAcknowledgments.userId))
    .where(
      and(
        eq(documentAcknowledgments.teamId, me.teamId),
        eq(documentAcknowledgments.documentId, documentId),
      ),
    )
    .orderBy(asc(users.name));

  // ---- server actions ----

  async function ack() {
    "use server";
    const u = await requireSession();
    if (!latest) return;
    await acknowledgeDocument(u.teamId, documentId, u.userId, latest.id);
    revalidatePath(`/documents/${documentId}`);
  }

  async function setMustAck(formData: FormData) {
    "use server";
    const u = await requireChief();
    const on = String(formData.get("on") ?? "") === "1";
    await db
      .update(documents)
      .set({ mustAcknowledge: on, updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.teamId, u.teamId)));
    revalidatePath(`/documents/${documentId}`);
  }

  async function softDelete() {
    "use server";
    const u = await requireChief();
    await db
      .update(documents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(documents.id, documentId), eq(documents.teamId, u.teamId)));
    if (doc.eventId) {
      revalidatePath(`/events/${doc.eventId}`);
      redirect(`/events/${doc.eventId}`);
    }
    redirect(`/events`);
  }

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-3xl px-6 py-10">
        {doc.eventId ? (
          <div className="rc-muted mb-2 text-sm">
            <Link href={`/events/${doc.eventId}`} className="rc-link">
              ← {doc.eventName ?? "Event"}
            </Link>
          </div>
        ) : null}
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{doc.name}</h1>
            <p className="rc-muted mt-1 text-sm">
              {DOCUMENT_CATEGORY_LABEL[doc.category]}
              {latest ? ` · v${latest.versionNumber}` : " · no versions yet"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {doc.mustAcknowledge ? (
              <span className="rc-badge rc-badge-prep">Must acknowledge</span>
            ) : null}
            {me.role === "chief" ? (
              <>
                <form action={setMustAck}>
                  <input
                    type="hidden"
                    name="on"
                    value={doc.mustAcknowledge ? "0" : "1"}
                  />
                  <button type="submit" className="rc-btn rc-btn-ghost text-xs">
                    {doc.mustAcknowledge ? "Drop ack flag" : "Require ack"}
                  </button>
                </form>
                <form action={softDelete}>
                  <button type="submit" className="rc-btn rc-btn-danger text-xs">
                    Remove
                  </button>
                </form>
              </>
            ) : null}
          </div>
        </header>

        {doc.mustAcknowledge && latest ? (
          <section className="rc-card mb-6 flex flex-wrap items-center justify-between gap-3 border-amber-500/30 bg-amber-500/10">
            <div className="text-sm">
              {myAckCurrent
                ? "✓ You've acknowledged the current version."
                : "This document needs your acknowledgment."}
            </div>
            {!myAckCurrent ? (
              <form action={ack}>
                <button type="submit" className="rc-btn rc-btn-primary text-sm">
                  I've read v{latest.versionNumber}
                </button>
              </form>
            ) : null}
          </section>
        ) : null}

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Versions</h2>
          {versions.length === 0 ? (
            <p className="rc-muted text-sm">No versions uploaded.</p>
          ) : (
            <ul className="rc-list">
              {versions.map((v) => (
                <li key={v.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">v{v.versionNumber}</div>
                    <div className="rc-muted text-sm">
                      {v.contentType} · {(v.sizeBytes / 1024).toFixed(1)} KB ·
                      uploaded {v.uploadedAt.toISOString().replace("T", " ").slice(0, 16)}{" "}
                      by {v.uploadedByName}
                    </div>
                  </div>
                  {downloadUrls.has(v.id) ? (
                    <a
                      href={downloadUrls.get(v.id)}
                      target="_blank"
                      rel="noopener"
                      className="rc-btn rc-btn-ghost text-xs"
                    >
                      Download
                    </a>
                  ) : (
                    <span className="rc-muted text-xs">No URL</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {latestDiff ? (
          <section className="mb-8">
            <h2 className="mb-3 text-lg font-semibold tracking-tight">
              Changes vs previous version
            </h2>
            <div className="rc-muted mb-3 text-sm">
              {latestDiff.addedCount} added · {latestDiff.removedCount} removed ·{" "}
              {latestDiff.unchangedCount} unchanged
            </div>
            {latestDiff.hasChanges ? (
              <ul className="space-y-2">
                {latestDiff.blocks.map((b, i) => (
                  <li
                    key={i}
                    className={`whitespace-pre-wrap rounded border-l-4 px-3 py-2 text-sm ${
                      b.kind === "added"
                        ? "border-emerald-500 bg-emerald-500/10"
                        : b.kind === "removed"
                        ? "border-rose-500 bg-rose-500/10 line-through decoration-rose-400"
                        : "border-[color:var(--border)] opacity-60"
                    }`}
                  >
                    <span className="rc-muted mr-2 font-mono text-xs">
                      {b.kind === "added"
                        ? "+"
                        : b.kind === "removed"
                        ? "−"
                        : " "}
                    </span>
                    {b.text}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rc-muted text-sm">No content changes.</p>
            )}
          </section>
        ) : versions.length > 1 ? (
          <p className="rc-muted text-sm">
            Diff not available — file format isn&apos;t text-extractable, or
            previous version had no extractable text.
          </p>
        ) : null}

        {doc.mustAcknowledge ? (
          <section>
            <h2 className="mb-3 text-lg font-semibold tracking-tight">
              Acknowledgments
            </h2>
            {allAcks.length === 0 ? (
              <p className="rc-muted text-sm">Nobody has acknowledged yet.</p>
            ) : (
              <ul className="rc-list">
                {allAcks.map((a) => {
                  const isCurrent = a.versionId === latest?.id;
                  return (
                    <li key={a.userId} className="rc-list-row">
                      <div className="flex-1">
                        <div className="font-medium">{a.userName}</div>
                        <div className="rc-muted text-xs">
                          Acked {a.acknowledgedAt.toISOString().replace("T", " ").slice(0, 16)}
                        </div>
                      </div>
                      <span
                        className={`rc-badge rc-badge-${isCurrent ? "on_event" : "post_event"}`}
                      >
                        {isCurrent ? "Current" : "Stale"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ) : null}
      </main>
    </>
  );
}
