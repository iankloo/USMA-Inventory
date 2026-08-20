export type PdfSerialExtraction = {
    serials: string[];
    duplicates: {
        serial: string;
        occurrences: number[];
    }[];
    invalidTokens: string[];
    pageCount: number;
    warnings: string[];
    /** Always true: callers can use this as a contract that source bytes are not persisted. */
    sourceBytesDiscarded: true;
};
export type PdfTextLoader = (data: Uint8Array) => Promise<string[]>;
export declare function extractSerialsFromText(pages: readonly string[], options?: {
    knownSerials?: readonly string[];
    serialPattern?: RegExp;
}): PdfSerialExtraction;
/**
 * Extract selectable text with pdf.js. The input is scoped to this call and is
 * never returned, written to disk, or stored in a result object.
 */
export declare function extractPdfSerials(input: Uint8Array, options?: {
    knownSerials?: readonly string[];
    serialPattern?: RegExp;
    loadText?: PdfTextLoader;
}): Promise<PdfSerialExtraction>;
