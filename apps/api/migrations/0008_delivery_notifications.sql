CREATE TABLE "notification_states" (
	"user_id" bigint NOT NULL,
	"key" text NOT NULL,
	"seen_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_states_user_id_key_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "notification_states_key_length_ck" CHECK (char_length("notification_states"."key") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "cases" ADD COLUMN "collect_on" date;--> statement-breakpoint
ALTER TABLE "notification_states" ADD CONSTRAINT "notification_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cases_collect_on_ix" ON "cases" USING btree ("collect_on") WHERE "cases"."collect_on" is not null;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_collect_on_ck" CHECK ("cases"."collect_on" is null or ("cases"."status" = 'delivered' and "cases"."collect_on" >= "cases"."delivered_date"));--> statement-breakpoint
-- Hand-written reference data (system, not business seed), B5: the notifications feed.
INSERT INTO "permissions" ("code") VALUES ('notifications.read')
  ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_code")
  SELECT r."id", p."code" FROM "roles" r CROSS JOIN "permissions" p
  WHERE r."code" = 'owner'
  ON CONFLICT DO NOTHING;
