import {
  boolean,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

// ---------- enums ----------

export const userRoleEnum = pgEnum("user_role", [
  "chief",
  "lead_mechanic",
  "assistant",
  "gopher",
  "co_driver",
  "driver",
]);

export const eventPhaseEnum = pgEnum("event_phase", [
  "planning",
  "prep",
  "on_event",
  "post_event",
]);

export const vehicleTypeEnum = pgEnum("vehicle_type", [
  "rally_car",
  "service_truck",
  "trailer",
]);

export const workOrderStatusEnum = pgEnum("work_order_status", [
  "open",
  "in_progress",
  "done",
]);

export const checklistKindEnum = pgEnum("checklist_kind", [
  "pre_event_inspection",
  "post_event_teardown",
  "packing",
]);

export const orderListStatusEnum = pgEnum("order_list_status", [
  "needed",
  "ordered",
  "received",
  "packed",
]);

export const budgetCategoryEnum = pgEnum("budget_category", [
  "entry",
  "fuel",
  "parts",
  "hotels",
  "food",
  "transport",
  "other",
]);

export const documentCategoryEnum = pgEnum("document_category", [
  "entry_form",
  "supp_regs",
  "bulletin",
  "schedule",
  "roadbook",
  "gpx",
  "receipt",
  "other",
]);

export const safetyItemTypeEnum = pgEnum("safety_item_type", [
  "helmet",
  "hans",
  "suit",
  "harness",
  "fuel_cell",
  "fire_extinguisher",
  "other",
]);

export const licenseKindEnum = pgEnum("license_kind", [
  "ara",
  "fia",
  "medical",
]);

export const equipmentCategoryEnum = pgEnum("equipment_category", [
  "service_tool",
  "comms",
  "filming",
  "other",
]);

export const crewStatusEnum = pgEnum("crew_status", [
  "at_service",
  "paddock",
  "parts_run",
  "hotel",
  "recce",
  "other",
]);

export const notificationChannelEnum = pgEnum("notification_channel", [
  "email",
  "sms",
]);

export const notificationKindEnum = pgEnum("notification_kind", [
  "digest",
  "expiry_alert",
  "bulletin",
  "manual",
]);

export const notificationStatusEnum = pgEnum("notification_status", [
  "pending",
  "sent",
  "failed",
]);

// ---------- domain ----------

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull(),
    /** E.164 phone (e.g., +15551234567). Optional. Used for Twilio SMS. */
    phoneNumber: text("phone_number"),
    /** SMS opt-in (default true). Email digest is mandatory while account active. */
    smsOptIn: boolean("sms_opt_in").notNull().default(true),
    // Auth.js adapter columns (single user record per person):
    emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
    image: text("image"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUniq: uniqueIndex("users_team_email_uniq").on(t.teamId, t.email),
    teamIdx: index("users_team_idx").on(t.teamId),
  }),
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    eventDate: date("event_date").notNull(),
    location: text("location").notNull(),
    araRoundNumber: integer("ara_round_number"),
    phase: eventPhaseEnum("phase").notNull().default("planning"),
    debriefNotes: text("debrief_notes"),
    recceLogisticsNotes: text("recce_logistics_notes"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("events_team_idx").on(t.teamId),
  }),
);

export const todos = pgTable(
  "todos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    assigneeUserId: uuid("assignee_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByUserId: uuid("completed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamEventIdx: index("todos_team_event_idx").on(t.teamId, t.eventId),
    teamAssigneeIdx: index("todos_team_assignee_idx").on(
      t.teamId,
      t.assigneeUserId,
      t.completedAt,
    ),
  }),
);

// ---------- Phase 2: vehicles & work orders ----------

export const vehicles = pgTable(
  "vehicles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    type: vehicleTypeEnum("type").notNull(),
    name: text("name").notNull(),
    year: integer("year"),
    make: text("make"),
    model: text("model"),
    vin: text("vin"),
    plate: text("plate"),
    notes: text("notes"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("vehicles_team_idx").on(t.teamId),
  }),
);

export const workOrders = pgTable(
  "work_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    status: workOrderStatusEnum("status").notNull().default("open"),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    openedByUserId: uuid("opened_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Driver-report metadata: when a driver enters a condition note after a
    // stage, a draft work order is auto-created with these set.
    driverReportStageNumber: integer("driver_report_stage_number"),
    eventId: uuid("event_id").references(() => events.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByUserId: uuid("closed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("work_orders_team_idx").on(t.teamId),
    vehicleIdx: index("work_orders_vehicle_idx").on(t.teamId, t.vehicleId),
    statusIdx: index("work_orders_status_idx").on(t.teamId, t.status),
  }),
);

