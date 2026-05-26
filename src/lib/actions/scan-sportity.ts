"use server";

import Anthropic from "@anthropic-ai/sdk";
import { and, eq, isNull, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { events, sportityItems, users } from "@/lib/db/schema";
import { requireFullAccess, requireSession } from "@/lib/authz";
import { uploadDocument } from "@/lib/documents";
import { isStorageConfigured } from "@/lib/storage";
import { recordAndSend } from "@/lib/notifications";

const SYSTEM_PROMPT = `You read screenshots from the Sportity rally-organizer app and extract the post's content. Strip UI chrome (timestamps, avatars, navigation) and keep just the bulletin/document/schedule-change content. Call the extract_post tool with your result. If the image is unreadable or empty, call the tool with empty strings.`;

const ALLOWED_MEDIA = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type AllowedMedia = (typeof ALLOWED_MEDIA)[number];

export type ScanResult = {
  title: string;
  body_text: string;
  kind: "bulletin" | "document" | "schedule_change";
};

const EXTRACT_TOOL = {
  name: "extract_post",
  description:
    "Record the extracted Sportity post content. Always invoke this exactly once with all three fields populated.",
  input_schema: {
    type: "object" as const,
    properties: {
      title: {
        type: "string",
        description:
          "Short headline, ~120 chars max. The most prominent line, or the first sentence. If the post has a name like 'Bulletin #3', include that.",
      },
      body_text: {
        type: "string",
        description:
          "Rest of the post's content, with newlines preserved between paragraphs. Empty string if there's no body.",
      },
      kind: {
        type: "string",
        enum: ["bulletin", "document", "schedule_change"],
        description:
          "Best guess. Use 'schedule_change' if the post is about a schedule update (cancelled stage, restart time, service window). Use 'document' if it's a file announcement. Otherwise 'bulletin'.",
      },
    },
    required: ["title", "body_text", "kind"],
  },
};

export async function scanSportityScreenshot(
  formData: FormData,
): Promise<ScanResult> {
  await requireSession();

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("OCR is not configured (ANTHROPIC_API_KEY missing)");
  }

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) throw new Error("file required");
  if (file.size > 8 * 1024 * 1024) {
    throw new Error("image too large (8 MB max)");
  }
  const rawType = (file.type || "image/png").toLowerCase();
  const mediaType: AllowedMedia = (ALLOWED_MEDIA as readonly string[]).includes(
    rawType,
  )
    ? (rawType as AllowedMedia)
    : "image/png";

  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = Buffer.from(bytes).toString("base64");

  const client = new Anthropic();
  const message = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [EXTRACT_TOOL],
    tool_choice: { type: "tool", name: "extract_post" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: base64,
            },
          },
          { type: "text", text: "Extract the post." },
        ],
      },
    ],
  });

  const toolUse = message.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
  );
  if (!toolUse) {
    // tool_choice forced the tool, so this should not happen — but degrade
    // gracefully rather than throwing into the user's face.
    console.error("[scan-sportity] no tool_use block in response", {
      stopReason: message.stop_reason,
    });
    return { title: "", body_text: "", kind: "bulletin" };
  }

  const input = toolUse.input as Partial<Record<string, unknown>>;
  const kind =
    typeof input.kind === "string" &&
    ["bulletin", "document", "schedule_change"].includes(input.kind)
      ? (input.kind as ScanResult["kind"])
      : "bulletin";

  return {
    title: typeof input.title === "string" ? input.title.slice(0, 240) : "",
    body_text: typeof input.body_text === "string" ? input.body_text : "",
    kind,
  };
}

export type BatchScanResult = {
  created: number;
  failed: number;
  /** Did the caller ask to notify? */
  notifyRequested: boolean;
  /** Did at least one notification deliver? */
  notifyDelivered: boolean;
};

/**
 * Multi-screenshot batch: OCR each image in parallel, create one
 * sportity_item per file with the extracted content + the image
 * attached as a Document. Optionally fires a single summary email
 * to every active crew member (one email each, not one-per-item).
 */
export async function scanAndCreateSportityItems(
  formData: FormData,
): Promise<BatchScanResult> {
  const u = await requireFullAccess();
  const eventId = String(formData.get("event_id") ?? "");
  if (!eventId) throw new Error("event_id required");
  const notify = String(formData.get("notify") ?? "") === "on";

  const [event] = await db
    .select({ id: events.id, name: events.name })
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.teamId, u.teamId),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);
  if (!event) throw new Error("event not found");

  const rawFiles = formData.getAll("files");
  const files = rawFiles.filter(
    (f): f is File => f instanceof File && f.size > 0,
  );
  if (files.length === 0) throw new Error("no files");

  // Process each screenshot in parallel: OCR + upload + insert.
  const results = await Promise.allSettled(
    files.map(async (file) => {
      const scanFd = new FormData();
      scanFd.append("file", file);
      const scan = await scanSportityScreenshot(scanFd);

      let documentId: string | null = null;
      if (isStorageConfigured()) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const docCategory =
          scan.kind === "schedule_change" ? "schedule" : "bulletin";
        const r = await uploadDocument({
          teamId: u.teamId,
          userId: u.userId,
          eventId,
          category: docCategory,
          name: scan.title || file.name.replace(/\.[^.]+$/, ""),
          filename: file.name,
          contentType: file.type || "image/png",
          bytes,
          mustAcknowledge: false,
        });
        documentId = r.documentId;
      }

      const [row] = await db
        .insert(sportityItems)
        .values({
          teamId: u.teamId,
          eventId,
          kind: scan.kind,
          title: scan.title || `(unread) ${file.name}`,
          bodyText: scan.body_text || null,
          documentId,
          postedByUserId: u.userId,
        })
        .returning({ id: sportityItems.id });
      return { itemId: row.id, scan };
    }),
  );

  const fulfilled = results.flatMap((r) =>
    r.status === "fulfilled" ? [r.value] : [],
  );
  const failed = results.length - fulfilled.length;

  let notifyDelivered = false;
  if (notify && fulfilled.length > 0) {
    const crew = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.teamId, u.teamId), isNull(users.deletedAt)));
    const subject = `[Sportity · ${event.name}] ${fulfilled.length} new update${fulfilled.length === 1 ? "" : "s"}`;
    const body = [
      `${u.name} logged ${fulfilled.length} Sportity update${fulfilled.length === 1 ? "" : "s"}.`,
      ``,
      ...fulfilled.map((f) => `• ${f.scan.title || "(unread)"}`),
      ``,
      `See https://rallycommander.com/events/${eventId}/sportity-updates`,
    ].join("\n");

    const sends = await Promise.allSettled(
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
    notifyDelivered = sends.some(
      (s) => s.status === "fulfilled" && s.value.delivered,
    );

    if (notifyDelivered) {
      const itemIds = fulfilled.map((f) => f.itemId);
      await db
        .update(sportityItems)
        .set({ notifiedCrew: true })
        .where(
          and(
            eq(sportityItems.teamId, u.teamId),
            inArray(sportityItems.id, itemIds),
          ),
        );
    }
  }

  revalidatePath(`/events/${eventId}/sportity-updates`);
  revalidatePath(`/events/${eventId}`);
  return {
    created: fulfilled.length,
    failed,
    notifyRequested: notify,
    notifyDelivered,
  };
}
