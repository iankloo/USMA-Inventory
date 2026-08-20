-- The application and worker accept storage slots through 28. Replace the
-- original 1–24 database check so imports can persist the full armory layout.
ALTER TABLE "StorageLocation" DROP CONSTRAINT IF EXISTS "StorageLocation_slot_check";
ALTER TABLE "StorageLocation"
  ADD CONSTRAINT "StorageLocation_slot_check" CHECK ("slot" BETWEEN 1 AND 28);
