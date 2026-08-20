-- Preserve legacy records that identify a safe but do not identify a slot.
ALTER TABLE "Gun" ADD COLUMN "reportedSafe" INTEGER;
ALTER TABLE "Gun"
  ADD CONSTRAINT "Gun_reportedSafe_check" CHECK ("reportedSafe" BETWEEN 2 AND 7);
