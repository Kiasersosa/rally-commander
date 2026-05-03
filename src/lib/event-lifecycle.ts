// Pure state machine for Event lifecycle. No DB access.
// Tests live in tests/event-lifecycle.test.ts.

import type { EventPhase, UserRole } from "./db/schema";

const TRANSITIONS: Record<EventPhase, EventPhase | null> = {
  planning: "prep",
  prep: "on_event",
  on_event: "post_event",
  post_event: null,
};

export function nextPhase(current: EventPhase): EventPhase | null {
  return TRANSITIONS[current];
}

export function canAdvance(current: EventPhase, role: UserRole): boolean {
  if (role !== "chief") return false;
  return nextPhase(current) !== null;
}

export type AdvanceResult =
  | { ok: true; phase: EventPhase }
  | { ok: false; reason: string };

export function advance(current: EventPhase, role: UserRole): AdvanceResult {
  if (role !== "chief") {
    return { ok: false, reason: "Only the chief can advance the event phase." };
  }
  const next = nextPhase(current);
  if (next === null) {
    return { ok: false, reason: "Event is already in the terminal phase (post_event)." };
  }
  return { ok: true, phase: next };
}

export const ALL_PHASES: readonly EventPhase[] = [
  "planning",
  "prep",
  "on_event",
  "post_event",
] as const;
