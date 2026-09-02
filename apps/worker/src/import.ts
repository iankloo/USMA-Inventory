import { deduplicateSerials, isValidSerial, normalizeSerial } from "./serial.js";

export type GunImportRow = {
  serialNumber: string;
  model?: string;
  gauge?: string;
  owner?: string;
  barrelLength?: string;
  lengthOfPull?: string;
  handedness?: string;
  adjustableComb?: boolean;
  type?: "skeet" | "trap" | "sporting";
  modelType?: string;
  highRib?: boolean;
  status?: string;
  assignee?: string;
  location?: string;
  safe?: number;
  slot?: number;
};

export type ImportMode = "create-only" | "upsert";
export type ImportOptions = {
  mode?: ImportMode;
  existingSerials?: readonly string[];
  occupiedLocations?: readonly { serialNumber?: string; safe: number; slot: number }[];
  skipBlankSerial?: boolean;
};

export type ImportIssue = {
  row: number;
  field?: string;
  code:
    | "missing-serial"
    | "invalid-serial"
    | "duplicate-serial"
    | "already-exists"
    | "invalid-number"
    | "invalid-enum"
    | "invalid-boolean"
    | "incomplete-location"
    | "safe-out-of-range"
    | "slot-out-of-range";
  message: string;
};

export type ImportDecision = "create" | "update";

export type ValidatedImportRow = GunImportRow & {
  serialNumber: string;
  decision: ImportDecision;
  sourceRow: number;
};

export type GunImportValidation = {
  rows: ValidatedImportRow[];
  issues: ImportIssue[];
  valid: boolean;
  warnings?: string[];
};

const HEADER_ALIASES: Record<string, keyof GunImportRow> = {
  serial: "serialNumber",
  serialnumber: "serialNumber",
  serial_number: "serialNumber",
  model: "model",
  gauge: "gauge",
  owner: "owner",
  manufacturer: "owner",
  status: "status",
  condition: "status",
  assignee: "assignee",
  assignedto: "assignee",
  assigned_to: "assignee",
  barrellength: "barrelLength",
  barrel_length: "barrelLength",
  lengthofpull: "lengthOfPull",
  length_of_pull: "lengthOfPull",
  handedness: "handedness",
  adjustablecomb: "adjustableComb",
  adjustable_comb: "adjustableComb",
  type: "type",
  modeltype: "modelType",
  model_type: "modelType",
  highrib: "highRib",
  high_rib: "highRib",
  location: "location",
  safe_slot: "slot",
  safe: "safe",
  slot: "slot"
};

function canonicalHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, "_");
}

/** RFC 4180-compatible CSV parser with support for quoted commas and newlines. */
export function parseCsv(input: string | Uint8Array): string[][] {
  const text = typeof input === "string" ? input : new TextDecoder().decode(input);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  return rows;
}

function parseBoolean(value: unknown): boolean | undefined | "invalid" {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(normalized)) return true;
  if (["no", "n", "false", "0"].includes(normalized)) return false;
  return "invalid";
}

function parseOptionalNumber(value: unknown): number | undefined | "invalid" {
  if (value === undefined || value === null || String(value).trim() === "") return undefined;
  const parsed = Number(String(value).trim());
  return Number.isInteger(parsed) ? parsed : "invalid";
}

function safeFromLocation(value: unknown): number | undefined {
  const match = String(value ?? "").trim().match(/^safe\s*(\d+)$/i);
  return match ? Number(match[1]) : undefined;
}

function isOffsiteLocation(value: unknown): boolean {
  const location = String(value ?? "").trim();
  return location.length > 0 && safeFromLocation(location) === undefined;
}

