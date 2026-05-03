CREATE TABLE "event_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"stage_number" integer NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recce_schedule_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"stage_id" uuid NOT NULL,
	"day" date,
	"pass_number" integer DEFAULT 1 NOT NULL,
	"driver_user_id" uuid,
	"co_driver_user_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "recce_logistics_notes" text;--> statement-breakpoint
ALTER TABLE "event_stages" ADD CONSTRAINT "event_stages_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_stages" ADD CONSTRAINT "event_stages_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recce_schedule_entries" ADD CONSTRAINT "recce_schedule_entries_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recce_schedule_entries" ADD CONSTRAINT "recce_schedule_entries_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recce_schedule_entries" ADD CONSTRAINT "recce_schedule_entries_stage_id_event_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."event_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recce_schedule_entries" ADD CONSTRAINT "recce_schedule_entries_driver_user_id_users_id_fk" FOREIGN KEY ("driver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recce_schedule_entries" ADD CONSTRAINT "recce_schedule_entries_co_driver_user_id_users_id_fk" FOREIGN KEY ("co_driver_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "event_stages_event_number_uniq" ON "event_stages" USING btree ("team_id","event_id","stage_number");--> statement-breakpoint
CREATE INDEX "recce_schedule_event_idx" ON "recce_schedule_entries" USING btree ("team_id","event_id","day");