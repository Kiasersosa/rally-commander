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

// boolean export to silence unused import warnings if added later
void boolean;
