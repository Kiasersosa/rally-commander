ALTER TYPE "public"."equipment_category" ADD VALUE 'tools' BEFORE 'comms';--> statement-breakpoint
ALTER TYPE "public"."equipment_category" ADD VALUE 'mechanics' BEFORE 'comms';--> statement-breakpoint
ALTER TYPE "public"."equipment_category" ADD VALUE 'cooking' BEFORE 'comms';--> statement-breakpoint
ALTER TYPE "public"."equipment_category" ADD VALUE 'transport' BEFORE 'comms';--> statement-breakpoint
ALTER TYPE "public"."equipment_category" ADD VALUE 'electronics' BEFORE 'other';--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "qty" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "packed_in" text;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD COLUMN "belongs_to_user_id" uuid;--> statement-breakpoint
ALTER TABLE "equipment_items" ADD CONSTRAINT "equipment_items_belongs_to_user_id_users_id_fk" FOREIGN KEY ("belongs_to_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;