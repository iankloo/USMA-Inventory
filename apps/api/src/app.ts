import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { Prisma, PrismaClient, type AuditItemStatus, type AuditStatus, type GunLifecycle, type GunState } from "@prisma/client";
import { createAuthenticator, type Actor, type Authenticate } from "./auth.js";
import { asHttpError, HttpError } from "./errors.js";
import {
  assignmentSchema, auditNameKey, auditStartSchema, checkoutSchema, csvEscape, exceptionSchema, fitterAssignmentSchema, gunInputSchema,
  archiveSchema, gunDetailsUpdateSchema, locationSchema, normalizeAuditName, normalizeSerial, parseOrThrow, reconciliationSchema, repairSchema, returnLocationSchema, scanSchema
} from "./domain.js";
import { userCreateSchema } from "./domain.js";
import {
  extractPdfSerials,
  generateEvidencePdf
} from "skeet-inventory-worker";
import { validateCsvGunImport, validateXlsxGunImport, type GunImportValidation, type ImportIssue, type ValidatedImportRow } from "skeet-inventory-worker/dist/src/import.js";

declare module "fastify" {
  interface FastifyRequest { actor: Actor }
}

export interface AppOptions {
  prisma: PrismaClient;
  authenticate?: Authenticate;
  logger?: boolean;
  extractPdf?: typeof extractPdfSerials;
}

function requireActor(request: FastifyRequest): Actor {
  if (!request.actor) throw new HttpError(401, "Authentication required", "AUTHENTICATION_REQUIRED");
  return request.actor;
}

function requireAccountAdmin(request: FastifyRequest): Actor {
  const actor = requireActor(request);
  if (actor.role !== "ACCOUNT_ADMIN") throw new HttpError(403, "Account administrator role required", "ACCOUNT_ADMIN_REQUIRED");
  return actor;
}

function routeError(reply: FastifyReply, error: unknown) {
  const normalized = asHttpError(error);
  return reply.code(normalized.statusCode).send({ error: normalized.code, message: normalized.message });
}

async function event(tx: Prisma.TransactionClient, actorId: string, action: string, entityType: string, entityId: string, beforeJson?: unknown, afterJson?: unknown, reason?: string) {
  return tx.activityEvent.create({ data: {
    actorId, action, entityType, entityId, reason,
    beforeJson: beforeJson === undefined ? undefined : (beforeJson as Prisma.InputJsonValue),
    afterJson: afterJson === undefined ? undefined : (afterJson as Prisma.InputJsonValue)
  } });
}

function idParam(request: FastifyRequest): string {
  const params = request.params as { serial?: string; id?: string; custodyId?: string };
  return params.serial ?? params.id ?? params.custodyId ?? "";
}

function serializeGun(gun: any) {
  return { ...gun, barrelLength: gun.barrelLength?.toString() ?? null, lengthOfPull: gun.lengthOfPull?.toString() ?? null };
}

function gunDetailsSnapshot(gun: any) {
  return {
    serialNumber: gun.serialNumber,
    model: gun.model,
    gauge: gun.gauge,
    owner: gun.owner,
    barrelLength: gun.barrelLength?.toString() ?? null,
    lengthOfPull: gun.lengthOfPull?.toString() ?? null,
    handedness: gun.handedness,
    adjustableComb: gun.adjustableComb,
    type: gun.type,
    highRib: gun.highRib
  };
}

type ApiImportIssue = ImportIssue | {
  row: number;
  field: string;
  code: "missing-required-field";
  message: string;
};

type ImportValidationResponse = Omit<GunImportValidation, "issues" | "valid"> & {
  issues: ApiImportIssue[];
  valid: boolean;
  summary: { rows: number; creates: number; updates: number; issues: number };
};

function importBody(request: FastifyRequest): { bytes: Uint8Array; isXlsx: boolean } {
  const contentType = String(request.headers["content-type"] ?? "").split(";", 1)[0].toLowerCase();
  const body = request.body;
  // The browser sends the file bytes directly. JSON is accepted as a small local/dev
  // convenience so API clients can send { content: "..." } or base64 content.
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    const payload = body as { content?: unknown; contentBase64?: unknown };
    if (typeof payload.contentBase64 === "string") return { bytes: Buffer.from(payload.contentBase64, "base64"), isXlsx: contentType.includes("spreadsheet") };
    if (typeof payload.content === "string") return { bytes: new TextEncoder().encode(payload.content), isXlsx: false };
  }
  if (typeof body === "string") return { bytes: new TextEncoder().encode(body), isXlsx: false };
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return { bytes: new Uint8Array(body), isXlsx: contentType.includes("spreadsheet") || contentType === "application/vnd.ms-excel" };
  throw new HttpError(400, "Upload a non-empty CSV or XLSX file", "IMPORT_UPLOAD_REQUIRED");
}

function addRequiredImportIssues(validation: GunImportValidation, existingSerials: ReadonlySet<string>): { rows: ValidatedImportRow[]; issues: ApiImportIssue[]; valid: boolean; warnings?: string[] } {
  const issues: ApiImportIssue[] = [...validation.issues];
  for (const row of validation.rows) {
    if (existingSerials.has(row.serialNumber)) continue;
    const required: Array<[keyof ValidatedImportRow, string]> = [
      ["model", "Model is required for a new gun."]
    ];
    for (const [field, message] of required) {
      if (row[field] === undefined || row[field] === "") issues.push({ row: row.sourceRow, field: String(field), code: "missing-required-field", message });
    }
  }
  return { rows: validation.rows, issues, valid: issues.length === 0, warnings: validation.warnings };
}

function importResponse(validation: { rows: ValidatedImportRow[]; issues: ApiImportIssue[]; valid: boolean; warnings?: string[] }): ImportValidationResponse {
  const creates = validation.rows.filter((row) => row.decision === "create").length;
  return {
    rows: validation.rows,
    issues: validation.issues,
    valid: validation.valid,
    warnings: validation.warnings ?? [],
    summary: { rows: validation.rows.length, creates, updates: validation.rows.length - creates, issues: validation.issues.length }
  };
}

function storedImportLocations(guns: any[]): Array<{ serialNumber?: string; safe: number; slot: number }> {
  return guns
    .filter((gun) => gun.state === "STORED" && gun.location?.safe != null && gun.location?.slot != null)
    .map((gun) => ({ serialNumber: gun.serialNumber, safe: Number(gun.location.safe), slot: Number(gun.location.slot) }));
}

