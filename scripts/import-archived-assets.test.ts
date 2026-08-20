import assert from "node:assert/strict";
import test from "node:test";
import {
  LOCAL_ARCHIVE_ACTOR_ID,
  importArchivedAssets,
  normalizeArchivedAssetsCsv,
  parseArchivedAssetsCsv
} from "./import-archived-assets.ts";

const csv = [
  "Serial Number,Model,Owner,Handedness,Barrel Length,LOP,Model Type,Gauge,High-Rib,Status,Created Date",
  'ARCH-1,"Beretta, 686",DCA,Left,30 in,14 3/8 in,Trap Doubles,12,Yes,Sold to Graduated Cadet,2020-01-02',
  "ARCH-2,ACS,Vittoria,Right,invalid,14.25,ACS,20,No,Donated,2021-02-03",
  ",,,Right,,,,,,Withdrawn,"
].join("\n");

test("parses quoted cells and normalizes the legacy archive field policy", () => {
  const records = parseArchivedAssetsCsv(csv);
  assert.equal(records.length, 3);
  assert.equal(records[0].values.model, "Beretta, 686");

  const normalized = normalizeArchivedAssetsCsv(csv);
  assert.deepEqual(normalized.rows[0], {
    sourceRow: 2,
    serialNumber: "ARCH-1",
    model: "Beretta, 686",
    owner: "DCA",
    handedness: "LEFT",
    barrelLength: 30,
    lengthOfPull: 14.375,
    type: "TRAP",
    status: "Sold to Graduated Cadet",
    createdAt: new Date("2020-01-02"),
    usedFallbackSerial: false,
    usedFallbackModel: false
  });
  assert.equal(normalized.rows[0].type, "TRAP");
  assert.equal(normalized.rows[1].type, null);
  assert.equal(normalized.rows[1].barrelLength, null);
  assert.equal(normalized.rows[1].owner, "Vittoria");
  assert.equal(normalized.rows[2].serialNumber, "ARCHIVED-LEGACY-4");
  assert.equal(normalized.rows[2].model, "Unknown legacy archived gun");
  assert.ok(normalized.warnings.some((warning) => warning.includes("barrel length")));
});

test("creates archived guns and actor events, then skips the same rows on rerun", async () => {
  const guns = new Map<string, any>();
  const events: any[] = [];
  const gun = {
    findUnique: async ({ where }: any) => guns.get(where.serialNumber) ?? null,
    create: async ({ data }: any) => {
      const created = { id: `gun-${guns.size + 1}`, ...data };
      guns.set(data.serialNumber, created);
      return created;
    }
  };
  const prisma = {
    user: { findUnique: async ({ where }: any) => where.id === LOCAL_ARCHIVE_ACTOR_ID ? { id: where.id, status: "ACTIVE" } : null },
    gun,
    $transaction: async (callback: any) => callback({ gun, activityEvent: { create: async ({ data }: any) => { events.push(data); return data; } } })
  } as any;
  const rows = normalizeArchivedAssetsCsv(csv).rows.slice(0, 2);
  const first = await importArchivedAssets(prisma, rows);
  assert.deepEqual(first, { rows: 2, created: 2, skipped: 0, conflicts: [], warnings: [], dryRun: false });
  assert.equal(events.length, 2);
  assert.equal(events[0].actorId, LOCAL_ARCHIVE_ACTOR_ID);
  assert.equal(events[0].action, "GUN_ARCHIVED");
  assert.match(events[0].reason, /Sold to Graduated Cadet/);
  assert.equal(events[0].afterJson.lifecycle, "ARCHIVED");
  assert.equal(events[0].afterJson.locationId, null);
  assert.equal(events[0].afterJson.gauge, null);
  assert.equal(events[0].afterJson.highRib, null);

  const second = await importArchivedAssets(prisma, rows);
  assert.deepEqual(second, { rows: 2, created: 0, skipped: 2, conflicts: [], warnings: [], dryRun: false });
});

test("reports a conflict instead of changing an existing active serial", async () => {
  const existing = { id: "gun-existing", serialNumber: "ARCH-1", lifecycle: "ACTIVE", state: "STORED", model: "Different model", locationId: null, lastStoredLocationId: null, assignments: [], custody: [], gauge: null, highRib: null };
  const prisma = {
    user: { findUnique: async () => ({ id: LOCAL_ARCHIVE_ACTOR_ID, status: "ACTIVE" }) },
    gun: { findUnique: async () => existing },
    $transaction: async () => { throw new Error("must not write conflicts"); }
  } as any;
  const report = await importArchivedAssets(prisma, normalizeArchivedAssetsCsv(csv).rows.slice(0, 1));
  assert.equal(report.created, 0);
  assert.equal(report.conflicts.length, 1);
  assert.match(report.conflicts[0].reason, /different data|active inventory state/);
});
