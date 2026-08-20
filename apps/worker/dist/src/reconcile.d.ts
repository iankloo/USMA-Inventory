export type ReconciliationResult = {
    snapshotSerials: string[];
    reviewedExternalSerials: string[];
    matched: string[];
    missing: string[];
    unknown: string[];
    duplicateExternal: {
        serial: string;
        occurrences: number[];
    }[];
    invalidExternal: string[];
    status: "matched" | "needs-review";
};
/** Compare a reviewed external serial set against the active audit snapshot. */
export declare function reconcileSerials(input: {
    snapshotSerials: readonly unknown[];
    externalSerials: readonly unknown[];
}): ReconciliationResult;
export declare function normalizeReviewedSerialSet(values: readonly unknown[]): string[];
