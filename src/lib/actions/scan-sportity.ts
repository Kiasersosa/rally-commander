"use server";

import Anthropic from "@anthropic-ai/sdk";
import { requireSession } from "@/lib/authz";

const SYSTEM_PROMPT = `You read screenshots from the Sportity rally-organizer app and extract the content into a structured form.

Respond with a JSON object ONLY — no prose, no markdown, no backticks:
{
  "title": string,        // short headline (the most prominent line, or the first sentence)
  "body_text": string,    // the rest of the post's text content, cleaned of UI chrome
  "kind": "bulletin" | "document" | "schedule_change"  // best guess; "bulletin" is the default
}

Guidelines:
- The title should be under ~120 chars. If the screenshot has a heading like "Bulletin #3", include that.
- body_text should preserve newlines between paragraphs. Strip out UI chrome (timestamps shown by the app, navigation, sender avatars).
- Use "schedule_change" if the post mentions a schedule update (cancelled stage, restart time, service window change). Use "document" if it's a file announcement. Otherwise "bulletin".
- If the image is unreadable or not a Sportity screenshot, return {"title":"","body_text":"","kind":"bulletin"}.`;

const ALLOWED_MEDIA = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
type AllowedMedia = (typeof ALLOWED_MEDIA)[number];

export type ScanResult = {
  title: string;
  body_text: string;
  kind: "bulletin" | "document" | "schedule_change";
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

  const raw = message.content
    .filter((c): c is Anthropic.TextBlock => c.type === "text")
    .map((c) => c.text)
    .join("")
    .trim();

  // Tolerate accidental fences even though the prompt forbids them.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error("OCR returned unparseable output");
  }

  const obj = parsed as Record<string, unknown>;
  const kind = typeof obj.kind === "string" && ["bulletin", "document", "schedule_change"].includes(obj.kind)
    ? (obj.kind as ScanResult["kind"])
    : "bulletin";

  return {
    title: typeof obj.title === "string" ? obj.title.slice(0, 240) : "",
    body_text: typeof obj.body_text === "string" ? obj.body_text : "",
    kind,
  };
}
