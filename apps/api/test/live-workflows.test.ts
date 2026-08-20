import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

const actor = {
  id: "00000000-0000-0000-0000-000000000001",
  cognitoSubject: "local-armorer",
  email: "armorer@example.test",
  role: "ACCOUNT_ADMIN" as const
};

function authenticated() {
  return async () => actor;
}

test("inventory summary reports database counts instead of a UI constant", async () => {
  const counts: Record<string, number> = {
    ACTIVE: 1,
    ARCHIVED: 2,
    "ACTIVE:STORED": 1,
    "ACTIVE:CHECKED_OUT": 0,
    "ACTIVE:REPAIR": 0
  };
  const prisma = {
    gun: {
      count: async ({ where }: any) => counts[where.state ? `${where.lifecycle}:${where.state}` : where.lifecycle]
    }
  } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const response = await app.inject({ method: "GET", url: "/api/inventory/summary" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    total: 1,
    active: 1,
    archived: 2,
    stored: 1,
    checkedOut: 0,
    repair: 0,
    inRepair: 0,
    byState: { STORED: 1, CHECKED_OUT: 0, REPAIR: 0 }
  });
  await app.close();
});

test("current-user endpoint returns the persisted authenticated account", async () => {
  const prisma = {
    user: {
      findUnique: async ({ where, select }: any) => {
        assert.deepEqual(where, { id: actor.id });
        assert.deepEqual(select, { id: true, email: true, displayName: true, role: true, status: true });
        return { id: actor.id, email: actor.email, displayName: "Armory Operator", role: "ACCOUNT_ADMIN", status: "ACTIVE" };
      }
    }
  } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const response = await app.inject({ method: "GET", url: "/api/me" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { id: actor.id, email: actor.email, displayName: "Armory Operator", role: "ACCOUNT_ADMIN", status: "ACTIVE" });
  await app.close();
});

test("gun register search matches active cadet assignments case-insensitively", async () => {
  let receivedWhere: any;
  const prisma = {
    gun: {
      findMany: async ({ where }: any) => {
        receivedWhere = where;
        return [];
      }
    }
  } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const response = await app.inject({ method: "GET", url: "/api/guns?q=Martinez" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedWhere.OR, [
    { serialNumber: { contains: "MARTINEZ" } },
    { model: { contains: "Martinez", mode: "insensitive" } },
    { gauge: { contains: "Martinez", mode: "insensitive" } },
    { assignments: { some: { endsAt: null, cadetName: { contains: "Martinez", mode: "insensitive" } } } }
  ]);
  await app.close();
});

test("gun detail updates preserve identity and location while recording before and after event", async () => {
  const original = {
    id: "00000000-0000-0000-0000-000000000010",
    serialNumber: "WP-DETAIL-001",
    model: "Beretta 686",
    gauge: "12 ga",
    owner: "Beretta",
    barrelLength: 30,
    lengthOfPull: 14.375,
    handedness: "RIGHT",
    type: "SKEET",
    highRib: false,
    lifecycle: "ACTIVE",
    state: "STORED",
    locationId: "00000000-0000-0000-0000-000000000011",
    location: { safe: 6, slot: 21 },
    lastStoredLocation: { safe: 6, slot: 21 },
    assignments: [{ id: "assignment-1", cadetName: "C. Martinez", endsAt: null }],
    custody: []
  };
  let updatedData: any;
  const events: any[] = [];
  const updated = { ...original, model: "Beretta 694", owner: "DCA", highRib: true };
  const gun = {
    findUnique: async () => original,
    update: async ({ data }: any) => { updatedData = data; return updated; },
    findUniqueOrThrow: async () => updated
  };
  const tx = { gun, activityEvent: { create: async ({ data }: any) => { events.push(data); return data; } } };
  const prisma = { gun, activityEvent: tx.activityEvent, $transaction: async (callback: any) => callback(tx) } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const response = await app.inject({
    method: "PATCH",
    url: "/api/guns/WP-DETAIL-001",
    payload: { model: "Beretta 694", owner: "DCA", highRib: true }
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().serialNumber, "WP-DETAIL-001");
  assert.equal(response.json().location.safe, 6);
  assert.deepEqual(updatedData, { model: "Beretta 694", owner: "DCA", highRib: true });
  assert.equal(events[0].actorId, actor.id);
  assert.equal(events[0].action, "GUN_DETAILS_UPDATED");
  assert.equal(events[0].beforeJson.model, "Beretta 686");
  assert.equal(events[0].afterJson.model, "Beretta 694");

  const invalid = await app.inject({ method: "PATCH", url: "/api/guns/WP-DETAIL-001", payload: { model: "" } });
  assert.equal(invalid.statusCode, 400);
  await app.close();
});

test("global activity returns newest events with related gun metadata and filters", async () => {
  let gunLookups = 0;
  const prisma = {
    gun: {
      findMany: async () => gunLookups++ === 0
        ? [{ id: "gun-1" }]
        : [{ id: "gun-1", serialNumber: "WP-1", model: "Beretta 686" }]
    },
    activityEvent: {
      findMany: async ({ where, orderBy }: any) => {
        assert.deepEqual(where.OR, [
          { action: { contains: "WP-1", mode: "insensitive" } },
          { reason: { contains: "WP-1", mode: "insensitive" } },
          { entityType: "Gun", entityId: { in: ["gun-1"] } }
        ]);
        assert.deepEqual(where.action, { equals: "GUN_RETURNED" });
        assert.deepEqual(orderBy, { createdAt: "desc" });
        return [{ id: "event-1", action: "GUN_RETURNED", entityType: "Gun", entityId: "gun-1", actor: { id: actor.id, email: actor.email, displayName: "Armorer" }, createdAt: new Date("2026-08-18T12:00:00Z"), reason: "Returned after repair", beforeJson: null, afterJson: { state: "STORED" } }];
      }
    }
  } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const response = await app.inject({ method: "GET", url: "/api/activity?q=WP-1&action=GUN_RETURNED" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json()[0].relatedGun, { id: "gun-1", serialNumber: "WP-1", model: "Beretta 686" });
  await app.close();
});

test("audit list returns persisted audits with live resolution counts", async () => {
  const prisma = {
    inventoryAudit: {
      findMany: async () => [{
        id: "audit-1",
        name: "August count",
        status: "IN_PROGRESS",
        startedAt: new Date("2026-08-16T12:00:00Z"),
        physicalFinalizedAt: null,
        completedAt: null,
        startedBy: { id: actor.id, email: actor.email, displayName: "Armorer" },
        items: [{ status: "SCANNED" }, { status: "UNRESOLVED" }],
        reconciliation: null
      }]
    }
  } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const response = await app.inject({ method: "GET", url: "/api/audits" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), [{
    id: "audit-1",
    name: "August count",
    status: "IN_PROGRESS",
    startedAt: "2026-08-16T12:00:00.000Z",
    physicalFinalizedAt: null,
    completedAt: null,
    startedBy: { id: actor.id, email: actor.email, displayName: "Armorer" },
    itemCount: 2,
    counts: { UNRESOLVED: 1, SCANNED: 1, REPAIR_VERIFIED: 0, EXCEPTION: 0 },
    reconciliation: null
  }]);
  await app.close();
});

test("CSV import preview validates against persisted serials and commit appends actor events", async () => {
  const created = {
    id: "00000000-0000-0000-0000-000000000002",
    serialNumber: "WP-NEW-001",
    model: "Beretta 686",
    gauge: "12",
    barrelLength: 30,
    lengthOfPull: 14,
    handedness: "RIGHT",
    type: "SKEET",
    highRib: false,
    reportedSafe: null,
    locationId: null,
    lifecycle: "ACTIVE",
    state: "STORED"
  };
  const events: unknown[] = [];
  const gun = {
    findMany: async () => [],
    findUnique: async () => null,
    create: async ({ data }: any) => ({ ...created, ...data }),
    count: async () => 0
  };
  const prisma = {
    gun,
    storageLocation: { upsert: async () => ({ id: "00000000-0000-0000-0000-000000000003" }) },
    activityEvent: { create: async ({ data }: any) => { events.push(data); return data; } },
    $transaction: async (callback: any) => callback({ gun, storageLocation: prisma.storageLocation, activityEvent: prisma.activityEvent })
  } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const csv = "serialNumber,model,gauge,barrelLength,lengthOfPull,handedness,type,highRib,safe,slot\nWPNEW001,Beretta 686,12,30,14,RIGHT,skeet,no,2,28\n";
  const preview = await app.inject({ method: "POST", url: "/api/guns/import/preview", headers: { "content-type": "text/csv" }, payload: csv });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(preview.json().summary, { rows: 1, creates: 1, updates: 0, issues: 0 });
  const commit = await app.inject({ method: "POST", url: "/api/guns/import/commit", headers: { "content-type": "text/csv" }, payload: csv });
  assert.equal(commit.statusCode, 200);
  assert.deepEqual(commit.json(), { imported: 1, created: 1, updated: 0, rows: [{ serialNumber: "WPNEW001", decision: "create", gun: { ...created, serialNumber: "WPNEW001", locationId: "00000000-0000-0000-0000-000000000003", lastStoredLocationId: "00000000-0000-0000-0000-000000000003", barrelLength: "30", lengthOfPull: "14" } }] });
  assert.equal(events.length, 1);
  assert.equal((events[0] as any).actorId, actor.id);
  assert.equal((events[0] as any).action, "GUN_IMPORT_CREATED");
  await app.close();
});

test("legacy import permits blank gauge, type, and high-rib while preserving owner", async () => {
  const created = {
    id: "00000000-0000-0000-0000-000000000004",
    serialNumber: "LEGACY-001",
    model: "ACS",
    gauge: null,
    owner: "Vittoria",
    type: null,
    highRib: null,
    state: "STORED",
    lifecycle: "ACTIVE",
    locationId: null,
  };
  let createData: any;
  const gun = {
    findMany: async () => [],
    findUnique: async () => null,
    create: async ({ data }: any) => { createData = data; return { ...created, ...data }; },
  };
  const tx = {
    gun,
    activityEvent: { create: async ({ data }: any) => data },
  };
  const prisma = {
    gun,
    activityEvent: tx.activityEvent,
    $transaction: async (callback: any) => callback(tx),
  } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const csv = "Serial Number,Model,Owner,Model Type,Gauge,High-Rib\nLEGACY-001,ACS,Vittoria,ACS,,\n";
  const preview = await app.inject({ method: "POST", url: "/api/guns/import/preview", headers: { "content-type": "text/csv" }, payload: csv });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().valid, true);
  assert.equal(preview.json().rows[0].owner, "Vittoria");
  assert.equal(preview.json().rows[0].type, undefined);
  const commit = await app.inject({ method: "POST", url: "/api/guns/import/commit", headers: { "content-type": "text/csv" }, payload: csv });
  assert.equal(commit.statusCode, 200);
  assert.equal(createData.gauge, undefined);
  assert.equal(createData.type, undefined);
  assert.equal(createData.highRib, undefined);
  assert.equal(createData.owner, "Vittoria");
  await app.close();
});

test("legacy repair/use statuses and locations create actor-attributed custody and assignment follow-up records", async () => {
  const created = {
    id: "00000000-0000-0000-0000-000000000005",
    serialNumber: "LEGACY-002",
    model: "Beretta",
    gauge: null,
    owner: "Beretta",
    type: "TRAP",
    highRib: null,
    state: "REPAIR",
    lifecycle: "ACTIVE",
    locationId: null,
  };
  const events: any[] = [];
  const assignments: any[] = [];
  const custody: any[] = [];
  const gun = {
    findMany: async () => [],
    findUnique: async () => null,
    create: async ({ data }: any) => ({ ...created, ...data }),
  };
  const tx = {
    gun,
    cadetAssignment: {
      create: async ({ data }: any) => { assignments.push(data); return { id: "assignment-1", ...data }; },
    },
    custodyRecord: {
      create: async ({ data }: any) => { custody.push(data); return { id: "custody-1", ...data }; },
    },
    activityEvent: { create: async ({ data }: any) => { events.push(data); return data; } },
  };
  const prisma = { gun, $transaction: async (callback: any) => callback(tx) } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const csv = [
    "Serial Number,Model,Model Type,Status,Location,Assignee",
    "LEGACY-002,Beretta,Trap 1,Out for Repairs,,Cadet Example",
    "LEGACY-003,Beretta,Trap 1,Assigned,Out for use,",
  ].join("\n");
  const response = await app.inject({ method: "POST", url: "/api/guns/import/commit", headers: { "content-type": "text/csv" }, payload: csv });
  assert.equal(response.statusCode, 200);
  assert.equal(assignments[0].cadetName, "Cadet Example");
  assert.equal(custody[0].kind, "REPAIR");
  assert.equal(custody[0].vendor, "Beretta");
  assert.match(custody[0].reason, /Legacy import/);
  const checkout = custody.find((record) => record.kind === "CHECKOUT");
  assert.equal(checkout?.personName, "Unknown");
  assert.match(checkout?.reason ?? "", /Out for use/);
  assert.ok(events.some((event) => event.action === "CADET_ASSIGNMENT_CHANGED"));
  assert.ok(events.some((event) => event.action === "GUN_SENT_TO_REPAIR"));
  await app.close();
});

test("legacy Location and Safe Slot CSV is normalized consistently in preview and commit", async () => {
  const existing = [
    { serialNumber: "R74361S", state: "STORED", location: { safe: 6, slot: 23 } },
    { serialNumber: "BLOCK-22", state: "STORED", location: { safe: 6, slot: 22 } },
    { serialNumber: "BLOCK-24", state: "STORED", location: { safe: 6, slot: 24 } },
  ];
  const gun = {
    findMany: async () => existing,
    findUnique: async () => null,
    create: async ({ data }: any) => { createdData.push(data); return { id: "imported-gun", lifecycle: "ACTIVE", state: "STORED", ...data }; },
  };
  const createdData: any[] = [];
  const tx = {
    gun,
    storageLocation: { upsert: async ({ create }: any) => ({ id: `location-${create.safe}-${create.slot}`, ...create }) },
    activityEvent: { create: async ({ data }: any) => data },
  };
  const prisma = { gun, $transaction: async (callback: any) => callback(tx) } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const csv = [
    "Serial Number,Location,Safe Slot,Model,Model Type,Owner",
    "R74361S,Safe 6,23,Beretta,Trap 1,Beretta",
    "AS19291,Safe 6,23,Beretta,Trap 2,Beretta",
    "SAFEONLY,Safe 6,,Beretta,Trap 1,Beretta",
    ",Safe 6,24,Blank,ACS,Vittoria",
  ].join("\n");
  const preview = await app.inject({ method: "POST", url: "/api/guns/import/preview", headers: { "content-type": "text/csv" }, payload: csv });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.json().valid, true);
  assert.equal(preview.json().rows.length, 3);
  assert.equal(preview.json().rows.find((row: any) => row.serialNumber === "SAFEONLY").safe, 6);
  assert.equal(preview.json().rows.find((row: any) => row.serialNumber === "SAFEONLY").slot, undefined);
  assert.ok(preview.json().warnings.some((warning: string) => warning.includes("AS19291") && warning.includes("Slot 21")));
  const commit = await app.inject({ method: "POST", url: "/api/guns/import/commit", headers: { "content-type": "text/csv" }, payload: csv });
  assert.equal(commit.statusCode, 200);
  assert.equal(commit.json().imported, 3);
  assert.equal(createdData.find((data) => data.serialNumber === "SAFEONLY")?.reportedSafe, 6);
  assert.equal(createdData.find((data) => data.serialNumber === "SAFEONLY")?.locationId, undefined);
  await app.close();
});

test("custody return defaults to the preserved last stored location", async () => {
  const gun = {
    id: "00000000-0000-0000-0000-000000000010",
    serialNumber: "RETURN-001",
    lifecycle: "ACTIVE",
    state: "CHECKED_OUT",
    locationId: null,
    lastStoredLocationId: "00000000-0000-0000-0000-000000000011"
  };
  const custody = { id: "00000000-0000-0000-0000-000000000012", gunId: gun.id, status: "ACTIVE" };
  const location = { id: gun.lastStoredLocationId, safe: 2, slot: 1 };
  const closed = { ...custody, status: "RETURNED" };
  const updatedGun = { ...gun, state: "STORED", locationId: location.id, lastStoredLocationId: location.id, location };
  const tx = {
    gun: {
      findUnique: async () => gun,
      update: async () => updatedGun,
      findUniqueOrThrow: async () => updatedGun
    },
    custodyRecord: {
      findUnique: async () => custody,
      updateMany: async () => ({ count: 1 }),
      findUniqueOrThrow: async () => closed
    },
    storageLocation: { findUnique: async () => location },
    activityEvent: { create: async ({ data }: any) => data }
  };
  const prisma = { $transaction: async (callback: any) => callback(tx) } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const response = await app.inject({ method: "POST", url: `/api/guns/${gun.serialNumber}/custody/${custody.id}/return` });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().custody.status, "RETURNED");
  assert.equal(response.json().gun.location.id, location.id);
  await app.close();
});

test("custody return requires a location when no preserved location exists", async () => {
  const gun = {
    id: "00000000-0000-0000-0000-000000000013",
    serialNumber: "RETURN-002",
    lifecycle: "ACTIVE",
    state: "CHECKED_OUT",
    locationId: null,
    lastStoredLocationId: null
  };
  const custody = { id: "00000000-0000-0000-0000-000000000014", gunId: gun.id, status: "ACTIVE" };
  const tx = {
    gun: { findUnique: async () => gun },
    custodyRecord: { findUnique: async () => custody },
    storageLocation: { findUnique: async () => null }
  };
  const prisma = { $transaction: async (callback: any) => callback(tx) } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const response = await app.inject({ method: "POST", url: `/api/guns/${gun.serialNumber}/custody/${custody.id}/return` });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "RETURN_LOCATION_REQUIRED");
  await app.close();
});

