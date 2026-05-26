CREATE TABLE "condition_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"logged_by_user_id" uuid NOT NULL,
	"fatigue_rating" integer,
	"hydration_rating" integer,
	"temp_rating" integer,
	"car_concerns" text,
	"notes" text,
	"location" text,
	"work_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "equipment_cleanup_signoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"equipment_item_id" uuid NOT NULL,
	"signed_by_user_id" uuid NOT NULL,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "condition_reports" ADD CONSTRAINT "condition_reports_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condition_reports" ADD CONSTRAINT "condition_reports_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condition_reports" ADD CONSTRAINT "condition_reports_logged_by_user_id_users_id_fk" FOREIGN KEY ("logged_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "condition_reports" ADD CONSTRAINT "condition_reports_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_cleanup_signoffs" ADD CONSTRAINT "equipment_cleanup_signoffs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_cleanup_signoffs" ADD CONSTRAINT "equipment_cleanup_signoffs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_cleanup_signoffs" ADD CONSTRAINT "equipment_cleanup_signoffs_equipment_item_id_equipment_items_id_fk" FOREIGN KEY ("equipment_item_id") REFERENCES "public"."equipment_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_cleanup_signoffs" ADD CONSTRAINT "equipment_cleanup_signoffs_signed_by_user_id_users_id_fk" FOREIGN KEY ("signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "condition_reports_event_idx" ON "condition_reports" USING btree ("team_id","event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "equipment_cleanup_signoffs_event_item_unique" ON "equipment_cleanup_signoffs" USING btree ("event_id","equipment_item_id");--> statement-breakpoint
CREATE INDEX "equipment_cleanup_signoffs_event_idx" ON "equipment_cleanup_signoffs" USING btree ("team_id","event_id");