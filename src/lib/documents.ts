// Server-side document upload + version + diff orchestration.

import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  documentAcknowledgments,
  documentVersions,
  documents,
  type DocumentCategory,
} from "./db/schema";
import { diff } from "./document-differ";
import { extractPdfText } from "./pdf-text";
import { putObject } from "./storage";

export const DOCUMENT_CATEGORY_LABEL: Record<DocumentCategory, string> = {
  entry_form: "Entry form",
  supp_regs: "Supp regs",
  bulletin: "Bulletin",
  schedule: "Schedule",
  roadbook: "Road book",
  gpx: "GPX track",
  receipt: "Receipt",
  other: "Other",
};

export const ALL_DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  "entry_form",
  "supp_regs",
  "bulletin",
  "schedule",
  "roadbook",
  "gpx",
  "receipt",
  "other",
];

export type UploadDocumentArgs = {
  teamId: string;
  userId: string;
  eventId: string | null;
  stageId?: string | null;
  expenseId?: string | null;
  category: DocumentCategory;
  name: string;
  mustAcknowledge?: boolean;
  filename: string;
  contentType: string;
  bytes: Uint8Array;
};

export type UploadResult = {
  documentId: string;
  versionId: string;
  versionNumber: number;
  diffComputed: boolean;
};

/**
 * Find-or-create the logical document, store the bytes, compute a diff
 * against the prior version (if any), and insert a new DocumentVersion row.
 * Returns the new version's id and number.
 */
export async function uploadDocument(args: UploadDocumentArgs): Promise<UploadResult> {
  // Find or create the logical document.
  let [doc] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.teamId, args.teamId),
        eq(documents.category, args.category),
        eq(documents.name, args.name),
        args.eventId
          ? eq(documents.eventId, args.eventId)
          : isNull(documents.eventId),
      ),
    )
    .limit(1);

  if (!doc) {
    const inserted = await db
      .insert(documents)
      .values({
        teamId: args.teamId,
        eventId: args.eventId,
        stageId: args.stageId ?? null,
        expenseId: args.expenseId ?? null,
        category: args.category,
        name: args.name,
        mustAcknowledge: args.mustAcknowledge ?? false,
      })
      .returning();
    doc = inserted[0];
  } else if (
    typeof args.mustAcknowledge === "boolean" &&
    args.mustAcknowledge !== doc.mustAcknowledge
  ) {
    await db
      .update(documents)
      .set({ mustAcknowledge: args.mustAcknowledge, updatedAt: new Date() })
      .where(eq(documents.id, doc.id));
  }

  // Determine next version number.
  const [last] = await db
    .select()
    .from(documentVersions)
    .where(
      and(
        eq(documentVersions.teamId, args.teamId),
        eq(documentVersions.documentId, doc.id),
      ),
    )
    .orderBy(desc(documentVersions.versionNumber))
    .limit(1);
  const versionNumber = (last?.versionNumber ?? 0) + 1;

  // Store the bytes in R2.
  const { key } = await putObject({
    teamId: args.teamId,
    eventId: args.eventId,
    documentId: doc.id,
    versionNumber,
    filename: args.filename,
    contentType: args.contentType,
    body: args.bytes,
  });

  // Extract text if we can.
  let extractedText: string | null = null;
  if (args.contentType === "application/pdf") {
    extractedText = await extractPdfText(args.bytes);
  } else if (args.contentType.startsWith("text/")) {
    try {
      extractedText = Buffer.from(args.bytes).toString("utf-8");
    } catch {
      extractedText = null;
    }
  }

  // Compute structured diff against the prior version (when both have text).
  let diffJson: string | null = null;
  let diffComputed = false;
  if (extractedText && last?.extractedText) {
    const result = diff(last.extractedText, extractedText);
    diffJson = JSON.stringify(result);
    diffComputed = true;
  }

  const [version] = await db
    .insert(documentVersions)
    .values({
      teamId: args.teamId,
      documentId: doc.id,
      versionNumber,
      storageKey: key,
      contentType: args.contentType,
      sizeBytes: args.bytes.byteLength,
      extractedText,
      diffJson,
      uploadedByUserId: args.userId,
    })
    .returning();

  return {
    documentId: doc.id,
    versionId: version.id,
    versionNumber,
    diffComputed,
  };
}

/**
 * Record (or update) a user's acknowledgment of a document at a specific
 * version. Re-uploading a newer version naturally invalidates older acks
 * (the comparison happens in the read query).
 */
export async function acknowledgeDocument(
  teamId: string,
  documentId: string,
  userId: string,
  versionId: string,
): Promise<void> {
  await db
    .insert(documentAcknowledgments)
    .values({
      teamId,
      documentId,
      userId,
      versionId,
    })
    .onConflictDoUpdate({
      target: [documentAcknowledgments.documentId, documentAcknowledgments.userId],
      set: { versionId, acknowledgedAt: new Date() },
    });
}
