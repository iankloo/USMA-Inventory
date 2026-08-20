-- Audit names remain human-readable, while nameKey provides deterministic
-- case-insensitive uniqueness after collapsing runs of whitespace.
ALTER TABLE "InventoryAudit" ADD COLUMN "nameKey" TEXT;

-- Backfill without deleting or merging legacy audits. Rows are processed in a
-- stable order, so the earliest row keeps the normalized base name. Later
-- rows receive "(2)", "(3)", etc. If a suffix is already occupied by another
-- legacy name, keep incrementing until the key is free.
DO $$
DECLARE
  audit_row RECORD;
  base_name TEXT;
  candidate_name TEXT;
  candidate_key TEXT;
  suffix_number INTEGER;
BEGIN
  FOR audit_row IN
    SELECT "id", "name"
    FROM "InventoryAudit"
    ORDER BY "createdAt" ASC, "id" ASC
  LOOP
    base_name := regexp_replace(trim(audit_row."name"), '\s+', ' ', 'g');
    candidate_name := base_name;
    candidate_key := lower(candidate_name);
    suffix_number := 1;

    WHILE EXISTS (
      SELECT 1
      FROM "InventoryAudit"
      WHERE "nameKey" = candidate_key
    ) LOOP
      suffix_number := suffix_number + 1;
      candidate_name := base_name || ' (' || suffix_number::TEXT || ')';
      candidate_key := lower(candidate_name);
    END LOOP;

    UPDATE "InventoryAudit"
    SET "name" = candidate_name, "nameKey" = candidate_key
    WHERE "id" = audit_row."id";
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION normalize_inventory_audit_name() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."name" := regexp_replace(trim(NEW."name"), '\s+', ' ', 'g');
  NEW."nameKey" := lower(NEW."name");
  RETURN NEW;
END;
$$;

CREATE TRIGGER inventory_audit_name_normalized
  BEFORE INSERT OR UPDATE OF "name", "nameKey" ON "InventoryAudit"
  FOR EACH ROW EXECUTE FUNCTION normalize_inventory_audit_name();

ALTER TABLE "InventoryAudit" ALTER COLUMN "nameKey" SET NOT NULL;
CREATE UNIQUE INDEX "InventoryAudit_nameKey_key" ON "InventoryAudit"("nameKey");