test("unassign closes the active cadet assignment and records an actor event", async () => {
  const gun = { id: "00000000-0000-0000-0000-000000000020", serialNumber: "ASSIGN-001" };
  const active = {
    id: "00000000-0000-0000-0000-000000000021",
    gunId: gun.id,
    cadetName: "Cadet Example",
    startsAt: new Date("2026-08-01T12:00:00Z"),
    endsAt: null
  };
  const endedAt = new Date("2026-08-18T12:00:00Z");
  const ended = { ...active, endsAt: endedAt };
  const events: any[] = [];
  const tx = {
    gun: { findUnique: async () => gun },
    cadetAssignment: {
      findFirst: async () => active,
      update: async () => ended
    },
    activityEvent: { create: async ({ data }: any) => { events.push(data); return data; } }
  };
  const prisma = { $transaction: async (callback: any) => callback(tx) } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const response = await app.inject({ method: "DELETE", url: `/api/guns/${gun.serialNumber}/assignment` });
  assert.equal(response.statusCode, 200);
  assert.ok(response.json().endsAt);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, "CADET_ASSIGNMENT_UNASSIGNED");
  assert.equal(events[0].actorId, actor.id);
  assert.equal(events[0].beforeJson.assignmentId, active.id);
  assert.equal(events[0].afterJson.assignmentId, active.id);
  await app.close();
});

