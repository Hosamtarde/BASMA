CREATE TABLE "cheque_status_history" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cheque_status_history_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"cheque_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"status_date" date NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text,
	"user_id" bigint,
	CONSTRAINT "cheque_status_history_from_ck" CHECK ("cheque_status_history"."from_status" is null or "cheque_status_history"."from_status" in ('pending','cleared','returned')),
	CONSTRAINT "cheque_status_history_to_ck" CHECK ("cheque_status_history"."to_status" in ('pending','cleared','returned')),
	CONSTRAINT "cheque_status_history_note_length_ck" CHECK (char_length("cheque_status_history"."note") <= 300)
);
--> statement-breakpoint
CREATE TABLE "cheques" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cheques_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"payment_id" bigint NOT NULL,
	"cheque_no" text NOT NULL,
	"bank" text NOT NULL,
	"due_date" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"status_date" date,
	"row_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" bigint,
	CONSTRAINT "cheques_cheque_no_length_ck" CHECK (char_length("cheques"."cheque_no") between 1 and 30),
	CONSTRAINT "cheques_bank_length_ck" CHECK (char_length("cheques"."bank") between 1 and 60),
	CONSTRAINT "cheques_status_ck" CHECK ("cheques"."status" in ('pending','cleared','returned')),
	CONSTRAINT "cheques_status_date_ck" CHECK (("cheques"."status" = 'pending') = ("cheques"."status_date" is null)),
	CONSTRAINT "cheques_row_version_ck" CHECK ("cheques"."row_version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "payments_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"voucher_no" bigint NOT NULL,
	"doctor_id" bigint NOT NULL,
	"case_id" bigint,
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
	CONSTRAINT "payments_voucher_no_ck" CHECK ("payments"."voucher_no" > 0),
	CONSTRAINT "payments_method_ck" CHECK ("payments"."method" in ('cash','cheque','transfer')),
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount" > 0 and "payments"."amount" <= 999999999999),
	CONSTRAINT "payments_currency_code_length_ck" CHECK (char_length("payments"."currency_code") between 1 and 10),
	CONSTRAINT "payments_notes_length_ck" CHECK (char_length("payments"."notes") <= 500),
	CONSTRAINT "payments_status_ck" CHECK ("payments"."status" in ('active','void')),
	CONSTRAINT "payments_void_ck" CHECK (("payments"."status" = 'void') = ("payments"."voided_at" is not null)
          and ("payments"."status" = 'void') = ("payments"."void_reason" is not null)
          and ("payments"."void_reason" is null or char_length("payments"."void_reason") between 1 and 300)),
	CONSTRAINT "payments_idempotency_ck" CHECK (("payments"."idempotency_key" is null) = ("payments"."request_hash" is null)),
	CONSTRAINT "payments_row_version_ck" CHECK ("payments"."row_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "cheque_status_history" ADD CONSTRAINT "cheque_status_history_cheque_id_cheques_id_fk" FOREIGN KEY ("cheque_id") REFERENCES "public"."cheques"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheque_status_history" ADD CONSTRAINT "cheque_status_history_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cheques" ADD CONSTRAINT "cheques_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_voided_by_users_id_fk" FOREIGN KEY ("voided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cheque_status_history_cheque_ix" ON "cheque_status_history" USING btree ("cheque_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "cheques_payment_uq" ON "cheques" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "cheques_status_due_ix" ON "cheques" USING btree ("status","due_date");--> statement-breakpoint
CREATE INDEX "cheques_due_ix" ON "cheques" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "cheques_bank_no_ix" ON "cheques" USING btree (lower("bank"),"cheque_no");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_voucher_no_uq" ON "payments" USING btree ("voucher_no");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_key_uq" ON "payments" USING btree ("idempotency_key") WHERE "payments"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "payments_doctor_paid_ix" ON "payments" USING btree ("doctor_id","paid_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_paid_ix" ON "payments" USING btree ("paid_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "payments_case_ix" ON "payments" USING btree ("case_id") WHERE "payments"."case_id" is not null;--> statement-breakpoint
-- Hand-written reference data (system, not business seed).
-- Voucher numbers IN-000001…: gap-free, start at 1, not owner-settable (SPEC §7.7).
INSERT INTO "counters" ("name", "start_value", "next_value") VALUES ('payment_in_no', 1, 1)
  ON CONFLICT ("name") DO NOTHING;--> statement-breakpoint
INSERT INTO "permissions" ("code") VALUES
  ('payments.read'), ('payments.write'), ('payments.void'),
  ('cheques.read'), ('cheques.write'),
  ('ledger.read')
  ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_code")
  SELECT r."id", p."code" FROM "roles" r CROSS JOIN "permissions" p
  WHERE r."code" = 'owner'
  ON CONFLICT DO NOTHING;
