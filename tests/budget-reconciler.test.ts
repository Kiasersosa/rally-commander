import { describe, it, expect } from "vitest";
import {
  reconcile,
  type EngineBudgetLine,
  type EngineExpense,
} from "@/lib/budget-reconciler";

const line = (
  category: EngineBudgetLine["category"],
  estimatedCents: number,
): EngineBudgetLine => ({ category, estimatedCents });

const exp = (
  category: EngineExpense["category"],
  amountCents: number,
): EngineExpense => ({ category, amountCents });

describe("BudgetReconciler.reconcile", () => {
  it("empty: zero totals, no rows", () => {
    const v = reconcile([], []);
    expect(v.totalEstimatedCents).toBe(0);
    expect(v.totalActualCents).toBe(0);
    expect(v.totalVarianceCents).toBe(0);
    expect(v.byCategory).toEqual([]);
  });

  it("under-budget: actual < estimated → positive variance, status 'under'", () => {
    const v = reconcile([line("fuel", 30000)], [exp("fuel", 25000)]);
    expect(v.byCategory).toHaveLength(1);
    expect(v.byCategory[0]).toMatchObject({
      category: "fuel",
      estimatedCents: 30000,
      actualCents: 25000,
      varianceCents: 5000,
      status: "under",
    });
    expect(v.totalEstimatedCents).toBe(30000);
    expect(v.totalActualCents).toBe(25000);
    expect(v.totalVarianceCents).toBe(5000);
  });

  it("over-budget: actual > estimated → negative variance, status 'over'", () => {
    const v = reconcile([line("parts", 50000)], [exp("parts", 75000)]);
    expect(v.byCategory[0]).toMatchObject({
      category: "parts",
      estimatedCents: 50000,
      actualCents: 75000,
      varianceCents: -25000,
      status: "over",
    });
  });

  it("on_budget: actual == estimated", () => {
    const v = reconcile([line("entry", 10000)], [exp("entry", 10000)]);
    expect(v.byCategory[0].status).toBe("on_budget");
    expect(v.byCategory[0].varianceCents).toBe(0);
  });

  it("missing budget side: expenses but no line → status 'no_budget'", () => {
    const v = reconcile([], [exp("food", 8000)]);
    expect(v.byCategory).toHaveLength(1);
    expect(v.byCategory[0]).toMatchObject({
      category: "food",
      estimatedCents: 0,
      actualCents: 8000,
      varianceCents: -8000,
      status: "no_budget",
    });
  });

  it("missing actuals side: line but no expenses → status 'no_actuals'", () => {
    const v = reconcile([line("hotels", 60000)], []);
    expect(v.byCategory).toHaveLength(1);
    expect(v.byCategory[0]).toMatchObject({
      category: "hotels",
      estimatedCents: 60000,
      actualCents: 0,
      varianceCents: 60000,
      status: "no_actuals",
    });
  });

  it("mixed: under + over + no_budget + no_actuals all present", () => {
    const v = reconcile(
      [line("entry", 10000), line("fuel", 30000), line("hotels", 60000)],
      [
        exp("entry", 10000), // on_budget
        exp("fuel", 25000), // under
        exp("parts", 75000), // no_budget
        // hotels: no expense -> no_actuals
      ],
    );
    const byCat = Object.fromEntries(v.byCategory.map((c) => [c.category, c]));
    expect(byCat.entry.status).toBe("on_budget");
    expect(byCat.fuel.status).toBe("under");
    expect(byCat.parts.status).toBe("no_budget");
    expect(byCat.hotels.status).toBe("no_actuals");

    expect(v.totalEstimatedCents).toBe(10000 + 30000 + 60000);
    expect(v.totalActualCents).toBe(10000 + 25000 + 75000);
    expect(v.totalVarianceCents).toBe(v.totalEstimatedCents - v.totalActualCents);
  });

  it("aggregates multiple expenses in same category", () => {
    const v = reconcile(
      [line("food", 20000)],
      [exp("food", 5000), exp("food", 7500), exp("food", 3000)],
    );
    expect(v.byCategory[0].actualCents).toBe(15500);
    expect(v.byCategory[0].varianceCents).toBe(4500);
    expect(v.byCategory[0].status).toBe("under");
  });

  it("multiple lines in same category sum to estimated total (last-write should not clobber)", () => {
    // The schema enforces uniqueness on (event, category) but the engine
    // shouldn't assume that; if two lines slip through, sum them.
    const v = reconcile(
      [line("transport", 5000), line("transport", 10000)],
      [exp("transport", 12000)],
    );
    expect(v.byCategory[0].estimatedCents).toBe(15000);
    expect(v.byCategory[0].varianceCents).toBe(3000);
  });

  it("sorts categories in canonical enum order regardless of input order", () => {
    const v = reconcile(
      [line("transport", 1000), line("entry", 2000)],
      [exp("food", 3000), exp("fuel", 4000)],
    );
    const order = v.byCategory.map((c) => c.category);
    expect(order).toEqual(["entry", "fuel", "food", "transport"]);
  });
});
