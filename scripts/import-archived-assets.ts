import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

export const DEFAULT_ARCHIVED_ASSETS_PATH = path.join(os.homedir(), "Downloads", "export-archived-assets-2026-08-20.csv");
export const LOCAL_ARCHIVE_ACTOR_ID = "11111111-1111-4111-8111-111111111111";

export interface CsvRecord {
  sourceRow: number;
  values: Record<string, string>;
}

export interface ArchivedAssetRow {
  sourceRow: number;
  serialNumber: string;
  model: string;
  owner: string | null;
  handedness: string | null;
  barrelLength: number | null;
  lengthOfPull: number | null;
  type: "SKEET" | "TRAP" | "SPORTING" | null;
  status: string | null;
  createdAt: Date | null;
  usedFallbackSerial: boolean;
  usedFallbackModel: boolean;
}

export interface ArchivedImportReport {
  rows: number;
  created: number;
  skipped: number;
  conflicts: Array<{ sourceRow: number; serialNumber: string; reason: string }>;
  warnings: string[];
  dryRun: boolean;
}

function normalizedHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseCsvCells(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      if (row.some((value) => value.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell.replace(/\r$/, ""));
    if (row.some((value) => value.trim() !== "")) rows.push(row);
  }
  return rows;
}

export function parseArchivedAssetsCsv(text: string): CsvRecord[] {
  const rows = parseCsvCells(text);
  const headers = rows.shift() ?? [];
  if (headers.length === 0 || headers.every((header) => header.trim() === "")) {
    throw new Error("Archived asset CSV must include a header row");
  }
  const keys = headers.map(normalizedHeader);
  return rows.map((values, index) => ({
    sourceRow: index + 2,
    values: Object.fromEntries(keys.map((key, column) => [key, values[column]?.trim() ?? ""]))
  }));
}

function value(record: CsvRecord, aliases: string[]): string {
  for (const alias of aliases) {
    const found = record.values[normalizedHeader(alias)];
    if (found !== undefined) return found.trim();
  }
  return "";
}

function parseMeasurement(raw: string): number | null {
  const normalized = raw.trim().replace(/\s*(?:in|inch|inches)\.?$/i, "").trim();
  if (!normalized) return null;
  const mixed = normalized.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  const fraction = normalized.match(/^(\d+)\/(\d+)$/);
  const parsed = mixed
    ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
    : fraction
      ? Number(fraction[1]) / Number(fraction[2])
      : Number(normalized);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

function normalizeType(raw: string): ArchivedAssetRow["type"] {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "skeet" || normalized.startsWith("skeet ")) return "SKEET";
  if (normalized === "trap" || normalized.startsWith("trap ")) return "TRAP";
  if (normalized === "sporting" || normalized.startsWith("sporting ")) return "SPORTING";
  return null;
}

function normalizeHandedness(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const normalized = value.toLowerCase();
  if (normalized.includes("left")) return "LEFT";
  if (normalized.includes("right")) return "RIGHT";
  if (normalized.includes("ambi")) return "AMBIDEXTROUS";
  return value;
}

