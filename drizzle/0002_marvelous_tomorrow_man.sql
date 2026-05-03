CREATE TYPE "public"."checklist_kind" AS ENUM('pre_event_inspection', 'post_event_teardown');--> statement-breakpoint
CREATE TABLE "checklist_instance_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"instance_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"label" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "checklist_instances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" "checklist_kind" NOT NULL,
	"name" text NOT NULL,
	"source_template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"instance_item_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_template_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" "checklist_kind" NOT NULL,
	"name" text NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "checklist_instance_items" ADD CONSTRAINT "checklist_instance_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instance_items" ADD CONSTRAINT "checklist_instance_items_instance_id_checklist_instances_id_fk" FOREIGN KEY ("instance_id") REFERENCES "public"."checklist_instances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_source_template_id_checklist_templates_id_fk" FOREIGN KEY ("source_template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_signoffs" ADD CONSTRAINT "checklist_signoffs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_signoffs" ADD CONSTRAINT "checklist_signoffs_instance_item_id_checklist_instance_items_id_fk" FOREIGN KEY ("instance_item_id") REFERENCES "public"."checklist_instance_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_signoffs" ADD CONSTRAINT "checklist_signoffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "checklist_instance_items_instance_idx" ON "checklist_instance_items" USING btree ("team_id","instance_id","order_index");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_instances_event_vehicle_kind_uniq" ON "checklist_instances" USING btree ("team_id","event_id","vehicle_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_signoffs_item_uniq" ON "checklist_signoffs" USING btree ("team_id","instance_item_id");--> statement-breakpoint
CREATE INDEX "checklist_template_items_template_idx" ON "checklist_template_items" USING btree ("team_id","template_id","order_index");--> statement-breakpoint
CREATE INDEX "checklist_templates_team_idx" ON "checklist_templates" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_templates_vehicle_kind_uniq" ON "checklist_templates" USING btree ("team_id","vehicle_id","kind");