/** A serial after the stable comparison normalization used by every worker operation. */
export declare function normalizeSerial(value: unknown): string;
export declare function isValidSerial(value: unknown): value is string;
export type DuplicateSerial = {
    serial: string;
    occurrences: number[];
};
export declare function deduplicateSerials(values: readonly unknown[]): {
    serials: string[];
    invalid: string[];
    duplicates: DuplicateSerial[];
};
