CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE "UserRole" AS ENUM ('OPERATOR', 'ACCOUNT_ADMIN');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "GunLifecycle" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "GunState" AS ENUM ('STORED', 'CHECKED_OUT', 'REPAIR');
CREATE TYPE "CustodyKind" AS ENUM ('CHECKOUT', 'REPAIR');
CREATE TYPE "CustodyStatus" AS ENUM ('ACTIVE', 'RETURNED');
CREATE TYPE "AuditStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'PHYSICAL_FINALIZED', 'COMPLETE');
CREATE TYPE "AuditItemStatus" AS ENUM ('UNRESOLVED', 'SCANNED', 'REPAIR_VERIFIED', 'EXCEPTION');
CREATE TYPE "ScanResult" AS ENUM ('MATCHED', 'DUPLICATE', 'UNEXPECTED', 'ARCHIVED', 'INVALID');
CREATE TYPE "ReconciliationResult" AS ENUM ('MATCHED', 'MISSING_FROM_EXTERNAL', 'UNKNOWN_EXTERNAL', 'DUPLICATE_EXTERNAL');

CREATE TABLE "User" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "cognitoSubject" TEXT NOT NULL, "email" TEXT NOT NULL,
  "displayName" TEXT NOT NULL, "role" "UserRole" NOT NULL DEFAULT 'OPERATOR', "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_cognitoSubject_key" ON "User"("cognitoSubject");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "StorageLocation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "safe" INTEGER NOT NULL, "slot" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StorageLocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StorageLocation_safe_slot_key" ON "StorageLocation"("safe", "slot");
CREATE INDEX "StorageLocation_safe_idx" ON "StorageLocation"("safe");
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_safe_check" CHECK ("safe" BETWEEN 2 AND 7);
ALTER TABLE "StorageLocation" ADD CONSTRAINT "StorageLocation_slot_check" CHECK ("slot" BETWEEN 1 AND 24);

CREATE TABLE "Gun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "serialNumber" TEXT NOT NULL, "lifecycle" "GunLifecycle" NOT NULL DEFAULT 'ACTIVE',
  "state" "GunState" NOT NULL DEFAULT 'STORED', "model" TEXT NOT NULL, "gauge" TEXT NOT NULL, "barrelLength" DECIMAL(6,2),
  "lengthOfPull" DECIMAL(6,2), "handedness" TEXT, "type" TEXT NOT NULL, "highRib" BOOLEAN NOT NULL,
  "locationId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Gun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Gun_serialNumber_key" ON "Gun"("serialNumber");
CREATE INDEX "Gun_lifecycle_state_idx" ON "Gun"("lifecycle", "state");
CREATE INDEX "Gun_model_idx" ON "Gun"("model");
ALTER TABLE "Gun" ADD CONSTRAINT "Gun_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StorageLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CadetAssignment" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "gunId" UUID NOT NULL, "cadetName" TEXT NOT NULL, "cadetId" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endsAt" TIMESTAMP(3), "createdById" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CadetAssignment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CadetAssignment_gunId_endsAt_idx" ON "CadetAssignment"("gunId", "endsAt");
ALTER TABLE "CadetAssignment" ADD CONSTRAINT "CadetAssignment_gunId_fkey" FOREIGN KEY ("gunId") REFERENCES "Gun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CadetAssignment" ADD CONSTRAINT "CadetAssignment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "CustodyRecord" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "gunId" UUID NOT NULL, "kind" "CustodyKind" NOT NULL, "status" "CustodyStatus" NOT NULL DEFAULT 'ACTIVE',
  "personName" TEXT, "personEmail" TEXT, "vendor" TEXT, "reason" TEXT, "notes" TEXT, "checkedOutAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expectedReturn" TIMESTAMP(3), "returnedAt" TIMESTAMP(3), "openedById" UUID NOT NULL, "closedById" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustodyRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustodyRecord_gunId_status_idx" ON "CustodyRecord"("gunId", "status");
