CREATE TABLE "outgoing_payments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "outgoing_payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"voucher_no" bigint NOT NULL,
	"kind" text NOT NULL,
	"category_id" bigint NOT NULL,
	"doctor_id" bigint,
	"payee" text,
	"method" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency_code" text NOT NULL,
	"paid_at" date NOT NULL,
	"notes" text,
	"status" text DEFAULT 'active' NOT NULL,
	"void_reason" text,
	"voided_at" timestamp with time zone,
	"voided_by" bigint,
	"idempotency_key" uuid,
	"request_hash" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "outgoing_payments_voucher_no_ck" CHECK ("outgoing_payments"."voucher_no" > 0),
	CONSTRAINT "outgoing_payments_kind_ck" CHECK ("outgoing_payments"."kind" in ('expense','doctor_refund')),
	CONSTRAINT "outgoing_payments_party_ck" CHECK (("outgoing_payments"."kind" = 'doctor_refund') = ("outgoing_payments"."doctor_id" is not null)
          and ("outgoing_payments"."kind" = 'expense') = ("outgoing_payments"."payee" is not null)),
	CONSTRAINT "outgoing_payments_payee_length_ck" CHECK (char_length("outgoing_payments"."payee") between 1 and 100),
	CONSTRAINT "outgoing_payments_method_ck" CHECK ("outgoing_payments"."method" in ('cash','cheque','transfer')),
	CONSTRAINT "outgoing_payments_amount_ck" CHECK ("outgoing_payments"."amount" > 0 and "outgoing_payments"."amount" <= 999999999999),
	CONSTRAINT "outgoing_payments_currency_code_length_ck" CHECK (char_length("outgoing_payments"."currency_code") between 1 and 10),
	CONSTRAINT "outgoing_payments_notes_length_ck" CHECK (char_length("outgoing_payments"."notes") <= 500),
	CONSTRAINT "outgoing_payments_status_ck" CHECK ("outgoing_payments"."status" in ('active','void')),
	CONSTRAINT "outgoing_payments_void_ck" CHECK (("outgoing_payments"."status" = 'void') = ("outgoing_payments"."voided_at" is not null)
          and ("outgoing_payments"."status" = 'void') = ("outgoing_payments"."void_reason" is not null)
          and ("outgoing_payments"."void_reason" is null or char_length("outgoing_payments"."void_reason") between 1 and 300)),
	CONSTRAINT "outgoing_payments_idempotency_ck" CHECK (("outgoing_payments"."idempotency_key" is null) = ("outgoing_payments"."request_hash" is null)),
	CONSTRAINT "outgoing_payments_row_version_ck" CHECK ("outgoing_payments"."row_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "cheques" ALTER COLUMN "payment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "cheques" ADD COLUMN "outgoing_payment_id" bigint;--> statement-breakpoint
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_payments" ADD CONSTRAINT "outgoing_payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outgoing_payments_voucher_no_uq" ON "outgoing_payments" USING btree ("voucher_no");--> statement-breakpoint
CREATE UNIQUE INDEX "outgoing_payments_idempotency_key_uq" ON "outgoing_payments" USING btree ("idempotency_key") WHERE "outgoing_payments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "outgoing_payments_paid_ix" ON "outgoing_payments" USING btree ("paid_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outgoing_payments_category_ix" ON "outgoing_payments" USING btree ("category_id","paid_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "outgoing_payments_doctor_ix" ON "outgoing_payments" USING btree ("doctor_id","paid_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "outgoing_payments"."doctor_id" is not null;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_outgoing_payment_id_outgoing_payments_id_fk" FOREIGN KEY ("outgoing_payment_id") REFERENCES "public"."outgoing_payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cheques_outgoing_payment_uq" ON "cheques" USING btree ("outgoing_payment_id") WHERE "cheques"."outgoing_payment_id" is not null;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_owner_ck" CHECK (("cheques"."payment_id" is null) <> ("cheques"."outgoing_payment_id" is null));--> statement-breakpoint
-- Hand-written reference data (system, not business seed), B4b.
-- Voucher numbers OUT-000001…: gap-free, start at 1, not owner-settable (SPEC §7.7); a series apart from IN-.
INSERT INTO "counters" ("name", "start_value", "next_value") VALUES ('payment_out_no', 1, 1)
  ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
INSERT INTO "permissions" ("code") VALUES
  ('expenses.read'), ('expenses.write'), ('expenses.void')
  ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_code")
  SELECT r."id", p."code" FROM "roles" r CROSS JOIN "permissions" p
  WHERE r."code" = 'owner'
  ON CONFLICT DO NOTHING;
