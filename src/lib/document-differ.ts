// Pure deep module for paragraph-level structured diff between two text
// documents. No DB, no I/O. Tests live in tests/document-differ.test.ts.

export type DiffBlockKind = "added" | "removed" | "unchanged";

export type DiffBlock = {
  kind: DiffBlockKind;
  text: string;
};

export type StructuredDiff = {
  blocks: DiffBlock[];
  addedCount: number;
  removedCount: number;
  unchangedCount: number;
  hasChanges: boolean;
};

/**
 * Normalize a document string for diffing:
 *  - strip a leading byte-order mark
 *  - normalize CRLF and CR to LF
 *  - trim trailing whitespace from each line
 *  - collapse runs of 2+ blank lines into a single blank line
 *  - trim trailing newlines from the document
 */
export function normalizeText(input: string): string {
  let s = input;
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  s = s.replace(/\r\n?/g, "\n");
  s = s
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .join("\n");
  s = s.replace(/\n{2,}/g, "\n\n");
  s = s.replace(/\n+$/g, "");
  s = s.replace(/^\n+/g, "");
  return s;
}

function splitBlocks(input: string): string[] {
  const norm = normalizeText(input);
  if (norm === "") return [];
  return norm.split(/\n{2,}/g).map((b) => b.trim()).filter((b) => b.length > 0);
}

/**
 * Standard LCS dynamic-programming table over two arrays of strings.
 * Returns a 2D array where dp[i][j] = LCS length of a[0..i) and b[0..j).
 */
function lcsTable(a: string[], b: string[]): number[][] {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array(b.length + 1).fill(0),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }
  return dp;
}

export function diff(prevText: string, nextText: string): StructuredDiff {
  const a = splitBlocks(prevText);
  const b = splitBlocks(nextText);

  if (a.length === 0 && b.length === 0) {
    return {
      blocks: [],
      addedCount: 0,
      removedCount: 0,
      unchangedCount: 0,
      hasChanges: false,
    };
  }

  const dp = lcsTable(a, b);

  // Backtrack to produce the diff in document order.
  const blocks: DiffBlock[] = [];
  let i = a.length;
  let j = b.length;
  const trace: DiffBlock[] = [];
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      trace.push({ kind: "unchanged", text: a[i - 1] });
      i--;
      j--;
    } else if (dp[i - 1][j] > dp[i][j - 1]) {
      trace.push({ kind: "removed", text: a[i - 1] });
      i--;
    } else {
      // Tie-break and "added wins": push added in the trace first so that
      // after reversal, removed precedes added in document order — matching
      // typical diff reading conventions ("here's what was, here's what is").
      trace.push({ kind: "added", text: b[j - 1] });
      j--;
    }
  }
  while (i > 0) {
    trace.push({ kind: "removed", text: a[i - 1] });
    i--;
  }
  while (j > 0) {
    trace.push({ kind: "added", text: b[j - 1] });
    j--;
  }
  trace.reverse();
  blocks.push(...trace);

  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const blk of blocks) {
    if (blk.kind === "added") added++;
    else if (blk.kind === "removed") removed++;
    else unchanged++;
  }

  return {
    blocks,
    addedCount: added,
    removedCount: removed,
    unchangedCount: unchanged,
    hasChanges: added + removed > 0,
  };
}