// Append-only thread of notes + status transitions on a work order.
// Status transitions are recorded with `statusTo` set; pure notes leave it null.
export const workOrderNotes = pgTable(
  "work_order_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    workOrderId: uuid("work_order_id")
      .notNull()
      .references(() => workOrders.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    statusTo: workOrderStatusEnum("status_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamWoIdx: index("work_order_notes_team_wo_idx").on(t.teamId, t.workOrderId),
  }),
);

// ---------- Phase 3: checklists ----------
//
// Templates are reusable per (vehicle, kind). Items are ordered.
// On event creation (or manual rebuild), each template materializes into a
// snapshot ChecklistInstance with a copy of its items. Sign-offs reference
// instance_items so historical state is preserved even if the template later
// changes or the vehicle is removed.

export const checklistTemplates = pgTable(
  "checklist_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    kind: checklistKindEnum("kind").notNull(),
    name: text("name").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("checklist_templates_team_idx").on(t.teamId),
    vehicleKindUniq: uniqueIndex("checklist_templates_vehicle_kind_uniq").on(
      t.teamId,
      t.vehicleId,
      t.kind,
    ),
  }),
);

export const checklistTemplateItems = pgTable(
  "checklist_template_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    templateId: uuid("template_id")
      .notNull()
      .references(() => checklistTemplates.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    label: text("label").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    templateIdx: index("checklist_template_items_template_idx").on(
      t.teamId,
      t.templateId,
      t.orderIndex,
    ),
  }),
);

export const checklistInstances = pgTable(
  "checklist_instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    kind: checklistKindEnum("kind").notNull(),
    name: text("name").notNull(),
    sourceTemplateId: uuid("source_template_id").references(
      () => checklistTemplates.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventVehicleKindUniq: uniqueIndex("checklist_instances_event_vehicle_kind_uniq").on(
      t.teamId,
      t.eventId,
      t.vehicleId,
      t.kind,
    ),
  }),
);

export const checklistInstanceItems = pgTable(
  "checklist_instance_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => checklistInstances.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    label: text("label").notNull(),
    description: text("description"),
  },
  (t) => ({
    instanceIdx: index("checklist_instance_items_instance_idx").on(
      t.teamId,
      t.instanceId,
      t.orderIndex,
    ),
  }),
);

export const checklistSignoffs = pgTable(
  "checklist_signoffs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    instanceItemId: uuid("instance_item_id")
      .notNull()
      .references(() => checklistInstanceItems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // One signoff per item — re-signing replaces (server-side upsert handles).
    itemUniq: uniqueIndex("checklist_signoffs_item_uniq").on(
      t.teamId,
      t.instanceItemId,
    ),
  }),
);

// ---------- Phase 4: order lists, tires ----------

export const orderListItems = pgTable(
  "order_list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    workOrderId: uuid("work_order_id").references(() => workOrders.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    qty: integer("qty").notNull().default(1),
    status: orderListStatusEnum("status").notNull().default("needed"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamEventIdx: index("order_list_items_team_event_idx").on(t.teamId, t.eventId),
  }),
);

export const tireNeeds = pgTable(
  "tire_needs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    compound: text("compound").notNull(),
    count: integer("count").notNull().default(4),
    orderedAt: timestamp("ordered_at", { withTimezone: true }),
    receivedAt: timestamp("received_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamEventIdx: index("tire_needs_team_event_idx").on(t.teamId, t.eventId),
  }),
);

// ---------- Phase 5a: logistics (itinerary, hotels, meals) ----------

export const itineraryLegs = pgTable(
  "itinerary_legs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    fromLocation: text("from_location").notNull(),
    toLocation: text("to_location").notNull(),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, {
      onDelete: "set null",
    }),
    departAt: timestamp("depart_at", { withTimezone: true }),
    arriveAt: timestamp("arrive_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdx: index("itinerary_legs_event_idx").on(t.teamId, t.eventId, t.orderIndex),
  }),
);

export const itineraryLegAssignees = pgTable(
  "itinerary_leg_assignees",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    legId: uuid("leg_id")
      .notNull()
      .references(() => itineraryLegs.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.legId, t.userId] }),
    userIdx: index("itinerary_leg_assignees_user_idx").on(t.teamId, t.userId),
  }),
);

