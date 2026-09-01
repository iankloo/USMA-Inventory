-- Fit information is optional because older inventory imports did not include it.
ALTER TABLE "Gun" ADD COLUMN "adjustableComb" BOOLEAN;
