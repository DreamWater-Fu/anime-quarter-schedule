import type { PublicApiError } from "../types/api.ts";
import { DataSourceError } from "../sources/types.ts";

export class ApiErrorException extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, options: { status?: number; details?: unknown } = {}) {
    super(message);
    this.name = "ApiErrorException";
    this.code = code;
    this.status = options.status ?? 500;
    this.details = options.details;
  }
}

export function toPublicApiError(error: unknown): PublicApiError {
  if (error instanceof ApiErrorException) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details })
    };
  }

  if (error instanceof DataSourceError) {
    return {
      code: error.code === "RATE_LIMITED" ? "BANGUMI_SOURCE_FAILED" : "SOURCE_FAILED",
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details })
    };
  }

  if (error instanceof Error) {
    return {
      code: "INTERNAL_ERROR",
      message: error.message
    };
  }

  return {
    code: "INTERNAL_ERROR",
    message: "unknown error"
  };
}

export function getHttpStatus(error: unknown): number {
  if (error instanceof ApiErrorException) return error.status;
  if (error instanceof DataSourceError) return error.status ?? (error.retryable ? 503 : 502);
  return 500;
}
