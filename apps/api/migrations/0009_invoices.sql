CREATE TABLE "document_images" (
	"sha256" text PRIMARY KEY NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_images_mime_type_ck" CHECK ("document_images"."mime_type" in ('image/png', 'image/jpeg')),
	CONSTRAINT "document_images_size_ck" CHECK ("document_images"."size_bytes" between 1 and 1048576),
	CONSTRAINT "document_images_sha256_ck" CHECK ("document_images"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "invoice_cases" (
	"invoice_id" bigint NOT NULL,
	"case_id" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "invoice_cases_invoice_id_case_id_pk" PRIMARY KEY("invoice_id","case_id")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "invoices_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"no" bigint NOT NULL,
	"type" text NOT NULL,
	"doctor_id" bigint,
	"party_name" text NOT NULL,
	"issue_date" date NOT NULL,
	"language" text NOT NULL,
	"currency_code" text NOT NULL,
	"subtotal" bigint,
	"discount" bigint,
	"total" bigint,
	"status" text DEFAULT 'active' NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" bigint,
	"snapshot" jsonb NOT NULL,
	"snapshot_version" smallint NOT NULL,
	"snapshot_sha256" text NOT NULL,
	"logo_sha256" text,
	"idempotency_key" uuid,
	"request_hash" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "invoices_no_ck" CHECK ("invoices"."no" > 0),
	CONSTRAINT "invoices_type_ck" CHECK ("invoices"."type" in ('cases','statement','free')),
	CONSTRAINT "invoices_language_ck" CHECK ("invoices"."language" in ('ar','en')),
	CONSTRAINT "invoices_status_ck" CHECK ("invoices"."status" in ('active','void')),
	CONSTRAINT "invoices_party_name_ck" CHECK (char_length("invoices"."party_name") between 1 and 100),
	CONSTRAINT "invoices_party_ck" CHECK ("invoices"."type" = 'free' or "invoices"."doctor_id" is not null),
	CONSTRAINT "invoices_money_ck" CHECK (case when "invoices"."type" = 'statement'
            then "invoices"."subtotal" is null and "invoices"."discount" is null and "invoices"."total" is null
            else "invoices"."subtotal" is not null and "invoices"."discount" is not null and "invoices"."total" is not null
              and "invoices"."subtotal" between 0 and 999999999999 and "invoices"."discount" between 0 and "invoices"."subtotal"
              and "invoices"."total" = "invoices"."subtotal" - "invoices"."discount"
              and ("invoices"."type" <> 'free' or ("invoices"."total" > 0 and "invoices"."discount" = 0))
          end),
	CONSTRAINT "invoices_void_ck" CHECK (("invoices"."status" = 'void') = ("invoices"."voided_at" is not null)
          and ("invoices"."status" = 'void') = ("invoices"."void_reason" is not null)
          and ("invoices"."void_reason" is null or char_length("invoices"."void_reason") between 1 and 300)),
	CONSTRAINT "invoices_idempotency_ck" CHECK (("invoices"."idempotency_key" is null) = ("invoices"."request_hash" is null)),
	CONSTRAINT "invoices_sha256_ck" CHECK ("invoices"."snapshot_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "invoices_row_version_ck" CHECK ("invoices"."row_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "invoice_cases" ADD CONSTRAINT "invoice_cases_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_cases" ADD CONSTRAINT "invoice_cases_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_logo_sha256_document_images_sha256_fk" FOREIGN KEY ("logo_sha256") REFERENCES "public"."document_images"("sha256") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_cases_active_case_uq" ON "invoice_cases" USING btree ("case_id") WHERE "invoice_cases"."active";--> statement-breakpoint
CREATE INDEX "invoice_cases_case_ix" ON "invoice_cases" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_no_uq" ON "invoices" USING btree ("no");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_idempotency_key_uq" ON "invoices" USING btree ("idempotency_key") WHERE "invoices"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "invoices_issue_date_ix" ON "invoices" USING btree ("issue_date" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoices_doctor_ix" ON "invoices" USING btree ("doctor_id","issue_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invoices_status_type_ix" ON "invoices" USING btree ("status","type");--> statement-breakpoint
-- Hand-written (B6 plan §2.4): issued invoices are immutable in the database itself. Only the void columns
-- (plus row_version and updated_*) may change, once, from active to void; nothing is ever deleted.
-- INSERT is not guarded, so a restore into a fresh database (pg_restore / psql) works (B7 restore rule).
CREATE FUNCTION "invoices_guard_row"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable constant text[] := ARRAY['status', 'void_reason', 'voided_at', 'voided_by', 'row_version', 'updated_at', 'updated_by'];
BEGIN
  IF OLD.status = 'void' THEN
    RAISE EXCEPTION 'invoices are immutable: invoice % is void and stays void', OLD.no;
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'invoices are immutable: only the void columns of invoice % may change', OLD.no;
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "invoices_guard_update" BEFORE UPDATE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "invoices_guard_row"();--> statement-breakpoint
CREATE FUNCTION "immutable_no_delete"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is immutable: rows are never deleted', TG_TABLE_NAME;
END $$;--> statement-breakpoint
CREATE TRIGGER "invoices_guard_delete" BEFORE DELETE ON "invoices"
  FOR EACH STATEMENT EXECUTE FUNCTION "immutable_no_delete"();--> statement-breakpoint
CREATE TRIGGER "invoice_cases_guard_delete" BEFORE DELETE ON "invoice_cases"
  FOR EACH STATEMENT EXECUTE FUNCTION "immutable_no_delete"();--> statement-breakpoint
CREATE TRIGGER "document_images_guard_delete" BEFORE DELETE ON "document_images"
  FOR EACH STATEMENT EXECUTE FUNCTION "immutable_no_delete"();--> statement-breakpoint
CREATE FUNCTION "invoice_cases_guard_row"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.case_id IS DISTINCT FROM OLD.case_id
     OR NOT OLD.active OR NEW.active THEN
    RAISE EXCEPTION 'invoice_cases is immutable: a row only moves from active to inactive (void)';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "invoice_cases_guard_update" BEFORE UPDATE ON "invoice_cases"
  FOR EACH ROW EXECUTE FUNCTION "invoice_cases_guard_row"();--> statement-breakpoint
CREATE FUNCTION "document_images_guard_update"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'document_images is immutable: frozen images never change';
END $$;--> statement-breakpoint
CREATE TRIGGER "document_images_guard_update" BEFORE UPDATE ON "document_images"
  FOR EACH STATEMENT EXECUTE FUNCTION "document_images_guard_update"();--> statement-breakpoint
-- Hand-written reference data (system, not business seed), B6: invoices.
INSERT INTO "permissions" ("code") VALUES ('invoices.read'), ('invoices.write'), ('invoices.void')
  ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_code")
  SELECT r."id", p."code" FROM "roles" r CROSS JOIN "permissions" p
  WHERE r."code" = 'owner'
  ON CONFLICT DO NOTHING;
