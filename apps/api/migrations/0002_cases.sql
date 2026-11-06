CREATE TABLE "case_items" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_items_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"case_id" bigint NOT NULL,
	"tooth_no" smallint,
	"area" text,
	"work_type_id" bigint NOT NULL,
	"work_type_name" text NOT NULL,
	"shade" text,
	"unit_price" bigint NOT NULL,
	"price_source" text NOT NULL,
	"note" text,
	CONSTRAINT "case_items_position_ck" CHECK (("case_items"."tooth_no" is null) <> ("case_items"."area" is null)),
	CONSTRAINT "case_items_tooth_ck" CHECK ("case_items"."tooth_no" is null or ("case_items"."tooth_no" between 11 and 48 and "case_items"."tooth_no" % 10 between 1 and 8)),
	CONSTRAINT "case_items_area_ck" CHECK ("case_items"."area" is null or "case_items"."area" in ('upper_arch','lower_arch','both_arches','none')),
	CONSTRAINT "case_items_price_source_ck" CHECK ("case_items"."price_source" in ('general','special','manual')),
	CONSTRAINT "case_items_unit_price_ck" CHECK ("case_items"."unit_price" between 0 and 999999999999),
	CONSTRAINT "case_items_shade_length_ck" CHECK (char_length("case_items"."shade") between 1 and 20),
	CONSTRAINT "case_items_note_length_ck" CHECK (char_length("case_items"."note") <= 200),
	CONSTRAINT "case_items_work_type_name_length_ck" CHECK (char_length("case_items"."work_type_name") between 1 and 100)
);
--> statement-breakpoint
CREATE TABLE "case_status_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "case_status_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"case_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"delivered_date" date,
	"user_id" bigint,
	CONSTRAINT "case_status_history_from_ck" CHECK ("case_status_history"."from_status" is null or "case_status_history"."from_status" in ('waiting','design','in_progress','ready','delivered','returned','cancelled')),
	CONSTRAINT "case_status_history_to_ck" CHECK ("case_status_history"."to_status" in ('waiting','design','in_progress','ready','delivered','returned','cancelled')),
	CONSTRAINT "case_status_history_note_length_ck" CHECK (char_length("case_status_history"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "cases" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"case_no" bigint NOT NULL,
	"doctor_id" bigint NOT NULL,
	"patient_name" text NOT NULL,
	"technician_id" bigint,
	"received_date" date NOT NULL,
	"expected_date" date NOT NULL,
	"delivered_date" date,
	"status" text NOT NULL,
	"discount" bigint DEFAULT 0 NOT NULL,
	"total" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "cases_case_no_ck" CHECK ("cases"."case_no" > 0),
	CONSTRAINT "cases_status_ck" CHECK ("cases"."status" in ('waiting','design','in_progress','ready','delivered','returned','cancelled')),
	CONSTRAINT "cases_patient_name_length_ck" CHECK (char_length("cases"."patient_name") between 1 and 100),
	CONSTRAINT "cases_notes_length_ck" CHECK (char_length("cases"."notes") <= 2000),
	CONSTRAINT "cases_expected_after_received_ck" CHECK ("cases"."expected_date" >= "cases"."received_date"),
	CONSTRAINT "cases_delivered_date_ck" CHECK (("cases"."status" = 'delivered') = ("cases"."delivered_date" is not null)
          and ("cases"."delivered_date" is null or "cases"."delivered_date" >= "cases"."received_date")),
	CONSTRAINT "cases_discount_ck" CHECK ("cases"."discount" between 0 and 999999999999),
	CONSTRAINT "cases_total_ck" CHECK ("cases"."total" between 0 and 999999999999),
	CONSTRAINT "cases_row_version_ck" CHECK ("cases"."row_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "case_items" ADD CONSTRAINT "case_items_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_items" ADD CONSTRAINT "case_items_work_type_id_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_status_history" ADD CONSTRAINT "case_status_history_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_status_history" ADD CONSTRAINT "case_status_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_technician_id_technicians_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."technicians"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cases" ADD CONSTRAINT "cases_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_items_case_ix" ON "case_items" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_status_history_case_ix" ON "case_status_history" USING btree ("case_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "cases_case_no_uq" ON "cases" USING btree ("case_no");--> statement-breakpoint
CREATE INDEX "cases_doctor_received_ix" ON "cases" USING btree ("doctor_id","received_date");--> statement-breakpoint
CREATE INDEX "cases_status_expected_ix" ON "cases" USING btree ("status","expected_date");--> statement-breakpoint
-- Hand-written reference data: case permissions, granted to the owner role.
INSERT INTO "permissions" ("code") VALUES ('cases.read'), ('cases.write'), ('cases.cancel');--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_code")
  SELECT r."id", p."code" FROM "roles" r CROSS JOIN "permissions" p
  WHERE r."code" = 'owner'
  ON CONFLICT DO NOTHING;