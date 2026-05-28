// Server-side helpers that bridge the pure ChecklistEngine to the DB.

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  checklistInstanceItems,
  checklistInstances,
  checklistSignoffs,
  checklistTemplateItems,
  checklistTemplates,
  equipmentItems,
  users,
  vehicles,
  type ChecklistKind,
  type UserRole,
} from "./db/schema";
import { deriveState, type EngineItem, type EngineSignoff } from "./checklist-engine";

export const KIND_LABEL: Record<ChecklistKind, string> = {
  pre_event_inspection: "Pre-event inspection",
  post_event_teardown: "Post-event teardown",
  packing: "Packing",
  service_setup: "Service-area setup",
};

export const ALL_KINDS: readonly ChecklistKind[] = [
  "pre_event_inspection",
  "post_event_teardown",
  "packing",
  "service_setup",
] as const;

/** Parse a JSON-stringified UUID array safely (returns []). */
export function parseToolIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((x): x is string => typeof x === "string");
    }
  } catch {
    /* fall through */
  }
  return [];
}

/** Stringify a UUID array for storage; returns null when empty. */
export function stringifyToolIds(ids: string[]): string | null {
  if (ids.length === 0) return null;
  return JSON.stringify(ids);
}

/**
 * For each (active vehicle × kind) on the team that has a template, ensure
 * a ChecklistInstance for the given event exists, snapshotting items.
 * Idempotent — already-present (event, vehicle, kind) tuples are skipped.
 */
export async function instantiateChecklistsForEvent(
  teamId: string,
  eventId: string,
): Promise<{ created: number }> {
  const activeVehicles = await db
    .select({ id: vehicles.id })
    .from(vehicles)
    .where(and(eq(vehicles.teamId, teamId), isNull(vehicles.deletedAt)));

  let created = 0;

  for (const v of activeVehicles) {
    const templates = await db
      .select()
      .from(checklistTemplates)
      .where(
        and(
          eq(checklistTemplates.teamId, teamId),
          eq(checklistTemplates.vehicleId, v.id),
          isNull(checklistTemplates.deletedAt),
        ),
      );

    for (const tpl of templates) {
      // Already instantiated for this (event, vehicle, kind)?
      const existing = await db
        .select({ id: checklistInstances.id })
        .from(checklistInstances)
        .where(
          and(
            eq(checklistInstances.teamId, teamId),
            eq(checklistInstances.eventId, eventId),
            eq(checklistInstances.vehicleId, v.id),
            eq(checklistInstances.kind, tpl.kind),
          ),
        )
        .limit(1);
      if (existing.length > 0) continue;

      const items = await db
        .select()
        .from(checklistTemplateItems)
        .where(
          and(
            eq(checklistTemplateItems.teamId, teamId),
            eq(checklistTemplateItems.templateId, tpl.id),
          ),
        )
        .orderBy(asc(checklistTemplateItems.orderIndex));

      const [instance] = await db
        .insert(checklistInstances)
        .values({
          teamId,
          eventId,
          vehicleId: v.id,
          kind: tpl.kind,
          name: tpl.name,
          sourceTemplateId: tpl.id,
        })
        .returning();

      if (items.length > 0) {
        await db.insert(checklistInstanceItems).values(
          items.map((it) => ({
            teamId,
            instanceId: instance.id,
            orderIndex: it.orderIndex,
            label: it.label,
            description: it.description,
            zone: it.zone,
            targetRole: it.targetRole,
            toolsNeeded: it.toolsNeeded,
          })),
        );
      }
      created++;
    }
  }

  return { created };
}

export type ChecklistItemMeta = {
  zone: string | null;
  targetRole: UserRole | null;
  toolNames: string[];
};

export type EnrichedChecklistState = ReturnType<typeof deriveState> & {
  meta: Map<string, ChecklistItemMeta>;
};

/**
 * Load the full state of a checklist instance via the pure ChecklistEngine,
 * plus per-item metadata (zone, target role, resolved tool names).
 */
export async function loadChecklistState(
  teamId: string,
  instanceId: string,
): Promise<EnrichedChecklistState> {
  const items = await db
    .select()
    .from(checklistInstanceItems)
    .where(
      and(
        eq(checklistInstanceItems.teamId, teamId),
        eq(checklistInstanceItems.instanceId, instanceId),
      ),
    )
    .orderBy(asc(checklistInstanceItems.orderIndex));

  const signoffs = await db
    .select({
      itemId: checklistSignoffs.instanceItemId,
      userId: checklistSignoffs.userId,
      userName: users.name,
      signedAt: checklistSignoffs.signedAt,
    })
    .from(checklistSignoffs)
    .innerJoin(users, eq(users.id, checklistSignoffs.userId))
    .where(eq(checklistSignoffs.teamId, teamId));

  // Collect all referenced tool IDs and resolve to names in a single query.
  const allToolIds = Array.from(
    new Set(items.flatMap((i) => parseToolIds(i.toolsNeeded))),
  );
  const toolNameById = new Map<string, string>();
  if (allToolIds.length > 0) {
    const tools = await db
      .select({ id: equipmentItems.id, description: equipmentItems.description })
      .from(equipmentItems)
      .where(
        and(
          eq(equipmentItems.teamId, teamId),
          inArray(equipmentItems.id, allToolIds),
        ),
      );
    for (const t of tools) toolNameById.set(t.id, t.description);
  }

  const engineItems: EngineItem[] = items.map((i) => ({
    id: i.id,
    orderIndex: i.orderIndex,
    label: i.label,
    description: i.description,
  }));
  const itemIdSet = new Set(items.map((i) => i.id));
  const engineSignoffs: EngineSignoff[] = signoffs
    .filter((s) => itemIdSet.has(s.itemId))
    .map((s) => ({
      itemId: s.itemId,
      userId: s.userId,
      userName: s.userName,
      signedAt: s.signedAt,
    }));

  const base = deriveState(engineItems, engineSignoffs);
  const meta = new Map<string, ChecklistItemMeta>();
  for (const i of items) {
    meta.set(i.id, {
      zone: i.zone,
      targetRole: i.targetRole,
      toolNames: parseToolIds(i.toolsNeeded)
        .map((id) => toolNameById.get(id))
        .filter((n): n is string => Boolean(n)),
    });
  }

  return { ...base, meta };
}
