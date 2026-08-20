export type GunImportRow = {
    serialNumber: string;
    model?: string;
    gauge?: string;
    owner?: string;
    barrelLength?: string;
    lengthOfPull?: string;
    handedness?: string;
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
    occupiedLocations?: readonly {
        serialNumber?: string;
        safe: number;
        slot: number;
    }[];
    skipBlankSerial?: boolean;
};
export type ImportIssue = {
    row: number;
    field?: string;
    code: "missing-serial" | "invalid-serial" | "duplicate-serial" | "already-exists" | "invalid-number" | "invalid-enum" | "invalid-boolean" | "incomplete-location" | "safe-out-of-range" | "slot-out-of-range";
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
/** RFC 4180-compatible CSV parser with support for quoted commas and newlines. */
export declare function parseCsv(input: string | Uint8Array): string[][];
/** Validate already decoded spreadsheet records and return explicit create/update decisions. */
export declare function validateGunImport(records: readonly Record<string, unknown>[], options?: ImportOptions): GunImportValidation;
export declare function validateCsvGunImport(input: string | Uint8Array, options?: ImportOptions): GunImportValidation;
/** Decode the first worksheet without retaining the workbook after validation. */
export declare function validateXlsxGunImport(input: Uint8Array, options?: ImportOptions): Promise<GunImportValidation>;
export interface LegacyInventoryPreparation {
    records: Record<string, unknown>[];
    validation: GunImportValidation;
    warnings: string[];
}
/**
 * Normalize a legacy table before it reaches the API. Unknown legacy model
 * types remain unknown, asset tags are intentionally ignored, and duplicate
 * safe/slot pairs are moved to the nearest free slot in the same safe.
 */
export declare function prepareLegacyInventory(records: readonly Record<string, unknown>[], options?: ImportOptions): LegacyInventoryPreparation;
