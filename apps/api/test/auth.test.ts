import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createAuthenticator } from "../src/auth.js";

const issuer = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_example";
const clientId = "inventory-web-client";
const keyPair = await generateKeyPair("RS256");
const jwk = await exportJWK(keyPair.publicKey);
jwk.kid = "test-key";

const server = createServer((request, response) => {
  if (request.url !== "/jwks.json") return response.writeHead(404).end();
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ keys: [jwk] }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
after(() => server.close());
const address = server.address();
if (!address || typeof address === "string") throw new Error("JWKS test server unavailable");
const jwksUrl = `http://127.0.0.1:${address.port}/jwks.json`;

async function accessToken(payload: Record<string, string>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keyPair.privateKey);
}

function authenticate() {
  process.env.COGNITO_JWKS_URL = jwksUrl;
  process.env.COGNITO_ISSUER = issuer;
  process.env.COGNITO_AUDIENCE = clientId;
  return createAuthenticator({
    user: {
      findUnique: async () => ({ id: "user-1", cognitoSubject: "subject-1", email: "iankloo@fastmail.com", role: "ACCOUNT_ADMIN", status: "ACTIVE" })
    }
  } as any);
}

test("accepts a Cognito access token matched by client_id", async () => {
  const token = await accessToken({ sub: "subject-1", token_use: "access", client_id: clientId });
  const actor = await authenticate()({ headers: { authorization: `Bearer ${token}` } } as any);
  assert.equal(actor.id, "user-1");
});

test("rejects a token for another Cognito client", async () => {
  const token = await accessToken({ sub: "subject-1", token_use: "access", client_id: "other-client" });
  await assert.rejects(
    authenticate()({ headers: { authorization: `Bearer ${token}` } } as any),
    { message: "INVALID_IDENTITY" }
  );
});
