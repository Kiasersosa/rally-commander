CREATE TYPE "public"."notification_channel" AS ENUM('email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('digest', 'expiry_alert', 'bulletin', 'manual');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"recipient" text NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone_number" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sms_opt_in" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_team_user_idx" ON "notifications" USING btree ("team_id","user_id","created_at");