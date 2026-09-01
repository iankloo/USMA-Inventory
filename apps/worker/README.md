# Inventory worker

This package contains pure worker utilities for the inventory application's import,
PDF reconciliation, and finalized-audit evidence workflows. It has no API, database,
or web dependencies. The API worker can call these functions from a short-lived job,
then persist only their validated outputs.

## Contracts

- `validateCsvGunImport(input, { mode, existingSerials })` parses CSV and returns
  `{ valid, rows, issues }`. Rows have an explicit `decision` of `create` or `update`.
  `mode: "create-only"` rejects rows already present. Safe is validated as 2–7 and
  slot as 1–28; a slot cannot be supplied without a safe. A safe without a slot
  is retained as a reported safe, while complete current locations use both. Optional
  gun fitting columns include `handedness`, `lengthOfPull`, and `adjustableComb`;
  the latter accepts boolean-style values such as `true`/`false`, `yes`/`no`, and
  `1`/`0`.
- `validateXlsxGunImport(input, options)` reads the first worksheet with the `xlsx`
  library and returns the same result. The workbook is not returned or persisted.
- `extractPdfSerials(input, options)` uses selectable text through pdf.js and returns
  normalized serials, duplicates, warnings, and `sourceBytesDiscarded: true`. Pass
  `knownSerials` from the active audit snapshot to avoid treating unrelated PDF
  numbers as serials. Image-only/empty extraction produces a warning and requires
  human review; OCR is intentionally not supported in V1.
- `extractSerialsFromText(pages, options)` is the parser seam for tests or an API
  adapter that already has pdf.js text. It never receives or returns PDF bytes.
- `reconcileSerials({ snapshotSerials, externalSerials })` compares normalized sets
  and reports matched, missing, unknown, duplicate, and invalid values. `needs-review`
  is returned for any discrepancy.
- `generateEvidencePackage(evidence)` returns deterministic CSV and PDF bytes. The
  evidence must be physically finalized and contain exactly one resolution item for
  every snapshot serial; each item includes resolution, actor, timestamp, and event
  references. The PDF is dependency-free and suitable for object-storage upload.

All serial comparison uses `normalizeSerial` (NFKC, uppercase, separator removal).
The caller should discard uploaded PDF bytes after `extractPdfSerials` resolves and
persist only the reviewed serial set, reconciliation result, and actor/timestamps.
