import { normalizeSerial } from "./serial.js";
function csvCell(value) {
    const text = value === undefined || value === null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
}
function line(values) {
    return values.map(csvCell).join(",");
}
function validateEvidence(evidence) {
    if (!evidence.auditId.trim())
        throw new Error("Audit evidence requires an audit ID.");
    if (!evidence.physicalCountFinalizedAt)
        throw new Error("Only physically finalized audits can be exported.");
    const snapshot = new Set(evidence.snapshotSerials.map(normalizeSerial));
    if (snapshot.size !== evidence.snapshotSerials.length)
        throw new Error("Snapshot contains duplicate or invalid serials.");
    const items = evidence.items.map((item) => ({ ...item, serial: normalizeSerial(item.serial) }));
    const resolved = new Set(items.map((item) => item.serial));
    if (resolved.size !== items.length)
        throw new Error("Audit evidence contains duplicate resolution items.");
    const unresolved = [...snapshot].filter((serial) => !resolved.has(serial));
    if (unresolved.length)
        throw new Error(`Audit evidence has unresolved snapshot serials: ${unresolved.join(", ")}.`);
    const unexpected = [...resolved].filter((serial) => !snapshot.has(serial));
    if (unexpected.length)
        throw new Error(`Audit evidence contains serials outside the snapshot: ${unexpected.join(", ")}.`);
    return items.sort((a, b) => a.serial.localeCompare(b.serial));
}
export function generateEvidenceCsv(evidence) {
    const items = validateEvidence(evidence);
    const rows = [
        line(["section", "auditId", "startedAt", "physicalCountFinalizedAt", "finalizedBy"]),
        line(["audit", evidence.auditId, evidence.startedAt, evidence.physicalCountFinalizedAt, evidence.finalizedBy]),
        "",
        line(["section", "serial", "resolution", "resolvedAt", "actor", "reason", "eventReferences"])
    ];
    for (const item of items)
        rows.push(line(["audit-item", item.serial, item.resolution, item.resolvedAt, item.actor, item.reason ?? "", item.eventReferences?.join(" ") ?? ""]));
    if (evidence.reconciliation) {
        const reconciliation = evidence.reconciliation;
        rows.push("", line(["section", "serial", "result"]));
        reconciliation.matched.forEach((serial) => rows.push(line(["reconciliation", serial, "matched"])));
        reconciliation.missing.forEach((serial) => rows.push(line(["reconciliation", serial, "missing"])));
        reconciliation.unknown.forEach((serial) => rows.push(line(["reconciliation", serial, "unknown"])));
        reconciliation.duplicateExternal.forEach(({ serial }) => rows.push(line(["reconciliation", serial, "duplicate-external"])));
        reconciliation.invalidExternal.forEach((serial) => rows.push(line(["reconciliation", serial, "invalid-external"])));
    }
    return `${rows.join("\n")}\n`;
}
function pdfText(value) {
    return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
}
/** Generate a small dependency-free, human-readable PDF evidence artifact. */
export function generateEvidencePdf(evidence) {
    const items = validateEvidence(evidence);
    const lines = [
        "Skeet & Trap Inventory - Finalized Audit Evidence",
        `Audit: ${evidence.auditId}`,
        `Started: ${evidence.startedAt}`,
        `Physical count finalized: ${evidence.physicalCountFinalizedAt}`,
        `Finalized by: ${evidence.finalizedBy}`,
        "",
        "Serial | Resolution | Resolved at | Actor | Reason | Events",
        ...items.map((item) => `${item.serial} | ${item.resolution} | ${item.resolvedAt} | ${item.actor} | ${item.reason ?? ""} | ${item.eventReferences?.join(" ") ?? ""}`)
    ];
    if (evidence.reconciliation) {
        lines.push("", `Reconciliation status: ${evidence.reconciliation.status}`);
        lines.push(`Matched: ${evidence.reconciliation.matched.join(", ") || "none"}`);
        lines.push(`Missing: ${evidence.reconciliation.missing.join(", ") || "none"}`);
        lines.push(`Unknown: ${evidence.reconciliation.unknown.join(", ") || "none"}`);
    }
    const pages = [];
    for (let index = 0; index < lines.length; index += 46)
        pages.push(lines.slice(index, index + 46));
    const objects = [];
    objects.push("<< /Type /Catalog /Pages 2 0 R >>");
    objects.push("<< /Type /Pages /Kids [" + pages.map((_, index) => `${4 + index * 2} 0 R`).join(" ") + `] /Count ${pages.length} >>`);
    objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>");
    pages.forEach((page, index) => {
        const content = ["BT", "/F1 8 Tf", "50 750 Td", ...page.flatMap((text, lineIndex) => [lineIndex ? "0 -14 Td" : "", `(${pdfText(text)}) Tj`]), "ET"].filter(Boolean).join("\n");
        const contentObject = 5 + index * 2;
        objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObject} 0 R >>`);
        objects.push(`<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`);
    });
    const chunks = ["%PDF-1.4\n%âãÏÓ\n"];
    const offsets = [0];
    let offset = Buffer.byteLength(chunks[0], "binary");
    objects.forEach((object, index) => {
        offsets.push(offset);
        const serialized = `${index + 1} 0 obj\n${object}\nendobj\n`;
        chunks.push(serialized);
        offset += Buffer.byteLength(serialized, "binary");
    });
    const xrefOffset = offset;
    chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    for (let index = 1; index < offsets.length; index += 1)
        chunks.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
    chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);
    return Buffer.from(chunks.join(""), "binary");
}
export function generateEvidencePackage(evidence) {
    return { csv: generateEvidenceCsv(evidence), pdf: generateEvidencePdf(evidence) };
}