function parseCreatedAt(raw: string): Date | null {
  if (!raw.trim()) return null;
  const parsed = new Date(raw.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function normalizeArchivedAsset(record: CsvRecord): ArchivedAssetRow {
  const rawSerial = value(record, ["serial number", "serial", "serialnumber", "serial no", "serial id"]);
  const rawModel = value(record, ["model", "gun model", "firearm model"]);
  const rawStatus = value(record, ["status", "legacy status", "condition", "disposition"]);
  return {
    sourceRow: record.sourceRow,
    serialNumber: (rawSerial || `ARCHIVED-LEGACY-${record.sourceRow}`).trim().toUpperCase(),
    model: rawModel || "Unknown legacy archived gun",
    owner: value(record, ["owner", "manufacturer"]) || null,
    handedness: normalizeHandedness(value(record, ["handedness", "hand"])),
    barrelLength: parseMeasurement(value(record, ["barrel length", "barrellength", "barrel"])),
    lengthOfPull: parseMeasurement(value(record, ["length of pull", "lengthofpull", "lop"])),
    type: normalizeType(value(record, ["model type", "modeltype", "type"])),
    // Policy: gauge and high-rib are intentionally blank for this legacy archive.
    status: rawStatus || null,
    createdAt: parseCreatedAt(value(record, ["created date", "created at", "created", "date added"])),
    usedFallbackSerial: rawSerial.trim() === "",
    usedFallbackModel: rawModel.trim() === ""
  };
}

export function normalizeArchivedAssetsCsv(text: string): { rows: ArchivedAssetRow[]; warnings: string[] } {
  const records = parseArchivedAssetsCsv(text);
  const rows = records.map(normalizeArchivedAsset);
  const warnings = rows.flatMap((row, index) => [
    ...(row.usedFallbackSerial ? [`Row ${row.sourceRow}: serial is blank; using ${row.serialNumber}`] : []),
    ...(row.usedFallbackModel ? [`Row ${row.sourceRow}: model is blank; using ${row.model}`] : []),
    ...(value(records[index], ["barrel length", "barrellength", "barrel"]) && row.barrelLength == null ? [`Row ${row.sourceRow}: barrel length could not be parsed and was left blank`] : []),
    ...(value(records[index], ["length of pull", "lengthofpull", "lop"]) && row.lengthOfPull == null ? [`Row ${row.sourceRow}: length of pull could not be parsed and was left blank`] : [])
  ]);
  return { rows, warnings };
}

function sameValue(left: unknown, right: unknown): boolean {
  return String(left ?? "").trim().toUpperCase() === String(right ?? "").trim().toUpperCase();
}

function sameImportedArchive(gun: any, row: ArchivedAssetRow): boolean {
  return gun.lifecycle === "ARCHIVED"
    && gun.state === "STORED"
    && gun.locationId == null
    && gun.lastStoredLocationId == null
    && (!gun.assignments || gun.assignments.length === 0)
    && (!gun.custody || gun.custody.length === 0)
    && sameValue(gun.model, row.model)
    && sameValue(gun.owner, row.owner)
    && sameValue(gun.handedness, row.handedness)
    && sameValue(gun.type, row.type)
    && Number(gun.barrelLength ?? 0) === Number(row.barrelLength ?? 0)
    && Number(gun.lengthOfPull ?? 0) === Number(row.lengthOfPull ?? 0)
    && gun.gauge == null
    && gun.highRib == null;
}

function reasonFor(row: ArchivedAssetRow): string {
  return `Imported from legacy archive: ${row.status || "Legacy archive row"}`;
}

function eventSnapshot(row: ArchivedAssetRow) {
  return {
    serialNumber: row.serialNumber,
    model: row.model,
    owner: row.owner,
    handedness: row.handedness,
    barrelLength: row.barrelLength,
    lengthOfPull: row.lengthOfPull,
    type: row.type,
    gauge: null,
    highRib: null,
    lifecycle: "ARCHIVED",
    state: "STORED",
    locationId: null,
    custody: null,
    assignment: null
  };
}

export async function importArchivedAssets(
  prisma: PrismaClient,
  rows: ArchivedAssetRow[],
  options: { actorId?: string; dryRun?: boolean } = {}
): Promise<ArchivedImportReport> {
  const actorId = options.actorId ?? LOCAL_ARCHIVE_ACTOR_ID;
  const dryRun = options.dryRun ?? false;
  const warnings: string[] = [];
  const conflicts: ArchivedImportReport["conflicts"] = [];
  let created = 0;
  let skipped = 0;
  if (!dryRun) {
    const actor = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, status: true } });
    if (!actor || actor.status !== "ACTIVE") throw new Error(`Required active local archive actor not found: ${actorId}`);
  }
  for (const row of rows) {
    const existing = await prisma.gun.findUnique({
      where: { serialNumber: row.serialNumber },
      include: { assignments: { where: { endsAt: null } }, custody: { where: { status: "ACTIVE" } } }
    });
    if (existing) {
      if (sameImportedArchive(existing, row)) {
        skipped += 1;
      } else {
        conflicts.push({ sourceRow: row.sourceRow, serialNumber: row.serialNumber, reason: "Serial already exists with different data or active inventory state" });
      }
      continue;
    }
    if (dryRun) {
      created += 1;
      continue;
    }
    try {
      await prisma.$transaction(async (tx) => {
        const gun = await tx.gun.create({
          data: {
            serialNumber: row.serialNumber,
            model: row.model,
            owner: row.owner,
            handedness: row.handedness,
            barrelLength: row.barrelLength,
            lengthOfPull: row.lengthOfPull,
            type: row.type,
            gauge: null,
            highRib: null,
            lifecycle: "ARCHIVED",
            state: "STORED",
            locationId: null,
            lastStoredLocationId: null,
            ...(row.createdAt ? { createdAt: row.createdAt } : {})
          }
        });
        await tx.activityEvent.create({
          data: {
            actorId,
            action: "GUN_ARCHIVED",
            entityType: "Gun",
            entityId: gun.id,
            reason: reasonFor(row),
            beforeJson: null,
            afterJson: eventSnapshot(row)
          }
        });
      });
      created += 1;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        conflicts.push({ sourceRow: row.sourceRow, serialNumber: row.serialNumber, reason: "Serial was created concurrently by another import" });
      } else {
        throw error;
      }
    }
  }
  return { rows: rows.length, created, skipped, conflicts, warnings, dryRun };
}

async function main(): Promise<void> {
  const positional = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  const csvPath = positional[0] || DEFAULT_ARCHIVED_ASSETS_PATH;
  const dryRun = process.argv.includes("--dry-run");
  const csv = await readFile(csvPath, "utf8");
  const normalized = normalizeArchivedAssetsCsv(csv);
  const prisma = new PrismaClient();
  try {
    const report = await importArchivedAssets(prisma, normalized.rows, { dryRun });
    report.warnings.push(...normalized.warnings);
    console.log(JSON.stringify({ source: csvPath, ...report }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
