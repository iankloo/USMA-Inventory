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
