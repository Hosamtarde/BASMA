-- Hand-written reference data (no tables): B4 permissions.
-- exports.run: take data out as CSV, on top of the permission to read it.
-- search.use: global search; each result group still needs its own read permission.
INSERT INTO "permissions" ("code") VALUES ('exports.run'), ('search.use')
  ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_code")
  SELECT r."id", p."code" FROM "roles" r CROSS JOIN "permissions" p
  WHERE r."code" = 'owner' AND p."code" IN ('exports.run', 'search.use')
  ON CONFLICT DO NOTHING;
