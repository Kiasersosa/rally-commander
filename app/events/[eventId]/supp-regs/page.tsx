import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, desc, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/lib/db";
import { documents, documentVersions, events } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/authz";
import { Nav } from "@/components/Nav";
import { uploadDocument } from "@/lib/documents";
import { getSignedDownloadUrl, isStorageConfigured } from "@/lib/storage";

type Params = Promise<{ eventId: string }>;

export default async function SuppRegsPage({ params }: { params: Params }) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { eventId } = await params;

  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.teamId, me.teamId), isNull(events.deletedAt)))
    .limit(1);
  if (!event) notFound();

  const isChief = me.role === "chief";
  const storageOk = isStorageConfigured();

  // Find the latest supp_regs document for this event
  const [doc] = await db
    .select({ id: documents.id, name: documents.name })
    .from(documents)
    .where(
      and(
        eq(documents.teamId, me.teamId),
        eq(documents.eventId, eventId),
        eq(documents.category, "supp_regs"),
        isNull(documents.deletedAt),
      ),
    )
    .limit(1);

  let latestVersion: { storageKey: string; sizeBytes: number; versionNumber: number } | null = null;
  let viewUrl: string | null = null;
  let downloadUrl: string | null = null;

  if (doc) {
    const [v] = await db
      .select({
        storageKey: documentVersions.storageKey,
        sizeBytes: documentVersions.sizeBytes,
        versionNumber: documentVersions.versionNumber,
      })
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.teamId, me.teamId),
          eq(documentVersions.documentId, doc.id),
        ),
      )
      .orderBy(desc(documentVersions.versionNumber))
      .limit(1);

    if (v && storageOk) {
      latestVersion = v;
      // 30-minute URLs — long enough to read the whole doc without needing a refresh
      viewUrl = await getSignedDownloadUrl(v.storageKey, 60 * 30, {
        inline: true,
        contentType: "application/pdf",
      });
      downloadUrl = await getSignedDownloadUrl(v.storageKey, 60 * 30);
    }
  }

  // Upload server action
  async function uploadSuppRegs(formData: FormData) {
    "use server";
    const u = await getCurrentUser();
    if (!u || u.role !== "chief") return;
    const file = formData.get("file") as File | null;
    if (!file || file.size === 0) return;
    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadDocument({
      teamId: u.teamId,
      userId: u.userId,
      eventId,
      category: "supp_regs",
      name: file.name.replace(/\.pdf$/i, ""),
      filename: file.name,
      contentType: file.type || "application/pdf",
      bytes,
      mustAcknowledge: false,
    });
    revalidatePath(`/events/${eventId}/supp-regs`);
  }

  const hasDoc = Boolean(viewUrl);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav user={me} />

      <div className="mx-auto w-full max-w-7xl px-4 py-4 flex flex-col flex-1">
        {/* Header bar */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="mb-1 text-xs rc-muted">
              <Link href="/events" className="rc-link">Events</Link>
              {" / "}
              <Link href={`/events/${eventId}`} className="rc-link">{event.name}</Link>
            </div>
            <h1 className="text-xl font-bold">
              Supplemental Regulations
              {doc ? <span className="ml-2 text-sm font-normal rc-muted">— {doc.name}</span> : null}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            {downloadUrl && (
              <a href={downloadUrl} download className="rc-btn rc-btn-ghost text-sm">
                Download PDF
              </a>
            )}
            {isChief && storageOk && (
              <label className="rc-btn rc-btn-primary text-sm cursor-pointer">
                {hasDoc ? "Replace PDF" : "Upload PDF"}
                <form id="supp-regs-upload-form" action={uploadSuppRegs} className="hidden">
                  <input
                    name="file"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => {
                      const form = document.getElementById("supp-regs-upload-form") as HTMLFormElement;
                      if (e.target.files?.length) form.requestSubmit();
                    }}
                  />
                </form>
              </label>
            )}
            {isChief && !storageOk && (
              <span className="text-xs rc-muted">R2 storage not configured</span>
            )}
          </div>
        </div>

        {/* PDF viewer */}
        {hasDoc ? (
          <div className="rc-card flex-1 p-0 overflow-hidden" style={{ minHeight: "75vh" }}>
            <iframe
              src={viewUrl!}
              className="w-full h-full"
              style={{ minHeight: "75vh", border: "none" }}
              title={`${event.name} Supplemental Regulations`}
            />
          </div>
        ) : (
          <div className="rc-card flex flex-col items-center justify-center py-20 gap-4">
            <p className="rc-muted text-center">
              No supplemental regulations uploaded yet for this event.
            </p>
            {isChief && storageOk && (
              <label className="rc-btn rc-btn-primary cursor-pointer">
                Upload PDF
                <form id="supp-regs-upload-form-empty" action={uploadSuppRegs} className="hidden">
                  <input
                    name="file"
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={(e) => {
                      const form = document.getElementById("supp-regs-upload-form-empty") as HTMLFormElement;
                      if (e.target.files?.length) form.requestSubmit();
                    }}
                  />
                </form>
              </label>
            )}
            {isChief && !storageOk && (
              <p className="text-sm rc-muted">R2 storage is not configured — set R2_* env vars to enable uploads.</p>
            )}
          </div>
        )}

        {latestVersion && (
          <p className="mt-2 text-xs rc-muted text-right">
            v{latestVersion.versionNumber} · {(latestVersion.sizeBytes / 1024).toFixed(0)} KB ·{" "}
            <span>Viewer URL valid 30 min — refresh page to renew</span>
          </p>
        )}
      </div>
    </div>
  );
}
