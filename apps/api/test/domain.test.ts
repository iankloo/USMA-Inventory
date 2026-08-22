import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { auditNameKey, auditStartSchema, gunDetailsUpdateSchema, gunInputSchema, normalizeAuditName, normalizeSerial, parseOrThrow, reconciliationSchema, returnLocationSchema } from "../src/domain.js";
import { asHttpError } from "../src/errors.js";

test("serials are normalized consistently for QR scans and imports", () => {
  assert.equal(normalizeSerial("  wp-123  "), "WP-123");
});

test("gun input allows a safe-only report, rejects slot-only input, and validates bounds", () => {
  const valid = gunInputSchema.parse({ serialNumber: "A-1", model: "Model", gauge: "12", type: "SKEET", highRib: true, safe: 2, slot: 28 });
  assert.equal(valid.safe, 2);
  const safeOnly = gunInputSchema.parse({ serialNumber: "A-2", model: "Model", safe: 7 });
  assert.equal(safeOnly.safe, 7);
  assert.equal(safeOnly.slot, undefined);
  assert.throws(() => gunInputSchema.parse({ serialNumber: "A-3", model: "Model", slot: 1 }));
  assert.throws(() => gunInputSchema.parse({ serialNumber: "A-1", model: "Model", gauge: "12", type: "SKEET", highRib: true, safe: 8, slot: 1 }));
});

test("gun detail updates validate descriptive fields and reject identity/location fields", () => {
  const details = gunDetailsUpdateSchema.parse({ model: "Beretta 694", gauge: null, owner: "DCA", barrelLength: 32, lengthOfPull: 14.375, handedness: "RIGHT", type: "SPORTING", highRib: true });
  assert.equal(details.model, "Beretta 694");
  assert.equal(details.gauge, null);
  assert.throws(() => gunDetailsUpdateSchema.parse({ serialNumber: "NEW-SERIAL" }));
  assert.throws(() => gunDetailsUpdateSchema.parse({ model: "" }));
  assert.throws(() => gunDetailsUpdateSchema.parse({ barrelLength: 0 }));
});

test("reconciliation requires a reviewed non-empty serial set", () => {
  assert.equal(reconciliationSchema.parse({ sourceName: "October report", serials: ["A-1"] }).serials.length, 1);
  assert.throws(() => parseOrThrow(reconciliationSchema, { sourceName: "October report", serials: [] }));
});

test("audit name validation rejects blank names", () => {
  assert.throws(() => auditStartSchema.parse({ name: "  " }));
});

test("audit names normalize whitespace and compare case-insensitively", () => {
  const normalized = normalizeAuditName("  September   Monthly\nInventory  ");
  assert.equal(normalized, "September Monthly Inventory");
  assert.equal(auditNameKey(normalized), auditNameKey("september monthly inventory"));
});

test("database duplicate audit names map to a stable conflict", () => {
  const error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
    meta: { target: ["InventoryAudit_nameKey_key"] }
  });
  const normalized = asHttpError(error);
  assert.equal(normalized.statusCode, 409);
  assert.equal(normalized.code, "AUDIT_NAME_EXISTS");
});

test("return location is optional but safe and slot must be supplied together", () => {
  assert.deepEqual(returnLocationSchema.parse(undefined), undefined);
  assert.deepEqual(returnLocationSchema.parse({}), {});
  assert.deepEqual(returnLocationSchema.parse({ safe: 2, slot: 1 }), { safe: 2, slot: 1 });
  assert.throws(() => returnLocationSchema.parse({ safe: 2 }));
});

test("stored location conflicts map to a stable conflict", () => {
  const error = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
    meta: { target: ["Gun_one_active_stored_location_key"] }
  });
  const normalized = asHttpError(error);
  assert.equal(normalized.statusCode, 409);
  assert.equal(normalized.code, "LOCATION_OCCUPIED");
});

test("expired Cognito access tokens require a new sign-in instead of returning a server error", () => {
  const error = Object.assign(new Error("JWT expired"), { code: "ERR_JWT_EXPIRED" });
  const normalized = asHttpError(error);
  assert.equal(normalized.statusCode, 401);
  assert.equal(normalized.code, "SESSION_EXPIRED");
});
