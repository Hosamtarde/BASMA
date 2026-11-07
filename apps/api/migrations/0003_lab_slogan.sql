-- F2c: optional lab slogan shown under the lab name on Home. The lab profile is a JSON value in
-- "settings", so no column changes; existing installs get "slogan": null so every stored profile
-- has the same shape. Additive and idempotent (rows that already have the key are left alone).
UPDATE "settings"
SET "value" = "value" || '{"slogan": null}'::jsonb
WHERE "key" = 'lab_profile' AND NOT ("value" ? 'slogan');
