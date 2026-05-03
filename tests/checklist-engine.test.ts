import { describe, it, expect } from "vitest";
import { deriveState, type EngineItem, type EngineSignoff } from "@/lib/checklist-engine";

const item = (id: string, label: string, orderIndex: number): EngineItem => ({
  id,
  orderIndex,
  label,
  description: null,
});

const signoff = (
  itemId: string,
  userId: string,
  userName: string,
  signedAt: Date,
): EngineSignoff => ({ itemId, userId, userName, signedAt });

describe("ChecklistEngine.deriveState", () => {
  it("empty checklist: 0 of 0, percentage = 100 (vacuously complete)", () => {
    const state = deriveState([], []);
    expect(state.totalItems).toBe(0);
    expect(state.signedItems).toBe(0);
    expect(state.percentage).toBe(100);
    expect(state.complete).toBe(true);
    expect(state.items).toEqual([]);
  });

  it("partial: 2 of 5 signed, percentage rounds to nearest int", () => {
    const items = [
      item("a", "Torque lugs", 0),
      item("b", "Fluid levels", 1),
      item("c", "Helmets present", 2),
      item("d", "Safety triangle", 3),
      item("e", "Tools loaded", 4),
    ];
    const sigs = [
      signoff("a", "u1", "Mech", new Date("2026-06-01T10:00:00Z")),
      signoff("c", "u2", "Chief", new Date("2026-06-01T10:05:00Z")),
    ];
    const state = deriveState(items, sigs);
    expect(state.totalItems).toBe(5);
    expect(state.signedItems).toBe(2);
    expect(state.percentage).toBe(40);
    expect(state.complete).toBe(false);
  });

  it("complete: all items signed → percentage = 100, complete = true", () => {
    const items = [item("a", "X", 0), item("b", "Y", 1)];
    const sigs = [
      signoff("a", "u1", "M", new Date()),
      signoff("b", "u2", "C", new Date()),
    ];
    const state = deriveState(items, sigs);
    expect(state.totalItems).toBe(2);
    expect(state.signedItems).toBe(2);
    expect(state.percentage).toBe(100);
    expect(state.complete).toBe(true);
  });

  it("attribution: each item's signoff carries the right user + timestamp", () => {
    const t1 = new Date("2026-06-01T10:00:00Z");
    const t2 = new Date("2026-06-01T11:00:00Z");
    const items = [item("a", "X", 0), item("b", "Y", 1)];
    const sigs = [
      signoff("a", "u1", "Mech", t1),
      signoff("b", "u2", "Chief", t2),
    ];
    const state = deriveState(items, sigs);
    const sa = state.items.find((i) => i.item.id === "a");
    const sb = state.items.find((i) => i.item.id === "b");
    expect(sa?.signoff?.userName).toBe("Mech");
    expect(sa?.signoff?.signedAt).toEqual(t1);
    expect(sb?.signoff?.userName).toBe("Chief");
    expect(sb?.signoff?.signedAt).toEqual(t2);
  });

  it("unsigned items: signoff is null", () => {
    const items = [item("a", "X", 0), item("b", "Y", 1)];
    const sigs = [signoff("a", "u1", "M", new Date())];
    const state = deriveState(items, sigs);
    const sb = state.items.find((i) => i.item.id === "b");
    expect(sb?.signoff).toBeNull();
  });

  it("percentage math: 3 of 8 = 38 (rounded)", () => {
    const items = Array.from({ length: 8 }, (_, i) => item(`i${i}`, `L${i}`, i));
    const sigs = [
      signoff("i0", "u", "U", new Date()),
      signoff("i1", "u", "U", new Date()),
      signoff("i2", "u", "U", new Date()),
    ];
    expect(deriveState(items, sigs).percentage).toBe(38);
  });

  it("returns items in orderIndex order regardless of input ordering", () => {
    const items = [
      item("c", "third", 2),
      item("a", "first", 0),
      item("b", "second", 1),
    ];
    const state = deriveState(items, []);
    expect(state.items.map((i) => i.item.id)).toEqual(["a", "b", "c"]);
  });

  it("ignores stray signoffs whose itemId isn't in the items list", () => {
    const items = [item("a", "X", 0)];
    const sigs = [
      signoff("a", "u", "U", new Date()),
      signoff("nonexistent", "u", "U", new Date()),
    ];
    const state = deriveState(items, sigs);
    expect(state.totalItems).toBe(1);
    expect(state.signedItems).toBe(1);
    expect(state.percentage).toBe(100);
  });
});
