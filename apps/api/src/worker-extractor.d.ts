declare module "skeet-inventory-worker" {
  export type PdfSerialExtraction = {
    serials: string[];
    duplicates: { serial: string; occurrences: number[] }[];
    invalidTokens: string[];
    pageCount: number;
    warnings: string[];
    sourceBytesDiscarded: true;
  };
  export function extractPdfSerials(input: Uint8Array, options?: { knownSerials?: readonly string[]; serialPattern?: RegExp }): Promise<PdfSerialExtraction>;
  export type AuditEvidence = {
    auditId: string;
    startedAt: string;
    physicalCountFinalizedAt: string;
    finalizedBy: string;
    snapshotSerials: readonly string[];
    items: readonly { serial: string; resolution: "scanned" | "repair-verified" | "approved-exception"; resolvedAt: string; actor: string; reason?: string; eventReferences?: string[] }[];
    reconciliation?: { snapshotSerials: string[]; reviewedExternalSerials: string[]; matched: string[]; missing: string[]; unknown: string[]; duplicateExternal: { serial: string; occurrences: number[] }[]; invalidExternal: string[]; status: "matched" | "needs-review" };
  };
  export function generateEvidencePdf(evidence: AuditEvidence): Uint8Array;
}
