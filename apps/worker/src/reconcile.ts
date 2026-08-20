import { deduplicateSerials, normalizeSerial } from "./serial.js";

export type ReconciliationResult = {
  snapshotSerials: string[];
  reviewedExternalSerials: string[];
  matched: string[];
  missing: string[];
  unknown: string[];
  duplicateExternal: { serial: string; occurrences: number[] }[];
  invalidExternal: string[];
  status: "matched" | "needs-review";
};

/** Compare a reviewed external serial set against the active audit snapshot. */
export function reconcileSerials(input: {
  snapshotSerials: readonly unknown[];
  externalSerials: readonly unknown[];
}): ReconciliationResult {
  const snapshot = deduplicateSerials(input.snapshotSerials);
  const external = deduplicateSerials(input.externalSerials);
  const snapshotSet = new Set(snapshot.serials);
  const externalSet = new Set(external.serials);
  const matched = snapshot.serials.filter((serial) => externalSet.has(serial));
  const missing = snapshot.serials.filter((serial) => !externalSet.has(serial));
  const unknown = external.serials.filter((serial) => !snapshotSet.has(serial));
  return {
    snapshotSerials: snapshot.serials,
    reviewedExternalSerials: external.serials,
    matched,
    missing,
    unknown,
    duplicateExternal: external.duplicates,
    invalidExternal: external.invalid,
    status: missing.length || unknown.length || external.duplicates.length || external.invalid.length ? "needs-review" : "matched"
  };
}

export function normalizeReviewedSerialSet(values: readonly unknown[]): string[] {
  return [...new Set(values.map(normalizeSerial).filter(Boolean))].sort();
}