function legacyCustody(status: string | undefined, location: string | undefined): { state: "CHECKED_OUT" | "REPAIR"; kind: "CHECKOUT" | "REPAIR"; reason: string; vendor?: string } | undefined {
  const normalizedStatus = status?.trim().toLowerCase() ?? "";
  const normalizedLocation = location?.trim().toLowerCase() ?? "";
  const source = /out\s+for\s+(?:repair|use)/.test(normalizedLocation)
    ? location?.trim()
    : status?.trim() || location?.trim();
  if (/broken|out\s+for\s+repair/.test(normalizedStatus) || /out\s+for\s+repair/.test(normalizedLocation)) {
    return { state: "REPAIR", kind: "REPAIR", vendor: "Beretta", reason: `Legacy import: ${source || "Out for Repairs"}` };
  }
  if (/out\s+for\s+use/.test(normalizedStatus) || /out\s+for\s+use/.test(normalizedLocation)) {
    return { state: "CHECKED_OUT", kind: "CHECKOUT", reason: `Legacy import: ${source || "Out for use"}` };
  }
  return undefined;
}

export async function createApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  const authenticate = options.authenticate ?? createAuthenticator(options.prisma);
  const extractPdf = options.extractPdf ?? extractPdfSerials;

  app.addContentTypeParser("application/pdf", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser("application/vnd.ms-excel", { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

  app.get("/healthz", async (_request, reply) => reply.send({ status: "ok" }));

  app.addHook("preHandler", async (request, reply) => {
    if (request.url.startsWith("/healthz")) return;
    try { request.actor = await authenticate(request); }
    catch (error) { return routeError(reply, error); }
  });

  app.get("/api/users", async (request, reply) => {
    try {
      requireAccountAdmin(request);
      const users = await options.prisma.user.findMany({ select: { id: true, cognitoSubject: true, email: true, displayName: true, role: true, status: true, createdAt: true, updatedAt: true }, orderBy: { email: "asc" } });
      return reply.send(users);
    } catch (error) { return routeError(reply, error); }
  });

  app.get("/api/me", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const user = await options.prisma.user.findUnique({
        where: { id: actor.id },
        select: { id: true, email: true, displayName: true, role: true, status: true },
      });
      if (!user) throw new HttpError(404, "Authenticated user was not found", "CURRENT_USER_NOT_FOUND");
      return reply.send(user);
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/users", async (request, reply) => {
    try {
      const actor = requireAccountAdmin(request);
      const input = parseOrThrow(userCreateSchema, request.body);
      const user = await options.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: input });
        await event(tx, actor.id, "USER_CREATED", "User", created.id, undefined, { email: created.email, role: created.role });
        return created;
      });
      return reply.code(201).send({ id: user.id, cognitoSubject: user.cognitoSubject, email: user.email, displayName: user.displayName, role: user.role, status: user.status });
    } catch (error) { return routeError(reply, error); }
  });

  app.patch("/api/users/:id/disable", async (request, reply) => {
    try {
      const actor = requireAccountAdmin(request);
      const id = (request.params as { id: string }).id;
      if (id === actor.id) throw new HttpError(409, "An account administrator cannot disable their own account", "SELF_DISABLE_NOT_ALLOWED");
      const user = await options.prisma.user.findUnique({ where: { id } });
      if (!user) throw new HttpError(404, "User not found", "USER_NOT_FOUND");
      const disabled = await options.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data: { status: "DISABLED" } });
        await event(tx, actor.id, "USER_DISABLED", "User", id, { status: user.status }, { status: updated.status });
        return updated;
      });
      return reply.send({ id: disabled.id, status: disabled.status });
    } catch (error) { return routeError(reply, error); }
  });

  app.patch("/api/users/:id/enable", async (request, reply) => {
    try {
      const actor = requireAccountAdmin(request);
      const id = (request.params as { id: string }).id;
      const user = await options.prisma.user.findUnique({ where: { id } });
      if (!user) throw new HttpError(404, "User not found", "USER_NOT_FOUND");
      const enabled = await options.prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data: { status: "ACTIVE" } });
        await event(tx, actor.id, "USER_ENABLED", "User", id, { status: user.status }, { status: updated.status }, "Account recovery by named administrator");
        return updated;
      });
      return reply.send({ id: enabled.id, status: enabled.status });
    } catch (error) { return routeError(reply, error); }
  });

  app.get("/api/guns", async (request, reply) => {
    try {
      requireActor(request);
      const query = request.query as { q?: string; includeArchived?: string; lifecycle?: string; state?: GunState };
      const q = query.q?.trim();
      const lifecycle = query.lifecycle === "ACTIVE" || query.lifecycle === "ARCHIVED" ? query.lifecycle : undefined;
      const guns = await options.prisma.gun.findMany({
        where: {
          ...(lifecycle ? { lifecycle } : query.includeArchived === "true" ? {} : { lifecycle: "ACTIVE" }),
          ...(query.state ? { state: query.state } : {}),
          ...(q ? {
            OR: [
              { serialNumber: { contains: normalizeSerial(q) } },
              { model: { contains: q, mode: "insensitive" } },
              { gauge: { contains: q, mode: "insensitive" } },
              { assignments: { some: { endsAt: null, cadetName: { contains: q, mode: "insensitive" } } } }
            ]
          } : {})
        },
        include: { location: true, lastStoredLocation: true, assignments: { where: { endsAt: null }, take: 1 }, custody: { where: { status: "ACTIVE" }, take: 1 } },
        orderBy: { serialNumber: "asc" }
      });
      return reply.send(guns.map(serializeGun));
    } catch (error) { return routeError(reply, error); }
  });

  async function inventorySummary(request: FastifyRequest, reply: FastifyReply) {
    try {
      requireActor(request);
      const [active, archived, stored, checkedOut, repair] = await Promise.all([
        options.prisma.gun.count({ where: { lifecycle: "ACTIVE" } }),
        options.prisma.gun.count({ where: { lifecycle: "ARCHIVED" } }),
        options.prisma.gun.count({ where: { lifecycle: "ACTIVE", state: "STORED" } }),
        options.prisma.gun.count({ where: { lifecycle: "ACTIVE", state: "CHECKED_OUT" } }),
        options.prisma.gun.count({ where: { lifecycle: "ACTIVE", state: "REPAIR" } })
      ]);
      return reply.send({
        total: active,
        active,
        archived,
        stored,
        checkedOut,
        repair,
        inRepair: repair,
        byState: { STORED: stored, CHECKED_OUT: checkedOut, REPAIR: repair }
      });
    } catch (error) { return routeError(reply, error); }
  }

  // Both paths are kept as stable aliases: the inventory page uses the resource-oriented
  // path, while older local clients used /guns/summary.
  app.get("/api/inventory/summary", inventorySummary);
  app.get("/api/guns/summary", inventorySummary);

  async function importPreview(request: FastifyRequest, reply: FastifyReply) {
    try {
      requireActor(request);
      const { bytes, isXlsx } = importBody(request);
      if (bytes.byteLength === 0) throw new HttpError(400, "Upload a non-empty CSV or XLSX file", "IMPORT_UPLOAD_REQUIRED");
      const existing = await options.prisma.gun.findMany({ select: { serialNumber: true, state: true, location: { select: { safe: true, slot: true } } } });
      const mode = (request.query as { mode?: string } | undefined)?.mode === "create-only" ? "create-only" : "upsert";
      let validation: GunImportValidation;
      try {
        validation = isXlsx
          ? await validateXlsxGunImport(bytes, { mode, existingSerials: existing.map((gun) => gun.serialNumber), occupiedLocations: storedImportLocations(existing) })
          : validateCsvGunImport(bytes, { mode, existingSerials: existing.map((gun) => gun.serialNumber), occupiedLocations: storedImportLocations(existing) });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Unable to parse import file", "IMPORT_PARSE_FAILED");
      }
      const checked = addRequiredImportIssues(validation, new Set(existing.map((gun) => normalizeSerial(gun.serialNumber))));
      return reply.send(importResponse(checked));
    } catch (error) { return routeError(reply, error); }
  }

  async function importCommit(request: FastifyRequest, reply: FastifyReply) {
    try {
      const actor = requireActor(request);
      const { bytes, isXlsx } = importBody(request);
      if (bytes.byteLength === 0) throw new HttpError(400, "Upload a non-empty CSV or XLSX file", "IMPORT_UPLOAD_REQUIRED");
      const existing = await options.prisma.gun.findMany({ select: { serialNumber: true, state: true, location: { select: { safe: true, slot: true } } } });
      const mode = (request.query as { mode?: string } | undefined)?.mode === "create-only" ? "create-only" : "upsert";
      let validation: GunImportValidation;
      try {
        validation = isXlsx
          ? await validateXlsxGunImport(bytes, { mode, existingSerials: existing.map((gun) => gun.serialNumber), occupiedLocations: storedImportLocations(existing) })
          : validateCsvGunImport(bytes, { mode, existingSerials: existing.map((gun) => gun.serialNumber), occupiedLocations: storedImportLocations(existing) });
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : "Unable to parse import file", "IMPORT_PARSE_FAILED");
      }
      const checked = addRequiredImportIssues(validation, new Set(existing.map((gun) => normalizeSerial(gun.serialNumber))));
      if (!checked.valid) return reply.code(400).send({ error: "IMPORT_VALIDATION_FAILED", message: "Resolve import validation issues before committing", ...importResponse(checked) });
      const committed = await options.prisma.$transaction(async (tx) => {
        const results: Array<{ serialNumber: string; decision: "create" | "update"; gun: unknown }> = [];
        for (const row of checked.rows) {
          const prior = await tx.gun.findUnique({ where: { serialNumber: row.serialNumber } });
          let locationId = prior?.locationId ?? undefined;
          let lastStoredLocationId = prior?.lastStoredLocationId ?? undefined;
          const custody = legacyCustody(row.status, row.location);
          const offsiteLocation = row.location !== undefined && !/^safe\s*\d+$/i.test(row.location.trim());
          if (custody || offsiteLocation) locationId = undefined;
          if (row.safe !== undefined && row.slot !== undefined) {
            const location = await tx.storageLocation.upsert({ where: { safe_slot: { safe: row.safe, slot: row.slot } }, create: { safe: row.safe, slot: row.slot }, update: {} });
            lastStoredLocationId = location.id;
            if (!prior || prior.state === "STORED") locationId = location.id;
          }
          const data = {
            model: row.model,
            gauge: row.gauge,
            owner: row.owner,
            barrelLength: row.barrelLength === undefined ? undefined : Number(row.barrelLength),
            lengthOfPull: row.lengthOfPull === undefined ? undefined : Number(row.lengthOfPull),
            handedness: row.handedness === undefined ? undefined : row.handedness.toUpperCase(),
            adjustableComb: row.adjustableComb,
            type: row.type === undefined ? undefined : row.type.toUpperCase(),
            highRib: row.highRib,
            reportedSafe: row.slot === undefined ? row.safe ?? (row.location === undefined ? prior?.reportedSafe ?? null : null) : null,
            state: custody?.state,
            locationId,
            lastStoredLocationId
          };
          const gun = prior
            ? await tx.gun.update({ where: { id: prior.id }, data })
            : await tx.gun.create({ data: { serialNumber: row.serialNumber, model: row.model!, gauge: row.gauge, owner: row.owner, reportedSafe: data.reportedSafe, barrelLength: data.barrelLength, lengthOfPull: data.lengthOfPull, handedness: data.handedness, adjustableComb: data.adjustableComb, type: data.type, highRib: row.highRib, state: data.state ?? "STORED", locationId, lastStoredLocationId } });
          const action = prior ? "GUN_IMPORT_UPDATED" : "GUN_IMPORT_CREATED";
          await event(tx, actor.id, action, "Gun", gun.id, prior ? serializeGun(prior) : undefined, serializeGun(gun), "Spreadsheet import");
          if (row.assignee) {
            const assignment = await tx.cadetAssignment.create({ data: { gunId: gun.id, cadetName: row.assignee, createdById: actor.id } });
            await event(tx, actor.id, "CADET_ASSIGNMENT_CHANGED", "Gun", gun.id, undefined, assignment, "Legacy spreadsheet import");
          }
          if (custody) {
            const record = await tx.custodyRecord.create({
              data: {
                gunId: gun.id,
                kind: custody.kind,
                personName: custody.kind === "CHECKOUT" ? "Unknown" : undefined,
                vendor: custody.vendor,
                reason: custody.reason,
                openedById: actor.id,
              },
            });
            await event(tx, actor.id, custody.kind === "REPAIR" ? "GUN_SENT_TO_REPAIR" : "GUN_CHECKED_OUT", "Gun", gun.id, undefined, record, custody.reason);
          }
          results.push({ serialNumber: gun.serialNumber, decision: prior ? "update" : "create", gun: serializeGun(gun) });
        }
        return results;
      });
      return reply.code(200).send({ imported: committed.length, created: committed.filter((row) => row.decision === "create").length, updated: committed.filter((row) => row.decision === "update").length, rows: committed });
    } catch (error) { return routeError(reply, error); }
  }

  app.post("/api/guns/import/preview", importPreview);
  app.post("/api/imports/guns/preview", importPreview);
  app.post("/api/guns/import/commit", importCommit);
  app.post("/api/imports/guns/commit", importCommit);

  app.get("/api/guns/:serial", async (request, reply) => {
    try {
      requireActor(request);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const gun = await options.prisma.gun.findUnique({ where: { serialNumber }, include: { location: true, lastStoredLocation: true, assignments: { orderBy: { startsAt: "desc" } }, custody: { orderBy: { checkedOutAt: "desc" } } } });
      if (!gun) throw new HttpError(404, "Gun not found", "GUN_NOT_FOUND");
      return reply.send(serializeGun(gun));
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/guns", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(gunInputSchema, request.body);
      const serialNumber = normalizeSerial(input.serialNumber);
      const gun = await options.prisma.$transaction(async (tx) => {
        let locationId: string | undefined;
        if (input.safe !== undefined && input.slot !== undefined) {
          const location = await tx.storageLocation.upsert({ where: { safe_slot: { safe: input.safe, slot: input.slot } }, create: { safe: input.safe, slot: input.slot }, update: {} });
          locationId = location.id;
        }
        const created = await tx.gun.create({ data: { serialNumber, model: input.model, gauge: input.gauge, owner: input.owner, reportedSafe: input.slot === undefined ? input.safe : null, barrelLength: input.barrelLength, lengthOfPull: input.lengthOfPull, handedness: input.handedness, adjustableComb: input.adjustableComb, type: input.type, highRib: input.highRib, locationId, lastStoredLocationId: locationId } });
        await event(tx, actor.id, "GUN_CREATED", "Gun", created.id, undefined, serializeGun(created));
        return created;
      });
      return reply.code(201).send(serializeGun(gun));
    } catch (error) { return routeError(reply, error); }
  });

  app.patch("/api/guns/:serial", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(gunDetailsUpdateSchema, request.body);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const gun = await options.prisma.gun.findUnique({
        where: { serialNumber },
        include: {
          location: true,
          lastStoredLocation: true,
          assignments: { where: { endsAt: null }, take: 1 },
          custody: { where: { status: "ACTIVE" }, take: 1 }
        }
      });
      if (!gun) throw new HttpError(404, "Gun not found", "GUN_NOT_FOUND");
      const updated = await options.prisma.$transaction(async (tx) => {
        await tx.gun.update({ where: { id: gun.id }, data: { ...input } });
        const next = await tx.gun.findUniqueOrThrow({
          where: { id: gun.id },
          include: {
            location: true,
            lastStoredLocation: true,
            assignments: { where: { endsAt: null }, take: 1 },
            custody: { where: { status: "ACTIVE" }, take: 1 }
          }
        });
        await event(tx, actor.id, "GUN_DETAILS_UPDATED", "Gun", gun.id, gunDetailsSnapshot(gun), gunDetailsSnapshot(next));
        return next;
      });
      return reply.send(serializeGun(updated));
    } catch (error) { return routeError(reply, error); }
  });

  app.patch("/api/guns/:serial/archive", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(archiveSchema, request.body);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const gun = await options.prisma.gun.findUnique({ where: { serialNumber }, include: { custody: { where: { status: "ACTIVE" } } } });
      if (!gun) throw new HttpError(404, "Gun not found", "GUN_NOT_FOUND");
      if (gun.lifecycle === "ARCHIVED") throw new HttpError(409, "Gun is already archived", "GUN_ALREADY_ARCHIVED");
      if (gun.custody.length > 0) throw new HttpError(409, "Return active custody before archiving", "ACTIVE_CUSTODY");
      const archived = await options.prisma.$transaction(async (tx) => {
        const updated = await tx.gun.update({ where: { id: gun.id }, data: { lifecycle: "ARCHIVED", locationId: null } });
        await event(tx, actor.id, "GUN_ARCHIVED", "Gun", gun.id, serializeGun(gun), serializeGun(updated), input.justification);
        return updated;
      });
      return reply.send(serializeGun(archived));
    } catch (error) { return routeError(reply, error); }
  });

  app.patch("/api/guns/:serial/unarchive", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const gun = await options.prisma.gun.findUnique({ where: { serialNumber } });
      if (!gun) throw new HttpError(404, "Gun not found", "GUN_NOT_FOUND");
      if (gun.lifecycle === "ACTIVE") return reply.send(serializeGun(gun));
      const restored = await options.prisma.$transaction(async (tx) => {
        const updated = await tx.gun.update({
          where: { id: gun.id },
          data: { lifecycle: "ACTIVE", state: "STORED", locationId: null, lastStoredLocationId: null },
        });
        await event(
          tx,
          actor.id,
          "GUN_UNARCHIVED",
          "Gun",
          gun.id,
          serializeGun(gun),
          serializeGun(updated),
          "Gun restored to active inventory with location unassigned",
        );
        return updated;
      });
      return reply.send(serializeGun(restored));
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/guns/:serial/location", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const input = parseOrThrow(locationSchema, request.body);
      const gun = await options.prisma.gun.findUnique({ where: { serialNumber } });
      if (!gun) throw new HttpError(404, "Gun not found", "GUN_NOT_FOUND");
      if (gun.lifecycle === "ARCHIVED") throw new HttpError(409, "Archived guns cannot be relocated", "ARCHIVED_GUN");
      if (gun.state !== "STORED") throw new HttpError(409, "Only stored guns have a safe and slot", "GUN_NOT_STORED");
      const updated = await options.prisma.$transaction(async (tx) => {
        const location = await tx.storageLocation.upsert({ where: { safe_slot: { safe: input.safe, slot: input.slot } }, create: input, update: {} });
        const next = await tx.gun.update({ where: { id: gun.id }, data: { locationId: location.id, lastStoredLocationId: location.id } });
        await event(tx, actor.id, "GUN_LOCATION_CHANGED", "Gun", gun.id, { locationId: gun.locationId }, { locationId: location.id });
        return tx.gun.findUniqueOrThrow({ where: { id: next.id }, include: { location: true } });
      });
      return reply.send(serializeGun(updated));
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/guns/:serial/assignment", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(assignmentSchema, request.body);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const gun = await options.prisma.gun.findUnique({ where: { serialNumber } });
      if (!gun) throw new HttpError(404, "Gun not found", "GUN_NOT_FOUND");
      const assignment = await options.prisma.$transaction(async (tx) => {
        await tx.cadetAssignment.updateMany({ where: { gunId: gun.id, endsAt: null }, data: { endsAt: new Date() } });
        const created = await tx.cadetAssignment.create({ data: { gunId: gun.id, cadetName: input.cadetName, cadetId: input.cadetId, createdById: actor.id } });
        await event(tx, actor.id, "CADET_ASSIGNMENT_CHANGED", "Gun", gun.id, undefined, created);
        return created;
      });
      return reply.code(201).send(assignment);
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/guns/:serial/fitter-assignment", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(fitterAssignmentSchema, request.body);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const updated = await options.prisma.$transaction(async (tx) => {
        const gun = await tx.gun.findUnique({ where: { serialNumber } });
        if (!gun) throw new HttpError(404, "Gun not found", "GUN_NOT_FOUND");
        if (gun.lifecycle === "ARCHIVED" || gun.state !== "STORED") throw new HttpError(409, "Only active stored guns can be assigned from Gun Fitter", "GUN_NOT_ASSIGNABLE");
        const activeAssignment = await tx.cadetAssignment.findFirst({ where: { gunId: gun.id, endsAt: null } });
        if (activeAssignment) throw new HttpError(409, "This gun is already assigned; refresh Gun Fitter and try again", "GUN_ALREADY_ASSIGNED");
        const location = await tx.storageLocation.upsert({ where: { safe_slot: { safe: input.safe, slot: input.slot } }, create: { safe: input.safe, slot: input.slot }, update: {} });
        await tx.gun.update({ where: { id: gun.id }, data: { locationId: location.id, lastStoredLocationId: location.id } });
        const assignment = await tx.cadetAssignment.create({ data: { gunId: gun.id, cadetName: input.cadetName, cadetId: input.cadetId, createdById: actor.id } });
        await event(tx, actor.id, "GUN_FITTER_ASSIGNED", "Gun", gun.id, { locationId: gun.locationId }, { cadetName: assignment.cadetName, locationId: location.id }, "Assigned from Gun Fitter");
        return tx.gun.findUniqueOrThrow({ where: { id: gun.id }, include: { location: true, lastStoredLocation: true, assignments: { where: { endsAt: null }, take: 1 }, custody: { where: { status: "ACTIVE" }, take: 1 } } });
      });
      return reply.code(201).send(serializeGun(updated));
    } catch (error) { return routeError(reply, error); }
  });

  app.delete("/api/guns/:serial/assignment", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const closed = await options.prisma.$transaction(async (tx) => {
        const gun = await tx.gun.findUnique({ where: { serialNumber } });
        if (!gun) throw new HttpError(404, "Gun not found", "GUN_NOT_FOUND");
        const active = await tx.cadetAssignment.findFirst({ where: { gunId: gun.id, endsAt: null }, orderBy: { startsAt: "desc" } });
        if (!active) throw new HttpError(409, "Gun has no active cadet assignment", "NO_ACTIVE_ASSIGNMENT");
        const endedAt = new Date();
        const ended = await tx.cadetAssignment.update({ where: { id: active.id }, data: { endsAt: endedAt } });
        await event(
          tx,
          actor.id,
          "CADET_ASSIGNMENT_UNASSIGNED",
          "Gun",
          gun.id,
          { assignmentId: active.id, cadetName: active.cadetName, startsAt: active.startsAt },
          { assignmentId: active.id, cadetName: active.cadetName, endsAt: endedAt },
          "Cadet assignment removed",
        );
        return ended;
      });
      return reply.send(closed);
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/guns/:serial/checkout", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(checkoutSchema, request.body);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const checkout = await options.prisma.$transaction(async (tx) => {
        const gun = await tx.gun.findUnique({ where: { serialNumber }, include: { custody: { where: { status: "ACTIVE" } } } });
        if (!gun) throw new HttpError(404, "Gun not found", "GUN_NOT_FOUND");
        if (gun.lifecycle === "ARCHIVED") throw new HttpError(409, "Archived guns cannot be checked out", "ARCHIVED_GUN");
        if (gun.custody.length > 0) throw new HttpError(409, "Gun already has active custody", "ACTIVE_CUSTODY");
        const record = await tx.custodyRecord.create({ data: { gunId: gun.id, kind: "CHECKOUT", personName: input.personName, personEmail: input.personEmail, reason: input.reason, notes: input.notes, expectedReturn: input.expectedReturn, openedById: actor.id } });
        await tx.gun.update({ where: { id: gun.id }, data: { state: "CHECKED_OUT", locationId: null, lastStoredLocationId: gun.locationId ?? undefined } });
        await event(tx, actor.id, "GUN_CHECKED_OUT", "Gun", gun.id, { state: gun.state }, { state: "CHECKED_OUT", custodyId: record.id });
        return record;
      });
      return reply.code(201).send(checkout);
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/guns/:serial/repair", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(repairSchema, request.body);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const repair = await options.prisma.$transaction(async (tx) => {
        const gun = await tx.gun.findUnique({ where: { serialNumber }, include: { custody: { where: { status: "ACTIVE" } } } });
        if (!gun) throw new HttpError(404, "Gun not found", "GUN_NOT_FOUND");
        if (gun.lifecycle === "ARCHIVED") throw new HttpError(409, "Archived guns cannot go to repair", "ARCHIVED_GUN");
        if (gun.custody.length > 0) throw new HttpError(409, "Gun already has active custody", "ACTIVE_CUSTODY");
        const record = await tx.custodyRecord.create({ data: { gunId: gun.id, kind: "REPAIR", vendor: input.vendor, reason: input.reason, notes: input.notes, expectedReturn: input.expectedReturn, openedById: actor.id } });
        await tx.gun.update({ where: { id: gun.id }, data: { state: "REPAIR", locationId: null, lastStoredLocationId: gun.locationId ?? undefined } });
        await event(tx, actor.id, "GUN_SENT_TO_REPAIR", "Gun", gun.id, { state: gun.state }, { state: "REPAIR", custodyId: record.id }, input.reason);
        return record;
      });
      return reply.code(201).send(repair);
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/guns/:serial/custody/:custodyId/return", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(returnLocationSchema, request.body);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const custodyId = (request.params as { custodyId: string }).custodyId;
      const result = await options.prisma.$transaction(async (tx) => {
        const gun = await tx.gun.findUnique({ where: { serialNumber } });
        const custody = await tx.custodyRecord.findUnique({ where: { id: custodyId } });
        if (!gun || !custody || custody.gunId !== gun.id) throw new HttpError(404, "Custody record not found", "CUSTODY_NOT_FOUND");
        if (custody.status !== "ACTIVE") throw new HttpError(409, "Custody record is already closed", "CUSTODY_CLOSED");
        const location = input
          ? await tx.storageLocation.upsert({ where: { safe_slot: { safe: input.safe!, slot: input.slot! } }, create: { safe: input.safe!, slot: input.slot! }, update: {} })
          : gun.lastStoredLocationId
            ? await tx.storageLocation.findUnique({ where: { id: gun.lastStoredLocationId } })
            : null;
        if (!location) throw new HttpError(400, "No stored location is available; provide safe and slot", "RETURN_LOCATION_REQUIRED");
        // Guard the transition itself so two concurrent returns cannot both succeed.
        const closedAt = new Date();
        const closedCount = await tx.custodyRecord.updateMany({ where: { id: custody.id, status: "ACTIVE" }, data: { status: "RETURNED", returnedAt: closedAt, closedById: actor.id } });
        if (closedCount.count !== 1) throw new HttpError(409, "Custody record is already closed", "CUSTODY_CLOSED");
        const closed = await tx.custodyRecord.findUniqueOrThrow({ where: { id: custody.id } });
        await tx.gun.update({ where: { id: gun.id }, data: { state: "STORED", locationId: location.id, lastStoredLocationId: location.id } });
        await event(tx, actor.id, "GUN_RETURNED", "Gun", gun.id, { state: gun.state, custodyId: custody.id }, { state: "STORED", locationId: location.id });
        const updatedGun = await tx.gun.findUniqueOrThrow({ where: { id: gun.id }, include: { location: true, lastStoredLocation: true } });
        return { custody: closed, gun: serializeGun(updatedGun) };
      });
      return reply.send(result);
    } catch (error) { return routeError(reply, error); }
  });

  app.get("/api/guns/:serial/history", async (request, reply) => {
    try {
      requireActor(request);
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const gun = await options.prisma.gun.findUnique({ where: { serialNumber } });
      if (!gun) throw new HttpError(404, "Gun not found", "GUN_NOT_FOUND");
      const events = await options.prisma.activityEvent.findMany({ where: { entityType: "Gun", entityId: gun.id }, orderBy: { createdAt: "asc" }, include: { actor: { select: { id: true, email: true, displayName: true } } } });
      return reply.send(events);
    } catch (error) { return routeError(reply, error); }
  });

  app.get("/api/activity", async (request, reply) => {
    try {
      requireActor(request);
      const query = request.query as { q?: string; action?: string };
      const q = query.q?.trim();
      const action = query.action?.trim();
      let relatedGunIds: string[] | undefined;
      if (q) {
        const matchingGuns = await options.prisma.gun.findMany({
          where: { OR: [
            { serialNumber: { contains: normalizeSerial(q) } },
            { model: { contains: q, mode: "insensitive" } },
          ] },
          select: { id: true },
        });
        relatedGunIds = matchingGuns.map((gun) => gun.id);
      }
      const events = await options.prisma.activityEvent.findMany({
        where: {
          ...(action ? { action: { equals: action } } : {}),
          ...(q ? { OR: [
            { action: { contains: q, mode: "insensitive" } },
            { reason: { contains: q, mode: "insensitive" } },
            ...(relatedGunIds?.length ? [{ entityType: "Gun", entityId: { in: relatedGunIds } }] : []),
          ] } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 500,
        include: { actor: { select: { id: true, email: true, displayName: true } } },
      });
      const gunIds = [...new Set(events.filter((event) => event.entityType === "Gun").map((event) => event.entityId))];
      const guns = gunIds.length ? await options.prisma.gun.findMany({ where: { id: { in: gunIds } }, select: { id: true, serialNumber: true, model: true } }) : [];
      const gunById = new Map(guns.map((gun) => [gun.id, gun]));
      return reply.send(events.map((event) => ({ ...event, relatedGun: gunById.get(event.entityId) ?? null })));
    } catch (error) { return routeError(reply, error); }
  });

  app.get("/api/audits", async (request, reply) => {
    try {
      requireActor(request);
      const audits = await options.prisma.inventoryAudit.findMany({
        orderBy: { startedAt: "desc" },
        include: {
          startedBy: { select: { id: true, email: true, displayName: true } },
          items: { select: { status: true } },
          reconciliation: { select: { id: true, sourceName: true, reviewedAt: true } }
        }
      });
      return reply.send(audits.map((audit) => {
        const counts = audit.items.reduce<Record<string, number>>((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc; }, {});
        return {
          id: audit.id,
          name: audit.name,
          status: audit.status,
          startedAt: audit.startedAt,
          physicalFinalizedAt: audit.physicalFinalizedAt,
          completedAt: audit.completedAt,
          startedBy: audit.startedBy,
          itemCount: audit.items.length,
          counts: { UNRESOLVED: counts.UNRESOLVED ?? 0, SCANNED: counts.SCANNED ?? 0, REPAIR_VERIFIED: counts.REPAIR_VERIFIED ?? 0, EXCEPTION: counts.EXCEPTION ?? 0 },
          reconciliation: audit.reconciliation
        };
      }));
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/audits", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(auditStartSchema, request.body);
      const audit = await options.prisma.$transaction(async (tx) => {
        const guns = await tx.gun.findMany({ where: { lifecycle: "ACTIVE" }, orderBy: { serialNumber: "asc" } });
        const name = normalizeAuditName(input.name);
        const created = await tx.inventoryAudit.create({ data: { name, nameKey: auditNameKey(name), status: "IN_PROGRESS", startedById: actor.id, items: { create: guns.map((gun) => ({ gunId: gun.id, serialNumber: gun.serialNumber })) } }, include: { items: true } });
        await event(tx, actor.id, "AUDIT_STARTED", "InventoryAudit", created.id, undefined, { name: created.name, snapshotCount: guns.length });
        return created;
      });
      return reply.code(201).send({ ...audit, itemCount: audit.items.length, items: undefined });
    } catch (error) { return routeError(reply, error); }
  });

  app.get("/api/audits/:id", async (request, reply) => {
    try {
      requireActor(request);
      const id = (request.params as { id: string }).id;
      const audit = await options.prisma.inventoryAudit.findUnique({ where: { id }, include: { items: { orderBy: { serialNumber: "asc" }, include: { gun: { include: { location: true, lastStoredLocation: true, custody: { where: { status: "ACTIVE" }, orderBy: { checkedOutAt: "desc" } }, assignments: { where: { endsAt: null }, orderBy: { startsAt: "desc" }, take: 1 } } } } }, scans: { orderBy: { scannedAt: "asc" } }, reconciliation: { include: { serials: true } } } });
      if (!audit) throw new HttpError(404, "Audit not found", "AUDIT_NOT_FOUND");
      const counts = audit.items.reduce<Record<string, number>>((acc, item) => { acc[item.status] = (acc[item.status] ?? 0) + 1; return acc; }, {});
      return reply.send({ ...audit, counts });
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/audits/:id/scans", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(scanSchema, request.body);
      const id = (request.params as { id: string }).id;
      const rawSerial = input.serialNumber;
      let serialNumber: string;
      try { serialNumber = normalizeSerial(input.serialNumber); } catch { serialNumber = rawSerial; }
      const result = await options.prisma.$transaction(async (tx) => {
        const audit = await tx.inventoryAudit.findUnique({ where: { id }, include: { items: true } });
        if (!audit) throw new HttpError(404, "Audit not found", "AUDIT_NOT_FOUND");
        if (audit.status !== "IN_PROGRESS") throw new HttpError(409, "Audit is not accepting scans", "AUDIT_NOT_IN_PROGRESS");
        const gun = await tx.gun.findUnique({ where: { serialNumber } });
        const item = audit.items.find((candidate) => candidate.serialNumber === serialNumber);
        let scanResult: "MATCHED" | "DUPLICATE" | "UNEXPECTED" | "ARCHIVED" | "INVALID" = "UNEXPECTED";
        if (!gun) scanResult = "UNEXPECTED";
        else if (gun.lifecycle === "ARCHIVED") scanResult = "ARCHIVED";
        else if (!item) scanResult = "UNEXPECTED";
        else if (item.status !== "UNRESOLVED") scanResult = "DUPLICATE";
        else scanResult = "MATCHED";
        const scan = await tx.auditScan.create({ data: { auditId: id, serialNumber, result: scanResult, scannedById: actor.id } });
        let updatedItem = item;
        if (scanResult === "MATCHED" && item) updatedItem = await tx.auditItem.update({ where: { id: item.id }, data: { status: "SCANNED", resolvedAt: new Date(), resolvedById: actor.id, resolutionNote: "QR/barcode scan" } });
        await event(tx, actor.id, "AUDIT_SCAN_RECORDED", "InventoryAudit", id, undefined, { serialNumber, result: scanResult, scanId: scan.id });
        return { scan, item: updatedItem };
      });
      return reply.code(201).send(result);
    } catch (error) { return routeError(reply, error); }
  });

  // Supports an explicitly created DRAFT (for example, one restored from an import). The
  // normal POST /audits path snapshots and enters IN_PROGRESS atomically in one transaction.
  app.post("/api/audits/:id/start", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const id = (request.params as { id: string }).id;
      const result = await options.prisma.$transaction(async (tx) => {
        const audit = await tx.inventoryAudit.findUnique({ where: { id }, include: { items: true } });
        if (!audit) throw new HttpError(404, "Audit not found", "AUDIT_NOT_FOUND");
        if (audit.status !== "DRAFT") throw new HttpError(409, "Only draft audits can be started", "AUDIT_NOT_DRAFT");
        if (audit.items.length > 0) throw new HttpError(409, "Draft audit already has a snapshot", "AUDIT_SNAPSHOT_EXISTS");
        const guns = await tx.gun.findMany({ where: { lifecycle: "ACTIVE" }, orderBy: { serialNumber: "asc" } });
        const started = await tx.inventoryAudit.update({ where: { id }, data: { status: "IN_PROGRESS", items: { create: guns.map((gun) => ({ gunId: gun.id, serialNumber: gun.serialNumber })) } }, include: { items: true } });
        await event(tx, actor.id, "AUDIT_STARTED", "InventoryAudit", id, { status: audit.status }, { status: started.status, snapshotCount: guns.length });
        return started;
      });
      return reply.send({ ...result, itemCount: result.items.length, items: undefined });
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/audits/:id/items/:serial/repair-verify", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const note = (request.body as { note?: string } | undefined)?.note?.trim();
      if (!note) throw new HttpError(400, "Verification note is required", "VERIFICATION_NOTE_REQUIRED");
      const id = (request.params as { id: string }).id;
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const result = await options.prisma.$transaction(async (tx) => {
        const item = await tx.auditItem.findFirst({ where: { auditId: id, serialNumber }, include: { gun: true } });
        if (!item) throw new HttpError(404, "Audit item not found", "AUDIT_ITEM_NOT_FOUND");
        if (item.gun.state !== "REPAIR") throw new HttpError(409, "Gun is not currently in repair", "GUN_NOT_IN_REPAIR");
        if (item.status !== "UNRESOLVED") throw new HttpError(409, "Audit item is already resolved", "AUDIT_ITEM_RESOLVED");
        const updated = await tx.auditItem.update({ where: { id: item.id }, data: { status: "REPAIR_VERIFIED", resolvedAt: new Date(), resolvedById: actor.id, resolutionNote: note } });
        await event(tx, actor.id, "AUDIT_REPAIR_VERIFIED", "InventoryAudit", id, { serialNumber }, { serialNumber, status: updated.status }, note);
        return updated;
      });
      return reply.send(result);
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/audits/:id/items/:serial/exception", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(exceptionSchema, request.body);
      const id = (request.params as { id: string }).id;
      const serialNumber = normalizeSerial((request.params as { serial: string }).serial);
      const result = await options.prisma.$transaction(async (tx) => {
        const item = await tx.auditItem.findFirst({ where: { auditId: id, serialNumber } });
        if (!item) throw new HttpError(404, "Audit item not found", "AUDIT_ITEM_NOT_FOUND");
        if (item.status !== "UNRESOLVED") throw new HttpError(409, "Audit item is already resolved", "AUDIT_ITEM_RESOLVED");
        const updated = await tx.auditItem.update({ where: { id: item.id }, data: { status: "EXCEPTION", resolvedAt: new Date(), resolvedById: actor.id, resolutionNote: `${input.reason}: ${input.note}` } });
        await event(tx, actor.id, "AUDIT_EXCEPTION_APPROVED", "InventoryAudit", id, { serialNumber }, { serialNumber, status: updated.status }, input.reason);
        return updated;
      });
      return reply.send(result);
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/audits/:id/finalize", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const id = (request.params as { id: string }).id;
      const result = await options.prisma.$transaction(async (tx) => {
        const audit = await tx.inventoryAudit.findUnique({ where: { id } });
        if (!audit) throw new HttpError(404, "Audit not found", "AUDIT_NOT_FOUND");
        if (audit.status !== "IN_PROGRESS") throw new HttpError(409, "Audit is not in progress", "AUDIT_NOT_IN_PROGRESS");
        const unresolved = await tx.auditItem.count({ where: { auditId: id, status: "UNRESOLVED" } });
        if (unresolved > 0) throw new HttpError(409, `${unresolved} audit items remain unresolved`, "AUDIT_ITEMS_UNRESOLVED");
        const finalized = await tx.inventoryAudit.update({ where: { id }, data: { status: "PHYSICAL_FINALIZED", physicalFinalizedAt: new Date() } });
        await event(tx, actor.id, "AUDIT_PHYSICAL_FINALIZED", "InventoryAudit", id, { status: audit.status }, { status: finalized.status });
        return finalized;
      });
      return reply.send(result);
    } catch (error) { return routeError(reply, error); }
  });

  app.post("/api/audits/:id/reconciliation", async (request, reply) => {
    try {
      const actor = requireActor(request);
      const input = parseOrThrow(reconciliationSchema, request.body);
      const id = (request.params as { id: string }).id;
      const result = await options.prisma.$transaction(async (tx) => {
        const audit = await tx.inventoryAudit.findUnique({ where: { id } });
        if (!audit) throw new HttpError(404, "Audit not found", "AUDIT_NOT_FOUND");
        if (audit.status !== "PHYSICAL_FINALIZED") throw new HttpError(409, "Physical count must be finalized before reconciliation", "AUDIT_NOT_FINALIZED");
        const normalizedSerials = input.serials.map(normalizeSerial);
        const counts = new Map<string, number>();
        for (const serial of normalizedSerials) counts.set(serial, (counts.get(serial) ?? 0) + 1);
        const activeGuns = await tx.gun.findMany({ where: { lifecycle: "ACTIVE" }, select: { serialNumber: true } });
        const activeSet = new Set(activeGuns.map((gun) => gun.serialNumber));
        const rows = new Map<string, "MATCHED" | "MISSING_FROM_EXTERNAL" | "UNKNOWN_EXTERNAL" | "DUPLICATE_EXTERNAL">();
        for (const serial of activeSet) rows.set(serial, (counts.get(serial) ?? 0) === 1 ? "MATCHED" : (counts.get(serial) ?? 0) > 1 ? "DUPLICATE_EXTERNAL" : "MISSING_FROM_EXTERNAL");
        for (const serial of counts.keys()) if (!activeSet.has(serial)) rows.set(serial, (counts.get(serial) ?? 0) > 1 ? "DUPLICATE_EXTERNAL" : "UNKNOWN_EXTERNAL");
        const reconciliation = await tx.reconciliation.create({ data: { auditId: id, sourceName: input.sourceName, reviewedById: actor.id, serials: { create: [...rows].map(([serialNumber, result]) => ({ serialNumber, result })) } }, include: { serials: true } });
        const completed = await tx.inventoryAudit.update({ where: { id }, data: { status: "COMPLETE", completedAt: new Date() } });
        await event(tx, actor.id, "AUDIT_RECONCILIATION_ATTACHED", "InventoryAudit", id, { status: audit.status }, { status: completed.status, reconciliationId: reconciliation.id }, "Reviewed extraction attached; source PDF bytes discarded");
        const summary = reconciliation.serials.reduce<Record<string, number>>((acc, row) => { acc[row.result] = (acc[row.result] ?? 0) + 1; return acc; }, {});
        return { reconciliation, audit: completed, summary };
      });
      return reply.code(201).send(result);
    } catch (error) { return routeError(reply, error); }
  });

  // The worker extracts selectable text in-memory and returns reviewable candidates. The API
  // intentionally does not persist this request body; the UI submits the reviewed serial set
  // to /reconciliation afterward, which is the only data retained by the audit.
  app.post("/api/audits/:id/reconciliation/pdf/preview", async (request, reply) => {
    try {
      requireActor(request);
      const id = (request.params as { id: string }).id;
      const audit = await options.prisma.inventoryAudit.findUnique({ where: { id }, include: { items: { select: { serialNumber: true } } } });
      if (!audit) throw new HttpError(404, "Audit not found", "AUDIT_NOT_FOUND");
      if (audit.status !== "PHYSICAL_FINALIZED") throw new HttpError(409, "Physical count must be finalized before PDF reconciliation", "AUDIT_NOT_FINALIZED");
      const body = request.body;
      if (!Buffer.isBuffer(body) || body.byteLength === 0) throw new HttpError(400, "Upload a non-empty selectable-text PDF", "PDF_UPLOAD_REQUIRED");
      const extraction = await extractPdf(new Uint8Array(body), { knownSerials: audit.items.map((item) => item.serialNumber) });
      return reply.send({ ...extraction, sourceBytesDiscarded: true, next: "Review candidates, then POST { sourceName, serials } to /reconciliation." });
    } catch (error) { return routeError(reply, error); }
  });

  app.get("/api/audits/:id/evidence.csv", async (request, reply) => {
    try {
      requireActor(request);
      const id = (request.params as { id: string }).id;
      const audit = await options.prisma.inventoryAudit.findUnique({ where: { id }, include: { items: { orderBy: { serialNumber: "asc" } }, scans: { orderBy: { scannedAt: "asc" } }, reconciliation: { include: { serials: true } } } });
      if (!audit) throw new HttpError(404, "Audit not found", "AUDIT_NOT_FOUND");
      if (audit.status === "DRAFT" || audit.status === "IN_PROGRESS") throw new HttpError(409, "Finalize the physical count before exporting evidence", "AUDIT_NOT_FINALIZED");
      const rows = [
        ["section", "serialNumber", "status", "resolutionNote", "scanResult"],
        ...audit.items.map((item) => ["snapshot", item.serialNumber, item.status, item.resolutionNote ?? "", audit.scans.find((scan) => scan.serialNumber === item.serialNumber && scan.result === "MATCHED")?.result ?? ""]),
        ...(audit.reconciliation?.serials.map((row) => ["reconciliation", row.serialNumber, row.result, "", ""]) ?? [])
      ];
      reply.header("content-type", "text/csv; charset=utf-8");
      reply.header("content-disposition", `attachment; filename="audit-${id}.csv"`);
      return reply.send(rows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n");
    } catch (error) { return routeError(reply, error); }
  });

  app.get("/api/audits/:id/evidence.pdf", async (request, reply) => {
    try {
      requireActor(request);
      const id = (request.params as { id: string }).id;
      const audit = await options.prisma.inventoryAudit.findUnique({ where: { id }, include: { startedBy: true, items: { orderBy: { serialNumber: "asc" }, include: { resolvedBy: true } }, reconciliation: { include: { serials: true } } } });
      if (!audit) throw new HttpError(404, "Audit not found", "AUDIT_NOT_FOUND");
      if (audit.status === "DRAFT" || audit.status === "IN_PROGRESS" || !audit.physicalFinalizedAt) throw new HttpError(409, "Finalize the physical count before exporting evidence", "AUDIT_NOT_FINALIZED");
      const finalization = await options.prisma.activityEvent.findFirst({ where: { entityType: "InventoryAudit", entityId: id, action: "AUDIT_PHYSICAL_FINALIZED" }, orderBy: { createdAt: "desc" }, include: { actor: true } });
      const resolution = (status: AuditItemStatus): "scanned" | "repair-verified" | "approved-exception" => status === "SCANNED" ? "scanned" : status === "REPAIR_VERIFIED" ? "repair-verified" : "approved-exception";
      const evidence = {
        auditId: id,
        startedAt: audit.startedAt.toISOString(),
        physicalCountFinalizedAt: audit.physicalFinalizedAt.toISOString(),
        finalizedBy: finalization?.actor.displayName ?? audit.startedBy.displayName,
        snapshotSerials: audit.items.map((item) => item.serialNumber),
        items: audit.items.map((item) => ({ serial: item.serialNumber, resolution: resolution(item.status), resolvedAt: item.resolvedAt?.toISOString() ?? audit.physicalFinalizedAt!.toISOString(), actor: item.resolvedBy?.displayName ?? "unknown", reason: item.resolutionNote ?? "" })),
        ...(audit.reconciliation ? { reconciliation: {
          snapshotSerials: audit.items.map((item) => item.serialNumber),
          reviewedExternalSerials: audit.reconciliation.serials.filter((row) => row.result === "MATCHED" || row.result === "DUPLICATE_EXTERNAL").map((row) => row.serialNumber),
          matched: audit.reconciliation.serials.filter((row) => row.result === "MATCHED").map((row) => row.serialNumber),
          missing: audit.reconciliation.serials.filter((row) => row.result === "MISSING_FROM_EXTERNAL").map((row) => row.serialNumber),
          unknown: audit.reconciliation.serials.filter((row) => row.result === "UNKNOWN_EXTERNAL").map((row) => row.serialNumber),
          duplicateExternal: audit.reconciliation.serials.filter((row) => row.result === "DUPLICATE_EXTERNAL").map((row) => ({ serial: row.serialNumber, occurrences: [1, 2] })),
          invalidExternal: [],
          status: audit.reconciliation.serials.some((row) => row.result !== "MATCHED") ? "needs-review" as const : "matched" as const
        } } : {})
      };
      const pdf = generateEvidencePdf(evidence);
      reply.header("content-type", "application/pdf");
      reply.header("content-disposition", `attachment; filename="audit-${id}.pdf"`);
      return reply.send(Buffer.from(pdf));
    } catch (error) { return routeError(reply, error); }
  });

  app.setErrorHandler((error, _request, reply) => routeError(reply, error));
  return app;
}
