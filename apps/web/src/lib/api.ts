import { beginCognitoSignIn, getAccessToken, signOutCognito } from "./auth";
import type {
  ApiClient,
  ActivityEvent,
  AuditSummary,
  CreateGunInput,
  CurrentUser,
  Gun,
  ImportCommitResult,
  ImportPreview,
  PdfPreview,
  ReconciliationResult,
} from "./types";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api").replace(
  /\/$/,
  "",
);
const savedLocations = new Map<string, { safe: number; slot: number }>();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAccessToken();
  const hasBody = init?.body !== undefined && init?.body !== null;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(hasBody && !(init?.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    if (response.status === 401) {
      signOutCognito();
      window.location.reload();
      throw new Error("Your session has expired. Please sign in again.");
    }
    const body = await response.text().catch(() => "");
    let message = body;
    try {
      const parsed = JSON.parse(body) as { message?: string; error?: string };
      message = parsed.message || parsed.error || body;
    } catch {
      // Keep plain-text errors intact for local/dev servers.
    }
    throw new Error(message || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json")
    ? response.json()
    : (response.blob() as Promise<T>);
}

export const api: ApiClient = {
  signIn: async () => {
    await beginCognitoSignIn();
  },
  listGuns: async (query = "", options) => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (options?.lifecycle) params.set("lifecycle", options.lifecycle);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return (await request<unknown[]>(`/guns${suffix}`)).map(normalizeGun);
  },
  createGun: async (input) =>
    normalizeGun(
      await request<unknown>("/guns", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  updateGunDetails: async (serial, input) =>
    normalizeGun(
      await request<unknown>(`/guns/${encodeURIComponent(serial)}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    ),
  archiveGun: async (serial, justification) =>
    normalizeGun(
      await request<unknown>(`/guns/${encodeURIComponent(serial)}/archive`, {
        method: "PATCH",
        body: JSON.stringify({ justification }),
      }),
    ),
  unarchiveGun: async (serial) => {
    savedLocations.delete(serial);
    return normalizeGun(
      await request<unknown>(`/guns/${encodeURIComponent(serial)}/unarchive`, {
        method: "PATCH",
      }),
    );
  },
  updateLocation: async (serial, input) => {
    await request<unknown>(`/guns/${encodeURIComponent(serial)}/location`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return api.getGun(serial);
  },
  assignCadet: async (serial, cadetName) => {
    await request<unknown>(`/guns/${encodeURIComponent(serial)}/assignment`, {
      method: "POST",
      body: JSON.stringify({ cadetName }),
    });
    return api.getGun(serial);
  },
  assignFittedGun: async (serial, input) => normalizeGun(
    await request<unknown>(`/guns/${encodeURIComponent(serial)}/fitter-assignment`, {
      method: "POST", body: JSON.stringify(input),
    }),
  ),
  unassignCadet: async (serial) => {
    await request<unknown>(`/guns/${encodeURIComponent(serial)}/assignment`, {
      method: "DELETE",
    });
    return api.getGun(serial);
  },
  checkoutGun: async (serial, input) => {
    await request<unknown>(`/guns/${encodeURIComponent(serial)}/checkout`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return api.getGun(serial);
  },
  sendToRepair: async (serial, input) => {
    await request<unknown>(`/guns/${encodeURIComponent(serial)}/repair`, {
      method: "POST",
      body: JSON.stringify(input),
    });
    return api.getGun(serial);
  },
  returnGun: async (serial, custodyId, input) => {
    const result = await request<{ gun?: unknown }>(
      `/guns/${encodeURIComponent(serial)}/custody/${encodeURIComponent(custodyId)}/return`,
      { method: "POST", body: JSON.stringify(input) },
    );
    return result.gun ? normalizeGun(result.gun) : api.getGun(serial);
  },
  getGun: async (serial) =>
    normalizeGun(await request<unknown>(`/guns/${encodeURIComponent(serial)}`)),
  getGunHistory: async (serial) =>
    (
      await request<unknown[]>(`/guns/${encodeURIComponent(serial)}/history`)
    ).map((event, index) => normalizeActivityEvent(event, index)),
  getCurrentUser: () => request<CurrentUser>("/me"),
  listActivity: async (filters = {}) => {
    const params = new URLSearchParams();
    if (filters.query) params.set("q", filters.query);
    if (filters.action) params.set("action", filters.action);
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return (await request<unknown[]>(`/activity${suffix}`)).map((event, index) => normalizeActivityEvent(event, index));
  },
  listAudits: async () =>
    (await request<unknown[]>("/audits")).map(normalizeAudit),
  getAudit: async (id) => normalizeAudit(await request<unknown>(`/audits/${id}`)),
  createAudit: async (name) =>
    normalizeAudit(
      await request<unknown>("/audits", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    ),
  previewGunImport: (file, mode = "upsert") =>
    request<ImportPreview>(`/guns/import/preview?mode=${mode}`, {
      method: "POST",
      headers: { "Content-Type": importContentType(file) },
      body: file,
    }),
  commitGunImport: (file, mode = "upsert") =>
    request<ImportCommitResult>(`/guns/import/commit?mode=${mode}`, {
      method: "POST",
      headers: { "Content-Type": importContentType(file) },
      body: file,
    }),
  scanAuditSerial: async (auditId, serial) => {
    const result = await request<{ scan: { result: string }; item?: unknown }>(
      `/audits/${auditId}/scans`,
      { method: "POST", body: JSON.stringify({ serialNumber: serial }) },
    );
    return {
      outcome:
        (
          {
            MATCHED: "scanned",
            DUPLICATE: "duplicate",
            UNEXPECTED: "unexpected",
            ARCHIVED: "archived",
          } as const
        )[result.scan.result as "MATCHED"] || "unexpected",
      gun: result.item
        ? normalizeGun((result.item as { gun?: unknown }).gun || result.item)
        : undefined,
    };
  },
  verifyRepair: (auditId, serial, note) =>
    request(
      `/audits/${auditId}/items/${encodeURIComponent(serial)}/repair-verify`,
      { method: "POST", body: JSON.stringify({ note }) },
    ).then(() => undefined),
  approveException: (auditId, serial, reason, note) =>
    request(
      `/audits/${auditId}/items/${encodeURIComponent(serial)}/exception`,
      { method: "POST", body: JSON.stringify({ reason, note }) },
    ).then(() => undefined),
  finalizeAudit: (auditId) =>
    request<AuditSummary>(`/audits/${auditId}/finalize`, { method: "POST" }),
  previewReconciliationPdf: (auditId, file) =>
    request<PdfPreview>(`/audits/${auditId}/reconciliation/pdf/preview`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: file,
    }),
  uploadReconciliation: async (auditId, input) =>
    normalizeReconciliation(
      await request<unknown>(`/audits/${auditId}/reconciliation`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    ),
  exportAudit: (auditId, format) => request<Blob>(`/audits/${auditId}/evidence.${format}`),
};

function importContentType(file: File): string {
  return file.name.toLowerCase().endsWith(".xlsx")
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : "text/csv";
}

function normalizeGun(raw: any): Gun {
  const state = raw.state as string;
  const status =
    raw.lifecycle === "ARCHIVED"
      ? "Archived"
      : state === "CHECKED_OUT"
        ? "Checked out"
        : state === "REPAIR"
          ? "In repair"
          : "Stored";
  const assignment = raw.assignments?.find((item: any) => !item.endsAt);
  const custody = raw.custody?.find((item: any) => item.status === "ACTIVE");
  const serial = raw.serialNumber || raw.serial;
  const currentLocation = raw.location?.safe != null && raw.location?.slot != null
    ? { safe: Number(raw.location.safe), slot: Number(raw.location.slot) }
    : undefined;
  if (currentLocation) savedLocations.set(serial, currentLocation);
  const savedLocation = currentLocation || savedLocations.get(serial) || (
    raw.defaultLocation?.safe != null && raw.defaultLocation?.slot != null
      ? { safe: Number(raw.defaultLocation.safe), slot: Number(raw.defaultLocation.slot) }
      : raw.defaultSafe != null && raw.defaultSlot != null
        ? { safe: Number(raw.defaultSafe), slot: Number(raw.defaultSlot) }
        : undefined
  );
  return {
    serial,
    model: raw.model,
    gauge: raw.gauge == null || String(raw.gauge).trim() === "" ? null : String(raw.gauge),
    owner: raw.owner == null || String(raw.owner).trim() === "" ? null : String(raw.owner),
    reportedSafe: raw.reportedSafe == null ? null : Number(raw.reportedSafe),
    barrelLength: raw.barrelLength == null ? "" : `${raw.barrelLength} in`,
    lengthOfPull: raw.lengthOfPull == null ? "" : `${raw.lengthOfPull} in`,
    handedness:
      raw.handedness === "LEFT"
        ? "Left"
        : raw.handedness === "AMBIDEXTROUS" || raw.handedness === "NEUTRAL"
          ? "Neutral"
          : "Right",
    adjustableComb: raw.adjustableComb == null ? null : Boolean(raw.adjustableComb),
    type:
      raw.type == null || String(raw.type).trim() === ""
        ? null
        : raw.type === "TRAP"
          ? "Trap"
          : raw.type === "SPORTING"
            ? "Sporting"
            : raw.type === "SKEET"
              ? "Skeet"
              : null,
    highRib: raw.highRib == null ? null : Boolean(raw.highRib),
    status,
    safe: raw.location?.safe,
    slot: raw.location?.slot,
    defaultSafe: savedLocation?.safe,
    defaultSlot: savedLocation?.slot,
    assignedCadet: assignment?.cadetName,
    holder: custody?.kind === "REPAIR" ? custody.vendor : custody?.personName,
    repairVendor: custody?.vendor,
    custodyId: custody?.status === "ACTIVE" ? custody.id : undefined,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt).toLocaleString() : "",
  };
}

export function normalizeActivityEvent(raw: any, index = 0): ActivityEvent {
  const rawAction = String(raw.action || "ACTIVITY_RECORDED");
  const action = formatActivityAction(rawAction);
  const before = raw.beforeJson ?? raw.before;
  const after = raw.afterJson ?? raw.after;
  const reason = typeof raw.reason === "string" ? raw.reason.trim() : "";
  return {
    id: String(raw.id || `activity-${index}`),
    action,
    actionCode: rawAction,
    actor: raw.actor?.displayName || raw.actor?.email || raw.actorName || "Unknown actor",
    timestamp: raw.createdAt ? new Date(raw.createdAt).toLocaleString() : raw.timestamp || "",
    occurredAt: raw.createdAt || raw.timestamp || undefined,
    relatedSerial: raw.relatedGun?.serialNumber || raw.serialNumber || undefined,
    detail: formatActivityDetail(rawAction, reason, before, after),
    tone: /CREATED|CHANGED|RETURNED|SCANNED|ASSIGNED|UNASSIGNED|CHECKED_OUT/i.test(rawAction) ? "success" : "default",
  };
}

function formatActivityAction(action: string): string {
  return action
    .replace(/^[A-Z]+:/, "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatActivityDetail(action: string, reason: string, before: unknown, after: unknown): string {
  const prior = asActivityRecord(before);
  const next = asActivityRecord(after);
  const code = action.toUpperCase().replace(/\s+/g, "_");
  let statement: string;
  switch (code) {
    case "GUN_CREATED":
    case "GUN_IMPORT_CREATED":
      statement = next.model ? `Gun added to inventory: ${next.model}` : "Gun added to inventory";
      break;
    case "GUN_LOCATION_CHANGED": {
      const location = asActivityRecord(next.location);
      statement = location.safe != null && location.slot != null
        ? `Location updated to Safe ${location.safe} · Slot ${location.slot}`
        : "Location updated";
      break;
    }
    case "GUN_CHECKED_OUT":
      statement = next.personName ? `Checked out to ${next.personName}` : "Gun checked out";
      break;
    case "GUN_SENT_TO_REPAIR":
      statement = next.vendor ? `Sent to repair with ${next.vendor}` : "Sent to repair";
      break;
    case "GUN_RETURNED":
      statement = "Returned to storage";
      break;
    case "CADET_ASSIGNMENT_CHANGED":
      statement = next.cadetName ? `Assigned to ${next.cadetName}` : "Cadet assignment updated";
      break;
    case "CADET_ASSIGNMENT_UNASSIGNED":
      statement = prior.cadetName ? `Unassigned from ${prior.cadetName}` : "Cadet assignment removed";
      break;
    case "GUN_ARCHIVED":
      statement = "Gun archived";
      break;
    case "GUN_UNARCHIVED":
      statement = "Gun restored to active inventory with location unassigned";
      break;
    case "GUN_DETAILS_UPDATED": {
      const labels: Record<string, string> = {
        model: "model",
        gauge: "gauge",
        owner: "owner",
        barrelLength: "barrel length",
        lengthOfPull: "length of pull",
        handedness: "handedness",
        type: "type",
        highRib: "high-rib",
      };
      const changed = Object.keys(labels).filter((key) => JSON.stringify(prior[key]) !== JSON.stringify(next[key]));
      statement = changed.length ? `Updated ${changed.map((key) => labels[key]).join(", ")}` : "Gun details updated";
      break;
    }
    case "GUN_REPORTED_SAFE_SET":
      statement = next.reportedSafe != null ? `Reported safe set to Safe ${next.reportedSafe}; slot remains unknown` : "Reported safe updated";
      break;
    default:
      statement = formatActivityAction(action);
  }
  if (reason && !statement.toLowerCase().includes(reason.toLowerCase())) return `${statement} · ${reason}`;
  return statement;
}

function asActivityRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : {};
}

function normalizeAudit(raw: any): AuditSummary {
  const counts = raw.counts || {};
  const scannedGuns: Array<{ serial: string; scannedAt: string }> | undefined = Array.isArray(raw.scans)
    ? [...new Map<string, { serial: string; scannedAt: string }>(
        raw.scans
          .filter((scan: any) => scan.result === "MATCHED")
          .map((scan: any) => [String(scan.serialNumber), { serial: String(scan.serialNumber), scannedAt: String(scan.scannedAt) }] as const),
      ).values()].sort((left, right) => right.scannedAt.localeCompare(left.scannedAt))
    : undefined;
  return {
    id: raw.id,
    label: raw.name || raw.label,
    startedAt: raw.startedAt ? new Date(raw.startedAt).toLocaleString() : "",
    startedBy: raw.startedBy?.displayName || raw.startedBy?.email || "",
    expected: raw.itemCount || raw.items?.length || 0,
    resolved:
      (counts.SCANNED || 0) +
      (counts.REPAIR_VERIFIED || 0) +
      (counts.EXCEPTION || 0),
    scanned: counts.SCANNED || 0,
    repairVerified: counts.REPAIR_VERIFIED || 0,
    exceptions: counts.EXCEPTION || 0,
    status:
      raw.status === "PHYSICAL_FINALIZED"
        ? "Physical count finalized"
        : raw.status === "COMPLETE"
          ? "Complete"
          : "In progress",
    reconciliation: raw.reconciliation ? "Reconciled" : "Not uploaded",
    items: Array.isArray(raw.items)
      ? raw.items.map((item: any) => ({ serial: item.serialNumber, status: item.status }))
      : undefined,
    scannedGuns,
  };
}

function normalizeReconciliation(raw: any): ReconciliationResult {
  const rows = raw.reconciliation?.serials || [];
  return {
    externalCount: rows.length,
    matched: raw.summary?.MATCHED || 0,
    missing: rows
      .filter((row: any) => row.result === "MISSING_FROM_EXTERNAL")
      .map((row: any) => row.serialNumber),
    unknown: rows
      .filter((row: any) => row.result === "UNKNOWN_EXTERNAL")
      .map((row: any) => row.serialNumber),
    duplicate: rows
      .filter((row: any) => row.result === "DUPLICATE_EXTERNAL")
      .map((row: any) => row.serialNumber),
  };
}

export function createDemoApi(): ApiClient {
  const detailHistory = new Map<string, ActivityEvent[]>();
  const guns: Gun[] = [
    {
      serial: "WP-24-00187",
      model: "Beretta 686 Silver Pigeon",
      owner: "Beretta",
      gauge: "12 ga",
      barrelLength: "30 in",
      lengthOfPull: "14 3/8 in",
      handedness: "Right",
      adjustableComb: true,
      type: "Skeet",
      highRib: false,
      status: "Stored",
      safe: 3,
      slot: 8,
      defaultSafe: 3,
      defaultSlot: 8,
      assignedCadet: "C. Martinez",
      updatedAt: "Today, 09:42",
    },
    {
      serial: "WP-24-00204",
      model: "Beretta 686 Silver Pigeon",
      owner: "Beretta",
      gauge: "12 ga",
      barrelLength: "30 in",
      lengthOfPull: "14 1/4 in",
      handedness: "Right",
      adjustableComb: false,
      type: "Skeet",
      highRib: false,
      status: "Checked out",
      assignedCadet: "J. Kim",
      holder: "J. Kim",
      custodyId: "demo-checkout-00204",
      defaultSafe: 2,
      defaultSlot: 1,
      updatedAt: "Yesterday, 16:18",
    },
    {
      serial: "WP-23-00091",
      model: "Krieghoff K-80",
      owner: "DCA",
      gauge: "12 ga",
      barrelLength: "30 in",
      lengthOfPull: "14 1/2 in",
      handedness: "Left",
      adjustableComb: true,
      type: "Trap",
      highRib: true,
      status: "In repair",
      assignedCadet: "A. Thompson",
      repairVendor: "Wenig Custom Guns",
      custodyId: "demo-repair-00091",
      defaultSafe: 4,
      defaultSlot: 6,
      updatedAt: "Aug 12, 14:05",
    },
    {
      serial: "WP-24-00312",
      model: "Beretta 694",
      owner: "Beretta",
      gauge: "12 ga",
      barrelLength: "32 in",
      lengthOfPull: "14 3/8 in",
      handedness: "Right",
      adjustableComb: true,
      type: "Sporting",
      highRib: true,
      status: "Stored",
      safe: 6,
      slot: 21,
      defaultSafe: 6,
      defaultSlot: 21,
      updatedAt: "Aug 14, 11:22",
    },
    {
      serial: "WP-22-00106",
      model: "Perazzi MX8",
      owner: "Personal",
      gauge: "12 ga",
      barrelLength: "30 in",
      lengthOfPull: "14 1/4 in",
      handedness: "Right",
      adjustableComb: null,
      type: "Skeet",
      highRib: false,
      status: "Stored",
      reportedSafe: 7,
      assignedCadet: "L. Brooks",
      updatedAt: "Aug 14, 11:17",
    },
  ];
  const audit: AuditSummary = {
    id: "audit-demo",
    label: "August 2026 monthly inventory",
    startedAt: new Date().toLocaleString(),
    startedBy: "M. O’Neill",
    expected: guns.length,
    resolved: 0,
    scanned: 0,
    repairVerified: 0,
    exceptions: 0,
    status: "In progress",
    reconciliation: "Not uploaded",
    items: guns.map((gun) => ({ serial: gun.serial, status: "UNRESOLVED" as const })),
    scannedGuns: [],
  };
  return {
    async signIn(email, password) {
      if (!email || !password)
        throw new Error("Email and password are required");
      void email;
    },
    async getCurrentUser() {
      return { id: "demo-account", displayName: "Demo account", email: "demo@local", role: "ACCOUNT_ADMIN", status: "ACTIVE" };
    },
    async listGuns(q = "", options) {
      return guns.filter(
        (g) =>
          (options?.lifecycle
            ? g.status.toUpperCase() === options.lifecycle
            : g.status !== "Archived") &&
          (!q ||
            [g.serial, g.model, g.assignedCadet, g.holder, g.repairVendor].some(
              (v) => v?.toLowerCase().includes(q.toLowerCase()),
            )),
      );
    },
    async createGun(input) {
      const gun: Gun = {
        serial: input.serialNumber.trim().toUpperCase(),
        model: input.model,
        gauge: input.gauge ?? null,
        owner: input.owner ?? null,
        barrelLength: input.barrelLength ? `${input.barrelLength} in` : "",
        lengthOfPull: input.lengthOfPull ? `${input.lengthOfPull} in` : "",
        handedness:
          input.handedness === "LEFT"
            ? "Left"
            : input.handedness === "AMBIDEXTROUS"
              ? "Neutral"
              : "Right",
        type:
          input.type == null
            ? null
            : input.type === "TRAP"
              ? "Trap"
              : input.type === "SPORTING"
                ? "Sporting"
                : "Skeet",
        highRib: input.highRib ?? null,
        adjustableComb: input.adjustableComb ?? null,
        status: "Stored",
        safe: input.safe,
        slot: input.slot,
        defaultSafe: input.safe,
        defaultSlot: input.slot,
        updatedAt: "Just now",
      };
      if (guns.some((existing) => existing.serial === gun.serial)) {
        throw new Error("A gun with that serial number already exists");
      }
      guns.unshift(gun);
      return gun;
    },
    async updateGunDetails(serial, input) {
      const gun = guns.find((item) => item.serial === serial);
      if (!gun) throw new Error("Gun not found");
      const before = { ...gun };
      if (input.model !== undefined) gun.model = input.model;
      if (input.gauge !== undefined) gun.gauge = input.gauge;
      if (input.owner !== undefined) gun.owner = input.owner;
      if (input.barrelLength !== undefined) gun.barrelLength = input.barrelLength == null ? "" : `${input.barrelLength} in`;
      if (input.lengthOfPull !== undefined) gun.lengthOfPull = input.lengthOfPull == null ? "" : `${input.lengthOfPull} in`;
      if (input.handedness !== undefined) {
        gun.handedness = input.handedness === "LEFT" ? "Left" : input.handedness === "AMBIDEXTROUS" ? "Neutral" : "Right";
      }
      if (input.type !== undefined) gun.type = input.type == null ? null : input.type === "TRAP" ? "Trap" : input.type === "SPORTING" ? "Sporting" : "Skeet";
      if (input.highRib !== undefined) gun.highRib = input.highRib;
      if (input.adjustableComb !== undefined) gun.adjustableComb = input.adjustableComb;
      gun.updatedAt = "Just now";
      const changed = [
        before.model !== gun.model && "model",
        before.owner !== gun.owner && "owner",
        before.gauge !== gun.gauge && "gauge",
        before.barrelLength !== gun.barrelLength && "barrel length",
        before.lengthOfPull !== gun.lengthOfPull && "length of pull",
        before.handedness !== gun.handedness && "handedness",
        before.type !== gun.type && "type",
        before.highRib !== gun.highRib && "high-rib",
        before.adjustableComb !== gun.adjustableComb && "adjustable comb",
      ].filter(Boolean).join(", ");
      detailHistory.set(serial, [{
        id: `details-${Date.now()}`,
        action: "Gun details updated",
        actionCode: "GUN_DETAILS_UPDATED",
        actor: "Demo account",
        timestamp: "Just now",
        occurredAt: new Date().toISOString(),
        detail: changed ? `Updated ${changed}` : "Gun details updated",
        tone: "success",
      }, ...(detailHistory.get(serial) || [])]);
      return gun;
    },
    async assignFittedGun(serial, input) {
      const gun = guns.find((item) => item.serial === serial);
      if (!gun) throw new Error("Gun not found");
      if (gun.status !== "Stored" || gun.assignedCadet) throw new Error("This gun is no longer assignable; refresh Gun Fitter and try again");
      gun.assignedCadet = input.cadetName;
      gun.safe = input.safe;
      gun.slot = input.slot;
      gun.defaultSafe = input.safe;
      gun.defaultSlot = input.slot;
      gun.updatedAt = "Just now";
      return gun;
    },
    async archiveGun(serial, justification) {
      if (!justification.trim()) throw new Error("Archive justification is required");
      const gun = guns.find((item) => item.serial === serial);
      if (!gun) throw new Error("Gun not found");
      if (gun.status === "Archived") throw new Error("Gun is already archived");
      if (gun.status === "Checked out" || gun.status === "In repair") {
        throw new Error("Return active custody before archiving");
      }
      gun.status = "Archived";
      gun.safe = undefined;
      gun.slot = undefined;
      gun.updatedAt = "Just now";
      return gun;
    },
    async unarchiveGun(serial) {
      const gun = guns.find((item) => item.serial === serial);
      if (!gun) throw new Error("Gun not found");
      gun.status = "Stored";
      gun.safe = undefined;
      gun.slot = undefined;
      gun.defaultSafe = undefined;
      gun.defaultSlot = undefined;
      gun.updatedAt = "Just now";
      return gun;
    },
    async updateLocation(serial, input) {
      const gun = guns.find((item) => item.serial === serial);
      if (!gun) throw new Error("Gun not found");
      gun.safe = input.safe;
      gun.slot = input.slot;
      gun.defaultSafe = input.safe;
      gun.defaultSlot = input.slot;
      gun.status = "Stored";
      gun.holder = undefined;
      gun.repairVendor = undefined;
      gun.updatedAt = "Just now";
      return gun;
    },
    async assignCadet(serial, cadetName) {
      const gun = guns.find((item) => item.serial === serial);
      if (!gun) throw new Error("Gun not found");
      gun.assignedCadet = cadetName;
      gun.updatedAt = "Just now";
      return gun;
    },
    async unassignCadet(serial) {
      const gun = guns.find((item) => item.serial === serial);
      if (!gun) throw new Error("Gun not found");
      if (!gun.assignedCadet) throw new Error("Gun has no active cadet assignment");
      gun.assignedCadet = undefined;
      gun.updatedAt = "Just now";
      return gun;
    },
    async checkoutGun(serial, input) {
      const gun = guns.find((item) => item.serial === serial);
      if (!gun) throw new Error("Gun not found");
      gun.status = "Checked out";
      gun.holder = input.personName;
      gun.safe = undefined;
      gun.slot = undefined;
      gun.repairVendor = undefined;
      gun.updatedAt = "Just now";
      return gun;
    },
    async sendToRepair(serial, input) {
      const gun = guns.find((item) => item.serial === serial);
      if (!gun) throw new Error("Gun not found");
      gun.status = "In repair";
      gun.repairVendor = input.vendor;
      gun.holder = undefined;
      gun.safe = undefined;
      gun.slot = undefined;
      gun.updatedAt = "Just now";
      return gun;
    },
    async returnGun(serial, custodyId, input) {
      const gun = guns.find((item) => item.serial === serial);
      if (!gun) throw new Error("Gun not found");
      if (!gun.custodyId || gun.custodyId !== custodyId) throw new Error("Active custody record not found");
      gun.status = "Stored";
      gun.safe = input.safe;
      gun.slot = input.slot;
      gun.holder = undefined;
      gun.repairVendor = undefined;
      gun.custodyId = undefined;
      gun.updatedAt = "Just now";
      return gun;
    },
    async getGun(serial) {
      const gun = guns.find((g) => g.serial === serial);
      if (!gun) throw new Error("Gun not found");
      return gun;
    },
    async getGunHistory(serial) {
      return [
        ...(detailHistory.get(serial) || []),
        {
          id: "e1",
          action: "Location updated",
          actionCode: "GUN_LOCATION_CHANGED",
          actor: "M. O’Neill",
          timestamp: "Aug 14, 11:22",
          occurredAt: "2026-08-14T15:22:00Z",
          detail: `${serial} moved to Safe 6 · Slot 21`,
          tone: "success",
        },
        {
          id: "e2",
          action: "Cadet assigned",
          actionCode: "CADET_ASSIGNMENT_CHANGED",
          actor: "S. Green",
          timestamp: "Aug 01, 09:06",
          occurredAt: "2026-08-01T13:06:00Z",
          detail: "Assignment updated to M. Patel",
        },
        {
          id: "e3",
          action: "Gun created",
          actionCode: "GUN_CREATED",
          actor: "M. O’Neill",
          timestamp: "Jul 28, 15:41",
          occurredAt: "2026-07-28T19:41:00Z",
          detail: "Imported from initial inventory",
        },
      ];
    },
    async listActivity(filters = {}) {
      const rows: ActivityEvent[] = [];
      for (const gun of guns) {
        if (filters.query && ![gun.serial, gun.model, gun.assignedCadet, gun.holder].some((value) => value?.toLowerCase().includes(filters.query!.toLowerCase()))) continue;
        const events = await this.getGunHistory(gun.serial);
        rows.push(...events.map((event) => ({ ...event, relatedSerial: gun.serial })));
      }
      return (filters.action ? rows.filter((event) => event.actionCode === filters.action || event.action === filters.action) : rows)
        .sort((left, right) => (right.occurredAt || "").localeCompare(left.occurredAt || ""));
    },
    async listAudits() {
      // Mirror the production list API, which intentionally returns aggregate
      // counts only. Detail-dependent screens must hydrate with getAudit().
      if (!audit.id) return [];
      const { items: _items, scannedGuns: _scannedGuns, ...summary } = audit;
      return [summary];
    },
    async getAudit() {
      // HTTP responses are values, not references into server-side state. Keep
      // the demo boundary equivalent so UI state cannot be mutated in place.
      return {
        ...audit,
        items: audit.items?.map((item) => ({ ...item })),
        scannedGuns: audit.scannedGuns?.map((scan) => ({ ...scan })),
      };
    },
    async createAudit(label) {
      const name = label.trim();
      if (!name) throw new Error("Audit name is required");
      if (audit.label.trim().toLowerCase() === name.toLowerCase()) throw new Error("An audit with that name already exists");
      audit.label = name;
      audit.startedAt = new Date().toLocaleString();
      audit.status = "In progress";
      audit.resolved = 0;
      audit.scanned = 0;
      audit.repairVerified = 0;
      audit.exceptions = 0;
      audit.reconciliation = "Not uploaded";
      audit.items = guns.map((gun) => ({ serial: gun.serial, status: "UNRESOLVED" as const }));
      audit.scannedGuns = [];
      return audit;
    },
    async previewGunImport(file) {
      const text = await file.text();
      const lines = text.split(/\r?\n/).filter(Boolean);
      const headers = (lines.shift() || "").split(",").map((value) => value.trim().toLowerCase());
      const serialIndex = headers.findIndex((header) => ["serial", "serialnumber", "serial_number"].includes(header));
      const rows = lines.map((line, index) => {
        const values = line.split(",");
        const serial = (values[serialIndex] || "").trim().toUpperCase();
        return { serialNumber: serial, model: values[headers.indexOf("model")], gauge: values[headers.indexOf("gauge")], type: values[headers.indexOf("type")], decision: guns.some((item) => item.serial === serial) ? "update" as const : "create" as const, sourceRow: index + 2 };
      });
      return { valid: Boolean(serialIndex >= 0 && rows.every((row) => row.serialNumber)), rows, issues: serialIndex >= 0 ? [] : [{ row: 1, field: "serialNumber", code: "missing-serial", message: "Import must include a Serial Number column." }], summary: { rows: rows.length, creates: rows.filter((row) => row.decision === "create").length, updates: rows.filter((row) => row.decision === "update").length, issues: serialIndex >= 0 ? 0 : 1 } };
    },
    async commitGunImport(file) {
      const preview = await this.previewGunImport(file);
      if (!preview.valid) throw new Error("Resolve import validation issues before committing");
      let created = 0;
      let updated = 0;
      for (const row of preview.rows) {
        const existing = guns.find((item) => item.serial === row.serialNumber);
        if (existing) {
          if (row.model) existing.model = row.model;
          if (row.gauge) existing.gauge = row.gauge;
          updated += 1;
        } else {
          guns.push({ serial: row.serialNumber, model: row.model || "Imported gun", gauge: row.gauge || "", barrelLength: "", lengthOfPull: "", handedness: "Right", adjustableComb: null, type: row.type === "trap" ? "Trap" : row.type === "sporting" ? "Sporting" : "Skeet", highRib: false, status: "Stored", updatedAt: "Just now" });
          created += 1;
        }
      }
      return { imported: created + updated, created, updated, rows: preview.rows.map((row) => ({ serialNumber: row.serialNumber, decision: row.decision, gun: {} })) };
    },
    async scanAuditSerial(_auditId, serial) {
      const gun = guns.find(
        (g) => g.serial.toLowerCase() === serial.toLowerCase(),
      );
      if (!gun) return { outcome: "unexpected" as const };
      if (gun.status === "Archived")
        return { outcome: "archived" as const, gun };
      audit.scanned += 1;
      audit.resolved += 1;
      audit.scannedGuns = [{ serial: gun.serial, scannedAt: new Date().toISOString() }, ...(audit.scannedGuns || []).filter((item) => item.serial !== gun.serial)];
      audit.items?.forEach((item) => { if (item.serial.toLowerCase() === serial.toLowerCase() && item.status === "UNRESOLVED") item.status = "SCANNED"; });
      return { outcome: "scanned" as const, gun };
    },
    async verifyRepair() {
      audit.repairVerified += 1;
      audit.resolved += 1;
    },
    async approveException(_auditId, serial) {
      audit.exceptions += 1;
      audit.resolved += 1;
      audit.items?.forEach((item) => { if (item.serial === serial && item.status === "UNRESOLVED") item.status = "EXCEPTION"; });
    },
    async finalizeAudit() {
      audit.status = "Physical count finalized";
      return audit;
    },
    async previewReconciliationPdf() {
      return { serials: ["WP-24-00312", "WP-24-00187", "WP-23-00091"], duplicates: [{ serial: "WP-24-00187", occurrences: [1, 2] }], invalidTokens: [], pageCount: 3, warnings: [], sourceBytesDiscarded: true as const };
    },
    async uploadReconciliation() {
      audit.reconciliation = "Reconciled";
      return {
        externalCount: 196,
        matched: 192,
        missing: ["WP-24-00312", "WP-23-00091"],
        unknown: ["EXT-4421"],
        duplicate: ["WP-24-00187"],
      };
    },
    async exportAudit(_id, format) {
      return new Blob([format === "pdf" ? "Armory audit evidence" : "section,serialNumber,status\n"], { type: format === "pdf" ? "application/pdf" : "text/csv" });
    },
  };
}
