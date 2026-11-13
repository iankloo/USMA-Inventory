import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

const fakePrisma = {} as any;

test("health endpoint is available without an account", async () => {
  const app = await createApp({ prisma: fakePrisma });
  const response = await app.inject({ method: "GET", url: "/healthz" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { status: "ok" });
  await app.close();
});

test("API routes require the supplied authentication boundary", async () => {
  const app = await createApp({ prisma: fakePrisma, authenticate: async () => { throw new Error("AUTHENTICATION_REQUIRED"); } });
  const response = await app.inject({ method: "GET", url: "/api/guns" });
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error, "AUTHENTICATION_REQUIRED");
  await app.close();
});

test("PDF reconciliation accepts reports up to the advertised 10 MB limit", async () => {
  let extractedBytes = 0;
  const app = await createApp({
    prisma: {
      inventoryAudit: {
        findUnique: async () => ({
          status: "PHYSICAL_FINALIZED",
          items: [{ serialNumber: "WP-1" }]
        })
      }
    } as any,
    authenticate: async () => ({ id: "user-1", role: "ACCOUNT_ADMIN" } as any),
    extractPdf: async (bytes) => {
      extractedBytes = bytes.byteLength;
      return {
        serials: ["WP-1"],
        duplicates: [],
        invalidTokens: [],
        pageCount: 1,
        warnings: [],
        sourceBytesDiscarded: true
      };
    }
  });
  const payload = Buffer.alloc(10 * 1024 * 1024, 1);
  const response = await app.inject({
    method: "POST",
    url: "/api/audits/audit-1/reconciliation/pdf/preview",
    headers: { "content-type": "application/pdf" },
    payload
  });
  assert.equal(response.statusCode, 200);
  assert.equal(extractedBytes, payload.byteLength);

  const oversized = await app.inject({
    method: "POST",
    url: "/api/audits/audit-1/reconciliation/pdf/preview",
    headers: { "content-type": "application/pdf" },
    payload: Buffer.alloc(10 * 1024 * 1024 + 1, 1)
  });
  assert.equal(oversized.statusCode, 413);
  assert.equal(oversized.json().error, "UPLOAD_TOO_LARGE");
  await app.close();
});
