# Armory inventory web app

This directory contains the responsive React/Vite client for the West Point Skeet & Trap inventory workflow. It intentionally does not include a backend. The production client uses Cognito Hosted UI + PKCE and sends the resulting bearer token to the API. A small in-memory adapter is available only as an explicit local development option.

## Run locally

```sh
npm install
npm run dev
```

The demo adapter is enabled by default for local UI work. Set `VITE_DEMO_MODE=false` to use the real REST client. The REST base URL defaults to `/api` (the API prefixes every protected route with `/api`) and can be changed with `VITE_API_BASE_URL`.

### Test the real API locally

When the Vite dev server runs, requests under `/api` are proxied to `http://127.0.0.1:3000`. This keeps browser requests same-origin and avoids a local CORS setup. The proxy adds `x-actor-id` only when `VITE_DEV_ACTOR_ID` is explicitly set; use that header only with the API's local-only `ALLOW_DEV_AUTH=true` mode. With `VITE_DEMO_MODE=false` and a nonblank actor id, the dev server also treats the browser session as authenticated and shows a `Local development · actor header enabled` label in the top bar. This bypass is gated by Vite's `import.meta.env.DEV` flag, so production builds always use Cognito auth even if a development variable is accidentally present. The proxy and bypass are development-server settings and are not included in production builds.

In one terminal, start PostgreSQL and the API with a migrated database. The API must have an active `User` row whose id will be used below:

```sh
cd apps/api
ALLOW_DEV_AUTH=true npm exec -- tsx src/server.ts
```

In a second terminal, create a local environment file from the example, set the active user id, and start the browser client:

```sh
cd apps/web
cp .env.example .env.local
# Edit .env.local: set VITE_DEMO_MODE=false and VITE_DEV_ACTOR_ID=<active-user-uuid>
npm run dev
```

Keep `VITE_API_BASE_URL=/api` so the Vite proxy is used. If `VITE_DEV_ACTOR_ID` is blank, the browser must use the Cognito PKCE configuration instead. Never use `ALLOW_DEV_AUTH` or `VITE_DEV_ACTOR_ID` for a deployed environment.

Production mode always starts at the Cognito sign-in screen. Configure `VITE_COGNITO_DOMAIN`, `VITE_COGNITO_CLIENT_ID`, and optionally `VITE_COGNITO_REDIRECT_URI`/`VITE_COGNITO_SCOPE`. The browser stores only the short-lived access token needed for API calls and uses Authorization Code + PKCE; there is no `/auth/login` endpoint in the API. `VITE_REQUIRE_AUTH=true` can show the local email/password demo screen when `VITE_DEMO_MODE` remains enabled.

```sh
VITE_API_BASE_URL=http://localhost:3000/api \
VITE_COGNITO_DOMAIN=https://your-domain.auth.us-east-1.amazoncognito.com \
VITE_COGNITO_CLIENT_ID=your-client-id \
VITE_COGNITO_REDIRECT_URI=http://localhost:5173 \
VITE_DEMO_MODE=false npm run dev
```

Validation commands:

```sh
npm run build
npm test
```

## API contract (apps/api source of truth)

All routes except `/healthz` require `Authorization: Bearer <Cognito access token>`. The client adds that header automatically after the PKCE callback. The API returns errors as `{ error, message }`; the UI preserves these server messages for the next error-boundary pass. Every mutating call is actor-attributed by the API.

