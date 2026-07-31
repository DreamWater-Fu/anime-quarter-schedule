import { buildSeasonQuery } from "./season";
import {
  compareSeasonKey,
  getCurrentSeasonKey,
  getQuarterBySeason,
  seasonKeyEquals
} from "./season";
import { DEFAULT_ANIME_SEARCH_LIMIT, searchAnimeItems } from "@/src/shared/animeSearch";
import type { AnimeCache, AnimeItem, AnimeSearchPayload, AnimeSeasonPayload, DataStatus, SeasonKey, SeasonMonth } from "@/src/server/types/anime";
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

export function isStaticExportMode() {
  return process.env.NEXT_PUBLIC_STATIC_EXPORT === "true";
}

export function loadSeasonAnime(input: {
  year: number;
  season: SeasonMonth;
}) {
  if (isStaticExportMode()) return loadStaticSeasonAnime(input);

  return fetchApi<AnimeSeasonPayload>(`/api/anime?${buildSeasonQuery(
    input.year,
    input.season,
    true,
    true
  )}`);
}

export async function loadAnimeSearch(input: {
  query: string;
  limit?: number;
}): Promise<AnimeSearchPayload> {
  if (isStaticExportMode()) return loadStaticAnimeSearch(input);

  const query = new URLSearchParams({
    q: input.query,
    limit: String(input.limit ?? DEFAULT_ANIME_SEARCH_LIMIT)
  });
  return fetchApi<AnimeSearchPayload>(`/api/search?${query.toString()}`);
}

export function loadUpdateStatus() {
  if (isStaticExportMode()) return loadStaticUpdateStatus();

  return fetchApi<UpdateStatusPayload>("/api/status");
}

export function runSeasonUpdate(input: { year: number; season: SeasonMonth }) {
  if (isStaticExportMode()) {
    void input;
    throw new FrontendApiError(
      {
        code: "STATIC_EXPORT_READONLY",
        message: "静态 GitHub Pages 页面不能直接更新数据；请在本地更新 JSON 后重新部署。"
      },
      403
    );
  }

  return fetchApi<UpdateResult>("/api/update", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ year: input.year, season: input.season, force: false })
  });
}

async function loadStaticSeasonAnime(input: { year: number; season: SeasonMonth }): Promise<AnimeSeasonPayload> {
  const cache = await fetchStaticJson<AnimeCache>("anime.json");
  const quarter = getQuarterBySeason(input.season);
  const requestedSeason = { year: input.year, quarter };
  const actualSeason = getCurrentSeasonKey();
  const items = cache.items
    .filter((item) => isVisibleInSeason(item, requestedSeason, actualSeason))
    .filter((item) => item.format === "tv")
    .filter((item) => item.isJapaneseAnime !== false)
    .filter((item) => item.inclusionStatus !== "excluded")
    .sort(compareAnimeForSeasonPage);

  return {
    year: input.year,
    season: input.season,
    quarter,
    items,
    meta: {
      total: items.length,
      cacheUpdatedAt: cache.updatedAt,
      dataStatusSummary: summarizeDataStatus(items)
    }
  };
}

async function loadStaticUpdateStatus(): Promise<UpdateStatusPayload> {
  return fetchStaticJson<UpdateStatusPayload>("status.json");
}

async function loadStaticAnimeSearch(input: { query: string; limit?: number }): Promise<AnimeSearchPayload> {
  const cache = await fetchStaticJson<AnimeCache>("anime.json");
  const query = input.query.trim();
  const results = searchAnimeItems(cache.items, query, input.limit ?? DEFAULT_ANIME_SEARCH_LIMIT);

  return {
    query,
    results,
    meta: {
      total: results.length,
      cacheUpdatedAt: cache.updatedAt
    }
  };
}

async function fetchStaticJson<T>(fileName: string): Promise<T> {
  const response = await fetch(`${getStaticBasePath()}/static-data/${fileName}`, { cache: "no-store" });
  if (!response.ok) {
    throw new FrontendApiError(
      {
        code: "STATIC_DATA_NOT_FOUND",
        message: `静态数据读取失败：${fileName}`
      },
      response.status
    );
  }
  return response.json() as Promise<T>;
}

function getStaticBasePath() {
  return process.env.NEXT_PUBLIC_BASE_PATH ?? "";
}

function isVisibleInSeason(
  item: AnimeItem,
  requestedSeason: SeasonKey,
  actualSeason: SeasonKey
): boolean {
  if (seasonKeyEquals(item.primarySeason, requestedSeason)) return true;
  if (!seasonKeyEquals(requestedSeason, actualSeason)) return false;
  if (!item.primarySeason || compareSeasonKey(item.primarySeason, requestedSeason) >= 0) return false;
  return item.activeSeasons.some((season) => seasonKeyEquals(season, requestedSeason));
}

function compareAnimeForSeasonPage(left: AnimeItem, right: AnimeItem): number {
  return (
    compareNullableNumber(left.updateWeekday, right.updateWeekday) ||
    compareNullableString(left.updateTime, right.updateTime) ||
    compareNullableString(left.startDate, right.startDate) ||
    left.title.original.localeCompare(right.title.original)
  );
}

function compareNullableNumber(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function compareNullableString(left: string | null, right: string | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

function summarizeDataStatus(items: AnimeItem[]): Record<DataStatus, number> {
  const summary: Record<DataStatus, number> = {
    complete: 0,
    partial: 0,
    conflicting: 0,
    unverified: 0
  };
  for (const item of items) summary[item.dataStatus] += 1;
  return summary;
}
