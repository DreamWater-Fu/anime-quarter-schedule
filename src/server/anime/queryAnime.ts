import {
  type AnimeItem,
  type AnimeSeasonPayload,
  type AnimeQuarter,
  type DataStatus,
  type SeasonMonth
} from "../types/anime.ts";
import { getDefaultStorage } from "../cache/jsonFileStorage.ts";
import type { AnimeStorage } from "../cache/storage.ts";
import { ApiErrorException } from "../utils/errors.ts";
import {
  compareSeasonKey,
  getCurrentSeasonKey,
  isSeasonMonth,
  seasonKeyEquals,
  seasonMonthToQuarter
} from "./calculateSeason.ts";

export interface QueryAnimeInput {
  year: number;
  season: SeasonMonth;
  quarter?: AnimeQuarter;
  includeOptional?: boolean;
  includeNeedsReview?: boolean;
  storage?: AnimeStorage;
  now?: Date;
}

const EMPTY_STATUS_SUMMARY: Record<DataStatus, number> = {
  complete: 0,
  partial: 0,
  conflicting: 0,
  unverified: 0
};

export async function queryAnimeBySeason(input: QueryAnimeInput): Promise<AnimeSeasonPayload> {
  assertYear(input.year);
  if (!isSeasonMonth(input.season)) {
    throw new ApiErrorException("INVALID_QUERY", "season must be one of 1, 4, 7, 10", { status: 400 });
  }

  const storage = input.storage ?? getDefaultStorage();
  const cache = await storage.readAnimeCache();
  const quarter = input.quarter ?? seasonMonthToQuarter(input.season);
  const currentSeason = { year: input.year, quarter };
  const actualSeason = getCurrentSeasonKey(input.now);
  const includeOptional = input.includeOptional ?? true;
  const includeNeedsReview = input.includeNeedsReview ?? true;

  const items = cache.items
    .filter((item) => isVisibleInSeason(item, currentSeason, actualSeason))
    .filter((item) => item.format === "tv")
    .filter((item) => item.isJapaneseAnime !== false)
    .filter((item) => isIncludedForQuery(item, includeOptional, includeNeedsReview))
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

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) {
    throw new ApiErrorException("INVALID_QUERY", "year is invalid", { status: 400 });
  }
}

function isIncludedForQuery(item: AnimeItem, includeOptional: boolean, includeNeedsReview: boolean): boolean {
  if (item.inclusionStatus === "excluded") return false;
  if (item.inclusionStatus === "included") return true;
  if (includeOptional && item.inclusionStatus === "optional") return true;
  if (includeNeedsReview && item.inclusionStatus === "needs_review") return true;
  return false;
}

function isVisibleInSeason(
  item: AnimeItem,
  requestedSeason: { year: number; quarter: AnimeQuarter },
  actualSeason: { year: number; quarter: AnimeQuarter }
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
  const summary = { ...EMPTY_STATUS_SUMMARY };
  for (const item of items) summary[item.dataStatus] += 1;
  return summary;
}