CREATE UNIQUE INDEX "CustodyRecord_one_active_gun_key" ON "CustodyRecord"("gunId") WHERE "status" = 'ACTIVE';
ALTER TABLE "CustodyRecord" ADD CONSTRAINT "CustodyRecord_gunId_fkey" FOREIGN KEY ("gunId") REFERENCES "Gun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustodyRecord" ADD CONSTRAINT "CustodyRecord_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustodyRecord" ADD CONSTRAINT "CustodyRecord_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "InventoryAudit" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "name" TEXT NOT NULL, "status" "AuditStatus" NOT NULL DEFAULT 'DRAFT', "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "physicalFinalizedAt" TIMESTAMP(3), "completedAt" TIMESTAMP(3), "startedById" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InventoryAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InventoryAudit_status_startedAt_idx" ON "InventoryAudit"("status", "startedAt");
ALTER TABLE "InventoryAudit" ADD CONSTRAINT "InventoryAudit_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AuditItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "auditId" UUID NOT NULL, "gunId" UUID NOT NULL, "serialNumber" TEXT NOT NULL, "status" "AuditItemStatus" NOT NULL DEFAULT 'UNRESOLVED', "resolvedAt" TIMESTAMP(3), "resolvedById" UUID, "resolutionNote" TEXT,
  CONSTRAINT "AuditItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AuditItem_auditId_gunId_key" ON "AuditItem"("auditId", "gunId");
CREATE INDEX "AuditItem_auditId_status_idx" ON "AuditItem"("auditId", "status");
ALTER TABLE "AuditItem" ADD CONSTRAINT "AuditItem_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "InventoryAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditItem" ADD CONSTRAINT "AuditItem_gunId_fkey" FOREIGN KEY ("gunId") REFERENCES "Gun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditItem" ADD CONSTRAINT "AuditItem_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "AuditScan" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "auditId" UUID NOT NULL, "serialNumber" TEXT NOT NULL, "result" "ScanResult" NOT NULL, "scannedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "scannedById" UUID NOT NULL,
  CONSTRAINT "AuditScan_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditScan_auditId_serialNumber_idx" ON "AuditScan"("auditId", "serialNumber");
ALTER TABLE "AuditScan" ADD CONSTRAINT "AuditScan_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "InventoryAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditScan" ADD CONSTRAINT "AuditScan_scannedById_fkey" FOREIGN KEY ("scannedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "Reconciliation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "auditId" UUID NOT NULL, "sourceName" TEXT NOT NULL, "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "reviewedById" UUID NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reconciliation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Reconciliation_auditId_key" ON "Reconciliation"("auditId");
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "InventoryAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reconciliation" ADD CONSTRAINT "Reconciliation_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ReconciliationSerial" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "reconciliationId" UUID NOT NULL, "serialNumber" TEXT NOT NULL, "result" "ReconciliationResult" NOT NULL,
  CONSTRAINT "ReconciliationSerial_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ReconciliationSerial_reconciliationId_serialNumber_key" ON "ReconciliationSerial"("reconciliationId", "serialNumber");
CREATE INDEX "ReconciliationSerial_reconciliationId_result_idx" ON "ReconciliationSerial"("reconciliationId", "result");
ALTER TABLE "ReconciliationSerial" ADD CONSTRAINT "ReconciliationSerial_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "Reconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ActivityEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(), "actorId" UUID NOT NULL, "action" TEXT NOT NULL, "entityType" TEXT NOT NULL, "entityId" TEXT NOT NULL, "reason" TEXT, "beforeJson" JSONB, "afterJson" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityEvent_entityType_entityId_createdAt_idx" ON "ActivityEvent"("entityType", "entityId", "createdAt");
CREATE INDEX "ActivityEvent_actorId_createdAt_idx" ON "ActivityEvent"("actorId", "createdAt");
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- History is append-only from the application role. These triggers also guard against accidental updates/deletes at the database boundary.
CREATE OR REPLACE FUNCTION prevent_activity_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ActivityEvent is immutable'; END; $$;
CREATE TRIGGER activity_event_immutable BEFORE UPDATE OR DELETE ON "ActivityEvent" FOR EACH ROW EXECUTE FUNCTION prevent_activity_event_mutation();