export const hotelBookings = pgTable(
  "hotel_bookings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    confirmationNumber: text("confirmation_number"),
    checkInDate: date("check_in_date"),
    checkOutDate: date("check_out_date"),
    roomAssignments: text("room_assignments"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdx: index("hotel_bookings_event_idx").on(t.teamId, t.eventId),
  }),
);

export const mealPlanItems = pgTable(
  "meal_plan_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    whenAt: timestamp("when_at", { withTimezone: true }),
    whereAt: text("where_at"),
    what: text("what").notNull(),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdx: index("meal_plan_items_event_idx").on(t.teamId, t.eventId),
  }),
);

// ---------- Phase 5b: recce ----------

export const eventStages = pgTable(
  "event_stages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    stageNumber: integer("stage_number").notNull(),
    name: text("name").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventStageUniq: uniqueIndex("event_stages_event_number_uniq").on(
      t.teamId,
      t.eventId,
      t.stageNumber,
    ),
  }),
);

export const recceScheduleEntries = pgTable(
  "recce_schedule_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    stageId: uuid("stage_id")
      .notNull()
      .references(() => eventStages.id, { onDelete: "cascade" }),
    day: date("day"),
    passNumber: integer("pass_number").notNull().default(1),
    driverUserId: uuid("driver_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    coDriverUserId: uuid("co_driver_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdx: index("recce_schedule_event_idx").on(t.teamId, t.eventId, t.day),
  }),
);

// ---------- Phase 6: budget ----------
//
// Amounts stored as integer cents to avoid float drift. UI converts to/from
// dollars at the boundary.

export const budgetLines = pgTable(
  "budget_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    category: budgetCategoryEnum("category").notNull(),
    estimatedCents: integer("estimated_cents").notNull(),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventCatUniq: uniqueIndex("budget_lines_event_cat_uniq").on(
      t.teamId,
      t.eventId,
      t.category,
    ),
  }),
);

export const expenseEntries = pgTable(
  "expense_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    category: budgetCategoryEnum("category").notNull(),
    amountCents: integer("amount_cents").notNull(),
    vendor: text("vendor"),
    expenseDate: date("expense_date"),
    notes: text("notes"),
    enteredByUserId: uuid("entered_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventCatIdx: index("expense_entries_event_cat_idx").on(
      t.teamId,
      t.eventId,
      t.category,
    ),
    teamCatIdx: index("expense_entries_team_cat_idx").on(t.teamId, t.category),
  }),
);

// ---------- Phase 7: documents ----------
//
// A "document" is a logical, named container scoped to (team, event,
// category, name). Each upload creates a new DocumentVersion row pointing at
// an object in R2. Re-uploading the same logical name appends a new version
// and computes a structured diff against the previous version (if both
// have extractable text). Versions are immutable; deletions soft-delete the
// document. Acknowledgments are per (user, document) — flagged "must ack"
// at the document level.

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id").references(() => events.id, {
      onDelete: "cascade",
    }),
    // Optional polymorphic links — set when the doc is attached to a specific
    // resource (a stage's road book, an expense's receipt photo, etc.).
    stageId: uuid("stage_id").references(() => eventStages.id, {
      onDelete: "set null",
    }),
    expenseId: uuid("expense_id").references(() => expenseEntries.id, {
      onDelete: "set null",
    }),
    category: documentCategoryEnum("category").notNull(),
    /** Logical name; re-uploading with the same (event, category, name) appends a version. */
    name: text("name").notNull(),
    mustAcknowledge: boolean("must_acknowledge").notNull().default(false),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamEventIdx: index("documents_team_event_idx").on(t.teamId, t.eventId),
    logicalUniq: uniqueIndex("documents_logical_uniq").on(
      t.teamId,
      t.eventId,
      t.category,
      t.name,
    ),
  }),
);

export const documentVersions = pgTable(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    /** R2 object key; we store the path, not the URL. */
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    /** Extracted text for diff computation. Null for non-text formats (e.g., GPX, image). */
    extractedText: text("extracted_text"),
    /** Cached structured diff against the immediately prior version. JSON-serialized StructuredDiff. */
    diffJson: text("diff_json"),
    uploadedByUserId: uuid("uploaded_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    documentVersionUniq: uniqueIndex("document_versions_doc_version_uniq").on(
      t.teamId,
      t.documentId,
      t.versionNumber,
    ),
  }),
);

