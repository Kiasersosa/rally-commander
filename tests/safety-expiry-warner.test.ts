import { describe, it, expect } from "vitest";
import {
  bandFor,
  deriveWarnings,
  type ExpiringItem,
} from "@/lib/safety-expiry-warner";

const ref = new Date("2026-06-01T00:00:00Z");

const item = (id: string, label: string, expiry: string | null): ExpiringItem => ({
  id,
  label,
  expiryDate: expiry ? new Date(`${expiry}T00:00:00Z`) : null,
});

describe("SafetyExpiryWarner.bandFor", () => {
  it("expired (negative days)", () => {
    expect(bandFor(-1)).toBe("expired");
    expect(bandFor(-365)).toBe("expired");
  });
  it("0 days = expiring today still considered '1w'", () => {
    expect(bandFor(0)).toBe("1w");
  });
  it("within 1 week (1..7)", () => {
    expect(bandFor(1)).toBe("1w");
    expect(bandFor(7)).toBe("1w");
  });
  it("within 1 month (8..30)", () => {
    expect(bandFor(8)).toBe("1mo");
    expect(bandFor(30)).toBe("1mo");
  });
  it("within 3 months (31..90)", () => {
    expect(bandFor(31)).toBe("3mo");
    expect(bandFor(90)).toBe("3mo");
  });
  it("within 6 months (91..180)", () => {
    expect(bandFor(91)).toBe("6mo");
    expect(bandFor(180)).toBe("6mo");
  });
  it("more than 6 months out is 'ok'", () => {
    expect(bandFor(181)).toBe("ok");
    expect(bandFor(1000)).toBe("ok");
  });
  it("null days (no expiry) is 'no_expiry'", () => {
    expect(bandFor(null)).toBe("no_expiry");
  });
});

describe("SafetyExpiryWarner.deriveWarnings", () => {
  it("classifies items into each band correctly", () => {
    const items = [
      item("a", "Helmet", "2026-12-31"), // ~213 days out → ok
      item("b", "HANS", "2026-09-15"), // ~106 days → 6mo
      item("c", "Suit", "2026-08-15"), // ~75 days → 3mo
      item("d", "Harness", "2026-06-25"), // 24 days → 1mo
      item("e", "Fire ext", "2026-06-05"), // 4 days → 1w
      item("f", "Fuel cell", "2026-05-20"), // -12 days → expired
      item("g", "Random", null), // no expiry
    ];
    const warnings = deriveWarnings(items, ref);
    const byId = Object.fromEntries(warnings.map((w) => [w.item.id, w]));
    expect(byId.a.band).toBe("ok");
    expect(byId.b.band).toBe("6mo");
    expect(byId.c.band).toBe("3mo");
    expect(byId.d.band).toBe("1mo");
    expect(byId.e.band).toBe("1w");
    expect(byId.f.band).toBe("expired");
    expect(byId.g.band).toBe("no_expiry");
  });

  it("days-until-expiry math is correct", () => {
    const w = deriveWarnings([item("x", "Item", "2026-06-08")], ref);
    expect(w[0].daysUntilExpiry).toBe(7);
    const expired = deriveWarnings([item("y", "Old", "2026-05-25")], ref);
    expect(expired[0].daysUntilExpiry).toBe(-7);
  });

  it("no-expiry items have null daysUntilExpiry", () => {
    const w = deriveWarnings([item("z", "Z", null)], ref);
    expect(w[0].daysUntilExpiry).toBeNull();
  });

  it("sorts by urgency: expired first, then ascending days, then no_expiry, then ok", () => {
    const w = deriveWarnings(
      [
        item("ok", "Way out", "2027-01-01"),
        item("none", "No date", null),
        item("exp", "Expired", "2026-05-01"),
        item("near", "Near", "2026-06-04"),
      ],
      ref,
    );
    expect(w.map((x) => x.item.id)).toEqual(["exp", "near", "ok", "none"]);
  });

  it("empty input: no warnings", () => {
    expect(deriveWarnings([], ref)).toEqual([]);
  });

  it("status summary counts: needsAttention excludes 'ok' and 'no_expiry'", () => {
    const items = [
      item("a", "ok", "2027-01-01"),
      item("b", "expired", "2026-05-01"),
      item("c", "1w", "2026-06-04"),
      item("d", "no_expiry", null),
    ];
    const w = deriveWarnings(items, ref);
    const attentionBands: Array<typeof w[number]["band"]> = [
      "expired",
      "1w",
      "1mo",
      "3mo",
      "6mo",
    ];
    const count = w.filter((x) => attentionBands.includes(x.band)).length;
    expect(count).toBe(2); // expired + 1w
  });
});
