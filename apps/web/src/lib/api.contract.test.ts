import { describe, expect, it, vi } from "vitest"
import { api } from "./api"

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, headers: { get: () => "application/json" }, json: async () => body, text: async () => "" } as unknown as Response
}

describe("apps/api HTTP contract", () => {
  it("loads the authenticated current user", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      id: "user-1",
      displayName: "Armory Operator",
      email: "operator@example.test",
      role: "OPERATOR",
      status: "ACTIVE",
    }))
    vi.stubGlobal("fetch", fetchMock)
    const user = await api.getCurrentUser()
    expect(fetchMock.mock.calls[0][0]).toBe("/api/me")
    expect(user).toMatchObject({ displayName: "Armory Operator", role: "OPERATOR" })
  })

  it("uses the API audit DTO and normalizes scan outcomes", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "a1", name: "August count", itemCount: 2, status: "IN_PROGRESS" }))
      .mockResolvedValueOnce(jsonResponse({ scan: { result: "MATCHED" }, item: { serialNumber: "WP-1", model: "Model", gauge: "12 ga", type: "SKEET", highRib: false, state: "STORED", lifecycle: "ACTIVE" } }))
    vi.stubGlobal("fetch", fetchMock)
    await api.createAudit("August count")
    await api.scanAuditSerial("a1", "wp-1")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ name: "August count" })
    expect(fetchMock.mock.calls[1][0]).toBe("/api/audits/a1/scans")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ serialNumber: "wp-1" })
  })

  it("previews PDF bytes, posts reviewed serials, and downloads both evidence formats", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ serials: ["WP-1"], duplicates: [], invalidTokens: [], pageCount: 1, warnings: [], sourceBytesDiscarded: true }))
      .mockResolvedValueOnce(jsonResponse({ reconciliation: { serials: [{ serialNumber: "WP-1", result: "MATCHED" }] }, summary: { MATCHED: 1 } }))
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => "text/csv" }, blob: async () => new Blob(["csv"]) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => "application/pdf" }, blob: async () => new Blob(["pdf"]) } as unknown as Response)
    vi.stubGlobal("fetch", fetchMock)
    await api.previewReconciliationPdf("a1", new File(["pdf"], "monitor.pdf", { type: "application/pdf" }))
    await api.uploadReconciliation("a1", { sourceName: "monitor.pdf", serials: ["WP-1"] })
    await api.exportAudit("a1", "csv")
    await api.exportAudit("a1", "pdf")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/audits/a1/reconciliation/pdf/preview")
    expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBe("application/pdf")
    expect(fetchMock.mock.calls[0][1].body).toBeInstanceOf(File)
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ sourceName: "monitor.pdf", serials: ["WP-1"] })
    expect(fetchMock.mock.calls[2][0]).toBe("/api/audits/a1/evidence.csv")
    expect(fetchMock.mock.calls[3][0]).toBe("/api/audits/a1/evidence.pdf")
  })

  it("loads persisted audits and sends CSV/XLSX imports through preview then commit", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse([{ id: "a1", name: "August count", status: "IN_PROGRESS", itemCount: 2, counts: { UNRESOLVED: 2 }, startedAt: "2026-08-16T12:00:00Z" }]))
      .mockResolvedValueOnce(jsonResponse({ id: "a1", name: "August count", status: "IN_PROGRESS", itemCount: 2, counts: { UNRESOLVED: 2 }, startedAt: "2026-08-16T12:00:00Z" }))
      .mockResolvedValueOnce(jsonResponse({ valid: true, rows: [{ serialNumber: "WP-1", decision: "create", sourceRow: 2 }], issues: [], summary: { rows: 1, creates: 1, updates: 0, issues: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ imported: 1, created: 1, updated: 0, rows: [{ serialNumber: "WP-1", decision: "create", gun: {} }] }))
    vi.stubGlobal("fetch", fetchMock)
    expect((await api.listAudits())[0].expected).toBe(2)
    expect((await api.getAudit("a1")).status).toBe("In progress")
    const file = new File(["Serial Number,Model\nWP-1,Model\n"], "guns.csv", { type: "text/csv" })
    expect((await api.previewGunImport(file)).summary.creates).toBe(1)
    expect((await api.commitGunImport(file)).created).toBe(1)
    expect(fetchMock.mock.calls[2][0]).toBe("/api/guns/import/preview?mode=upsert")
    expect(fetchMock.mock.calls[2][1].headers["Content-Type"]).toBe("text/csv")
    expect(fetchMock.mock.calls[2][1].body).toBeInstanceOf(File)
    expect(fetchMock.mock.calls[3][0]).toBe("/api/guns/import/commit?mode=upsert")
  })

  it("deletes only the active assignment and does not resurrect ended history", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: "assignment-1", endsAt: "2026-08-18T12:00:00Z" }))
      .mockResolvedValueOnce(jsonResponse({
        serialNumber: "WP-1",
        model: "Model",
        gauge: "12 ga",
        type: "SKEET",
        highRib: false,
        state: "STORED",
        lifecycle: "ACTIVE",
        assignments: [{ id: "assignment-1", cadetName: "Former Cadet", endsAt: "2026-08-18T12:00:00Z" }],
      }))
    vi.stubGlobal("fetch", fetchMock)
    const gun = await api.unassignCadet("WP-1")
    expect(fetchMock.mock.calls[0][0]).toBe("/api/guns/WP-1/assignment")
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE")
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
    expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBeUndefined()
    expect(gun.assignedCadet).toBeUndefined()
  })

  it("archives with a justification and unarchives through explicit lifecycle endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ serialNumber: "WP-1", model: "Model", gauge: "12 ga", type: "SKEET", highRib: false, state: "STORED", lifecycle: "ARCHIVED" }))
      .mockResolvedValueOnce(jsonResponse({ serialNumber: "WP-1", model: "Model", gauge: "12 ga", type: "SKEET", highRib: false, state: "STORED", lifecycle: "ACTIVE" }))
    vi.stubGlobal("fetch", fetchMock)

    await api.archiveGun("WP-1", "Disposed after documented damage")
    await api.unarchiveGun("WP-1")

    expect(fetchMock.mock.calls[0][0]).toBe("/api/guns/WP-1/archive")
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ justification: "Disposed after documented damage" })
    expect(fetchMock.mock.calls[1][0]).toBe("/api/guns/WP-1/unarchive")
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH")
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined()
  })

  it("updates descriptive gun details without changing the gun identity", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      serialNumber: "WP-1",
      model: "Beretta 694",
      gauge: "12 ga",
      owner: "DCA",
      barrelLength: "32",
      lengthOfPull: "14.375",
      handedness: "RIGHT",
      type: "SPORTING",
      highRib: true,
      state: "STORED",
      lifecycle: "ACTIVE",
      location: { safe: 6, slot: 21 },
    }))
    vi.stubGlobal("fetch", fetchMock)
    const gun = await api.updateGunDetails("WP-1", {
      model: "Beretta 694",
      gauge: "12 ga",
      owner: "DCA",
      barrelLength: 32,
      lengthOfPull: 14.375,
      handedness: "RIGHT",
      type: "SPORTING",
      highRib: true,
    })
    expect(fetchMock.mock.calls[0][0]).toBe("/api/guns/WP-1")
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH")
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: "Beretta 694", owner: "DCA", highRib: true })
    expect(gun.serial).toBe("WP-1")
    expect(gun.safe).toBe(6)
    expect(gun.slot).toBe(21)
  })

  it("scopes archived register requests to the archived lifecycle", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([]))
    vi.stubGlobal("fetch", fetchMock)
    await api.listGuns("retired gun", { lifecycle: "ARCHIVED" })
    expect(fetchMock.mock.calls[0][0]).toBe("/api/guns?q=retired+gun&lifecycle=ARCHIVED")
  })

  it("preserves unknown legacy gun attributes as null instead of applying defaults", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      serialNumber: "LEGACY-1",
      model: "ACS",
      gauge: null,
      type: null,
      highRib: null,
      owner: "Vittoria",
      state: "STORED",
      lifecycle: "ACTIVE",
    }))
    vi.stubGlobal("fetch", fetchMock)
    const gun = await api.getGun("LEGACY-1")
    expect(gun.gauge).toBeNull()
    expect(gun.type).toBeNull()
    expect(gun.highRib).toBeNull()
    expect(gun.owner).toBe("Vittoria")
  })

  it("omits JSON content type and body for bodyless finalize requests", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse({ id: "a1", status: "PHYSICAL_FINALIZED" }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await api.finalizeAudit("a1")

    expect(fetchMock.mock.calls[0][0]).toBe("/api/audits/a1/finalize")
    expect(fetchMock.mock.calls[0][1].method).toBe("POST")
    expect(fetchMock.mock.calls[0][1].body).toBeUndefined()
    expect(fetchMock.mock.calls[0][1].headers["Content-Type"]).toBeUndefined()
  })

  it("normalizes persisted activity events for the history drawer", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([{
      id: "event-1",
      action: "GUN_RETURNED",
      actor: { displayName: "Morgan Armorer", email: "armorer@example.test" },
      createdAt: "2026-08-18T12:00:00Z",
      reason: "Returned after repair",
      beforeJson: { state: "REPAIR" },
      afterJson: { state: "STORED", locationId: "location-1" },
    }, {
      id: "event-2",
      action: "GUN_CREATED",
      actor: { displayName: "Morgan Armorer" },
      createdAt: "2026-08-17T09:00:00Z",
      afterJson: {
        id: "gun-internal-id",
        serialNumber: "WP-1",
        model: "Beretta 686",
        locationId: "location-1",
        createdAt: "2026-08-17T09:00:00Z",
      },
    }]))
    vi.stubGlobal("fetch", fetchMock)
    const history = await api.getGunHistory("WP-1")
    expect(history).toHaveLength(2)
    expect(history[0]).toMatchObject({
      id: "event-1",
      action: "Gun Returned",
      actor: "Morgan Armorer",
      detail: "Returned to storage · Returned after repair",
    })
    expect(history[0].detail).not.toContain("location-1")
    expect(history[0].detail).not.toContain("2026-08-18")
    expect(history[1]).toMatchObject({ action: "Gun Created", detail: "Gun added to inventory: Beretta 686" })
    expect(history[1].detail).not.toContain("gun-internal-id")
    expect(history[1].detail).not.toContain("location-1")
    expect(history[0].timestamp).not.toBe("")
  })

  it("renders descriptive detail changes without exposing internal fields", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([{
      id: "event-details",
      action: "GUN_DETAILS_UPDATED",
      actor: { displayName: "Armory Operator" },
      createdAt: "2026-08-18T12:00:00Z",
      beforeJson: { model: "Beretta 686", owner: "Beretta", locationId: "internal-location" },
      afterJson: { model: "Beretta 694", owner: "DCA", locationId: "internal-location" },
    }]))
    vi.stubGlobal("fetch", fetchMock)
    const history = await api.getGunHistory("WP-1")
    expect(history[0]).toMatchObject({ action: "Gun Details Updated", detail: "Updated model, owner" })
    expect(history[0].detail).not.toContain("internal-location")
  })

  it("loads global activity with serial and action filters", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse([{
      id: "event-1",
      action: "GUN_RETURNED",
      relatedGun: { serialNumber: "WP-1", model: "Beretta" },
      actor: { displayName: "Morgan Armorer" },
      createdAt: "2026-08-18T12:00:00Z",
      afterJson: { state: "STORED" },
    }]))
    vi.stubGlobal("fetch", fetchMock)
    const events = await api.listActivity({ query: "WP-1", action: "GUN_RETURNED" })
    expect(fetchMock.mock.calls[0][0]).toBe("/api/activity?q=WP-1&action=GUN_RETURNED")
    expect(events[0]).toMatchObject({ relatedSerial: "WP-1", actionCode: "GUN_RETURNED", action: "Gun Returned" })
  })

  it("normalizes the complete persisted scan history newest first", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      id: "audit-1",
      name: "August count",
      status: "IN_PROGRESS",
      itemCount: 3,
      counts: { SCANNED: 2, UNRESOLVED: 1 },
      scans: [
        { serialNumber: "WP-1", result: "MATCHED", scannedAt: "2026-08-18T09:00:00Z" },
        { serialNumber: "WP-2", result: "MATCHED", scannedAt: "2026-08-18T10:00:00Z" },
        { serialNumber: "WP-2", result: "DUPLICATE", scannedAt: "2026-08-18T10:01:00Z" },
      ],
    }))
    vi.stubGlobal("fetch", fetchMock)
    const audit = await api.getAudit("audit-1")
    expect(audit.scannedGuns).toEqual([
      { serial: "WP-2", scannedAt: "2026-08-18T10:00:00Z" },
      { serial: "WP-1", scannedAt: "2026-08-18T09:00:00Z" },
    ])
  })
})