export const documentAcknowledgments = pgTable(
  "document_acknowledgments",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The version that was acknowledged. New versions reset the ack. */
    versionId: uuid("version_id")
      .notNull()
      .references(() => documentVersions.id, { onDelete: "cascade" }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.documentId, t.userId] }),
    versionIdx: index("document_acknowledgments_version_idx").on(
      t.teamId,
      t.versionId,
    ),
  }),
);

// ---------- Phase 8: safety, licensing, equipment ----------

export const safetyItems = pgTable(
  "safety_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    type: safetyItemTypeEnum("type").notNull(),
    /** FIA / SA / ARA spec or rating, e.g. "FIA 8859-2015". */
    spec: text("spec"),
    serial: text("serial"),
    expiryDate: date("expiry_date"),
    ownerUserId: uuid("owner_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("safety_items_team_idx").on(t.teamId),
  }),
);

export const licenseDocs = pgTable(
  "license_docs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    holderUserId: uuid("holder_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: licenseKindEnum("kind").notNull(),
    licenseNumber: text("license_number"),
    expiryDate: date("expiry_date"),
    notes: text("notes"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("license_docs_team_idx").on(t.teamId),
    holderKindIdx: index("license_docs_holder_kind_idx").on(
      t.teamId,
      t.holderUserId,
      t.kind,
    ),
  }),
);

export const equipmentItems = pgTable(
  "equipment_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    category: equipmentCategoryEnum("category").notNull(),
    description: text("description").notNull(),
    location: text("location"),
    notes: text("notes"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamIdx: index("equipment_items_team_idx").on(t.teamId),
  }),
);

// ---------- Phase 9: live mode ----------

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    stageNumber: integer("stage_number"),
    note: text("note").notNull(),
    photoDocumentId: uuid("photo_document_id").references(() => documents.id, {
      onDelete: "set null",
    }),
    reportedByUserId: uuid("reported_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    workOrderId: uuid("work_order_id").references(() => workOrders.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    eventIdx: index("incidents_event_idx").on(t.teamId, t.eventId),
  }),
);

export const serviceStops = pgTable(
  "service_stops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    plannedDurationSeconds: integer("planned_duration_seconds")
      .notNull()
      .default(1800),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    startedByUserId: uuid("started_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    notes: text("notes"),
  },
  (t) => ({
    eventIdx: index("service_stops_event_idx").on(t.teamId, t.eventId),
  }),
);

export const serviceStopItems = pgTable(
  "service_stop_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    serviceStopId: uuid("service_stop_id")
      .notNull()
      .references(() => serviceStops.id, { onDelete: "cascade" }),
    orderIndex: integer("order_index").notNull(),
    label: text("label").notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedByUserId: uuid("completed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    stopIdx: index("service_stop_items_stop_idx").on(t.teamId, t.serviceStopId, t.orderIndex),
  }),
);

// One row per (event, user). Latest status with notes + last-updated time.
export const crewStatusEntries = pgTable(
  "crew_status_entries",
  {
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: crewStatusEnum("status").notNull(),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.eventId, t.userId] }),
  }),
);

// ---------- Phase 10: notifications (audit log) ----------

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    channel: notificationChannelEnum("channel").notNull(),
    kind: notificationKindEnum("kind").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    /** Email address or phone number actually used at send time. */
    recipient: text("recipient").notNull(),
    status: notificationStatusEnum("status").notNull().default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    teamUserIdx: index("notifications_team_user_idx").on(t.teamId, t.userId, t.createdAt),
  }),
);

// ---------- Auth.js (NextAuth v5) tables ----------
// Per @auth/drizzle-adapter docs. Schema is intentionally adapter-shape; team_id
// lives only on the domain `users` table above (Auth.js manages a 1:1 row per user).

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (a) => ({
    pk: primaryKey({ columns: [a.provider, a.providerAccountId] }),
  }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (vt) => ({
    pk: primaryKey({ columns: [vt.identifier, vt.token] }),
  }),
);

// Re-export types
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type Todo = typeof todos.$inferSelect;
export type NewTodo = typeof todos.$inferInsert;

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
export type WorkOrder = typeof workOrders.$inferSelect;
export type NewWorkOrder = typeof workOrders.$inferInsert;
export type WorkOrderNote = typeof workOrderNotes.$inferSelect;
export type NewWorkOrderNote = typeof workOrderNotes.$inferInsert;

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type EventPhase = (typeof eventPhaseEnum.enumValues)[number];
export type VehicleType = (typeof vehicleTypeEnum.enumValues)[number];
export type WorkOrderStatus = (typeof workOrderStatusEnum.enumValues)[number];

