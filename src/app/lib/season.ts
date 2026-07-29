import type { AnimeItem, AnimeQuarter, SeasonKey, SeasonMonth } from "@/src/server/types/anime";

export const seasonOptions: Array<{ label: string; value: SeasonMonth; quarter: AnimeQuarter }> = [
  { label: "一月新番", value: 1, quarter: "winter" },
  { label: "四月新番", value: 4, quarter: "spring" },
  { label: "七月新番", value: 7, quarter: "summer" },
  { label: "十月新番", value: 10, quarter: "fall" }
];

export const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function getCurrentSeasonMonth(date = new Date()): SeasonMonth {
  const month = date.getMonth() + 1;
  if (month <= 3) return 1;
  if (month <= 6) return 4;
  if (month <= 9) return 7;
  return 10;
}

export function getQuarterBySeason(season: SeasonMonth): AnimeQuarter {
  return seasonOptions.find((item) => item.value === season)?.quarter ?? "summer";
}

export function isSeasonMonth(value: number): value is SeasonMonth {
  return value === 1 || value === 4 || value === 7 || value === 10;
}

export function parseSeasonFromUrl(value: string | null): SeasonMonth | null {
  const season = Number(value);
  return isSeasonMonth(season) ? season : null;
}

export function seasonKeyEquals(left: SeasonKey | null | undefined, right: SeasonKey): boolean {
  return Boolean(left && left.year === right.year && left.quarter === right.quarter);
}

export function compareSeasonKey(left: SeasonKey, right: SeasonKey): number {
  const leftMonth = seasonOptions.find((item) => item.quarter === left.quarter)?.value ?? 7;
  const rightMonth = seasonOptions.find((item) => item.quarter === right.quarter)?.value ?? 7;
  return left.year * 12 + leftMonth - (right.year * 12 + rightMonth);
}

export function classifySeasonMembership(item: AnimeItem, currentSeason: SeasonKey): "new" | "continuing" {
  if (item.primarySeason && compareSeasonKey(item.primarySeason, currentSeason) < 0) return "continuing";
  return "new";
}

export function buildSeasonQuery(year: number, season: SeasonMonth, includeOptional: boolean, includeNeedsReview: boolean) {
  const query = new URLSearchParams({
    year: String(year),
    season: String(season),
    includeOptional: String(includeOptional),
    includeNeedsReview: String(includeNeedsReview)
  });
  return query.toString();
}
