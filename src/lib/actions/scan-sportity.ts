"use server";

import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/authz";

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
