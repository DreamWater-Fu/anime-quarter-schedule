import type { AnimeItem, AnimeQuarter, SeasonKey, SeasonMonth } from "@/src/server/types/anime";

export const seasonOptions: Array<{ label: string; value: SeasonMonth; quarter: AnimeQuarter }> = [
  { label: "一月新番", value: 1, quarter: "winter" },
  { label: "四月新番", value: 4, quarter: "spring" },
  { label: "七月新番", value: 7, quarter: "summer" },
  { label: "十月新番", value: 10, quarter: "fall" }
];

export const weekdayLabels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

export function getCurrentSeasonMonth(date = new Date()): SeasonMonth {
  return seasonOptions.find((item) => item.quarter === getCurrentSeasonKey(date).quarter)?.value ?? 7;
}

export function getCurrentSeasonKey(date = new Date()): SeasonKey {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return calculateSeasonKeyFromDate(`${byType.year}-${byType.month}-${byType.day}`);
}

function calculateSeasonKeyFromDate(date: string): SeasonKey {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const quarter = getQuarterForMonth(month);

  if (month === 3 && day >= 18) return { year, quarter: "spring" };
  if (month === 6 && day >= 17) return { year, quarter: "summer" };
  if (month === 9 && day >= 17) return { year, quarter: "fall" };
  if (month === 12 && day >= 18) return { year: year + 1, quarter: "winter" };

  return { year, quarter };
}

function getQuarterForMonth(month: number): AnimeQuarter {
  if (month <= 3) return "winter";
  if (month <= 6) return "spring";
  if (month <= 9) return "summer";
  return "fall";
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
