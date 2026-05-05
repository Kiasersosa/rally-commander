CREATE TABLE "movement_plan_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"label" text NOT NULL,
	"order_index" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movement_plan_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"day_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"who" text DEFAULT '' NOT NULL,
	"what" text NOT NULL,
	"where_label" text,
	"where_url" text,
	"when_time" text,
	"travel_time" text,
	"comments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "movement_plan_days" ADD CONSTRAINT "movement_plan_days_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_plan_days" ADD CONSTRAINT "movement_plan_days_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_plan_entries" ADD CONSTRAINT "movement_plan_entries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_plan_entries" ADD CONSTRAINT "movement_plan_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "movement_plan_entries" ADD CONSTRAINT "movement_plan_entries_day_id_movement_plan_days_id_fk" FOREIGN KEY ("day_id") REFERENCES "public"."movement_plan_days"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "movement_plan_days_event_idx" ON "movement_plan_days" USING btree ("team_id","event_id","order_index");--> statement-breakpoint
CREATE INDEX "movement_plan_entries_day_idx" ON "movement_plan_entries" USING btree ("team_id","day_id","order_index");