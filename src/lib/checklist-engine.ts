// Pure deep module for checklist state derivation. No DB.
// Tests live in tests/checklist-engine.test.ts.

export type EngineItem = {
  id: string;
  orderIndex: number;
  label: string;
  description: string | null;
};

export type EngineSignoff = {
  itemId: string;
  userId: string;
  userName: string;
  signedAt: Date;
};

export type EngineItemState = {
  item: EngineItem;
  signoff: EngineSignoff | null;
};

export type ChecklistState = {
  totalItems: number;
  signedItems: number;
  /** Integer 0..100. An empty checklist is vacuously 100. */
  percentage: number;
  complete: boolean;
  items: EngineItemState[];
};

export function deriveState(
  items: EngineItem[],
  signoffs: EngineSignoff[],
): ChecklistState {
  const byItem = new Map<string, EngineSignoff>();
  for (const s of signoffs) {
    if (items.some((i) => i.id === s.itemId)) {
      byItem.set(s.itemId, s);
    }
  }

  const ordered = [...items].sort((a, b) => a.orderIndex - b.orderIndex);
  const itemStates: EngineItemState[] = ordered.map((item) => ({
    item,
    signoff: byItem.get(item.id) ?? null,
  }));

  const total = itemStates.length;
  const signed = itemStates.reduce((n, i) => n + (i.signoff ? 1 : 0), 0);
  const percentage = total === 0 ? 100 : Math.round((signed / total) * 100);

  return {
    totalItems: total,
    signedItems: signed,
    percentage,
    complete: signed === total,
    items: itemStates,
  };
}
