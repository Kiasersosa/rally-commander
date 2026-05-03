CREATE TABLE "hotel_bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"confirmation_number" text,
	"check_in_date" date,
	"check_out_date" date,
	"room_assignments" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itinerary_leg_assignees" (
	"team_id" uuid NOT NULL,
	"leg_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "itinerary_leg_assignees_leg_id_user_id_pk" PRIMARY KEY("leg_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "itinerary_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"order_index" integer NOT NULL,
	"from_location" text NOT NULL,
	"to_location" text NOT NULL,
	"vehicle_id" uuid,
	"depart_at" timestamp with time zone,
	"arrive_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meal_plan_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"when_at" timestamp with time zone,
	"where_at" text,
	"what" text NOT NULL,
	"assignee_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hotel_bookings" ADD CONSTRAINT "hotel_bookings_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hotel_bookings" ADD CONSTRAINT "hotel_bookings_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_leg_assignees" ADD CONSTRAINT "itinerary_leg_assignees_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_leg_assignees" ADD CONSTRAINT "itinerary_leg_assignees_leg_id_itinerary_legs_id_fk" FOREIGN KEY ("leg_id") REFERENCES "public"."itinerary_legs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_leg_assignees" ADD CONSTRAINT "itinerary_leg_assignees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_legs" ADD CONSTRAINT "itinerary_legs_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_legs" ADD CONSTRAINT "itinerary_legs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_legs" ADD CONSTRAINT "itinerary_legs_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_items" ADD CONSTRAINT "meal_plan_items_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_items" ADD CONSTRAINT "meal_plan_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_plan_items" ADD CONSTRAINT "meal_plan_items_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hotel_bookings_event_idx" ON "hotel_bookings" USING btree ("team_id","event_id");--> statement-breakpoint
CREATE INDEX "itinerary_leg_assignees_user_idx" ON "itinerary_leg_assignees" USING btree ("team_id","user_id");--> statement-breakpoint
CREATE INDEX "itinerary_legs_event_idx" ON "itinerary_legs" USING btree ("team_id","event_id","order_index");--> statement-breakpoint
CREATE INDEX "meal_plan_items_event_idx" ON "meal_plan_items" USING btree ("team_id","event_id");