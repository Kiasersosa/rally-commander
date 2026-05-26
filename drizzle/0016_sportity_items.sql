CREATE TYPE "public"."sportity_item_kind" AS ENUM('bulletin', 'document', 'schedule_change');--> statement-breakpoint
CREATE TABLE "sportity_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"kind" "sportity_item_kind" DEFAULT 'bulletin' NOT NULL,
	"title" text NOT NULL,
	"body_text" text,
	"document_id" uuid,
	"source_url" text,
	"notified_crew" boolean DEFAULT false NOT NULL,
	"posted_by_user_id" uuid NOT NULL,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sportity_items" ADD CONSTRAINT "sportity_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sportity_items" ADD CONSTRAINT "sportity_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sportity_items" ADD CONSTRAINT "sportity_items_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sportity_items" ADD CONSTRAINT "sportity_items_posted_by_user_id_users_id_fk" FOREIGN KEY ("posted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sportity_items_event_idx" ON "sportity_items" USING btree ("team_id","event_id","created_at");