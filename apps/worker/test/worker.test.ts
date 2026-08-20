import assert from "node:assert/strict";
import test from "node:test";
import { generateEvidencePackage } from "../src/evidence.js";
import { prepareLegacyInventory, validateCsvGunImport } from "../src/import.js";
import { extractPdfSerials, extractSerialsFromText } from "../src/pdf.js";
import { reconcileSerials } from "../src/reconcile.js";
import { deduplicateSerials, normalizeSerial } from "../src/serial.js";

test("normalizes serial separators and detects duplicates", () => {
  assert.equal(normalizeSerial(" ab-12 / 3 "), "AB123");
  assert.deepEqual(deduplicateSerials(["AB-123", "ab123", "bad"]).duplicates, [{ serial: "AB123", occurrences: [1, 2] }]);
});

test("validates CSV fields, location ranges, and explicit create/update decisions", () => {
  const csv = [
    "Serial Number,Model,Type,High-Rib,Safe,Slot",
    "AB-123,Model A,skeet,yes,2,1",
    "CD-456,Model B,trap,no,7,24"
  ].join("\n");
  const result = validateCsvGunImport(csv, { existingSerials: ["AB123"] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.rows.map((row) => [row.serialNumber, row.decision]), [["AB123", "update"], ["CD456", "create"]]);

  const invalid = validateCsvGunImport("serial,safe,slot\nEF-789,8,1\nGH-000,,1", { mode: "create-only" });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.some((issue) => issue.code === "safe-out-of-range"));
  assert.ok(invalid.issues.some((issue) => issue.code === "incomplete-location"));
});

test("prepares legacy fields without inventing unknown values and resolves occupied slots deterministically", () => {
  const prepared = prepareLegacyInventory([
    { serialNumber: "R74361S", model: "Beretta", modelType: "Trap 1", owner: "Beretta", safe: 6, slot: 23, "Asset Tag": "discard-me" },
    { serialNumber: "AS19291", model: "Beretta", modelType: "Trap 2", owner: "Beretta", safe: 6, slot: 23 },
    { serialNumber: "UNKNOWN-1", model: "ACS", modelType: "ACS", gauge: "", highRib: "", owner: "Vittoria" },
  ], { occupiedLocations: [{ safe: 6, slot: 22 }, { safe: 6, slot: 24 }] });
  assert.equal(prepared.validation.valid, true);
  assert.deepEqual(prepared.validation.rows.map((row) => [row.serialNumber, row.type, row.owner, row.safe, row.slot]), [
    ["R74361S", "trap", "Beretta", 6, 23],
    ["AS19291", "trap", "Beretta", 6, 21],
    ["UNKNOWN1", undefined, "Vittoria", undefined, undefined],
  ]);
  assert.equal(prepared.validation.rows[2]?.gauge, undefined);
  assert.equal(prepared.validation.rows[2]?.highRib, undefined);
  assert.match(prepared.warnings[0] ?? "", /AS19291 moved from Safe 6 · Slot 23 to Safe 6 · Slot 21/);
});

