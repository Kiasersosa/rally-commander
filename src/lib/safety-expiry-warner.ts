// Pure deep module for safety / license / equipment expiry classification.
// No DB, no I/O. Tests live in tests/safety-expiry-warner.test.ts.
//
// Bands (matching the PRD warning ladder):
//   "expired"    — daysUntilExpiry < 0
//   "1w"         — 0..7 days
//   "1mo"        — 8..30 days
//   "3mo"        — 31..90 days
//   "6mo"        — 91..180 days
//   "ok"         — more than 180 days out
//   "no_expiry"  — item has no recorded expiry date

export type ExpiryBand =
  | "expired"
  | "1w"
  | "1mo"
  | "3mo"
  | "6mo"
  | "ok"
  | "no_expiry";

export type ExpiringItem = {
  id: string;
  label: string;
  expiryDate: Date | null;
};

export type ExpiryWarning = {
  item: ExpiringItem;
  band: ExpiryBand;
  /** Negative when expired, null when no expiry. */
  daysUntilExpiry: number | null;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function dateOnlyUTC(d: Date): number {
  // Truncate to UTC midnight so day math is integer.
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function bandFor(daysUntilExpiry: number | null): ExpiryBand {
  if (daysUntilExpiry === null) return "no_expiry";
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry <= 7) return "1w";
  if (daysUntilExpiry <= 30) return "1mo";
  if (daysUntilExpiry <= 90) return "3mo";
  if (daysUntilExpiry <= 180) return "6mo";
  return "ok";
}

const BAND_ORDER: ExpiryBand[] = [
  "expired",
  "1w",
  "1mo",
  "3mo",
  "6mo",
  "ok",
  "no_expiry",
];

const BAND_RANK = new Map<ExpiryBand, number>(
  BAND_ORDER.map((b, i) => [b, i]),
);

export function deriveWarnings(
  items: ExpiringItem[],
  referenceDate: Date,
): ExpiryWarning[] {
  const refDay = dateOnlyUTC(referenceDate);
  const warnings: ExpiryWarning[] = items.map((item) => {
    if (!item.expiryDate) {
      return { item, band: "no_expiry", daysUntilExpiry: null };
    }
    const days = Math.round((dateOnlyUTC(item.expiryDate) - refDay) / MS_PER_DAY);
    return { item, band: bandFor(days), daysUntilExpiry: days };
  });

  warnings.sort((a, b) => {
    const r = (BAND_RANK.get(a.band) ?? 99) - (BAND_RANK.get(b.band) ?? 99);
    if (r !== 0) return r;
    // Within the same band, ascending daysUntilExpiry (most urgent first).
    const aDays = a.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER;
    const bDays = b.daysUntilExpiry ?? Number.MAX_SAFE_INTEGER;
    return aDays - bDays;
  });

  return warnings;
}

export const ATTENTION_BANDS: readonly ExpiryBand[] = [
  "expired",
  "1w",
  "1mo",
  "3mo",
  "6mo",
];

export const BAND_LABEL: Record<ExpiryBand, string> = {
  expired: "Expired",
  "1w": "≤ 1 week",
  "1mo": "≤ 1 month",
  "3mo": "≤ 3 months",
  "6mo": "≤ 6 months",
  ok: "OK",
  no_expiry: "No expiry",
};

/** Tailwind-ish CSS class fragment for our existing badge system. */
export const BAND_BADGE_CLASS: Record<ExpiryBand, string> = {
  expired: "rc-badge-post_event", // we'll override color for expired in CSS later
  "1w": "rc-badge-post_event",
  "1mo": "rc-badge-prep",
  "3mo": "rc-badge-prep",
  "6mo": "rc-badge-planning",
  ok: "rc-badge-on_event",
  no_expiry: "rc-badge-post_event",
};
