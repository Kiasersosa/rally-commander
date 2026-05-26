"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { conditionReports, events } from "@/lib/db/schema";
import { requireSession } from "@/lib/authz";

function clampRating(raw: unknown): number | null {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n)) return null;
  if (n < 1 || n > 5) return null;
  return n;
}

export async function createConditionReport(formData: FormData) {
  const u = await requireSession();
  const eventId = String(formData.get("event_id") ?? "");
  if (!eventId) throw new Error("event_id required");

  const [event] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.teamId, u.teamId),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);
  if (!event) throw new Error("event not found");

  const fatigueRating = clampRating(formData.get("fatigue"));
  const hydrationRating = clampRating(formData.get("hydration"));
  const tempRating = clampRating(formData.get("temp"));
  const carConcerns = String(formData.get("car_concerns") ?? "").trim() || null;
  const notes = String(formData.get("notes") ?? "").trim() || null;
  const location = String(formData.get("location") ?? "").trim() || null;

  if (
    fatigueRating === null &&
    hydrationRating === null &&
    tempRating === null &&
    !carConcerns &&
    !notes
  ) {
    throw new Error("at least one field is required");
  }

  await db.insert(conditionReports).values({
    teamId: u.teamId,
    eventId,
    loggedByUserId: u.userId,
    fatigueRating,
    hydrationRating,
    tempRating,
    carConcerns,
    notes,
    location,
  });

  revalidatePath(`/events/${eventId}/condition-reports`);
  revalidatePath(`/events/${eventId}`);
}
