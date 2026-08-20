# CEO-Reviewed Plan: Skeet & Trap Inventory App

## Summary

Build a scan-first AWS web app that acts as the team’s current gun register and monthly inventory evidence system. The guiding model is: physical scans prove a fixed audit snapshot; they never silently change location or custody. Comparable asset/armory systems use serial-level scanning and chain-of-custody records for this same purpose. [Armory System](https://armorysystem.com/features), [MapTrack](https://www.maptrack.com/how-to/how-to-conduct-an-asset-audit)

## Locked Product Decisions

- Use a TypeScript modular monolith on AWS with PostgreSQL, Cognito email/password authentication, and a small worker for spreadsheet imports, selectable-text PDF extraction, and audit-export generation.
- Do not retain uploaded PDFs. Extract serials, require human review, persist the reviewed serial set/results, then discard source bytes.
- All users can operate inventory and audits. Named account administrators alone create, disable, and recover accounts.
- Use a standard actor-attributed history table, not cryptographic hash chaining. History is corrected by new events, never overwritten.
- Require password-only login for V1; document this as an accepted security risk.
- Run local tests and deploy directly to production. Include backups, health checks, migration safety, and rollback steps; do not build staging.
- Support one scanner/audit operator at a time. No audit zones or offline queueing in V1.
- Finalize the physical count when all guns are resolved; attach the required PDF reconciliation later if the emailed report has not arrived.
- Add a shareable finalized-audit evidence export. Defer the operations dashboard. Skip checkout acknowledgement, safe-zone assignments, and offline scanning.

## System and Data Model

```text
Phone camera / USB scanner / browser
                |
        Modular web application
          /          |         \\
      Cognito    PostgreSQL    Worker
                   |             |
     current gun state + history  +-- import / extract / export
                   |
          audit evidence + reviewed serial sets
          (never the source PDF)
```

- `Gun`: unique serial number; active/archived lifecycle; model, gauge, barrel length, length of pull, handedness, type, high-rib flag, and current whereabouts.
- `StorageLocation`: safe 2–7 and slot 1–28; required only when the gun is stored.
- `CadetAssignment`: historical long-term responsibility, independent of temporary custody.
- `Custody` / `RepairRecord`: one active state per gun: stored, checked out to a named person, or at a vendor for repair/modification. Repair records include vendor, reason, outbound/expected-return/return dates, notes, and verification evidence.
- `InventoryAudit` and `AuditItem`: starting an audit snapshots active, non-archived guns. Each item ends as scanned, repair-verified, or approved exception. Exceptions require a reason, note, and actor; any signed-in user may approve one.
- `Reconciliation`: linked after physical audit finalization; stores normalized/reviewed external serials and comparison results.
- `ActivityEvent`: standard immutable-in-app history of actor, timestamp, action, entity, before/after values, and required reason.

```text
Audit lifecycle

Draft -> In progress -> Physical count finalized -> Reconciliation attached -> Complete
                   |             |
                   |             +-- only when every snapshot item is:
                   |                 scanned / repair-verified / approved exception
                   |
                   +-- duplicate, invalid, archived, and unexpected scans remain visible
```

## Core Workflows

- Import initial guns and cadets using a validated CSV/XLSX template with preview, duplicate-serial detection, required-field checks, and explicit create/update decisions.
- Search active inventory by serial, cadet, safe/slot, current holder, repair vendor, model, or status; show current whereabouts and complete event history.
- Check out/return guns to people and send/return guns from repair without changing cadet assignment.
- Run scan-first audits through phone camera or USB/Bluetooth scanner input. Immediately show valid, duplicate, unexpected, and archived scans.
- Manually verify repair guns against their active repair record. Keep audits open until every expected gun is resolved.
- Upload the emailed selectable-text PDF after physical count finalization, review extracted serials, compare against active non-archived serials, and show missing, unknown, and duplicate serials.
- Generate a finalized audit PDF/CSV evidence package containing the snapshot, scan/resolution record, repair verifications, reconciliation result, and event references.

## Reliability, Security, and UX

- Reject malformed imports, duplicate serials, bad safe/slot values, unsupported/image-only PDFs, empty extractions, duplicate scans, and archived scans with explicit errors.
- Make scan submission idempotent by audit and serial so retries cannot double-count a gun.
- On parser/import/export failure: preserve an actor-attributed failure event and actionable message; discard transient PDF bytes even on failure.
- Use TLS, encryption at rest, least-privilege service access, encrypted backups with point-in-time recovery, password-reset logging, and documented restore/rollback procedures.
- Design the audit screen around one dominant action: scan. Keep progress, unresolved items, repair verification, and reconciliation status visible without competing with scan input.
- Use responsive touch targets, keyboard-focusable controls, clear empty/error states, and high-contrast success/warning feedback.

## Test and Acceptance Plan

- Unit-test lifecycle transitions, serial uniqueness, archive behavior, assignment/custody separation, repair return, event generation, and audit-resolution rules.
- Integration-test imports, account administration, checkout conflicts, scan idempotency, repair verification, PDF extraction/review/discard, reconciliation mismatch reporting, and evidence exports.
- End-to-end test a real monthly count: scan valid and duplicate QR codes, resolve a repair gun, flag an archived/unexpected serial, finalize the physical count, later reconcile a PDF, and export evidence.
- Before launch, shadow one real audit using the current text-file process. Convert every observed exception and manual step into an acceptance test.

## Not in V1

- RFID, native mobile app, offline scanning, image-PDF OCR, automated external integrations, maintenance cost/work-order management, ammunition/training tracking, checkout recipient acknowledgement, audit-zone assignment, operations dashboard, MFA, and staging environment.

## Risk Acknowledgments

- Password-only authentication, a standard rather than hash-linked history table, production-only deployment, and user-approved audit exceptions are intentional V1 tradeoffs. The evidence export and visible exception reporting are required so these tradeoffs never become silent failures.
