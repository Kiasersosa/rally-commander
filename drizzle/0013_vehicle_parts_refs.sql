CREATE TABLE "vehicle_parts_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"component" text NOT NULL,
	"source_vehicle" text,
	"part_number" text,
	"supplier" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehicle_parts_refs" ADD CONSTRAINT "vehicle_parts_refs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_parts_refs" ADD CONSTRAINT "vehicle_parts_refs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehicle_parts_refs_vehicle_idx" ON "vehicle_parts_refs" USING btree ("team_id","vehicle_id");