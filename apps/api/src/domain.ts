import { z } from "zod";

export const serialSchema = z.string().trim().min(2).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "serial must contain only letters, numbers, dot, underscore, slash, or hyphen");
export const gunTypeSchema = z.enum(["SKEET", "TRAP", "SPORTING"]);
export const handednessValueSchema = z.enum(["LEFT", "RIGHT", "AMBIDEXTROUS"]);
export const handednessSchema = handednessValueSchema.optional();

export const gunInputSchema = z.object({
  serialNumber: serialSchema,
  model: z.string().trim().min(1).max(120),
  gauge: z.string().trim().min(1).max(20).nullable().optional(),
  owner: z.string().trim().min(1).max(160).nullable().optional(),
  barrelLength: z.number().positive().max(100).optional(),
  lengthOfPull: z.number().positive().max(100).optional(),
  handedness: handednessSchema,
  adjustableComb: z.boolean().nullable().optional(),
  type: gunTypeSchema.nullable().optional(),
  highRib: z.boolean().nullable().optional(),
  safe: z.number().int().min(2).max(7).optional(),
  slot: z.number().int().min(1).max(28).optional()
}).superRefine((value, ctx) => {
  if (value.safe === undefined && value.slot !== undefined) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "slot cannot be supplied without a safe", path: ["safe"] });
  }
});

/** Descriptive fields may be corrected after creation; identity and custody stay immutable here. */
export const gunDetailsUpdateSchema = z.object({
  model: z.string().trim().min(1).max(120).optional(),
  gauge: z.string().trim().min(1).max(20).nullable().optional(),
  owner: z.string().trim().min(1).max(160).nullable().optional(),
  barrelLength: z.number().positive().max(100).nullable().optional(),
  lengthOfPull: z.number().positive().max(100).nullable().optional(),
  handedness: handednessValueSchema.nullable().optional(),
  adjustableComb: z.boolean().nullable().optional(),
  type: gunTypeSchema.nullable().optional(),
  highRib: z.boolean().nullable().optional()
}).strict().refine((value) => Object.keys(value).length > 0, "At least one descriptive field is required");

export const checkoutSchema = z.object({
  personName: z.string().trim().min(1).max(160),
  personEmail: z.string().trim().email().optional(),
  reason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  expectedReturn: z.coerce.date().optional()
});

export const repairSchema = z.object({
  vendor: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2000).optional(),
  expectedReturn: z.coerce.date().optional()
});

export const locationSchema = z.object({ safe: z.number().int().min(2).max(7), slot: z.number().int().min(1).max(28) });
export const archiveSchema = z.object({ justification: z.string().trim().min(1).max(1000) });
export const returnLocationSchema = z.object({
  safe: z.number().int().min(2).max(7).optional(),
  slot: z.number().int().min(1).max(28).optional()
}).superRefine((value, ctx) => {
  if ((value.safe === undefined) !== (value.slot === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "safe and slot must be supplied together", path: ["safe"] });
  }
}).optional();
export const assignmentSchema = z.object({ cadetName: z.string().trim().min(1).max(160), cadetId: z.string().trim().max(80).optional() });
export const fitterAssignmentSchema = assignmentSchema.extend({
  safe: z.number().int().min(2).max(7),
  slot: z.number().int().min(1).max(28),
});
export const userCreateSchema = z.object({
  cognitoSubject: z.string().trim().min(1).max(200),
  email: z.string().trim().email(),
  displayName: z.string().trim().min(1).max(160),
  role: z.enum(["OPERATOR", "ACCOUNT_ADMIN"]).default("OPERATOR")
});
export const auditStartSchema = z.object({ name: z.string().trim().min(1).max(160) });
export const scanSchema = z.object({ serialNumber: z.string().trim().min(1).max(128) });
export const exceptionSchema = z.object({ reason: z.string().trim().min(1).max(500), note: z.string().trim().min(1).max(2000) });
export const reconciliationSchema = z.object({ sourceName: z.string().trim().min(1).max(240), serials: z.array(z.string().trim().min(1).max(128)).min(1).max(10000) });

export function normalizeSerial(value: string): string {
  return value.trim().toUpperCase();
}

/** Preserve a readable audit label while making repeated whitespace deterministic. */
export function normalizeAuditName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/** Canonical key used by the database unique constraint for audit names. */
export function auditNameKey(value: string): string {
  return normalizeAuditName(value).toLowerCase();
}

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ");
    throw new Error(`VALIDATION_ERROR:${message}`);
  }
  return parsed.data;
}

export type ResolutionStatus = "SCANNED" | "REPAIR_VERIFIED" | "EXCEPTION";

export function csvEscape(value: unknown): string {
  const stringValue = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(stringValue) ? `"${stringValue.replaceAll('"', '""')}"` : stringValue;
}
