/** A serial after the stable comparison normalization used by every worker operation. */
export function normalizeSerial(value) {
    if (typeof value !== "string" && typeof value !== "number")
        return "";
    // NFKC handles full-width characters copied from PDFs. Punctuation and whitespace
    // are separators in serial labels, not part of the identity we compare.
    return String(value)
        .normalize("NFKC")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
}
export function isValidSerial(value) {
    const normalized = normalizeSerial(value);
    return normalized.length >= 3 && normalized.length <= 64;
}
export function deduplicateSerials(values) {
    const serials = [];
    const invalid = [];
    const occurrences = new Map();
    values.forEach((value, index) => {
        const normalized = normalizeSerial(value);
        if (!isValidSerial(normalized)) {
            if (String(value).trim())
                invalid.push(String(value));
            return;
        }
        const seen = occurrences.get(normalized) ?? [];
        seen.push(index + 1);
        occurrences.set(normalized, seen);
        if (seen.length === 1)
            serials.push(normalized);
    });
    const duplicates = [...occurrences.entries()]
        .filter(([, indexes]) => indexes.length > 1)
        .map(([serial, indexes]) => ({ serial, occurrences: indexes }));
    return { serials, invalid, duplicates };
}
