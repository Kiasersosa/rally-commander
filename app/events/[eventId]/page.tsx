import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  budgetLines,
  checklistInstanceItems,
  checklistInstances,
  checklistSignoffs,
  documentAcknowledgments,
  documentVersions,
  documents,
  eventStages,
  events,
  expenseEntries,
  hotelBookings,
  itineraryLegAssignees,
  itineraryLegs,
  mealPlanItems,
  orderListItems,
  recceScheduleEntries,
  tireNeeds,
  todos,
  users,
  vehicles,
  workOrders,
  type BudgetCategory,
  type DocumentCategory,
  type OrderListStatus,
} from "@/lib/db/schema";
import {
  ALL_DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABEL,
  uploadDocument,
} from "@/lib/documents";
import { isStorageConfigured } from "@/lib/storage";
import {
  ALL_BUDGET_CATEGORIES,
  BUDGET_CATEGORY_LABEL,
  formatCents,
  reconcile,
} from "@/lib/budget-reconciler";
import { getCurrentUser, requireChief, requireSession } from "@/lib/authz";
import { advance } from "@/lib/event-lifecycle";
import { Nav } from "@/components/Nav";
import { instantiateChecklistsForEvent, KIND_LABEL } from "@/lib/checklists";
import { aliasedTable, sql } from "drizzle-orm";
import Link from "next/link";

type Params = Promise<{ eventId: string }>;
type SearchParams = Promise<{ legs?: string }>;

