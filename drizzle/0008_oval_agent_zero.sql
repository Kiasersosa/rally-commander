CREATE TYPE "public"."equipment_category" AS ENUM('service_tool', 'comms', 'filming', 'other');--> statement-breakpoint
CREATE TYPE "public"."license_kind" AS ENUM('ara', 'fia', 'medical');--> statement-breakpoint
CREATE TYPE "public"."safety_item_type" AS ENUM('helmet', 'hans', 'suit', 'harness', 'fuel_cell', 'fire_extinguisher', 'other');--> statement-breakpoint
CREATE TABLE "equipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"category" "equipment_category" NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "license_docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"holder_user_id" uuid NOT NULL,
	"kind" "license_kind" NOT NULL,
	"license_number" text,
	"expiry_date" date,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"type" "safety_item_type" NOT NULL,
	"spec" text,
	"serial" text,
	"expiry_date" date,
	"owner_user_id" uuid,
	"notes" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_docs" ADD CONSTRAINT "license_docs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_docs" ADD CONSTRAINT "license_docs_holder_user_id_users_id_fk" FOREIGN KEY ("holder_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_items" ADD CONSTRAINT "safety_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_items" ADD CONSTRAINT "safety_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_items_team_idx" ON "equipment_items" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "license_docs_team_idx" ON "license_docs" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "license_docs_holder_kind_idx" ON "license_docs" USING btree ("team_id","holder_user_id","kind");--> statement-breakpoint
CREATE INDEX "safety_items_team_idx" ON "safety_items" USING btree ("team_id");