test("archive requires a justification, preserves it in the event, and clears current location", async () => {
  const gun = {
    id: "00000000-0000-0000-0000-000000000030",
    serialNumber: "ARCHIVE-001",
    lifecycle: "ACTIVE",
    state: "STORED",
    locationId: "location-1",
    custody: []
  };
  const events: any[] = [];
  const updates: any[] = [];
  const tx = {
    gun: {
      update: async ({ data }: any) => {
        updates.push(data);
        return { ...gun, ...data };
      }
    },
    activityEvent: { create: async ({ data }: any) => { events.push(data); return data; } }
  };
  const prisma = {
    gun: { findUnique: async () => gun },
    $transaction: async (callback: any) => callback(tx)
  } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const invalid = await app.inject({ method: "PATCH", url: `/api/guns/${gun.serialNumber}/archive`, payload: { justification: "  " } });
  assert.equal(invalid.statusCode, 400);
  const response = await app.inject({ method: "PATCH", url: `/api/guns/${gun.serialNumber}/archive`, payload: { justification: "Documented damage; removed from service" } });
  assert.equal(response.statusCode, 200);
  assert.equal(updates[0].lifecycle, "ARCHIVED");
  assert.equal(updates[0].locationId, null);
  assert.equal(events[0].action, "GUN_ARCHIVED");
  assert.equal(events[0].reason, "Documented damage; removed from service");
  await app.close();
});

