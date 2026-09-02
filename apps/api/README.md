# Inventory API

This package is the backend boundary for the skeet and trap inventory app. It is a TypeScript Fastify modular monolith backed by PostgreSQL through Prisma. A worker can call the same service layer later for spreadsheet import, selectable-text PDF extraction, and evidence generation; the HTTP API deliberately accepts only a reviewed serial set for reconciliation and never persists source PDF bytes.

## Architecture decisions

- PostgreSQL is the source of truth. `prisma/migrations/0001_init/migration.sql` creates the full schema, safe/slot checks, one-active-custody partial index, and a database trigger that rejects updates/deletes to `ActivityEvent`.
- Every state-changing endpoint runs its state change and actor-attributed `ActivityEvent` append in one transaction. Correction is represented by a later event; there is no history update endpoint.
- A gun has one current state (`STORED`, `CHECKED_OUT`, or `REPAIR`) and a separate historical cadet assignment. Checkout/repair records are temporary custody and are independent of assignment.
- An audit snapshots active, non-archived guns at start. A QR scan only resolves an audit item; it never changes the gun's location or custody. Physical finalization requires every snapshot item to be scanned, repair-verified, or exception-approved. Reconciliation is attached afterward and then marks the audit complete.
- Audit names are unique case-insensitively after collapsing whitespace. `POST /api/audits` returns `409 AUDIT_NAME_EXISTS` for a duplicate, including a concurrent duplicate create.
- Migration `0002_audit_name_key` preserves legacy duplicate audits. During backfill, rows are ordered by `createdAt`, then `id`; the first normalized name remains unchanged and later collisions receive deterministic suffixes such as `(2)` and `(3)`. If a generated suffix is already occupied, the migration increments until it finds a free key. If a `0002_audit_name_key` attempt was recorded as failed by Prisma, resolve it as rolled back before retrying: `npx prisma migrate resolve --rolled-back 0002_audit_name_key`, then run `npm run db:migrate` against the same `DATABASE_URL`.
- Migration `0003_gun_location_invariants` adds the last-stored-location reference and single-occupancy index. Existing duplicate stored occupants are not deleted: the earliest gun keeps the current location and later guns are made unassigned while retaining that location as their last stored location.
- Migration `0005_storage_slot_limit` updates the database slot check to match the supported 1–28 range. Apply pending migrations before importing locations in slots 25–28.
- `POST /api/guns/:serial/custody/:custodyId/return` requires `{ "safe": 2-7, "slot": 1-28 }` and returns `{ custody, gun }`; a repeated/concurrent return returns `409 CUSTODY_CLOSED`.
- Safe/slot is single-occupancy for active stored guns. Create, import, move, and return operations return `409 LOCATION_OCCUPIED` when a concurrent or existing stored gun already claims the requested location.
- `POST /api/guns/:serial/fitter-assignment` atomically assigns an active, stored, currently unassigned gun and places it in a supplied safe/slot. It accepts `{ cadetName, cadetId?, safe: 2-7, slot: 1-28 }`, applies the same single-occupancy invariant, and appends `GUN_FITTER_ASSIGNED` to the immutable activity history.
- Checkout and repair preserve the gun's last stored location. Return accepts an optional body `{ "safe": 2-7, "slot": 1-28 }`; with no body it returns to that preserved location, while a supplied location is an explicit override. If no preserved location exists, return requires a location and returns `400 RETURN_LOCATION_REQUIRED`.
- `GET /api/audits/:id` includes each snapshot item's serial, resolution state, current gun state, location, active custody records, and active cadet assignment.
- Reconciliation accepts `{ sourceName, serials }` after a human has reviewed extraction. It stores normalized serials and comparison results, not the PDF. This keeps the source document discardable and makes the comparison deterministic.
- Production auth verifies Cognito JWTs using the configured issuer, audience, and remote JWKS. `ALLOW_DEV_AUTH=true` is an explicit local-only escape hatch and still requires an active user id in `x-actor-id`; it is false by default.

## Run locally

```sh
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run build
npm test
```

`DATABASE_URL` must point at PostgreSQL for migrations or API workflows. Unit/API-boundary tests do not require a database; integration tests should run against a disposable PostgreSQL database in CI.

## API contract

All routes except `/healthz` require a Cognito bearer token (or the explicit local development header described above).

Named account administrators manage the local account registry through `GET /api/users`, `POST /api/users`, `PATCH /api/users/:id/disable`, and `PATCH /api/users/:id/enable`. The latter is the auditable local recovery action; password reset delivery remains the Cognito responsibility.

- `GET /api/guns`, `GET /api/guns/:serial`, `GET /api/guns/:serial/history`
- `GET /api/inventory/summary` (also `GET /api/guns/summary`) — live counts, for example `{ total, active, archived, stored, checkedOut, repair, inRepair, byState }`.
- `POST /api/guns` — create a gun; a safe may be supplied without a slot and is retained as `reportedSafe`, while a slot always requires a safe.
- `POST /api/guns/import/preview` (also `/api/imports/guns/preview`) — upload raw `text/csv` or XLSX bytes and receive `{ valid, rows, issues, summary }`; use `?mode=create-only` to reject existing serials. JSON `{ content: "..." }` is supported for local API clients.
- `POST /api/guns/import/commit` (also `/api/imports/guns/commit`) — accepts the same file body and mode, commits only a valid preview, and returns `{ imported, created, updated, rows }`. Each created/updated gun gets an actor-attributed immutable activity event.
- `PATCH /api/guns/:serial/archive`
- `POST /api/guns/:serial/location`, `/assignment`, `/fitter-assignment`, `/checkout`, `/repair`
- `POST /api/guns/:serial/custody/:custodyId/return` — optional body `{ safe, slot }`; omitted body uses the gun's preserved last stored location.
- `POST /api/audits` — body `{ name }`; snapshots active guns.
- `POST /api/audits/:id/start` — starts a pre-created draft audit and snapshots active guns; normal creation already performs this transition atomically.
- `GET /api/audits/:id`
- `POST /api/audits/:id/scans` — body `{ serialNumber }`; returns `MATCHED`, `DUPLICATE`, `UNEXPECTED`, or `ARCHIVED` scan outcomes without silently mutating inventory.
- `POST /api/audits/:id/items/:serial/repair-verify` — requires a note and an active repair state.
- `POST /api/audits/:id/items/:serial/exception` — requires a reason and note.
- `POST /api/audits/:id/finalize` — requires no unresolved snapshot items.
- `POST /api/audits/:id/reconciliation` — body `{ sourceName, serials }`; attaches reviewed external serials after physical finalization.
- `GET /api/audits` — persisted audits in descending start order, each with `{ id, name, status, startedAt, physicalFinalizedAt, completedAt, startedBy, itemCount, counts, reconciliation }`.
- `POST /api/audits/:id/reconciliation/pdf/preview` — send the PDF as `application/pdf`; the worker extracts selectable-text candidates in memory and returns them for review. The request bytes are never persisted. Submit only the reviewed `{ sourceName, serials }` to the reconciliation endpoint.
- `GET /api/audits/:id/evidence.csv` — available after physical finalization and includes snapshot, scan, and reconciliation evidence.
- `GET /api/audits/:id/evidence.pdf` — worker-generated human-readable PDF evidence with the same finalized snapshot and resolution data.

Errors use `{ error, message }` with stable error codes for frontend handling. Serials are trimmed and uppercased at the API boundary.