function rowFromRecord(record: Record<string, unknown>, rowNumber: number): {
  row?: GunImportRow;
  issues: ImportIssue[];
} {
  const issues: ImportIssue[] = [];
  const rawSerial = record.serialNumber;
  const serialNumber = normalizeSerial(rawSerial);
  if (!String(rawSerial ?? "").trim()) {
    issues.push({ row: rowNumber, field: "serialNumber", code: "missing-serial", message: "Serial number is required." });
  } else if (!isValidSerial(serialNumber)) {
    issues.push({ row: rowNumber, field: "serialNumber", code: "invalid-serial", message: "Serial number must contain 3–64 letters or digits." });
  }

  const locationSafe = safeFromLocation(record.location);
  const offsiteLocation = isOffsiteLocation(record.location);
  const slot = offsiteLocation ? undefined : parseOptionalNumber(record.slot);
  const safe = offsiteLocation ? undefined : parseOptionalNumber(record.safe ?? locationSafe);
  if (safe === "invalid") issues.push({ row: rowNumber, field: "safe", code: "invalid-number", message: "Safe must be an integer." });
  if (slot === "invalid") issues.push({ row: rowNumber, field: "slot", code: "invalid-number", message: "Slot must be an integer." });
  if (typeof safe === "number" && (safe < 2 || safe > 7)) issues.push({ row: rowNumber, field: "safe", code: "safe-out-of-range", message: "Safe must be between 2 and 7." });
  if (typeof slot === "number" && (slot < 1 || slot > 28)) issues.push({ row: rowNumber, field: "slot", code: "slot-out-of-range", message: "Slot must be between 1 and 28." });
  if (safe === undefined && slot !== undefined) issues.push({ row: rowNumber, code: "incomplete-location", message: "Slot cannot be provided without a safe." });

  const explicitType = String(record.type ?? "").trim().toLowerCase() || undefined;
  const legacyModelType = String(record.modelType ?? "").trim().toLowerCase();
  const type = legacyModelType
    ? legacyModelType === "sporting"
      ? "sporting"
      : legacyModelType.startsWith("trap")
        ? "trap"
        : undefined
    : explicitType;
  if (type && !["skeet", "trap", "sporting"].includes(type)) issues.push({ row: rowNumber, field: "type", code: "invalid-enum", message: "Type must be skeet, trap, or sporting." });
  const highRib = parseBoolean(record.highRib);
  if (highRib === "invalid") issues.push({ row: rowNumber, field: "highRib", code: "invalid-boolean", message: "High-rib must be yes/no or true/false." });
  const adjustableComb = parseBoolean(record.adjustableComb);
  if (adjustableComb === "invalid") issues.push({ row: rowNumber, field: "adjustableComb", code: "invalid-boolean", message: "Adjustable comb must be yes/no or true/false." });

  if (issues.some((issue) => issue.field === "serialNumber" && issue.code !== "duplicate-serial")) return { issues };
  return {
    row: {
      serialNumber,
      model: String(record.model ?? "").trim() || undefined,
      gauge: String(record.gauge ?? "").trim() || undefined,
      owner: String(record.owner ?? "").trim() || undefined,
      barrelLength: String(record.barrelLength ?? "").trim() || undefined,
      lengthOfPull: String(record.lengthOfPull ?? "").trim() || undefined,
      handedness: String(record.handedness ?? "").trim() || undefined,
      adjustableComb: adjustableComb === "invalid" ? undefined : adjustableComb,
      type: type as GunImportRow["type"],
      modelType: legacyModelType || undefined,
      highRib: highRib === "invalid" ? undefined : highRib,
      status: String(record.status ?? "").trim() || undefined,
      assignee: String(record.assignee ?? "").trim() || undefined,
      location: String(record.location ?? "").trim() || undefined,
      safe: typeof safe === "number" ? safe : undefined,
      slot: typeof slot === "number" ? slot : undefined
    },
    issues
  };
}

