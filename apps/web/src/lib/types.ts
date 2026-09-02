export type GunStatus = "Stored" | "Checked out" | "In repair" | "Archived";
export type GunType = string;
export type GunTypeCode = "SKEET" | "TRAP" | "SPORTING" | "ACS" | "VITTORIA" | "ONYX" | "TRAP (SINGLE BARREL)" | "TRAP (DOUBLE BARREL)";

export interface Gun {
  serial: string;
  model: string;
  gauge: string | null;
  owner?: string | null;
  /** Legacy-reported safe when the slot is unknown; complete locations use safe/slot. */
  reportedSafe?: number | null;
  barrelLength: string;
  lengthOfPull: string;
  chokeType?: string;
  handedness: "Right" | "Left" | "Neutral";
  adjustableComb: boolean | null;
  type: GunType | null;
  highRib: boolean | null;
  status: GunStatus;
  safe?: number;
  slot?: number;
  /** Last known saved storage location, retained by the web client for return defaults. */
  defaultSafe?: number;
  defaultSlot?: number;
  assignedCadet?: string;
  holder?: string;
  repairVendor?: string;
  /** Active custody record needed to close a checkout/repair. */
  custodyId?: string;
  updatedAt: string;
}

export interface AuditItemSummary {
  serial: string;
  status: "UNRESOLVED" | "SCANNED" | "REPAIR_VERIFIED" | "EXCEPTION";
}

export interface ActivityEvent {
  id: string;
  action: string;
  actionCode?: string;
  actor: string;
  timestamp: string;
  detail: string;
  relatedSerial?: string;
  occurredAt?: string;
  tone?: "default" | "success" | "warning";
}

export interface CurrentUser {
  id: string;
  displayName: string;
  email: string;
  role: "OPERATOR" | "ACCOUNT_ADMIN";
  status: "ACTIVE" | "DISABLED";
}

export interface AuditSummary {
  id: string;
  label: string;
  startedAt: string;
  startedBy: string;
  expected: number;
  resolved: number;
  scanned: number;
  repairVerified: number;
  exceptions: number;
  status: "In progress" | "Physical count finalized" | "Complete";
  reconciliation?: "Not uploaded" | "Needs review" | "Reconciled";
  /** Present on GET /audits/:id; used to target exception actions. */
  items?: AuditItemSummary[];
  /** Successful scans, newest first, for the complete audit scan history. */
  scannedGuns?: Array<{ serial: string; scannedAt: string }>;
}

export interface ReconciliationResult {
  externalCount: number;
  matched: number;
  missing: string[];
  unknown: string[];
  duplicate: string[];
}

export interface PdfPreview {
  serials: string[];
  duplicates: { serial: string; occurrences: number[] }[];
  invalidTokens: string[];
  pageCount: number;
  warnings: string[];
  sourceBytesDiscarded: true;
}

export interface ImportIssue {
  row: number;
  field?: string;
  code: string;
  message: string;
}

export interface ImportPreview {
  valid: boolean;
  rows: Array<{
    serialNumber: string;
    model?: string;
    gauge?: string;
    owner?: string;
    type?: string;
    modelType?: string;
    decision: "create" | "update";
    sourceRow: number;
  }>;
  issues: ImportIssue[];
  warnings?: string[];
  summary: { rows: number; creates: number; updates: number; issues: number };
}

export interface ImportCommitResult {
  imported: number;
  created: number;
  updated: number;
  rows: Array<{ serialNumber: string; decision: "create" | "update"; gun: unknown }>;
}

export interface ApiClient {
  signIn: (email?: string, password?: string) => Promise<void>;
  listGuns: (query?: string, options?: { lifecycle?: "ACTIVE" | "ARCHIVED" }) => Promise<Gun[]>;
  createGun: (input: CreateGunInput) => Promise<Gun>;
  updateGunDetails: (serial: string, input: UpdateGunDetailsInput) => Promise<Gun>;
  archiveGun: (serial: string, justification: string) => Promise<Gun>;
  unarchiveGun: (serial: string) => Promise<Gun>;
  updateLocation: (serial: string, input: { safe: number; slot: number }) => Promise<Gun>;
  assignCadet: (serial: string, cadetName: string) => Promise<Gun>;
  assignFittedGun: (serial: string, input: { cadetName: string; safe: number; slot: number }) => Promise<Gun>;
  unassignCadet: (serial: string) => Promise<Gun>;
  checkoutGun: (serial: string, input: { personName: string; notes?: string }) => Promise<Gun>;
  sendToRepair: (serial: string, input: { vendor: string; reason: string; notes?: string; expectedReturn?: string }) => Promise<Gun>;
  returnGun: (serial: string, custodyId: string, input: { safe: number; slot: number }) => Promise<Gun>;
  getGun: (serial: string) => Promise<Gun>;
  getGunHistory: (serial: string) => Promise<ActivityEvent[]>;
  getCurrentUser: () => Promise<CurrentUser>;
  listActivity: (filters?: { query?: string; action?: string }) => Promise<ActivityEvent[]>;
  listAudits: () => Promise<AuditSummary[]>;
  getAudit: (id: string) => Promise<AuditSummary>;
  createAudit: (label: string) => Promise<AuditSummary>;
  previewGunImport: (file: File, mode?: "upsert" | "create-only") => Promise<ImportPreview>;
  commitGunImport: (file: File, mode?: "upsert" | "create-only") => Promise<ImportCommitResult>;
  scanAuditSerial: (
    auditId: string,
    serial: string,
  ) => Promise<{
    outcome: "scanned" | "duplicate" | "unexpected" | "archived";
    gun?: Gun;
  }>;
  verifyRepair: (
    auditId: string,
    serial: string,
    note: string,
  ) => Promise<void>;
  approveException: (
    auditId: string,
    serial: string,
    reason: string,
    note: string,
  ) => Promise<void>;
  finalizeAudit: (auditId: string) => Promise<AuditSummary>;
  previewReconciliationPdf: (auditId: string, file: File) => Promise<PdfPreview>;
  uploadReconciliation: (
    auditId: string,
    input: { sourceName: string; serials: string[] },
  ) => Promise<ReconciliationResult>;
  exportAudit: (auditId: string, format: "csv" | "pdf") => Promise<Blob>;
}

export interface CreateGunInput {
  serialNumber: string;
  model: string;
  gauge?: string | null;
  owner?: string | null;
  barrelLength?: number;
  lengthOfPull?: number;
  chokeType?: string | null;
  handedness: "RIGHT" | "LEFT" | "AMBIDEXTROUS";
  adjustableComb?: boolean | null;
  type?: GunTypeCode | null;
  highRib?: boolean | null;
  safe?: number;
  slot?: number;
}

export interface UpdateGunDetailsInput {
  model?: string;
  gauge?: string | null;
  owner?: string | null;
  barrelLength?: number | null;
  lengthOfPull?: number | null;
  chokeType?: string | null;
  handedness?: "RIGHT" | "LEFT" | "AMBIDEXTROUS" | null;
  adjustableComb?: boolean | null;
  type?: GunTypeCode | null;
  highRib?: boolean | null;
}
