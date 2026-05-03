// Server-side helpers that bridge the pure ChecklistEngine to the DB.

import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  checklistInstanceItems,
  checklistInstances,
  checklistSignoffs,
  checklistTemplateItems,
  checklistTemplates,
  users,
  vehicles,
  type ChecklistKind,
} from "./db/schema";
import { deriveState, type EngineItem, type EngineSignoff } from "./checklist-engine";

export const KIND_LABEL: Record<ChecklistKind, string> = {
  pre_event_inspection: "Pre-event inspection",
  post_event_teardown: "Post-event teardown",
  packing: "Packing",
};

export const ALL_KINDS: readonly ChecklistKind[] = [
  "pre_event_inspection",
  "post_event_teardown",
  "packing",
] as const;

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
          })),
        );
      }
      created++;
    }
  }

  return { created };
}

/**
 * Load the full state of a checklist instance via the pure ChecklistEngine.
 */
export async function loadChecklistState(teamId: string, instanceId: string) {
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

  return deriveState(engineItems, engineSignoffs);
}
