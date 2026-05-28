ALTER TYPE "public"."checklist_kind" ADD VALUE 'service_setup';--> statement-breakpoint
ALTER TABLE "checklist_instance_items" ADD COLUMN "zone" text;--> statement-breakpoint
ALTER TABLE "checklist_instance_items" ADD COLUMN "target_role" "user_role";--> statement-breakpoint
ALTER TABLE "checklist_instance_items" ADD COLUMN "tools_needed" text;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD COLUMN "zone" text;--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD COLUMN "target_role" "user_role";--> statement-breakpoint
ALTER TABLE "checklist_template_items" ADD COLUMN "tools_needed" text;