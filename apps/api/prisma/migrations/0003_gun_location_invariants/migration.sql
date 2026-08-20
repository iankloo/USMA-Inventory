-- Keep the last known storage location while a gun is checked out or in repair.
ALTER TABLE "Gun" ADD COLUMN "lastStoredLocationId" UUID;
UPDATE "Gun" SET "lastStoredLocationId" = "locationId";

-- Preserve every gun while repairing any legacy duplicate occupancy. The
-- earliest active stored gun keeps the location; later duplicates become
-- unassigned stored guns but retain the location as their lastStoredLocationId
-- for audit/reconciliation and manual correction.
WITH duplicates AS (
  SELECT "id",
         row_number() OVER (PARTITION BY "locationId" ORDER BY "createdAt" ASC, "id" ASC) AS row_number
  FROM "Gun"
  WHERE "lifecycle" = 'ACTIVE'
    AND "state" = 'STORED'
    AND "locationId" IS NOT NULL
)
UPDATE "Gun" AS gun
SET "locationId" = NULL
FROM duplicates
WHERE gun."id" = duplicates."id"
  AND duplicates.row_number > 1;

ALTER TABLE "Gun"
  ADD CONSTRAINT "Gun_lastStoredLocationId_fkey"
  FOREIGN KEY ("lastStoredLocationId") REFERENCES "StorageLocation"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- A location is single-occupancy only for active guns currently stored in the
-- armory. Checked-out, repair, and archived guns have no current slot claim.
CREATE UNIQUE INDEX "Gun_one_active_stored_location_key"
  ON "Gun"("locationId")
  WHERE "lifecycle" = 'ACTIVE' AND "state" = 'STORED' AND "locationId" IS NOT NULL;