// Module-level helper. Server actions defined inside the page component
// cannot close over functions from the parent scope (Next.js can't
// serialize the closure), so this lives up here.
function dollarsToCents(s: string): number {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

const PHASE_HINT: Record<string, string> = {
  planning:
    "Planning phase — events, hotels, and initial logistics modules will appear here in later phases.",
  prep: "Prep phase — work orders, parts ordering, and packing checklists will appear here.",
  on_event:
    "On-event phase — incident logging, service-stop timer, and crew status will appear here.",
  post_event:
    "Post-event phase — receipts reconciliation and post-event teardown checklists will appear here.",
};

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  const { eventId } = await params;
  const { legs: legsFilter } = await searchParams;
  const showOnlyMyLegs = legsFilter === "mine";

  const [event] = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.id, eventId),
        eq(events.teamId, me.teamId),
        isNull(events.deletedAt),
      ),
    )
    .limit(1);
  if (!event) notFound();

  const crew = await db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(and(eq(users.teamId, me.teamId), isNull(users.deletedAt)))
    .orderBy(asc(users.name));

  // Order list items
  const orderListRows = await db
    .select({
      id: orderListItems.id,
      title: orderListItems.title,
      qty: orderListItems.qty,
      status: orderListItems.status,
      notes: orderListItems.notes,
      workOrderId: orderListItems.workOrderId,
      workOrderTitle: workOrders.title,
      vehicleName: vehicles.name,
    })
    .from(orderListItems)
    .leftJoin(workOrders, eq(workOrders.id, orderListItems.workOrderId))
    .leftJoin(vehicles, eq(vehicles.id, workOrders.vehicleId))
    .where(
      and(
        eq(orderListItems.teamId, me.teamId),
        eq(orderListItems.eventId, eventId),
      ),
    )
    .orderBy(asc(orderListItems.status), asc(orderListItems.createdAt));

  // Open work orders for this team — used to suggest order-list source linkage
  const openWosForLink = await db
    .select({
      id: workOrders.id,
      title: workOrders.title,
      vehicleName: vehicles.name,
    })
    .from(workOrders)
    .innerJoin(vehicles, eq(vehicles.id, workOrders.vehicleId))
    .where(
      and(
        eq(workOrders.teamId, me.teamId),
        isNull(workOrders.closedAt),
      ),
    )
    .orderBy(asc(vehicles.name));

  // Tire needs
  const tireRows = await db
    .select()
    .from(tireNeeds)
    .where(
      and(eq(tireNeeds.teamId, me.teamId), eq(tireNeeds.eventId, eventId)),
    )
    .orderBy(asc(tireNeeds.createdAt));

  // Active team vehicles (for itinerary leg dropdown)
  const teamVehicles = await db
    .select({ id: vehicles.id, name: vehicles.name })
    .from(vehicles)
    .where(and(eq(vehicles.teamId, me.teamId), isNull(vehicles.deletedAt)))
    .orderBy(asc(vehicles.name));

  // Itinerary legs + assignees (joined as aggregated names per leg)
  const legs = await db
    .select({
      id: itineraryLegs.id,
      orderIndex: itineraryLegs.orderIndex,
      fromLocation: itineraryLegs.fromLocation,
      toLocation: itineraryLegs.toLocation,
      vehicleId: itineraryLegs.vehicleId,
      vehicleName: vehicles.name,
      departAt: itineraryLegs.departAt,
      arriveAt: itineraryLegs.arriveAt,
      notes: itineraryLegs.notes,
    })
    .from(itineraryLegs)
    .leftJoin(vehicles, eq(vehicles.id, itineraryLegs.vehicleId))
    .where(
      and(
        eq(itineraryLegs.teamId, me.teamId),
        eq(itineraryLegs.eventId, eventId),
      ),
    )
    .orderBy(asc(itineraryLegs.orderIndex));

  const legAssignees = await db
    .select({
      legId: itineraryLegAssignees.legId,
      userId: itineraryLegAssignees.userId,
      userName: users.name,
    })
    .from(itineraryLegAssignees)
    .innerJoin(users, eq(users.id, itineraryLegAssignees.userId))
    .where(eq(itineraryLegAssignees.teamId, me.teamId));

  const assigneesByLeg = new Map<string, { userId: string; userName: string }[]>();
  for (const a of legAssignees) {
    const list = assigneesByLeg.get(a.legId) ?? [];
    list.push({ userId: a.userId, userName: a.userName });
    assigneesByLeg.set(a.legId, list);
  }

  // Hotel bookings
  const hotels = await db
    .select()
    .from(hotelBookings)
    .where(
      and(
        eq(hotelBookings.teamId, me.teamId),
        eq(hotelBookings.eventId, eventId),
      ),
    )
    .orderBy(asc(hotelBookings.checkInDate), asc(hotelBookings.createdAt));

  // Meal plan items
  const meals = await db
    .select({
      id: mealPlanItems.id,
      whenAt: mealPlanItems.whenAt,
      whereAt: mealPlanItems.whereAt,
      what: mealPlanItems.what,
      assigneeUserId: mealPlanItems.assigneeUserId,
      assigneeName: users.name,
    })
    .from(mealPlanItems)
    .leftJoin(users, eq(users.id, mealPlanItems.assigneeUserId))
    .where(
      and(
        eq(mealPlanItems.teamId, me.teamId),
        eq(mealPlanItems.eventId, eventId),
      ),
    )
    .orderBy(asc(mealPlanItems.whenAt), asc(mealPlanItems.createdAt));

  // Documents for this event with their latest version + ack count
  const docRows = await db
    .select({
      id: documents.id,
      name: documents.name,
      category: documents.category,
      mustAcknowledge: documents.mustAcknowledge,
      latestVersionId: sql<string | null>`(SELECT id FROM ${documentVersions} v WHERE v.team_id = ${documents.teamId} AND v.document_id = ${documents.id} ORDER BY v.version_number DESC LIMIT 1)`,
      latestVersionNumber: sql<number | null>`(SELECT version_number FROM ${documentVersions} v WHERE v.team_id = ${documents.teamId} AND v.document_id = ${documents.id} ORDER BY v.version_number DESC LIMIT 1)::int`,
      latestUploadedAt: sql<Date | null>`(SELECT created_at FROM ${documentVersions} v WHERE v.team_id = ${documents.teamId} AND v.document_id = ${documents.id} ORDER BY v.version_number DESC LIMIT 1)`,
      myAckVersionId: sql<string | null>`(SELECT version_id FROM ${documentAcknowledgments} a WHERE a.team_id = ${documents.teamId} AND a.document_id = ${documents.id} AND a.user_id = ${me.userId} LIMIT 1)`,
      ackCount: sql<number>`COALESCE((SELECT COUNT(*)::int FROM ${documentAcknowledgments} a WHERE a.team_id = ${documents.teamId} AND a.document_id = ${documents.id} AND a.version_id = (SELECT id FROM ${documentVersions} v WHERE v.team_id = ${documents.teamId} AND v.document_id = ${documents.id} ORDER BY v.version_number DESC LIMIT 1)), 0)`,
    })
    .from(documents)
    .where(
      and(
        eq(documents.teamId, me.teamId),
        eq(documents.eventId, eventId),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(asc(documents.category), asc(documents.name));

  // Budget lines + expenses for this event
  const budgetRows = await db
    .select()
    .from(budgetLines)
    .where(
      and(
        eq(budgetLines.teamId, me.teamId),
        eq(budgetLines.eventId, eventId),
      ),
    )
    .orderBy(asc(budgetLines.category));
  const expenseRows = await db
    .select({
      id: expenseEntries.id,
      category: expenseEntries.category,
      amountCents: expenseEntries.amountCents,
      vendor: expenseEntries.vendor,
      expenseDate: expenseEntries.expenseDate,
      notes: expenseEntries.notes,
      enteredByName: users.name,
    })
    .from(expenseEntries)
    .innerJoin(users, eq(users.id, expenseEntries.enteredByUserId))
    .where(
      and(
        eq(expenseEntries.teamId, me.teamId),
        eq(expenseEntries.eventId, eventId),
      ),
    )
    .orderBy(asc(expenseEntries.expenseDate), asc(expenseEntries.createdAt));

  const variance = reconcile(
    budgetRows.map((b) => ({
      category: b.category,
      estimatedCents: b.estimatedCents,
    })),
    expenseRows.map((e) => ({
      category: e.category,
      amountCents: e.amountCents,
    })),
  );

  // Stages and recce schedule
  const stages = await db
    .select()
    .from(eventStages)
    .where(
      and(
        eq(eventStages.teamId, me.teamId),
        eq(eventStages.eventId, eventId),
      ),
    )
    .orderBy(asc(eventStages.stageNumber));

  // Distinct alias users for driver vs codriver joins
  const driverUsers = aliasedTable(users, "driver_users");
  const coDriverUsers = aliasedTable(users, "codriver_users");

  const recceRows = await db
    .select({
      id: recceScheduleEntries.id,
      stageId: recceScheduleEntries.stageId,
      stageNumber: eventStages.stageNumber,
      stageName: eventStages.name,
      day: recceScheduleEntries.day,
      passNumber: recceScheduleEntries.passNumber,
      driverUserId: recceScheduleEntries.driverUserId,
      driverName: driverUsers.name,
      coDriverUserId: recceScheduleEntries.coDriverUserId,
      coDriverName: coDriverUsers.name,
      notes: recceScheduleEntries.notes,
    })
    .from(recceScheduleEntries)
    .innerJoin(eventStages, eq(eventStages.id, recceScheduleEntries.stageId))
    .leftJoin(driverUsers, eq(driverUsers.id, recceScheduleEntries.driverUserId))
    .leftJoin(coDriverUsers, eq(coDriverUsers.id, recceScheduleEntries.coDriverUserId))
    .where(
      and(
        eq(recceScheduleEntries.teamId, me.teamId),
        eq(recceScheduleEntries.eventId, eventId),
      ),
    )
    .orderBy(
      asc(recceScheduleEntries.day),
      asc(eventStages.stageNumber),
      asc(recceScheduleEntries.passNumber),
    );

  // Per-vehicle checklist instances with completion stats
  const checklistRows = await db
    .select({
      id: checklistInstances.id,
      kind: checklistInstances.kind,
      name: checklistInstances.name,
      vehicleId: checklistInstances.vehicleId,
      vehicleName: vehicles.name,
      total: sql<number>`COALESCE((SELECT COUNT(*)::int FROM ${checklistInstanceItems} ii WHERE ii.team_id = ${checklistInstances.teamId} AND ii.instance_id = ${checklistInstances.id}), 0)`,
      signed: sql<number>`COALESCE((SELECT COUNT(*)::int FROM ${checklistSignoffs} s INNER JOIN ${checklistInstanceItems} ii ON ii.id = s.instance_item_id WHERE s.team_id = ${checklistInstances.teamId} AND ii.instance_id = ${checklistInstances.id}), 0)`,
    })
    .from(checklistInstances)
    .innerJoin(vehicles, eq(vehicles.id, checklistInstances.vehicleId))
    .where(
      and(
        eq(checklistInstances.teamId, me.teamId),
        eq(checklistInstances.eventId, eventId),
      ),
    )
    .orderBy(asc(vehicles.name), asc(checklistInstances.kind));

  const todoRows = await db
    .select({
      id: todos.id,
      title: todos.title,
      description: todos.description,
      assigneeUserId: todos.assigneeUserId,
      assigneeName: users.name,
      completedAt: todos.completedAt,
      completedByUserId: todos.completedByUserId,
    })
    .from(todos)
    .innerJoin(users, eq(users.id, todos.assigneeUserId))
    .where(
      me.role === "chief"
        ? and(eq(todos.teamId, me.teamId), eq(todos.eventId, eventId))
        : and(
            eq(todos.teamId, me.teamId),
            eq(todos.eventId, eventId),
            eq(todos.assigneeUserId, me.userId),
          ),
    )
    .orderBy(asc(todos.completedAt), asc(todos.createdAt));

  // ---- server actions ----

  async function advancePhase() {
    "use server";
    const u = await requireChief();
    const [current] = await db
      .select({ phase: events.phase })
      .from(events)
      .where(and(eq(events.id, eventId), eq(events.teamId, u.teamId)))
      .limit(1);
    if (!current) throw new Error("Event not found");
    const result = advance(current.phase, u.role);
    if (!result.ok) throw new Error(result.reason);
    await db
      .update(events)
      .set({ phase: result.phase, updatedAt: new Date() })
      .where(and(eq(events.id, eventId), eq(events.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
    revalidatePath("/events");
  }

  async function saveDebrief(formData: FormData) {
    "use server";
    const u = await requireChief();
    const notes = String(formData.get("debrief_notes") ?? "");
    await db
      .update(events)
      .set({ debriefNotes: notes, updatedAt: new Date() })
      .where(and(eq(events.id, eventId), eq(events.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  async function createTodo(formData: FormData) {
    "use server";
    const u = await requireChief();
    const title = String(formData.get("title") ?? "").trim();
    const description =
      String(formData.get("description") ?? "").trim() || null;
    const assigneeUserId = String(formData.get("assignee_user_id") ?? "");
    if (!title || !assigneeUserId) throw new Error("title and assignee required");
    await db.insert(todos).values({
      teamId: u.teamId,
      eventId,
      assigneeUserId,
      title,
      description,
    });
    revalidatePath(`/events/${eventId}`);
  }

  // ---- Order list actions ----
  async function addOrderItem(formData: FormData) {
    "use server";
    const u = await requireSession();
    const title = String(formData.get("title") ?? "").trim();
    const qty = Number.parseInt(String(formData.get("qty") ?? "1"), 10) || 1;
    const woRaw = String(formData.get("work_order_id") ?? "");
    const workOrderId = woRaw || null;
    if (!title) return;
    await db.insert(orderListItems).values({
      teamId: u.teamId,
      eventId,
      title,
      qty,
      workOrderId,
    });
    revalidatePath(`/events/${eventId}`);
  }

  async function setOrderStatus(formData: FormData) {
    "use server";
    const u = await requireSession();
    const id = String(formData.get("id") ?? "");
    const status = String(formData.get("status") ?? "") as OrderListStatus;
    if (!id || !["needed", "ordered", "received", "packed"].includes(status)) return;
    await db
      .update(orderListItems)
      .set({ status, updatedAt: new Date() })
      .where(and(eq(orderListItems.id, id), eq(orderListItems.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteOrderItem(formData: FormData) {
    "use server";
    const u = await requireSession();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(orderListItems)
      .where(and(eq(orderListItems.id, id), eq(orderListItems.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  // ---- Tire actions ----
  async function addTire(formData: FormData) {
    "use server";
    const u = await requireSession();
    const compound = String(formData.get("compound") ?? "").trim();
    const count = Number.parseInt(String(formData.get("count") ?? "4"), 10) || 4;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    if (!compound) return;
    await db.insert(tireNeeds).values({
      teamId: u.teamId,
      eventId,
      compound,
      count,
      notes,
    });
    revalidatePath(`/events/${eventId}`);
  }

  async function toggleTireFlag(formData: FormData) {
    "use server";
    const u = await requireSession();
    const id = String(formData.get("id") ?? "");
    const which = String(formData.get("which") ?? "");
    const isOn = String(formData.get("on") ?? "") === "1";
    if (!id || (which !== "ordered" && which !== "received")) return;
    const ts = isOn ? new Date() : null;
    if (which === "ordered") {
      await db
        .update(tireNeeds)
        .set({ orderedAt: ts, updatedAt: new Date() })
        .where(and(eq(tireNeeds.id, id), eq(tireNeeds.teamId, u.teamId)));
    } else {
      await db
        .update(tireNeeds)
        .set({ receivedAt: ts, updatedAt: new Date() })
        .where(and(eq(tireNeeds.id, id), eq(tireNeeds.teamId, u.teamId)));
    }
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteTire(formData: FormData) {
    "use server";
    const u = await requireSession();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(tireNeeds)
      .where(and(eq(tireNeeds.id, id), eq(tireNeeds.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  // ---- Itinerary actions ----
  async function addLeg(formData: FormData) {
    "use server";
    const u = await requireChief();
    const fromLocation = String(formData.get("from_location") ?? "").trim();
    const toLocation = String(formData.get("to_location") ?? "").trim();
    if (!fromLocation || !toLocation) throw new Error("from and to required");
    const vehicleRaw = String(formData.get("vehicle_id") ?? "");
    const vehicleId = vehicleRaw || null;
    const departRaw = String(formData.get("depart_at") ?? "");
    const arriveRaw = String(formData.get("arrive_at") ?? "");
    const notes = String(formData.get("notes") ?? "").trim() || null;
    const departAt = departRaw ? new Date(departRaw) : null;
    const arriveAt = arriveRaw ? new Date(arriveRaw) : null;

    const last = await db
      .select({ orderIndex: itineraryLegs.orderIndex })
      .from(itineraryLegs)
      .where(
        and(
          eq(itineraryLegs.teamId, u.teamId),
          eq(itineraryLegs.eventId, eventId),
        ),
      )
      .orderBy(asc(itineraryLegs.orderIndex));
    const next = last.length ? last[last.length - 1].orderIndex + 1 : 0;
    const [leg] = await db
      .insert(itineraryLegs)
      .values({
        teamId: u.teamId,
        eventId,
        orderIndex: next,
        fromLocation,
        toLocation,
        vehicleId,
        departAt,
        arriveAt,
        notes,
      })
      .returning();
    const assigneeIds = formData.getAll("assignee_user_id").map(String).filter(Boolean);
    if (assigneeIds.length > 0) {
      await db.insert(itineraryLegAssignees).values(
        assigneeIds.map((userId) => ({ teamId: u.teamId, legId: leg.id, userId })),
      );
    }
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteLeg(formData: FormData) {
    "use server";
    const u = await requireChief();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(itineraryLegs)
      .where(and(eq(itineraryLegs.id, id), eq(itineraryLegs.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  async function moveLeg(formData: FormData) {
    "use server";
    const u = await requireChief();
    const id = String(formData.get("id") ?? "");
    const dir = String(formData.get("dir") ?? "");
    if (!id || (dir !== "up" && dir !== "down")) return;
    const all = await db
      .select()
      .from(itineraryLegs)
      .where(
        and(
          eq(itineraryLegs.teamId, u.teamId),
          eq(itineraryLegs.eventId, eventId),
        ),
      )
      .orderBy(asc(itineraryLegs.orderIndex));
    const idx = all.findIndex((l) => l.id === id);
    if (idx === -1) return;
    const swapWith = dir === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= all.length) return;
    const a = all[idx];
    const b = all[swapWith];
    await db
      .update(itineraryLegs)
      .set({ orderIndex: b.orderIndex })
      .where(eq(itineraryLegs.id, a.id));
    await db
      .update(itineraryLegs)
      .set({ orderIndex: a.orderIndex })
      .where(eq(itineraryLegs.id, b.id));
    revalidatePath(`/events/${eventId}`);
  }

  // ---- Hotel actions ----
  async function addHotel(formData: FormData) {
    "use server";
    const u = await requireChief();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    const address = String(formData.get("address") ?? "").trim() || null;
    const confirmationNumber =
      String(formData.get("confirmation_number") ?? "").trim() || null;
    const checkInRaw = String(formData.get("check_in_date") ?? "").trim();
    const checkOutRaw = String(formData.get("check_out_date") ?? "").trim();
    const roomAssignments =
      String(formData.get("room_assignments") ?? "").trim() || null;
    const notes = String(formData.get("notes") ?? "").trim() || null;
    await db.insert(hotelBookings).values({
      teamId: u.teamId,
      eventId,
      name,
      address,
      confirmationNumber,
      checkInDate: checkInRaw || null,
      checkOutDate: checkOutRaw || null,
      roomAssignments,
      notes,
    });
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteHotel(formData: FormData) {
    "use server";
    const u = await requireChief();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(hotelBookings)
      .where(and(eq(hotelBookings.id, id), eq(hotelBookings.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  // ---- Meal plan actions ----
  async function addMeal(formData: FormData) {
    "use server";
    const u = await requireChief();
    const what = String(formData.get("what") ?? "").trim();
    if (!what) return;
    const whereAt = String(formData.get("where_at") ?? "").trim() || null;
    const whenRaw = String(formData.get("when_at") ?? "").trim();
    const assigneeRaw = String(formData.get("assignee_user_id") ?? "");
    await db.insert(mealPlanItems).values({
      teamId: u.teamId,
      eventId,
      what,
      whereAt,
      whenAt: whenRaw ? new Date(whenRaw) : null,
      assigneeUserId: assigneeRaw || null,
    });
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteMeal(formData: FormData) {
    "use server";
    const u = await requireChief();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(mealPlanItems)
      .where(and(eq(mealPlanItems.id, id), eq(mealPlanItems.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  // ---- Recce actions ----
  async function addStage(formData: FormData) {
    "use server";
    const u = await requireChief();
    const stageNumber = Number.parseInt(
      String(formData.get("stage_number") ?? ""),
      10,
    );
    const name = String(formData.get("name") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim() || null;
    if (!Number.isFinite(stageNumber) || !name) return;
    await db.insert(eventStages).values({
      teamId: u.teamId,
      eventId,
      stageNumber,
      name,
      notes,
    });
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteStage(formData: FormData) {
    "use server";
    const u = await requireChief();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(eventStages)
      .where(and(eq(eventStages.id, id), eq(eventStages.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  async function addRecceEntry(formData: FormData) {
    "use server";
    const u = await requireChief();
    const stageId = String(formData.get("stage_id") ?? "");
    const dayRaw = String(formData.get("day") ?? "").trim();
    const passNumber =
      Number.parseInt(String(formData.get("pass_number") ?? "1"), 10) || 1;
    const driverRaw = String(formData.get("driver_user_id") ?? "");
    const codriverRaw = String(formData.get("co_driver_user_id") ?? "");
    const notes = String(formData.get("notes") ?? "").trim() || null;
    if (!stageId) return;
    await db.insert(recceScheduleEntries).values({
      teamId: u.teamId,
      eventId,
      stageId,
      day: dayRaw || null,
      passNumber,
      driverUserId: driverRaw || null,
      coDriverUserId: codriverRaw || null,
      notes,
    });
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteRecceEntry(formData: FormData) {
    "use server";
    const u = await requireChief();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(recceScheduleEntries)
      .where(
        and(
          eq(recceScheduleEntries.id, id),
          eq(recceScheduleEntries.teamId, u.teamId),
        ),
      );
    revalidatePath(`/events/${eventId}`);
  }

  async function saveRecceLogistics(formData: FormData) {
    "use server";
    const u = await requireChief();
    const notes = String(formData.get("recce_logistics_notes") ?? "");
    await db
      .update(events)
      .set({ recceLogisticsNotes: notes, updatedAt: new Date() })
      .where(and(eq(events.id, eventId), eq(events.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  // ---- Budget actions ----

  async function upsertBudgetLine(formData: FormData) {
    "use server";
    const u = await requireChief();
    const category = String(formData.get("category") ?? "") as BudgetCategory;
    if (!ALL_BUDGET_CATEGORIES.includes(category)) return;
    const dollars = String(formData.get("amount") ?? "0");
    const estimatedCents = dollarsToCents(dollars);
    const notes = String(formData.get("notes") ?? "").trim() || null;

    // Upsert: one line per (team, event, category)
    const [existing] = await db
      .select({ id: budgetLines.id })
      .from(budgetLines)
      .where(
        and(
          eq(budgetLines.teamId, u.teamId),
          eq(budgetLines.eventId, eventId),
          eq(budgetLines.category, category),
        ),
      )
      .limit(1);
    if (existing) {
      await db
        .update(budgetLines)
        .set({ estimatedCents, notes, updatedAt: new Date() })
        .where(eq(budgetLines.id, existing.id));
    } else {
      await db.insert(budgetLines).values({
        teamId: u.teamId,
        eventId,
        category,
        estimatedCents,
        notes,
      });
    }
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteBudgetLine(formData: FormData) {
    "use server";
    const u = await requireChief();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    await db
      .delete(budgetLines)
      .where(and(eq(budgetLines.id, id), eq(budgetLines.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  async function addExpense(formData: FormData) {
    "use server";
    const u = await requireSession();
    const category = String(formData.get("category") ?? "") as BudgetCategory;
    if (!ALL_BUDGET_CATEGORIES.includes(category)) return;
    const dollars = String(formData.get("amount") ?? "0");
    const amountCents = dollarsToCents(dollars);
    if (amountCents <= 0) return;
    const vendor = String(formData.get("vendor") ?? "").trim() || null;
    const dateRaw = String(formData.get("expense_date") ?? "").trim();
    const notes = String(formData.get("notes") ?? "").trim() || null;
    await db.insert(expenseEntries).values({
      teamId: u.teamId,
      eventId,
      category,
      amountCents,
      vendor,
      expenseDate: dateRaw || null,
      notes,
      enteredByUserId: u.userId,
    });
    revalidatePath(`/events/${eventId}`);
  }

  async function deleteExpense(formData: FormData) {
    "use server";
    const u = await requireSession();
    const id = String(formData.get("id") ?? "");
    if (!id) return;
    // Anyone on the team can delete (lightweight; chief is the policy owner)
    await db
      .delete(expenseEntries)
      .where(and(eq(expenseEntries.id, id), eq(expenseEntries.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  // ---- Document upload ----
  async function uploadDocAction(formData: FormData) {
    "use server";
    const u = await requireSession();
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      throw new Error("Choose a file to upload");
    }
    const category = String(formData.get("category") ?? "") as DocumentCategory;
    if (!ALL_DOCUMENT_CATEGORIES.includes(category)) {
      throw new Error("invalid category");
    }
    const name = String(formData.get("name") ?? "").trim();
    if (!name) throw new Error("name required");
    const mustAck = String(formData.get("must_acknowledge") ?? "") === "on";

    const bytes = new Uint8Array(await file.arrayBuffer());
    await uploadDocument({
      teamId: u.teamId,
      userId: u.userId,
      eventId,
      category,
      name,
      mustAcknowledge: u.role === "chief" ? mustAck : false,
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      bytes,
    });
    revalidatePath(`/events/${eventId}`);
  }

  async function rebuildChecklists() {
    "use server";
    const u = await requireChief();
    await instantiateChecklistsForEvent(u.teamId, eventId);
    revalidatePath(`/events/${eventId}`);
  }

  async function completeTodo(formData: FormData) {
    "use server";
    const u = await requireSession();
    const todoId = String(formData.get("todo_id") ?? "");
    if (!todoId) return;
    const [t] = await db
      .select({ assigneeUserId: todos.assigneeUserId })
      .from(todos)
      .where(and(eq(todos.id, todoId), eq(todos.teamId, u.teamId)))
      .limit(1);
    if (!t) throw new Error("Todo not found");
    if (u.role !== "chief" && t.assigneeUserId !== u.userId) {
      throw new Error("You can only complete your own todos.");
    }
    await db
      .update(todos)
      .set({
        completedAt: new Date(),
        completedByUserId: u.userId,
        updatedAt: new Date(),
      })
      .where(and(eq(todos.id, todoId), eq(todos.teamId, u.teamId)));
    revalidatePath(`/events/${eventId}`);
  }

  const canAdvance = me.role === "chief" && event.phase !== "post_event";

  // % ready to ship across all packing instances on this event
  const packingRows = checklistRows.filter((r) => r.kind === "packing");
  const packingTotal = packingRows.reduce((n, r) => n + Number(r.total), 0);
  const packingSigned = packingRows.reduce((n, r) => n + Number(r.signed), 0);
  const readyPct =
    packingTotal === 0 ? null : Math.round((packingSigned / packingTotal) * 100);

  const ORDER_STATUSES: OrderListStatus[] = [
    "needed",
    "ordered",
    "received",
    "packed",
  ];

  return (
    <>
      <Nav user={me} />
      <main className="mx-auto max-w-4xl px-6 py-10">
        <header className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{event.name}</h1>
            <div className="rc-muted mt-1 text-sm">
              {event.eventDate} · {event.location}
              {event.araRoundNumber ? ` · ARA round ${event.araRoundNumber}` : ""}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {event.phase === "on_event" ? (
              <Link
                href={`/events/${eventId}/live`}
                className="rc-btn rc-btn-primary text-sm"
              >
                Live mode →
              </Link>
            ) : null}
            <Link
              href={`/events/${eventId}/tech-ready`}
              className="rc-link text-sm"
            >
              Tech-ready ↗
            </Link>
            {readyPct !== null ? (
              <span
                className={`rc-badge rc-badge-${readyPct === 100 ? "on_event" : readyPct === 0 ? "post_event" : "prep"}`}
                title="Ready to ship: signed packing items / total"
              >
                {readyPct}% ready
              </span>
            ) : null}
            <span className={`rc-badge rc-badge-${event.phase}`}>
              {event.phase.replace("_", " ")}
            </span>
            {canAdvance ? (
              <form action={advancePhase}>
                <button type="submit" className="rc-btn rc-btn-primary text-sm">
                  Advance phase →
                </button>
              </form>
            ) : null}
          </div>
        </header>

        <section className="rc-empty-section mb-10">
          {PHASE_HINT[event.phase]}
        </section>

        <section className="mb-10">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Itinerary</h2>
            <div className="flex items-center gap-3 text-xs">
              <Link
                href={`/events/${eventId}`}
                className={`rc-link ${!showOnlyMyLegs ? "underline" : ""}`}
              >
                All legs
              </Link>
              <span className="rc-muted">·</span>
              <Link
                href={`/events/${eventId}?legs=mine`}
                className={`rc-link ${showOnlyMyLegs ? "underline" : ""}`}
              >
                My legs
              </Link>
              <span className="rc-muted">·</span>
              <Link
                href={`/events/${eventId}/itinerary/print`}
                className="rc-link"
              >
                Print
              </Link>
            </div>
          </div>

          {me.role === "chief" ? (
            <form action={addLeg} className="rc-card mb-4 grid grid-cols-1 gap-2 sm:grid-cols-12">
              <input
                name="from_location"
                required
                placeholder="From (e.g., Shop)"
                className="rc-input sm:col-span-3"
              />
              <input
                name="to_location"
                required
                placeholder="To (e.g., Service park)"
                className="rc-input sm:col-span-3"
              />
              <select
                name="vehicle_id"
                defaultValue=""
                className="rc-select sm:col-span-2"
              >
                <option value="">Vehicle (opt)</option>
                {teamVehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              <input
                name="depart_at"
                type="datetime-local"
                className="rc-input sm:col-span-2"
                title="Depart"
              />
              <input
                name="arrive_at"
                type="datetime-local"
                className="rc-input sm:col-span-2"
                title="Arrive"
              />
              <select
                name="assignee_user_id"
                multiple
                defaultValue={[]}
                className="rc-select sm:col-span-6"
                size={Math.min(crew.length, 4)}
              >
                {crew.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input
                name="notes"
                placeholder="Notes (optional)"
                className="rc-input sm:col-span-4"
              />
              <button type="submit" className="rc-btn rc-btn-primary sm:col-span-2">
                Add leg
              </button>
            </form>
          ) : null}

          {(() => {
            const filtered = showOnlyMyLegs
              ? legs.filter((l) =>
                  (assigneesByLeg.get(l.id) ?? []).some(
                    (a) => a.userId === me.userId,
                  ),
                )
              : legs;
            if (filtered.length === 0) {
              return (
                <p className="rc-muted text-sm">
                  {showOnlyMyLegs
                    ? "You aren't on any legs."
                    : "No legs yet."}
                </p>
              );
            }
            return (
              <ul className="rc-list">
                {filtered.map((l, idx) => {
                  const ass = assigneesByLeg.get(l.id) ?? [];
                  return (
                    <li key={l.id} className="rc-list-row">
                      <div className="flex-1">
                        <div className="font-medium">
                          <span className="rc-muted mr-2 font-mono text-xs">
                            {idx + 1}.
                          </span>
                          {l.fromLocation} → {l.toLocation}
                          {l.vehicleName ? (
                            <span className="rc-muted text-sm"> · {l.vehicleName}</span>
                          ) : null}
                        </div>
                        <div className="rc-muted mt-0.5 text-sm">
                          {l.departAt
                            ? `Dep ${l.departAt.toISOString().replace("T", " ").slice(0, 16)}`
                            : "—"}
                          {" → "}
                          {l.arriveAt
                            ? `Arr ${l.arriveAt.toISOString().replace("T", " ").slice(0, 16)}`
                            : "—"}
                        </div>
                        {ass.length > 0 ? (
                          <div className="rc-muted mt-1 text-xs">
                            Crew: {ass.map((a) => a.userName).join(", ")}
                          </div>
                        ) : null}
                        {l.notes ? (
                          <div className="rc-muted mt-1 text-xs">{l.notes}</div>
                        ) : null}
                      </div>
                      {me.role === "chief" ? (
                        <div className="flex items-center gap-1">
                          <form action={moveLeg}>
                            <input type="hidden" name="id" value={l.id} />
                            <input type="hidden" name="dir" value="up" />
                            <button
                              type="submit"
                              disabled={idx === 0 && !showOnlyMyLegs}
                              className="rc-btn rc-btn-ghost px-2 py-1 text-xs disabled:opacity-30"
                            >
                              ↑
                            </button>
                          </form>
                          <form action={moveLeg}>
                            <input type="hidden" name="id" value={l.id} />
                            <input type="hidden" name="dir" value="down" />
                            <button
                              type="submit"
                              className="rc-btn rc-btn-ghost px-2 py-1 text-xs"
                            >
                              ↓
                            </button>
                          </form>
                          <form action={deleteLeg}>
                            <input type="hidden" name="id" value={l.id} />
                            <button
                              type="submit"
                              className="rc-btn rc-btn-danger px-2 py-1 text-xs"
                            >
                              ×
                            </button>
                          </form>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            );
          })()}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Documents</h2>
          {!isStorageConfigured() ? (
            <div className="rc-card mb-4 border-amber-500/30 bg-amber-500/10 text-sm text-amber-700 dark:text-amber-300">
              File storage isn&apos;t configured yet (R2_* env vars missing).
              Documents you upload will fail until the chief sets the secrets.
            </div>
          ) : null}
          <form
            action={uploadDocAction}
            className="rc-card mb-4 grid grid-cols-1 gap-2 sm:grid-cols-12"
            encType="multipart/form-data"
          >
            <input
              name="file"
              type="file"
              required
              accept="application/pdf,text/plain,image/*,.gpx,.xml"
              className="rc-input sm:col-span-4"
            />
            <input
              name="name"
              required
              placeholder="Logical name (e.g., Bulletin 1)"
              className="rc-input sm:col-span-3"
            />
            <select
              name="category"
              required
              defaultValue=""
              className="rc-select sm:col-span-2"
            >
              <option value="" disabled>
                Category…
              </option>
              {ALL_DOCUMENT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {DOCUMENT_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            {me.role === "chief" ? (
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" name="must_acknowledge" />
                Must ack
              </label>
            ) : (
              <span className="rc-muted text-xs sm:col-span-2">
                {/* placeholder so grid stays balanced */}
              </span>
            )}
            <button type="submit" className="rc-btn rc-btn-primary sm:col-span-1">
              Upload
            </button>
          </form>
          {docRows.length === 0 ? (
            <p className="rc-muted text-sm">No documents uploaded yet.</p>
          ) : (
            <ul className="rc-list">
              {docRows.map((d) => {
                const myAckIsCurrent =
                  d.myAckVersionId && d.myAckVersionId === d.latestVersionId;
                const needsAck = d.mustAcknowledge && !myAckIsCurrent;
                return (
                  <li key={d.id} className="rc-list-row">
                    <div className="flex-1">
                      <Link
                        href={`/documents/${d.id}`}
                        className="rc-link font-medium"
                      >
                        {d.name}
                      </Link>
                      <div className="rc-muted text-sm">
                        {DOCUMENT_CATEGORY_LABEL[d.category]} · v
                        {d.latestVersionNumber ?? "?"} · uploaded{" "}
                        {d.latestUploadedAt
                          ? d.latestUploadedAt.toISOString().slice(0, 10)
                          : "—"}
                      </div>
                    </div>
                    {needsAck ? (
                      <span className="rc-badge rc-badge-post_event">Needs ack</span>
                    ) : d.mustAcknowledge ? (
                      <span className="rc-badge rc-badge-on_event">Acked</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Budget</h2>
            <div className="text-sm">
              <span className="rc-muted">Est </span>
              <span className="font-medium">
                {formatCents(variance.totalEstimatedCents)}
              </span>
              <span className="rc-muted"> · Actual </span>
              <span className="font-medium">
                {formatCents(variance.totalActualCents)}
              </span>
              <span className="rc-muted"> · Variance </span>
              <span
                className={
                  variance.totalVarianceCents < 0
                    ? "font-semibold text-rose-600 dark:text-rose-400"
                    : "font-semibold text-emerald-600 dark:text-emerald-400"
                }
              >
                {formatCents(variance.totalVarianceCents)}
              </span>
            </div>
          </div>

          {me.role === "chief" ? (
            <form
              action={upsertBudgetLine}
              className="rc-card mb-3 grid grid-cols-1 gap-2 sm:grid-cols-12"
            >
              <select
                name="category"
                required
                defaultValue=""
                className="rc-select sm:col-span-3"
              >
                <option value="" disabled>
                  Category…
                </option>
                {ALL_BUDGET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {BUDGET_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
              <input
                name="amount"
                type="number"
                min={0}
                step="0.01"
                required
                placeholder="Estimated $ (e.g., 350.00)"
                className="rc-input sm:col-span-3"
              />
              <input
                name="notes"
                placeholder="Notes (optional)"
                className="rc-input sm:col-span-4"
              />
              <button type="submit" className="rc-btn rc-btn-primary sm:col-span-2">
                Set budget
              </button>
            </form>
          ) : null}

          {variance.byCategory.length === 0 ? (
            <p className="rc-muted mb-4 text-sm">
              No budget set and no expenses yet.
            </p>
          ) : (
            <ul className="rc-list mb-4">
              {variance.byCategory.map((c) => {
                const matchingLine = budgetRows.find(
                  (b) => b.category === c.category,
                );
                return (
                  <li key={c.category} className="rc-list-row">
                    <div className="flex-1">
                      <div className="font-medium">
                        {BUDGET_CATEGORY_LABEL[c.category]}
                      </div>
                      <div className="rc-muted text-sm">
                        Est {formatCents(c.estimatedCents)} · Actual{" "}
                        {formatCents(c.actualCents)}
                      </div>
                    </div>
                    <span
                      className={`rc-badge rc-badge-${
                        c.status === "over"
                          ? "post_event"
                          : c.status === "no_budget"
                          ? "post_event"
                          : c.status === "no_actuals"
                          ? "planning"
                          : c.status === "on_budget"
                          ? "prep"
                          : "on_event"
                      }`}
                      title={c.status}
                    >
                      {formatCents(c.varianceCents)}
                    </span>
                    {me.role === "chief" && matchingLine ? (
                      <form action={deleteBudgetLine}>
                        <input type="hidden" name="id" value={matchingLine.id} />
                        <button
                          type="submit"
                          className="rc-btn rc-btn-danger px-2 py-1 text-xs"
                          title="Remove this budget line"
                        >
                          ×
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}

          <h3 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide rc-muted">
            Log an expense
          </h3>
          <form
            action={addExpense}
            className="rc-card mb-3 grid grid-cols-1 gap-2 sm:grid-cols-12"
          >
            <select
              name="category"
              required
              defaultValue=""
              className="rc-select sm:col-span-2"
            >
              <option value="" disabled>
                Category…
              </option>
              {ALL_BUDGET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {BUDGET_CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <input
              name="amount"
              type="number"
              min={0}
              step="0.01"
              required
              placeholder="$ amount"
              className="rc-input sm:col-span-2"
            />
            <input
              name="vendor"
              placeholder="Vendor"
              className="rc-input sm:col-span-3"
            />
            <input
              name="expense_date"
              type="date"
              className="rc-input sm:col-span-2"
            />
            <input
              name="notes"
              placeholder="Notes"
              className="rc-input sm:col-span-2"
            />
            <button type="submit" className="rc-btn rc-btn-primary sm:col-span-1">
              Log
            </button>
          </form>

          {expenseRows.length === 0 ? (
            <p className="rc-muted text-sm">No expenses logged yet.</p>
          ) : (
            <ul className="rc-list">
              {expenseRows.map((e) => (
                <li key={e.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">
                      {formatCents(e.amountCents)} ·{" "}
                      {BUDGET_CATEGORY_LABEL[e.category]}
                      {e.vendor ? (
                        <span className="rc-muted text-sm"> · {e.vendor}</span>
                      ) : null}
                    </div>
                    <div className="rc-muted text-xs">
                      {e.expenseDate ?? "—"} · entered by {e.enteredByName}
                      {e.notes ? ` · ${e.notes}` : ""}
                    </div>
                  </div>
                  <form action={deleteExpense}>
                    <input type="hidden" name="id" value={e.id} />
                    <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold tracking-tight">Recce</h2>
            <Link
              href={`/events/${eventId}/recce/print`}
              className="rc-link text-xs"
            >
              Print
            </Link>
          </div>

          {me.role === "chief" ? (
            <form
              action={addStage}
              className="rc-card mb-3 grid grid-cols-1 gap-2 sm:grid-cols-12"
            >
              <input
                name="stage_number"
                type="number"
                min={1}
                required
                placeholder="#"
                className="rc-input sm:col-span-1"
              />
              <input
                name="name"
                required
                placeholder="Stage name (e.g., 'Lulu')"
                className="rc-input sm:col-span-5"
              />
              <input
                name="notes"
                placeholder="Notes (length, gravel/tarmac, etc.)"
                className="rc-input sm:col-span-4"
              />
              <button type="submit" className="rc-btn rc-btn-primary sm:col-span-2">
                Add stage
              </button>
            </form>
          ) : null}

          {stages.length === 0 ? (
            <p className="rc-muted mb-4 text-sm">
              No stages defined yet.{" "}
              {me.role === "chief"
                ? "Add the first one above."
                : "Your chief hasn't added stages."}
            </p>
          ) : (
            <ul className="rc-list mb-4">
              {stages.map((s) => (
                <li key={s.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">
                      <span className="rc-muted mr-2 font-mono text-xs">
                        SS{s.stageNumber}
                      </span>
                      {s.name}
                    </div>
                    {s.notes ? (
                      <div className="rc-muted mt-0.5 text-sm">{s.notes}</div>
                    ) : null}
                  </div>
                  {me.role === "chief" ? (
                    <form action={deleteStage}>
                      <input type="hidden" name="id" value={s.id} />
                      <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                        ×
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {stages.length > 0 ? (
            <>
              <h3 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide rc-muted">
                Recce schedule
              </h3>
              {me.role === "chief" ? (
                <form
                  action={addRecceEntry}
                  className="rc-card mb-3 grid grid-cols-1 gap-2 sm:grid-cols-12"
                >
                  <select
                    name="stage_id"
                    required
                    defaultValue=""
                    className="rc-select sm:col-span-3"
                  >
                    <option value="" disabled>
                      Stage…
                    </option>
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        SS{s.stageNumber} — {s.name}
                      </option>
                    ))}
                  </select>
                  <input
                    name="day"
                    type="date"
                    className="rc-input sm:col-span-2"
                    title="Day"
                  />
                  <input
                    name="pass_number"
                    type="number"
                    min={1}
                    defaultValue={1}
                    className="rc-input sm:col-span-1"
                    title="Pass #"
                  />
                  <select
                    name="driver_user_id"
                    defaultValue=""
                    className="rc-select sm:col-span-2"
                  >
                    <option value="">Driver…</option>
                    {crew.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    name="co_driver_user_id"
                    defaultValue=""
                    className="rc-select sm:col-span-2"
                  >
                    <option value="">Co-driver…</option>
                    {crew.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <button type="submit" className="rc-btn rc-btn-primary sm:col-span-2">
                    Add entry
                  </button>
                  <input
                    name="notes"
                    placeholder="Notes (optional)"
                    className="rc-input sm:col-span-12"
                  />
                </form>
              ) : null}
              {recceRows.length === 0 ? (
                <p className="rc-muted text-sm">No recce passes scheduled.</p>
              ) : (
                <ul className="rc-list mb-4">
                  {recceRows.map((r) => (
                    <li key={r.id} className="rc-list-row">
                      <div className="flex-1">
                        <div className="font-medium">
                          <span className="rc-muted mr-2 font-mono text-xs">
                            SS{r.stageNumber}
                          </span>
                          {r.stageName}
                          <span className="rc-muted ml-2 text-xs">
                            · pass {r.passNumber}
                          </span>
                        </div>
                        <div className="rc-muted mt-0.5 text-sm">
                          {r.day ?? "—"}
                          {" · "}
                          {r.driverName ? `Driver: ${r.driverName}` : "Driver TBD"}
                          {" · "}
                          {r.coDriverName
                            ? `Co: ${r.coDriverName}`
                            : "Co TBD"}
                        </div>
                        {r.notes ? (
                          <div className="rc-muted mt-1 text-xs">{r.notes}</div>
                        ) : null}
                      </div>
                      {me.role === "chief" ? (
                        <form action={deleteRecceEntry}>
                          <input type="hidden" name="id" value={r.id} />
                          <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                            ×
                          </button>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          <h3 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide rc-muted">
            Recce logistics notes
          </h3>
          {me.role === "chief" ? (
            <form action={saveRecceLogistics} className="rc-card flex flex-col gap-2">
              <textarea
                name="recce_logistics_notes"
                defaultValue={event.recceLogisticsNotes ?? ""}
                rows={4}
                placeholder="Fuel stops, lunch, transit times between stages…"
                className="rc-textarea"
              />
              <button type="submit" className="rc-btn rc-btn-ghost self-start text-sm">
                Save logistics
              </button>
            </form>
          ) : (
            <div className="rc-card whitespace-pre-wrap text-sm">
              {event.recceLogisticsNotes ?? (
                <span className="rc-muted">No logistics notes yet.</span>
              )}
            </div>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Hotels</h2>
          {me.role === "chief" ? (
            <form action={addHotel} className="rc-card mb-4 grid grid-cols-1 gap-2 sm:grid-cols-12">
              <input
                name="name"
                required
                placeholder="Hotel name"
                className="rc-input sm:col-span-4"
              />
              <input
                name="address"
                placeholder="Address"
                className="rc-input sm:col-span-4"
              />
              <input
                name="confirmation_number"
                placeholder="Confirmation #"
                className="rc-input sm:col-span-2"
              />
              <input
                name="check_in_date"
                type="date"
                className="rc-input sm:col-span-1"
                title="Check in"
              />
              <input
                name="check_out_date"
                type="date"
                className="rc-input sm:col-span-1"
                title="Check out"
              />
              <input
                name="room_assignments"
                placeholder="Rooms (e.g., 'Rm 12 — chief+codriver, Rm 14 — mech')"
                className="rc-input sm:col-span-8"
              />
              <input
                name="notes"
                placeholder="Notes"
                className="rc-input sm:col-span-2"
              />
              <button type="submit" className="rc-btn rc-btn-primary sm:col-span-2">
                Add
              </button>
            </form>
          ) : null}
          {hotels.length === 0 ? (
            <p className="rc-muted text-sm">No hotel bookings yet.</p>
          ) : (
            <ul className="rc-list">
              {hotels.map((h) => (
                <li key={h.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">{h.name}</div>
                    <div className="rc-muted text-sm">
                      {h.address ?? ""}
                      {h.address && h.confirmationNumber ? " · " : ""}
                      {h.confirmationNumber ? `Conf ${h.confirmationNumber}` : ""}
                    </div>
                    <div className="rc-muted text-xs">
                      {h.checkInDate ? `In ${h.checkInDate}` : ""}
                      {h.checkInDate && h.checkOutDate ? " · " : ""}
                      {h.checkOutDate ? `Out ${h.checkOutDate}` : ""}
                    </div>
                    {h.roomAssignments ? (
                      <div className="mt-1 text-sm">{h.roomAssignments}</div>
                    ) : null}
                    {h.notes ? (
                      <div className="rc-muted mt-1 text-xs">{h.notes}</div>
                    ) : null}
                  </div>
                  {me.role === "chief" ? (
                    <form action={deleteHotel}>
                      <input type="hidden" name="id" value={h.id} />
                      <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                        ×
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">Meal plan</h2>
          {me.role === "chief" ? (
            <form action={addMeal} className="rc-card mb-4 grid grid-cols-1 gap-2 sm:grid-cols-12">
              <input
                name="when_at"
                type="datetime-local"
                className="rc-input sm:col-span-3"
              />
              <input
                name="where_at"
                placeholder="Where (e.g., Service truck)"
                className="rc-input sm:col-span-3"
              />
              <input
                name="what"
                required
                placeholder="What (e.g., Sandwiches & coffee)"
                className="rc-input sm:col-span-3"
              />
              <select
                name="assignee_user_id"
                defaultValue=""
                className="rc-select sm:col-span-2"
              >
                <option value="">Who&apos;s bringing it</option>
                {crew.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button type="submit" className="rc-btn rc-btn-primary sm:col-span-1">
                Add
              </button>
            </form>
          ) : null}
          {meals.length === 0 ? (
            <p className="rc-muted text-sm">No meals planned yet.</p>
          ) : (
            <ul className="rc-list">
              {meals.map((m) => (
                <li key={m.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">{m.what}</div>
                    <div className="rc-muted text-sm">
                      {m.whenAt
                        ? m.whenAt.toISOString().replace("T", " ").slice(0, 16)
                        : ""}
                      {m.whenAt && m.whereAt ? " · " : ""}
                      {m.whereAt ?? ""}
                    </div>
                    {m.assigneeName ? (
                      <div className="rc-muted text-xs">
                        {m.assigneeName} brings it
                      </div>
                    ) : null}
                  </div>
                  {me.role === "chief" ? (
                    <form action={deleteMeal}>
                      <input type="hidden" name="id" value={m.id} />
                      <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                        ×
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            Parts to order
          </h2>
          <form
            action={addOrderItem}
            className="rc-card mb-4 grid grid-cols-1 gap-2 sm:grid-cols-12"
          >
            <input
              name="title"
              required
              placeholder="Part (e.g., Front strut)"
              className="rc-input sm:col-span-5"
            />
            <input
              name="qty"
              type="number"
              min={1}
              defaultValue={1}
              className="rc-input sm:col-span-1"
            />
            <select
              name="work_order_id"
              defaultValue=""
              className="rc-select sm:col-span-4"
            >
              <option value="">Linked WO (optional)</option>
              {openWosForLink.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.vehicleName} · {w.title}
                </option>
              ))}
            </select>
            <button type="submit" className="rc-btn rc-btn-primary sm:col-span-2">
              Add
            </button>
          </form>
          {orderListRows.length === 0 ? (
            <p className="rc-muted text-sm">No parts to order yet.</p>
          ) : (
            <ul className="rc-list">
              {orderListRows.map((it) => (
                <li key={it.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">
                      {it.qty}× {it.title}
                    </div>
                    {it.workOrderTitle ? (
                      <div className="rc-muted text-xs">
                        For {it.vehicleName} · {it.workOrderTitle}
                      </div>
                    ) : null}
                  </div>
                  <form action={setOrderStatus} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={it.id} />
                    <select
                      name="status"
                      defaultValue={it.status}
                      className="rc-select py-1 text-sm"
                    >
                      {ORDER_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="rc-btn rc-btn-ghost text-xs">
                      Save
                    </button>
                  </form>
                  <form action={deleteOrderItem}>
                    <input type="hidden" name="id" value={it.id} />
                    <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            Tires needed
          </h2>
          <form
            action={addTire}
            className="rc-card mb-4 grid grid-cols-1 gap-2 sm:grid-cols-12"
          >
            <input
              name="compound"
              required
              placeholder="Compound (e.g., DMACK Gravel Hard)"
              className="rc-input sm:col-span-5"
            />
            <input
              name="count"
              type="number"
              min={1}
              defaultValue={4}
              className="rc-input sm:col-span-1"
            />
            <input
              name="notes"
              placeholder="Notes"
              className="rc-input sm:col-span-4"
            />
            <button type="submit" className="rc-btn rc-btn-primary sm:col-span-2">
              Add
            </button>
          </form>
          {tireRows.length === 0 ? (
            <p className="rc-muted text-sm">No tires logged yet.</p>
          ) : (
            <ul className="rc-list">
              {tireRows.map((t) => (
                <li key={t.id} className="rc-list-row">
                  <div className="flex-1">
                    <div className="font-medium">
                      {t.count}× {t.compound}
                    </div>
                    {t.notes ? (
                      <div className="rc-muted text-xs">{t.notes}</div>
                    ) : null}
                    <div className="rc-muted mt-0.5 text-xs">
                      {t.orderedAt
                        ? `Ordered ${t.orderedAt.toISOString().slice(0, 10)}`
                        : "Not ordered"}
                      {" · "}
                      {t.receivedAt
                        ? `Received ${t.receivedAt.toISOString().slice(0, 10)}`
                        : "Not received"}
                    </div>
                  </div>
                  <form action={toggleTireFlag}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="which" value="ordered" />
                    <input type="hidden" name="on" value={t.orderedAt ? "0" : "1"} />
                    <button type="submit" className="rc-btn rc-btn-ghost text-xs">
                      {t.orderedAt ? "Un-order" : "Mark ordered"}
                    </button>
                  </form>
                  <form action={toggleTireFlag}>
                    <input type="hidden" name="id" value={t.id} />
                    <input type="hidden" name="which" value="received" />
                    <input type="hidden" name="on" value={t.receivedAt ? "0" : "1"} />
                    <button type="submit" className="rc-btn rc-btn-ghost text-xs">
                      {t.receivedAt ? "Un-receive" : "Mark received"}
                    </button>
                  </form>
                  <form action={deleteTire}>
                    <input type="hidden" name="id" value={t.id} />
                    <button type="submit" className="rc-btn rc-btn-danger px-2 py-1 text-xs">
                      ×
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Checklists</h2>
            {me.role === "chief" ? (
              <form action={rebuildChecklists}>
                <button type="submit" className="rc-btn rc-btn-ghost text-xs">
                  Rebuild from templates
                </button>
              </form>
            ) : null}
          </div>
          {checklistRows.length === 0 ? (
            <p className="rc-muted text-sm">
              No checklists. Add items to a vehicle template, then rebuild.
            </p>
          ) : (
            <ul className="rc-list">
              {checklistRows.map((c) => {
                const total = Number(c.total);
                const signed = Number(c.signed);
                const pct =
                  total === 0 ? 100 : Math.round((signed / total) * 100);
                return (
                  <li key={c.id} className="rc-list-row">
                    <div className="flex-1">
                      <Link
                        href={`/checklists/${c.id}`}
                        className="rc-link font-medium"
                      >
                        {c.vehicleName} · {KIND_LABEL[c.kind]}
                      </Link>
                      <div className="rc-muted text-sm">
                        {signed} of {total} signed off
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[color:var(--border)]">
                        <div
                          className="h-full rounded-full bg-[color:var(--accent)]"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                    <span
                      className={`rc-badge rc-badge-${pct === 100 ? "on_event" : pct === 0 ? "post_event" : "prep"}`}
                    >
                      {pct}%
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="mb-10">
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            {me.role === "chief" ? "Event todos" : "My todos"}
          </h2>

          {me.role === "chief" ? (
            <form
              action={createTodo}
              className="rc-card mb-4 grid grid-cols-1 gap-2 sm:grid-cols-12"
            >
              <input
                name="title"
                required
                placeholder="What needs doing?"
                className="rc-input sm:col-span-5"
              />
              <input
                name="description"
                placeholder="Description (optional)"
                className="rc-input sm:col-span-4"
              />
              <select
                name="assignee_user_id"
                required
                className="rc-select sm:col-span-2"
                defaultValue=""
              >
                <option value="" disabled>
                  Assign to…
                </option>
                {crew.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="rc-btn rc-btn-primary sm:col-span-1"
              >
                Add
              </button>
            </form>
          ) : null}

          {todoRows.length === 0 ? (
            <p className="rc-muted text-sm">No todos.</p>
          ) : (
            <ul className="rc-list">
              {todoRows.map((t) => {
                const canComplete =
                  !t.completedAt &&
                  (me.role === "chief" || t.assigneeUserId === me.userId);
                return (
                  <li key={t.id} className="rc-list-row">
                    <div>
                      <div
                        className={
                          t.completedAt
                            ? "line-through decoration-[var(--muted)] text-[color:var(--muted)]"
                            : "font-medium"
                        }
                      >
                        {t.title}
                      </div>
                      {t.description ? (
                        <div className="rc-muted mt-0.5 text-sm">
                          {t.description}
                        </div>
                      ) : null}
                      <div className="rc-muted mt-1 text-xs">
                        Assigned to {t.assigneeName}
                        {t.completedAt
                          ? ` · done ${t.completedAt.toISOString().slice(0, 10)}`
                          : ""}
                      </div>
                    </div>
                    {canComplete ? (
                      <form action={completeTodo}>
                        <input type="hidden" name="todo_id" value={t.id} />
                        <button type="submit" className="rc-btn rc-btn-ghost text-sm">
                          Mark done
                        </button>
                      </form>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h2 className="mb-4 text-lg font-semibold tracking-tight">
            Post-event debrief
          </h2>
          {me.role === "chief" ? (
            <form action={saveDebrief} className="rc-card flex flex-col gap-3">
              <textarea
                name="debrief_notes"
                defaultValue={event.debriefNotes ?? ""}
                placeholder="What went well, what didn't, lessons for next event."
                rows={6}
                className="rc-textarea"
              />
              <button type="submit" className="rc-btn rc-btn-primary self-start">
                Save debrief
              </button>
            </form>
          ) : (
            <div className="rc-card whitespace-pre-wrap text-sm">
              {event.debriefNotes ?? (
                <span className="rc-muted">No debrief yet.</span>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
