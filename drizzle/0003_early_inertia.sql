CREATE TYPE "public"."order_list_status" AS ENUM('needed', 'ordered', 'received', 'packed');--> statement-breakpoint
ALTER TYPE "public"."checklist_kind" ADD VALUE 'packing';--> statement-breakpoint
CREATE TABLE "order_list_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"work_order_id" uuid,
	"title" text NOT NULL,
	"qty" integer DEFAULT 1 NOT NULL,
	"status" "order_list_status" DEFAULT 'needed' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tire_needs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"compound" text NOT NULL,
	"count" integer DEFAULT 4 NOT NULL,
	"ordered_at" timestamp with time zone,
	"received_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_list_items" ADD CONSTRAINT "order_list_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_list_items" ADD CONSTRAINT "order_list_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_list_items" ADD CONSTRAINT "order_list_items_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tire_needs" ADD CONSTRAINT "tire_needs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tire_needs" ADD CONSTRAINT "tire_needs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_list_items_team_event_idx" ON "order_list_items" USING btree ("team_id","event_id");--> statement-breakpoint
CREATE INDEX "tire_needs_team_event_idx" ON "tire_needs" USING btree ("team_id","event_id");