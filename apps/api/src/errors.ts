import { Prisma } from "@prisma/client";

export class HttpError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code = "REQUEST_FAILED") {
    super(message);
  }
}

export function asHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    const target = Array.isArray(error.meta?.target) ? error.meta.target.join(",") : String(error.meta?.target ?? "");
    if (target.includes("nameKey")) return new HttpError(409, "An audit with this name already exists", "AUDIT_NAME_EXISTS");
    if (target.includes("Gun_one_active_stored_location_key") || target.includes("locationId")) return new HttpError(409, "That safe and slot are already occupied by another stored gun", "LOCATION_OCCUPIED");
  }
  if (error instanceof Error && error.message.startsWith("VALIDATION_ERROR:")) return new HttpError(400, error.message.slice(18), "VALIDATION_ERROR");
  if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") return new HttpError(401, "Authentication required", "AUTHENTICATION_REQUIRED");
  if (error instanceof Error && error.message === "AUTHENTICATION_NOT_CONFIGURED") return new HttpError(503, "Authentication is not configured", "AUTHENTICATION_NOT_CONFIGURED");
  if (error instanceof Error && error.message === "ACCOUNT_NOT_ACTIVE") return new HttpError(403, "Account is not active", "ACCOUNT_NOT_ACTIVE");
  if (error instanceof Error && error.message === "INVALID_IDENTITY") return new HttpError(401, "Identity token has no subject", "INVALID_IDENTITY");
  return new HttpError(500, "Unexpected server error", "INTERNAL_ERROR");
}
