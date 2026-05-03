// Pure deep module for budget vs actuals reconciliation. No DB.
// Tests live in tests/budget-reconciler.test.ts.

import type { BudgetCategory } from "./db/schema";

export type EngineBudgetLine = {
  category: BudgetCategory;
  estimatedCents: number;
};

export type EngineExpense = {
  category: BudgetCategory;
  amountCents: number;
};

export type CategoryStatus =
  | "under"
  | "over"
  | "on_budget"
  | "no_budget" // expenses but no budgeted line
  | "no_actuals"; // budgeted but no expenses yet

export type CategoryVariance = {
  category: BudgetCategory;
  estimatedCents: number;
  actualCents: number;
  /** estimatedCents - actualCents (positive = under budget). */
  varianceCents: number;
  status: CategoryStatus;
};

export type Variance = {
  byCategory: CategoryVariance[];
  totalEstimatedCents: number;
  totalActualCents: number;
  totalVarianceCents: number;
};

// Canonical display order — matches the enum order in the schema.
const CATEGORY_ORDER: readonly BudgetCategory[] = [
  "entry",
  "fuel",
  "parts",
  "hotels",
  "food",
  "transport",
  "other",
] as const;

function categoryStatus(
  estimated: number,
  actual: number,
  hasBudget: boolean,
  hasActuals: boolean,
): CategoryStatus {
  if (!hasBudget && hasActuals) return "no_budget";
  if (hasBudget && !hasActuals) return "no_actuals";
  if (estimated === actual) return "on_budget";
  return actual > estimated ? "over" : "under";
}

export function reconcile(
  lines: EngineBudgetLine[],
  expenses: EngineExpense[],
): Variance {
  const estimated = new Map<BudgetCategory, number>();
  for (const l of lines) {
    estimated.set(l.category, (estimated.get(l.category) ?? 0) + l.estimatedCents);
  }
  const actual = new Map<BudgetCategory, number>();
  for (const e of expenses) {
    actual.set(e.category, (actual.get(e.category) ?? 0) + e.amountCents);
  }

  const cats = new Set<BudgetCategory>([...estimated.keys(), ...actual.keys()]);
  const sorted = CATEGORY_ORDER.filter((c) => cats.has(c));

  const byCategory: CategoryVariance[] = sorted.map((category) => {
    const e = estimated.get(category) ?? 0;
    const a = actual.get(category) ?? 0;
    const hasBudget = estimated.has(category);
    const hasActuals = actual.has(category);
    return {
      category,
      estimatedCents: e,
      actualCents: a,
      varianceCents: e - a,
      status: categoryStatus(e, a, hasBudget, hasActuals),
    };
  });

  const totalEstimatedCents = byCategory.reduce(
    (n, c) => n + c.estimatedCents,
    0,
  );
  const totalActualCents = byCategory.reduce((n, c) => n + c.actualCents, 0);

  return {
    byCategory,
    totalEstimatedCents,
    totalActualCents,
    totalVarianceCents: totalEstimatedCents - totalActualCents,
  };
}

export const ALL_BUDGET_CATEGORIES: readonly BudgetCategory[] = CATEGORY_ORDER;

export const BUDGET_CATEGORY_LABEL: Record<BudgetCategory, string> = {
  entry: "Entry fees",
  fuel: "Fuel",
  parts: "Parts",
  hotels: "Hotels",
  food: "Food",
  transport: "Transport",
  other: "Other",
};

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString()}.${remainder.toString().padStart(2, "0")}`;
}