| Method | Path                                          | Request                                                          | Response                                                                                             |
| ------ | --------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/api/guns?q=`                                | optional search query                                            | backend gun rows, normalized by the client                                                           |
| POST   | `/api/guns/import/preview`                    | CSV/XLSX file bytes                                              | validation rows, create/update decisions, summary, and issues                                        |
| POST   | `/api/guns/import/commit`                     | same CSV/XLSX file bytes                                         | `{ imported, created, updated, rows }`                                                               |
| GET    | `/api/guns/:serial`                           | —                                                                | backend gun row, normalized by the client                                                            |
| GET    | `/api/guns/:serial/history`                   | —                                                                | actor-attributed activity events                                                                     |
| POST   | `/api/guns/:serial/location`                  | `{ safe, slot }`                                                 | updated gun                                                                                          |
| POST   | `/api/guns/:serial/assignment`                | `{ cadetName, cadetId? }`                                        | assignment                                                                                           |
| POST   | `/api/guns/:serial/fitter-assignment`         | `{ cadetName, cadetId?, safe, slot }`                           | assignment and updated gun                                                                           |
| POST   | `/api/guns/:serial/checkout`                  | `{ personName, personEmail?, reason?, notes?, expectedReturn? }` | custody record                                                                                       |
| POST   | `/api/guns/:serial/repair`                    | `{ vendor, reason, notes?, expectedReturn? }`                    | custody record                                                                                       |
| POST   | `/api/audits`                                 | `{ name }`                                                       | audit with `itemCount`                                                                               |
| GET    | `/api/audits`                                 | —                                                               | persisted audits with progress and reconciliation summaries                                           |
| POST   | `/api/audits/:id/scans`                       | `{ serialNumber }`                                               | `{ scan: { result: MATCHED\|DUPLICATE\|UNEXPECTED\|ARCHIVED }, item? }`                              |
| POST   | `/api/audits/:id/items/:serial/repair-verify` | `{ note }`                                                       | resolved audit item                                                                                  |
| POST   | `/api/audits/:id/items/:serial/exception`     | `{ reason, note }`                                               | resolved audit item                                                                                  |
| POST   | `/api/audits/:id/finalize`                    | —                                                                | physical-finalized audit                                                                             |
| POST   | `/api/audits/:id/reconciliation/pdf/preview`  | raw PDF body with `Content-Type: application/pdf`                | server-extracted `{ serials, duplicates, invalidTokens, pageCount, warnings, sourceBytesDiscarded }` |
| POST   | `/api/audits/:id/reconciliation`              | `{ sourceName, serials }`                                        | reconciliation, summary, completed audit                                                             |
| GET    | `/api/audits/:id/evidence.csv`                | —                                                                | downloadable CSV evidence                                                                            |
| GET    | `/api/audits/:id/evidence.pdf`                | —                                                                | downloadable human-readable PDF evidence                                                             |

### JSON shapes

The backend's gun row uses `serialNumber`, `state` (`STORED`, `CHECKED_OUT`, `REPAIR`), `lifecycle`, nested `location`, `assignments`, and `custody`. It also carries fitting metadata including `handedness`, `lengthOfPull`, optional `adjustableComb`, and optional `type`. The client preserves the supported type values `SKEET`, `TRAP`, `SPORTING`, `ACS`, `VITTORIA`, `ONYX`, `TRAP (SINGLE BARREL)`, and `TRAP (DOUBLE BARREL)` and displays their readable labels rather than treating them as unknown. It normalizes the row into its view model: `serial`, `status`, optional `safe`, `slot`, `assignedCadet`, `holder`, and `repairVendor`.

`AuditSummary` includes `id`, `label`, `startedAt`, `startedBy`, `expected`, `resolved`, `scanned`, `repairVerified`, `exceptions`, `status`, and optional `reconciliation`. The server remains the source of truth for counts and lifecycle transitions; the demo adapter only approximates those updates.

`ReconciliationResult` is derived from the API's `summary` and `reconciliation.serials` rows. The browser sends the selected PDF transiently to `/reconciliation/pdf/preview` with `Content-Type: application/pdf`. The server worker extracts selectable-text candidates and discards source bytes. The UI presents those candidates, duplicates, invalid tokens, and warnings for review, then sends only `{ sourceName, serials }` to the reconciliation endpoint.

## UX notes

- A QR camera integration can populate the scan input; a USB/Bluetooth keyboard-wedge scanner works without any additional adapter because the input is focused on audit entry.
- Scanning records evidence only. It does not silently change a gun’s location or custody.
- Exceptions require a reason and note in the UI. A production API should reject incomplete exception submissions and enforce the authenticated actor.
- Finalized audits expose both CSV and PDF evidence downloads from the API.
- Gun detail location, cadet assignment, checkout, and repair actions call the corresponding actor-attributed API routes and refresh the live row. Specification editing and bulk import remain visibly marked as not available in V1 because no corresponding API routes exist.
- Inventory totals and status counts are derived from the rows returned by `GET /api/guns`; the UI does not assume a 200-gun register. The audit list loads persisted rows from `GET /api/audits`; an empty response produces a truthful empty state, and starting an audit creates then reloads its live snapshot with `POST /api/audits` and `GET /api/audits/:id`.
- CSV/XLSX imports are previewed before commit. The browser sends the selected file bytes to the API, presents validation issues and create/update counts, then sends the same file to the commit route only after a valid preview.
- Gun Fitter lists only unassigned stored guns. It begins with Beretta-owned guns and can filter by ownership, handedness, length of pull, and adjustable comb. Its assignment action accepts only currently available safe/slot pairs; the API remains authoritative if a competing assignment claims a slot first.
