import { deduplicateSerials, normalizeSerial } from "./serial.js";
/** Compare a reviewed external serial set against the active audit snapshot. */
export function reconcileSerials(input) {
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
export function normalizeReviewedSerialSet(values) {
    return [...new Set(values.map(normalizeSerial).filter(Boolean))].sort();
}