/** Validate already decoded spreadsheet records and return explicit create/update decisions. */
export function validateGunImport(
  records: readonly Record<string, unknown>[],
  options: ImportOptions = {}
): GunImportValidation {
  if (options.occupiedLocations) {
    const prepared = prepareLegacyInventory(records, options);
    return prepared.validation;
  }
  const mode = options.mode ?? "upsert";
  const existing = new Set((options.existingSerials ?? []).map(normalizeSerial).filter(Boolean));
  const rows: ValidatedImportRow[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Map<string, number>();

  records.forEach((record, index) => {
    if (options.skipBlankSerial && !String(record.serialNumber ?? "").trim()) return;
    const sourceRow = index + 2;
    const parsed = rowFromRecord(record, sourceRow);
    issues.push(...parsed.issues);
    if (!parsed.row) return;
    const prior = seen.get(parsed.row.serialNumber);
    if (prior) {
      issues.push({ row: sourceRow, field: "serialNumber", code: "duplicate-serial", message: `Serial duplicates row ${prior}.` });
      return;
    }
    seen.set(parsed.row.serialNumber, sourceRow);
    const decision: ImportDecision = existing.has(parsed.row.serialNumber) ? "update" : "create";
    if (decision === "update" && mode === "create-only") {
      issues.push({ row: sourceRow, field: "serialNumber", code: "already-exists", message: "Serial already exists; choose upsert to update it." });
      return;
    }
    rows.push({ ...parsed.row, decision, sourceRow });
  });
  return { rows, issues, valid: issues.length === 0 };
}

function recordsFromTable(table: string[][]): { records: Record<string, unknown>[]; legacyLocationHeaders: boolean } {
  if (table.length === 0) return { records: [], legacyLocationHeaders: false };
  const headers = table[0].map(canonicalHeader);
  const mapped = headers.map((header) => HEADER_ALIASES[header]);
  if (!mapped.includes("serialNumber")) throw new Error("Import must include a Serial Number column.");
  const records = table.slice(1).map((values) => {
    const record: Record<string, unknown> = {};
    mapped.forEach((field, index) => {
      if (field) record[field] = values[index] ?? "";
    });
    return record;
  });
  return { records, legacyLocationHeaders: headers.includes("location") && headers.includes("safe_slot") };
}

export function validateCsvGunImport(input: string | Uint8Array, options: ImportOptions = {}): GunImportValidation {
  const parsed = recordsFromTable(parseCsv(input));
  return validateGunImport(parsed.records, { ...options, skipBlankSerial: options.skipBlankSerial ?? parsed.legacyLocationHeaders });
}

/** Decode the first worksheet without retaining the workbook after validation. */
export async function validateXlsxGunImport(input: Uint8Array, options: ImportOptions = {}): Promise<GunImportValidation> {
  const xlsx = await import("xlsx");
  const workbook = xlsx.read(input, { type: "array", dense: true, cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Workbook has no worksheets.");
  const sheet = workbook.Sheets[sheetName];
  const table = xlsx.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  const parsed = recordsFromTable(table.map((row) => row.map((value) => String(value))));
  return validateGunImport(parsed.records, { ...options, skipBlankSerial: options.skipBlankSerial ?? parsed.legacyLocationHeaders });
}

export interface LegacyInventoryPreparation {
  records: Record<string, unknown>[];
  validation: GunImportValidation;
  warnings: string[];
}

function locationKey(safe: number, slot: number): string {
  return String(safe) + ":" + String(slot);
}

/**
 * Normalize a legacy table before it reaches the API. Unknown legacy model
 * types remain unknown, asset tags are intentionally ignored, and duplicate
 * safe/slot pairs are moved to the nearest free slot in the same safe.
 */
export function prepareLegacyInventory(
  records: readonly Record<string, unknown>[],
  options: ImportOptions = {},
): LegacyInventoryPreparation {
  const occupied = new Set((options.occupiedLocations ?? []).map(({ safe, slot }) => locationKey(safe, slot)));
  const owners = new Map((options.occupiedLocations ?? []).map(({ serialNumber, safe, slot }) => [locationKey(safe, slot), serialNumber && normalizeSerial(serialNumber)]));
  const warnings: string[] = [];
  const normalized = records.map((record) => {
    const next = { ...record };
    const offsiteLocation = isOffsiteLocation(record.location);
    if (offsiteLocation) {
      next.safe = undefined;
      next.slot = undefined;
      return next;
    }
    const safe = parseOptionalNumber(record.safe ?? safeFromLocation(record.location));
    const slot = parseOptionalNumber(record.slot);
    if (typeof safe !== "number" || typeof slot !== "number") return next;
    if (slot < 1 || slot > 28) return next;
    let resolvedSlot = slot;
    const originalKey = locationKey(safe, slot);
    if (owners.get(originalKey) === normalizeSerial(String(record.serialNumber ?? ""))) occupied.delete(originalKey);
    if (occupied.has(originalKey)) {
      const available = Array.from({ length: 28 }, (_, index) => index + 1)
        .filter((candidate) => !occupied.has(locationKey(safe, candidate)))
        .sort((left, right) => Math.abs(left - slot) - Math.abs(right - slot) || left - right)[0];
      if (available === undefined) {
        warnings.push(`No available slot in Safe ${safe} for ${String(record.serialNumber ?? "unknown serial")}.`);
        return next;
      }
      resolvedSlot = available;
      warnings.push(`${String(record.serialNumber ?? "unknown serial")} moved from Safe ${safe} · Slot ${slot} to Safe ${safe} · Slot ${resolvedSlot}.`);
    }
    occupied.add(locationKey(safe, resolvedSlot));
    owners.set(locationKey(safe, resolvedSlot), normalizeSerial(String(record.serialNumber ?? "")));
    next.safe = safe;
    next.slot = resolvedSlot;
    return next;
  });
  const { occupiedLocations: _occupiedLocations, ...validationOptions } = options;
  const validation = validateGunImport(normalized, validationOptions);
  validation.warnings = warnings;
  return { records: normalized, validation, warnings };
}
