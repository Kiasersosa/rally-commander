// Server-side PDF text extraction via unpdf. Used to feed DocumentDiffer.
// Failures are swallowed and return null — diff is best-effort.

export async function extractPdfText(bytes: Uint8Array): Promise<string | null> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    if (!text) return null;
    if (Array.isArray(text)) return text.join("\n\n");
    return String(text);
  } catch (err) {
    console.warn("[pdf-text] extraction failed:", err);
    return null;
  }
}