test("legacy CSV Location and Safe Slot headers survive preview normalization", () => {
  const result = validateCsvGunImport([
    "Serial Number,Location,Safe Slot,Model,Model Type,Owner",
    "R74361S,Safe 6,23,Beretta,Trap 1,Beretta",
    "AS19291,Safe 6,23,Beretta,Trap 2,Beretta",
    ",Safe 6,24,Blank,ACS,Vittoria",
  ].join("\n"), {
    occupiedLocations: [
      { safe: 6, slot: 22 },
      { safe: 6, slot: 24 },
    ],
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.rows.map((row) => [row.serialNumber, row.safe, row.slot, row.type]), [
    ["R74361S", 6, 23, "trap"],
    ["AS19291", 6, 21, "trap"],
  ]);
  assert.equal(result.rows.length, 2);
  assert.ok(result.warnings?.some((warning) => warning.includes("AS19291") && warning.includes("Slot 21")));
});

test("legacy Safe-only locations become unknown while slots 25-28 are valid", () => {
  const result = validateCsvGunImport([
    "Serial Number,Location,Safe Slot,Model,Model Type",
    "SAFE-ONLY,Safe 6,,Beretta,Trap 1",
    "SLOT-28,Safe 6,28,Beretta,Trap 1",
    "SLOT-29,Safe 6,29,Beretta,Trap 1",
  ].join("\n"), {
    occupiedLocations: [{ safe: 6, slot: 22 }],
  });
  assert.equal(result.rows[0]?.safe, 6);
  assert.equal(result.rows[0]?.slot, undefined);
  assert.equal(result.rows[1]?.slot, 28);
  assert.equal(result.rows[2]?.slot, 29);
  assert.equal(result.issues.filter((issue) => issue.code === "incomplete-location").length, 0);
  assert.equal(result.issues.filter((issue) => issue.code === "slot-out-of-range").length, 1);
});

test("legacy imports allow a known safe without a slot but reject slot-only locations", () => {
  const result = validateCsvGunImport([
    "Serial Number,Location,Safe Slot,Model,Model Type",
    "SAFE-ONLY,Safe 7,,Beretta,Trap 1",
    "SLOT-ONLY,,11,Beretta,Trap 1",
  ].join("\n"));
  assert.equal(result.rows[0]?.safe, 7);
  assert.equal(result.rows[0]?.slot, undefined);
  assert.equal(result.rows[1]?.slot, 11);
  assert.ok(result.issues.some((issue) => issue.row === 3 && issue.code === "incomplete-location"));
});

test("legacy off-site locations clear stray safe slots", () => {
  const result = validateCsvGunImport([
    "Serial Number,Location,Safe Slot,Model,Model Type",
    "N80484S,Out for use,11,Beretta,Trap 1",
    "ST12299R,Out for Repairs,12,Beretta,Trap 1",
    "DT18343W,Wall,10,Beretta,Trap 1",
  ].join("\n"), { occupiedLocations: [{ safe: 6, slot: 10 }] });
  assert.equal(result.valid, true);
  assert.deepEqual(result.rows.map((row) => [row.serialNumber, row.safe, row.slot]), [
    ["N80484S", undefined, undefined],
    ["ST12299R", undefined, undefined],
    ["DT18343W", undefined, undefined],
  ]);
  assert.equal(result.issues.filter((issue) => issue.code === "incomplete-location").length, 0);
});

test("selectable text extraction filters to known snapshot serials and flags duplicates", () => {
  const result = extractSerialsFromText(["Report date 2026-08-01. AB-123 CD456 AB123.", "Other 99999"], { knownSerials: ["AB123", "CD456"] });
  assert.deepEqual(result.serials, ["AB123", "CD456"]);
  assert.deepEqual(result.duplicates, [{ serial: "AB123", occurrences: [1, 3] }]);
  assert.equal(result.sourceBytesDiscarded, true);
});

test("PDF extraction calls injected loader and exposes no source bytes", async () => {
  let received: Uint8Array | undefined;
  const result = await extractPdfSerials(new Uint8Array([1, 2, 3]), {
    knownSerials: ["AB123"],
    loadText: async (input) => {
      received = input;
      return ["AB-123"];
    }
  });
  assert.equal(received?.byteLength, 3);
  assert.deepEqual([...received!], [0, 0, 0]);
  assert.deepEqual(result.serials, ["AB123"]);
  assert.equal(Object.prototype.hasOwnProperty.call(result, "input"), false);
});

test("reconciliation reports missing, unknown, duplicate, and invalid external values", () => {
  const result = reconcileSerials({ snapshotSerials: ["AB-123", "CD456"], externalSerials: ["AB123", "AB-123", "ZZ999", "?"] });
  assert.deepEqual(result.matched, ["AB123"]);
  assert.deepEqual(result.missing, ["CD456"]);
  assert.deepEqual(result.unknown, ["ZZ999"]);
  assert.equal(result.duplicateExternal[0]?.serial, "AB123");
  assert.equal(result.status, "needs-review");
});

test("evidence package requires a resolved finalized snapshot and emits CSV/PDF", () => {
  const evidence = {
    auditId: "audit-2026-08",
    startedAt: "2026-08-01T10:00:00Z",
    physicalCountFinalizedAt: "2026-08-01T12:00:00Z",
    finalizedBy: "armorer@example.test",
    snapshotSerials: ["AB123", "CD456"],
    items: [
      { serial: "CD-456", resolution: "repair-verified" as const, resolvedAt: "2026-08-01T11:00:00Z", actor: "armorer@example.test", reason: "Vendor return checked", eventReferences: ["evt-2"] },
      { serial: "AB123", resolution: "scanned" as const, resolvedAt: "2026-08-01T10:30:00Z", actor: "armorer@example.test", eventReferences: ["evt-1"] }
    ]
  };
  const result = generateEvidencePackage(evidence);
  assert.match(result.csv, /audit-2026-08/);
  assert.match(result.csv, /AB123/);
  assert.equal(Buffer.from(result.pdf).subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.throws(() => generateEvidencePackage({ ...evidence, items: evidence.items.slice(0, 1) }), /unresolved/);
});
