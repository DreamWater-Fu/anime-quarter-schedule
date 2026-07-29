import { buildSeasonQuery } from "./season";
import type { AnimeSeasonPayload, SeasonMonth } from "@/src/server/types/anime";
import type { ApiResponse, PublicApiError, UpdateResult, UpdateStatusPayload } from "@/src/server/types/api";

export class FrontendApiError extends Error {
  readonly code: string;
  readonly details?: unknown;
  readonly status: number;

  constructor(error: PublicApiError, status: number) {
    super(error.message || error.code);
    this.name = "FrontendApiError";
    this.code = error.code;
    this.details = error.details;
    this.status = status;
  }
}

export async function fetchApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => null) as ApiResponse<T> | null;

  if (!payload) {
    throw new FrontendApiError({ code: "INVALID_RESPONSE", message: "接口返回无法解析" }, response.status);
  }

  if (!payload.ok) {
    throw new FrontendApiError(payload.error, response.status);
  }

  return payload.data;
}

export function loadSeasonAnime(input: {
  year: number;
  season: SeasonMonth;
}) {
  return fetchApi<AnimeSeasonPayload>(`/api/anime?${buildSeasonQuery(
    input.year,
    input.season,
    true,
    true
  )}`);
}

export function loadUpdateStatus() {
  return fetchApi<UpdateStatusPayload>("/api/status");
}

export function runSeasonUpdate(input: { year: number; season: SeasonMonth }) {
  return fetchApi<UpdateResult>("/api/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year: input.year, season: input.season, force: false })
  });
}