test("unarchive restores active stored state without restoring the prior location", async () => {
  const gun = {
    id: "00000000-0000-0000-0000-000000000031",
    serialNumber: "ARCHIVE-002",
    lifecycle: "ARCHIVED",
    state: "STORED",
    locationId: null,
    lastStoredLocationId: "location-2"
  };
  const events: any[] = [];
  const updates: any[] = [];
  const tx = {
    gun: {
      update: async ({ data }: any) => {
        updates.push(data);
        return { ...gun, ...data };
      }
    },
    activityEvent: { create: async ({ data }: any) => { events.push(data); return data; } }
  };
  const prisma = {
    gun: { findUnique: async () => gun },
    $transaction: async (callback: any) => callback(tx)
  } as any;
  const app = await createApp({ prisma, authenticate: authenticated() });
  const response = await app.inject({ method: "PATCH", url: `/api/guns/${gun.serialNumber}/unarchive` });
  assert.equal(response.statusCode, 200);
  assert.equal(updates[0].lifecycle, "ACTIVE");
  assert.equal(updates[0].state, "STORED");
  assert.equal(updates[0].locationId, null);
  assert.equal(updates[0].lastStoredLocationId, null);
  assert.equal(events[0].action, "GUN_UNARCHIVED");
  await app.close();
});
