// Work order status transitions. Pure module; no DB.

import type { WorkOrderStatus, UserRole } from "./db/schema";

const NEXT: Record<WorkOrderStatus, WorkOrderStatus | null> = {
  open: "in_progress",
  in_progress: "done",
  done: null,
};

export function nextStatus(current: WorkOrderStatus): WorkOrderStatus | null {
  return NEXT[current];
}

// Anyone on the team can transition; chief can also reopen if needed (future).
export function canTransition(
  _current: WorkOrderStatus,
  _role: UserRole,
): boolean {
  return true;
}

export function statusLabel(s: WorkOrderStatus): string {
  switch (s) {
    case "open":
      return "Open";
    case "in_progress":
      return "In progress";
    case "done":
      return "Done";
  }
}

export const ALL_STATUSES: readonly WorkOrderStatus[] = [
  "open",
  "in_progress",
  "done",
] as const;
