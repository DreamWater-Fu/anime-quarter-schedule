import { readUpdateStatus } from "../cache/statusCache.ts";
import { queryAnimeBySeason, queryAnimeItemsByIds, searchAnimeLibrary } from "../anime/queryAnime.ts";
import { updateAnimeData } from "../anime/updateAnimeData.ts";
import type { AnimeItemsPayload, AnimeSearchPayload, AnimeSeasonPayload, SeasonMonth } from "../types/anime.ts";
import type { ApiResponse, UpdateInput, UpdateResult, UpdateStatusPayload } from "../types/api.ts";
import { getHttpStatus, toPublicApiError } from "../utils/errors.ts";
import { isSeasonMonth } from "../anime/calculateSeason.ts";

export interface ApiHandlerResult<T> {
  status: number;
  body: ApiResponse<T>;
}

export async function getAnimeApi(query: URLSearchParams): Promise<ApiHandlerResult<AnimeSeasonPayload>> {
  try {
    const year = Number(query.get("year"));
    const seasonValue = Number(query.get("season"));
    const season = parseSeasonMonth(seasonValue);
    const data = await queryAnimeBySeason({
      year,
      season,
      includeOptional: query.get("includeOptional") !== "false",
      includeNeedsReview: query.get("includeNeedsReview") !== "false"
    });
    return { status: 200, body: { ok: true, data } };
  } catch (error) {
    return { status: getHttpStatus(error), body: { ok: false, error: toPublicApiError(error) } };
  }
}

export async function getSearchApi(query: URLSearchParams): Promise<ApiHandlerResult<AnimeSearchPayload>> {
  try {
    const limitValue = query.get("limit");
    const data = await searchAnimeLibrary({
      query: query.get("q") ?? "",
      limit: limitValue === null ? undefined : Number(limitValue)
    });
    return { status: 200, body: { ok: true, data } };
  } catch (error) {
    return { status: getHttpStatus(error), body: { ok: false, error: toPublicApiError(error) } };
  }
}

export async function getAnimeItemsApi(query: URLSearchParams): Promise<ApiHandlerResult<AnimeItemsPayload>> {
  try {
    const data = await queryAnimeItemsByIds({
      ids: parseIds(query.get("ids"))
    });
    return { status: 200, body: { ok: true, data } };
  } catch (error) {
    return { status: getHttpStatus(error), body: { ok: false, error: toPublicApiError(error) } };
  }
}

export async function postUpdateApi(body: unknown): Promise<ApiHandlerResult<UpdateResult>> {
  try {
    const input = parseUpdateInput(body);
    const data = await updateAnimeData(input);
    return { status: 200, body: { ok: true, data } };
  } catch (error) {
    return { status: getHttpStatus(error), body: { ok: false, error: toPublicApiError(error) } };
  }
}

export async function getStatusApi(): Promise<ApiHandlerResult<UpdateStatusPayload>> {
  try {
    const data = await readUpdateStatus();
    return { status: 200, body: { ok: true, data } };
  } catch (error) {
    return { status: getHttpStatus(error), body: { ok: false, error: toPublicApiError(error) } };
  }
}

export async function handleApiRequest(input: {
  method: "GET" | "POST";
  path: "/api/anime" | "/api/update" | "/api/status" | "/api/search" | "/api/items";
  query?: URLSearchParams;
  body?: unknown;
}): Promise<ApiHandlerResult<unknown>> {
  if (input.method === "GET" && input.path === "/api/anime") {
    return getAnimeApi(input.query ?? new URLSearchParams());
  }
  if (input.method === "GET" && input.path === "/api/search") {
    return getSearchApi(input.query ?? new URLSearchParams());
  }
  if (input.method === "GET" && input.path === "/api/items") {
    return getAnimeItemsApi(input.query ?? new URLSearchParams());
  }
  if (input.method === "POST" && input.path === "/api/update") {
    return postUpdateApi(input.body);
  }
  if (input.method === "GET" && input.path === "/api/status") {
    return getStatusApi();
  }
  return {
    status: 404,
    body: {
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "api route not found"
      }
    }
  };
}

function parseUpdateInput(body: unknown): UpdateInput {
  const value = body && typeof body === "object" ? body as Record<string, unknown> : {};
  return {
    year: Number(value.year),
    season: parseSeasonMonth(Number(value.season)),
    force: value.force === true
  };
}

function parseSeasonMonth(value: number): SeasonMonth {
  if (isSeasonMonth(value)) return value;
  return value as SeasonMonth;
}

function parseIds(value: string | null): string[] {
  if (!value) return [];
  return value.split(",");
}