export type ChecklistTemplate = typeof checklistTemplates.$inferSelect;
export type NewChecklistTemplate = typeof checklistTemplates.$inferInsert;
export type ChecklistTemplateItem = typeof checklistTemplateItems.$inferSelect;
export type NewChecklistTemplateItem = typeof checklistTemplateItems.$inferInsert;
export type ChecklistInstance = typeof checklistInstances.$inferSelect;
export type NewChecklistInstance = typeof checklistInstances.$inferInsert;
export type ChecklistInstanceItem = typeof checklistInstanceItems.$inferSelect;
export type NewChecklistInstanceItem = typeof checklistInstanceItems.$inferInsert;
export type ChecklistSignoff = typeof checklistSignoffs.$inferSelect;
export type NewChecklistSignoff = typeof checklistSignoffs.$inferInsert;
export type ChecklistKind = (typeof checklistKindEnum.enumValues)[number];

export type OrderListItem = typeof orderListItems.$inferSelect;
export type NewOrderListItem = typeof orderListItems.$inferInsert;
export type OrderListStatus = (typeof orderListStatusEnum.enumValues)[number];
export type TireNeed = typeof tireNeeds.$inferSelect;
export type NewTireNeed = typeof tireNeeds.$inferInsert;

export type ItineraryLeg = typeof itineraryLegs.$inferSelect;
export type NewItineraryLeg = typeof itineraryLegs.$inferInsert;
export type HotelBooking = typeof hotelBookings.$inferSelect;
export type NewHotelBooking = typeof hotelBookings.$inferInsert;
export type MealPlanItem = typeof mealPlanItems.$inferSelect;
export type NewMealPlanItem = typeof mealPlanItems.$inferInsert;

export type EventStage = typeof eventStages.$inferSelect;
export type NewEventStage = typeof eventStages.$inferInsert;
export type RecceScheduleEntry = typeof recceScheduleEntries.$inferSelect;
export type NewRecceScheduleEntry = typeof recceScheduleEntries.$inferInsert;

export type BudgetLine = typeof budgetLines.$inferSelect;
export type NewBudgetLine = typeof budgetLines.$inferInsert;
export type ExpenseEntry = typeof expenseEntries.$inferSelect;
export type NewExpenseEntry = typeof expenseEntries.$inferInsert;
export type BudgetCategory = (typeof budgetCategoryEnum.enumValues)[number];

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentVersion = typeof documentVersions.$inferSelect;
export type NewDocumentVersion = typeof documentVersions.$inferInsert;
export type DocumentAcknowledgment = typeof documentAcknowledgments.$inferSelect;
export type NewDocumentAcknowledgment = typeof documentAcknowledgments.$inferInsert;
export type DocumentCategory = (typeof documentCategoryEnum.enumValues)[number];

export type SafetyItem = typeof safetyItems.$inferSelect;
export type NewSafetyItem = typeof safetyItems.$inferInsert;
export type LicenseDoc = typeof licenseDocs.$inferSelect;
export type NewLicenseDoc = typeof licenseDocs.$inferInsert;
export type EquipmentItem = typeof equipmentItems.$inferSelect;
export type NewEquipmentItem = typeof equipmentItems.$inferInsert;
export type SafetyItemType = (typeof safetyItemTypeEnum.enumValues)[number];
export type LicenseKind = (typeof licenseKindEnum.enumValues)[number];
export type EquipmentCategory = (typeof equipmentCategoryEnum.enumValues)[number];

export type Incident = typeof incidents.$inferSelect;
export type NewIncident = typeof incidents.$inferInsert;
export type ServiceStop = typeof serviceStops.$inferSelect;
export type NewServiceStop = typeof serviceStops.$inferInsert;
export type ServiceStopItem = typeof serviceStopItems.$inferSelect;
export type NewServiceStopItem = typeof serviceStopItems.$inferInsert;
export type CrewStatusEntry = typeof crewStatusEntries.$inferSelect;
export type NewCrewStatusEntry = typeof crewStatusEntries.$inferInsert;
export type CrewStatus = (typeof crewStatusEnum.enumValues)[number];

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationChannel = (typeof notificationChannelEnum.enumValues)[number];
export type NotificationKind = (typeof notificationKindEnum.enumValues)[number];
export type NotificationStatus = (typeof notificationStatusEnum.enumValues)[number];

// boolean export to silence unused import warnings if added later
void boolean;
