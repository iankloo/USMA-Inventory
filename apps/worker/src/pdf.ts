import { deduplicateSerials, isValidSerial, normalizeSerial } from "./serial.js";

export type PdfSerialExtraction = {
  serials: string[];
  duplicates: { serial: string; occurrences: number[] }[];
  invalidTokens: string[];
  pageCount: number;
  warnings: string[];
  /** Always true: callers can use this as a contract that source bytes are not persisted. */
  sourceBytesDiscarded: true;
};

export type PdfTextLoader = (data: Uint8Array) => Promise<string[]>;

function tokenCandidates(text: string): string[] {
  // PDF text extraction commonly inserts spaces between table cells. Tokens are
  // intentionally conservative: dates and punctuation-only table values are not
  // serial candidates, while numeric and alpha-numeric serials remain candidates.
  return text.match(/[A-Za-z0-9][A-Za-z0-9./_-]{2,63}/g) ?? [];
}

export function extractSerialsFromText(
  pages: readonly string[],
  options: { knownSerials?: readonly string[]; serialPattern?: RegExp } = {}
): PdfSerialExtraction {
  const known = new Set((options.knownSerials ?? []).map(normalizeSerial).filter(Boolean));
  const candidates = pages.flatMap(tokenCandidates);
  const pattern = options.serialPattern;
  const accepted: string[] = [];
  const invalidTokens: string[] = [];
  for (const candidate of candidates) {
    if (pattern) {
      pattern.lastIndex = 0;
      if (!pattern.test(candidate)) continue;
    }
    const normalized = normalizeSerial(candidate);
    if (!isValidSerial(normalized)) {
      invalidTokens.push(candidate);
    } else if (known.size === 0 || known.has(normalized)) {
      accepted.push(normalized);
    }
  }
  const deduped = deduplicateSerials(accepted);
  const warnings: string[] = [];
  if (pages.every((page) => page.trim() === "")) warnings.push("PDF contains no selectable text.");
  if (known.size === 0) warnings.push("No inventory snapshot was supplied; all serial-like tokens require human review.");
  if (deduped.serials.length === 0) warnings.push("No serials were extracted from selectable text.");
  return {
    serials: deduped.serials,
    duplicates: deduped.duplicates,
    invalidTokens,
    pageCount: pages.length,
    warnings,
    sourceBytesDiscarded: true
  };
}

/**
 * Extract selectable text with pdf.js. The input is scoped to this call and is
 * never returned, written to disk, or stored in a result object.
 */
export async function extractPdfSerials(
  input: Uint8Array,
  options: { knownSerials?: readonly string[]; serialPattern?: RegExp; loadText?: PdfTextLoader } = {}
): Promise<PdfSerialExtraction> {
  if (input.byteLength === 0) throw new Error("PDF upload is empty.");
  if (input.byteLength > 25 * 1024 * 1024) throw new Error("PDF upload exceeds the 25 MB worker limit.");
  const loadText = options.loadText ?? defaultPdfTextLoader;
  // Give the parser an owned copy so the worker can explicitly clear its bytes
  // after the extraction job, without mutating the API caller's upload buffer.
  const ownedInput = new Uint8Array(input);
  try {
    const pages = await loadText(ownedInput);
    return extractSerialsFromText(pages, options);
  } finally {
    ownedInput.fill(0);
  }
}

async function defaultPdfTextLoader(data: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true });
  const document = await loadingTask.promise;
  try {
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
      page.cleanup();
    }
    return pages;
  } finally {
    await document.destroy();
  }
}
