-- Auditable, manually reviewed remediation. Do not run automatically.
-- Before running, set the authenticated actor UUID in the session:
--   SET app.actor_id = '00000000-0000-0000-0000-000000000000';
-- The actor must be an existing User. Review the target rows before COMMIT.

BEGIN;

CREATE TEMP TABLE report_safe_7_targets (serial_number TEXT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO report_safe_7_targets (serial_number) VALUES
  ('DT27347W'), ('DT27365W'), ('DT27035W'), ('DT27060W'), ('DT27104W'),
  ('ST04997R'), ('DT18109W'), ('ST24621R'), ('DT22217W'), ('ST06534R');

CREATE TEMP TABLE report_safe_7_changes ON COMMIT DROP AS
SELECT gun.id, gun."serialNumber", gun."reportedSafe"
FROM "Gun" AS gun
JOIN report_safe_7_targets AS target ON target.serial_number = gun."serialNumber"
WHERE gun."reportedSafe" IS DISTINCT FROM 7;

SELECT id, "serialNumber", "reportedSafe" AS previous_reported_safe
FROM report_safe_7_changes
ORDER BY "serialNumber";

UPDATE "Gun" AS gun
SET "reportedSafe" = 7, "updatedAt" = CURRENT_TIMESTAMP
FROM report_safe_7_changes AS change
WHERE gun.id = change.id;

INSERT INTO "ActivityEvent" ("actorId", action, "entityType", "entityId", reason, "beforeJson", "afterJson")
SELECT current_setting('app.actor_id')::uuid,
       'GUN_REPORTED_SAFE_SET',
       'Gun',
       change.id::text,
       'Reviewed legacy import remediation: reported safe set to Safe 7',
       jsonb_build_object('reportedSafe', change."reportedSafe"),
       jsonb_build_object('reportedSafe', 7)
FROM report_safe_7_changes AS change;

SELECT gun."serialNumber", gun."reportedSafe"
FROM "Gun" AS gun
JOIN report_safe_7_targets AS target ON target.serial_number = gun."serialNumber"
ORDER BY gun."serialNumber";

-- COMMIT only after reviewing both result sets; otherwise ROLLBACK.
-- COMMIT;
-- ROLLBACK;
