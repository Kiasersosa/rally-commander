import { describe, it, expect } from "vitest";
import { diff, normalizeText } from "@/lib/document-differ";

describe("DocumentDiffer.diff", () => {
  it("identical text: hasChanges=false, all blocks unchanged", () => {
    const text = "Section A\n\nSection B\n\nSection C";
    const d = diff(text, text);
    expect(d.hasChanges).toBe(false);
    expect(d.blocks.every((b) => b.kind === "unchanged")).toBe(true);
    expect(d.addedCount).toBe(0);
    expect(d.removedCount).toBe(0);
    expect(d.unchangedCount).toBe(3);
  });

  it("added section: extra paragraph at end is reported as added", () => {
    const prev = "Section A\n\nSection B";
    const next = "Section A\n\nSection B\n\nSection C (NEW)";
    const d = diff(prev, next);
    expect(d.hasChanges).toBe(true);
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(0);
    const added = d.blocks.find((b) => b.kind === "added");
    expect(added?.text).toBe("Section C (NEW)");
  });

  it("added section in middle", () => {
    const prev = "A\n\nC";
    const next = "A\n\nB (new middle)\n\nC";
    const d = diff(prev, next);
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(0);
    expect(d.unchangedCount).toBe(2);
  });

  it("removed section: missing paragraph is reported as removed", () => {
    const prev = "A\n\nB\n\nC";
    const next = "A\n\nC";
    const d = diff(prev, next);
    expect(d.hasChanges).toBe(true);
    expect(d.addedCount).toBe(0);
    expect(d.removedCount).toBe(1);
    const removed = d.blocks.find((b) => b.kind === "removed");
    expect(removed?.text).toBe("B");
  });

  it("changed wording shows as removed+added pair", () => {
    const prev = "Stage 4 starts at 09:00.";
    const next = "Stage 4 starts at 10:30.";
    const d = diff(prev, next);
    expect(d.hasChanges).toBe(true);
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(1);
  });

  it("no change with different line endings (LF vs CRLF) is normalized", () => {
    const prev = "A\nB\nC";
    const next = "A\r\nB\r\nC";
    const d = diff(prev, next);
    expect(d.hasChanges).toBe(false);
  });

  it("strips leading BOM", () => {
    const prev = "Hello world";
    const next = "\uFEFFHello world";
    expect(d_with(prev, next).hasChanges).toBe(false);
  });

  it("trims trailing whitespace per block", () => {
    const prev = "Section A   \n\nSection B";
    const next = "Section A\n\nSection B";
    const d = diff(prev, next);
    expect(d.hasChanges).toBe(false);
  });

  it("collapses runs of blank lines into a single paragraph break", () => {
    const prev = "A\n\n\n\nB";
    const next = "A\n\nB";
    const d = diff(prev, next);
    expect(d.hasChanges).toBe(false);
  });

  it("empty prev: all blocks added", () => {
    const d = diff("", "Just one paragraph");
    expect(d.hasChanges).toBe(true);
    expect(d.addedCount).toBe(1);
    expect(d.removedCount).toBe(0);
  });

  it("empty next: all blocks removed", () => {
    const d = diff("A\n\nB", "");
    expect(d.hasChanges).toBe(true);
    expect(d.addedCount).toBe(0);
    expect(d.removedCount).toBe(2);
  });

  it("both empty: no changes, no blocks", () => {
    const d = diff("", "");
    expect(d.hasChanges).toBe(false);
    expect(d.blocks).toHaveLength(0);
  });

  it("Unicode characters round-trip cleanly", () => {
    const prev = "Stage 5 — Río Cañón";
    const next = "Stage 5 — Río Cañón";
    expect(diff(prev, next).hasChanges).toBe(false);
  });

  it("blocks are returned in document order (prev order preserved for unchanged/removed; added inserted at correct position)", () => {
    const prev = "A\n\nB\n\nC";
    const next = "A\n\nB-new\n\nC";
    const d = diff(prev, next);
    const order = d.blocks.map((b) => `${b.kind}:${b.text.replace(/\n/g, " ")}`);
    // A (unchanged), B (removed), B-new (added), C (unchanged)
    expect(order).toEqual([
      "unchanged:A",
      "removed:B",
      "added:B-new",
      "unchanged:C",
    ]);
  });
});

describe("DocumentDiffer.normalizeText", () => {
  it("strips BOM, normalizes CRLF, trims trailing whitespace per line, collapses blank-line runs", () => {
    const messy = "\uFEFFA  \r\nB\r\n\r\n\r\nC\r\n";
    const clean = normalizeText(messy);
    expect(clean).toBe("A\nB\n\nC");
  });
});

// Local helper — vitest's `expect` doesn't accept extra args directly.
function d_with(prev: string, next: string) {
  return diff(prev, next);
}
