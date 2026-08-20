import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { PrismaClient } from "@prisma/client";

export interface Actor {
  id: string;
  cognitoSubject: string;
  email: string;
  role: "OPERATOR" | "ACCOUNT_ADMIN";
}

export type Authenticate = (request: FastifyRequest) => Promise<Actor>;

export function createAuthenticator(prisma: PrismaClient): Authenticate {
  const jwksUrl = process.env.COGNITO_JWKS_URL;
  const issuer = process.env.COGNITO_ISSUER;
  const audience = process.env.COGNITO_AUDIENCE;
  const developmentAuth = process.env.ALLOW_DEV_AUTH === "true";
  const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : undefined;

  return async (request) => {
    let subject: string | undefined;
    let email: string | undefined;

    if (developmentAuth) {
      const devActorId = request.headers["x-actor-id"];
      if (typeof devActorId === "string" && devActorId.length > 0) {
        const user = await prisma.user.findUnique({ where: { id: devActorId } });
        if (user && user.status === "ACTIVE") return { id: user.id, cognitoSubject: user.cognitoSubject, email: user.email, role: user.role };
      }
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new Error("AUTHENTICATION_REQUIRED");
    if (!jwks || !issuer || !audience) throw new Error("AUTHENTICATION_NOT_CONFIGURED");
    const token = authorization.slice("Bearer ".length);
    const verified = await jwtVerify(token, jwks, { issuer, audience });
    subject = typeof verified.payload.sub === "string" ? verified.payload.sub : undefined;
    email = typeof verified.payload.email === "string" ? verified.payload.email : undefined;
    if (!subject) throw new Error("INVALID_IDENTITY");

    const user = await prisma.user.findUnique({ where: { cognitoSubject: subject } });
    if (!user || user.status !== "ACTIVE") throw new Error("ACCOUNT_NOT_ACTIVE");
    return { id: user.id, cognitoSubject: user.cognitoSubject, email: email ?? user.email, role: user.role };
  };
}
