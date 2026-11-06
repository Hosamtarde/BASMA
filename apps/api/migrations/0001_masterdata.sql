CREATE TABLE "lab_logo" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"content" "bytea" NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "lab_logo_single_row_ck" CHECK ("lab_logo"."id" = 1),
	CONSTRAINT "lab_logo_mime_type_ck" CHECK ("lab_logo"."mime_type" in ('image/png', 'image/jpeg')),
	CONSTRAINT "lab_logo_size_ck" CHECK ("lab_logo"."size_bytes" between 1 and 1048576)
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "expense_categories_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"is_doctor" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "expense_categories_name_length_ck" CHECK (char_length("expense_categories"."name") between 1 and 100),
	CONSTRAINT "expense_categories_row_version_ck" CHECK ("expense_categories"."row_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "technicians" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "technicians_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "technicians_name_length_ck" CHECK (char_length("technicians"."name") between 1 and 100),
	CONSTRAINT "technicians_row_version_ck" CHECK ("technicians"."row_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "work_types" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "work_types_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"unit_price" bigint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "work_types_name_length_ck" CHECK (char_length("work_types"."name") between 1 and 100),
	CONSTRAINT "work_types_unit_price_ck" CHECK ("work_types"."unit_price" between 0 and 999999999999),
	CONSTRAINT "work_types_sort_order_ck" CHECK ("work_types"."sort_order" between 0 and 10000),
	CONSTRAINT "work_types_row_version_ck" CHECK ("work_types"."row_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "doctor_prices" (
	"doctor_id" bigint NOT NULL,
	"work_type_id" bigint NOT NULL,
	"price" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "doctor_prices_pk" PRIMARY KEY("doctor_id","work_type_id"),
	CONSTRAINT "doctor_prices_price_ck" CHECK ("doctor_prices"."price" between 0 and 999999999999)
);
--> statement-breakpoint
CREATE TABLE "doctors" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "doctors_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"name" text NOT NULL,
	"phone" text,
	"clinic" text,
	"notes" text,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "doctors_name_length_ck" CHECK (char_length("doctors"."name") between 1 and 100),
	CONSTRAINT "doctors_phone_length_ck" CHECK (char_length("doctors"."phone") <= 30),
	CONSTRAINT "doctors_clinic_length_ck" CHECK (char_length("doctors"."clinic") <= 100),
	CONSTRAINT "doctors_notes_length_ck" CHECK (char_length("doctors"."notes") <= 1000),
	CONSTRAINT "doctors_opening_balance_ck" CHECK ("doctors"."opening_balance" between -999999999999 and 999999999999),
	CONSTRAINT "doctors_row_version_ck" CHECK ("doctors"."row_version" >= 1)
);
--> statement-breakpoint
-- Hand-edited: backfill before NOT NULL so the step is safe even if counter rows exist.
ALTER TABLE "counters" ADD COLUMN "start_value" bigint;--> statement-breakpoint
UPDATE "counters" SET "start_value" = "next_value";--> statement-breakpoint
ALTER TABLE "counters" ALTER COLUMN "start_value" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "lab_logo" ADD CONSTRAINT "lab_logo_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technicians" ADD CONSTRAINT "technicians_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_types" ADD CONSTRAINT "work_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_types" ADD CONSTRAINT "work_types_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_prices" ADD CONSTRAINT "doctor_prices_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_prices" ADD CONSTRAINT "doctor_prices_work_type_id_work_types_id_fk" FOREIGN KEY ("work_type_id") REFERENCES "public"."work_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_prices" ADD CONSTRAINT "doctor_prices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_name_lower_uq" ON "expense_categories" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_single_doctor_uq" ON "expense_categories" USING btree ("is_doctor") WHERE "expense_categories"."is_doctor";--> statement-breakpoint
CREATE UNIQUE INDEX "technicians_name_lower_uq" ON "technicians" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "work_types_name_lower_uq" ON "work_types" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "doctors_name_lower_uq" ON "doctors" USING btree (lower("name"));--> statement-breakpoint
ALTER TABLE "counters" ADD CONSTRAINT "counters_start_value_ck" CHECK ("counters"."start_value" > 0 and "counters"."next_value" >= "counters"."start_value");--> statement-breakpoint
-- Hand-written reference data (system, not business seed).
-- Numbering: the owner may change the first number until one is issued (SPEC §12.12).
INSERT INTO "counters" ("name", "start_value", "next_value") VALUES
  ('case_no', 1, 1),
  ('invoice_no', 1, 1)
  ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
INSERT INTO "permissions" ("code") VALUES
  ('doctors.read'), ('doctors.write'),
  ('catalog.read'), ('catalog.write'),
  ('settings.read'), ('settings.write');--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_code")
  SELECT r."id", p."code" FROM "roles" r CROSS JOIN "permissions" p
  WHERE r."code" = 'owner'
  ON CONFLICT DO NOTHING;