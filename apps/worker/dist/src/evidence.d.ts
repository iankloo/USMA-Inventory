import type { ReconciliationResult } from "./reconcile.js";
export type AuditEvidenceItem = {
    serial: string;
    resolution: "scanned" | "repair-verified" | "approved-exception";
    resolvedAt: string;
    actor: string;
    reason?: string;
    eventReferences?: string[];
};
export type AuditEvidence = {
    auditId: string;
    startedAt: string;
    physicalCountFinalizedAt: string;
    finalizedBy: string;
    snapshotSerials: readonly string[];
    items: readonly AuditEvidenceItem[];
    reconciliation?: ReconciliationResult;
};
export declare function generateEvidenceCsv(evidence: AuditEvidence): string;
/** Generate a small dependency-free, human-readable PDF evidence artifact. */
export declare function generateEvidencePdf(evidence: AuditEvidence): Uint8Array;
export declare function generateEvidencePackage(evidence: AuditEvidence): {
    csv: string;
    pdf: Uint8Array;
};
