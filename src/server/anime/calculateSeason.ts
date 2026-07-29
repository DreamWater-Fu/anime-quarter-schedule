import type { AnimeItem, AnimeQuarter, AnimeScheduleItem, SeasonKey, SeasonMonth } from "../types/anime.ts";

const QUARTER_BY_SEASON_MONTH: Record<SeasonMonth, AnimeQuarter> = {
  1: "winter",
  4: "spring",
  7: "summer",
  10: "fall"
};

const SEASON_MONTH_BY_QUARTER: Record<AnimeQuarter, SeasonMonth> = {
  winter: 1,
  spring: 4,
  summer: 7,
  fall: 10
};

export const QUARTER_LABELS: Record<AnimeQuarter, string> = {
  winter: "一月新番",
  spring: "四月新番",
  summer: "七月新番",
  fall: "十月新番"
};

export function seasonMonthToQuarter(season: SeasonMonth): AnimeQuarter {
  return QUARTER_BY_SEASON_MONTH[season];
}

export function quarterToSeasonMonth(quarter: AnimeQuarter): SeasonMonth {
  return SEASON_MONTH_BY_QUARTER[quarter];
}

export function isSeasonMonth(value: number): value is SeasonMonth {
  return value === 1 || value === 4 || value === 7 || value === 10;
}

export function getQuarterForMonth(month: number): AnimeQuarter {
  if (month >= 1 && month <= 3) return "winter";
  if (month >= 4 && month <= 6) return "spring";
  if (month >= 7 && month <= 9) return "summer";
  if (month >= 10 && month <= 12) return "fall";
  throw new RangeError(`month must be between 1 and 12: ${month}`);
}

export function isValidDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isValidTimeString(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function isIsoDateTimeString(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp);
}

export function seasonKeyFromDate(date: string): SeasonKey {
  if (!isValidDateString(date)) {
    throw new TypeError(`date must use YYYY-MM-DD and be a real calendar date: ${date}`);
  }

  return {
    year: Number(date.slice(0, 4)),
    quarter: getQuarterForMonth(Number(date.slice(5, 7)))
  };
}

export function weekdayFromDate(date: string): number {
  if (!isValidDateString(date)) {
    throw new TypeError(`date must use YYYY-MM-DD and be a real calendar date: ${date}`);
  }

  const [yearText, monthText, dayText] = date.split("-");
  const day = new Date(Date.UTC(Number(yearText), Number(monthText) - 1, Number(dayText))).getUTCDay();
  return day === 0 ? 7 : day;
}

export function calculatePrimarySeason(startDate: string | null): SeasonKey | null {
  if (startDate === null) return null;
  const season = seasonKeyFromDate(startDate);
  const month = Number(startDate.slice(5, 7));
  const day = Number(startDate.slice(8, 10));

  if (month === 3 && day >= 18) return { year: season.year, quarter: "spring" };
  if (month === 6 && day >= 17) return { year: season.year, quarter: "summer" };
  if (month === 9 && day >= 17) return { year: season.year, quarter: "fall" };
  if (month === 12 && day >= 18) return { year: season.year + 1, quarter: "winter" };

  return season;
}

export function getCurrentSeasonKey(date = new Date()): SeasonKey {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const today = `${byType.year}-${byType.month}-${byType.day}`;
  return calculatePrimarySeason(today) ?? seasonKeyFromDate(today);
}

export function inferUpdateWeekday(input: {
  updateWeekday?: number | null;
  schedule: Array<Pick<AnimeScheduleItem, "airDate" | "status">>;
  startDate: string | null;
}): number | null {
  if (
    input.updateWeekday !== null &&
    input.updateWeekday !== undefined &&
    Number.isInteger(input.updateWeekday) &&
    input.updateWeekday >= 1 &&
    input.updateWeekday <= 7
  ) {
    return input.updateWeekday;
  }

  const hasKnownDelay = input.schedule.some((item) => item.status === "delayed" || item.status === "changed");
  if (hasKnownDelay) return null;

  const firstScheduledDate = input.schedule
    .map((item) => item.airDate)
    .filter(isValidDateString)
    .sort()[0] ?? null;

  if (firstScheduledDate !== null) return weekdayFromDate(firstScheduledDate);
  if (isValidDateString(input.startDate)) return weekdayFromDate(input.startDate);
  return null;
}

export function seasonKeyEquals(left: SeasonKey | null | undefined, right: SeasonKey | null | undefined): boolean {
  return Boolean(left && right && left.year === right.year && left.quarter === right.quarter);
}

export function compareSeasonKey(left: SeasonKey, right: SeasonKey): number {
  const leftValue = left.year * 12 + quarterToSeasonMonth(left.quarter);
  const rightValue = right.year * 12 + quarterToSeasonMonth(right.quarter);
  return leftValue - rightValue;
}

export function sortSeasonKeys(seasons: SeasonKey[]): SeasonKey[] {
  return [...seasons].sort(compareSeasonKey);
}

export function dedupeSeasonKeys(seasons: SeasonKey[]): SeasonKey[] {
  const seen = new Set<string>();
  const result: SeasonKey[] = [];

  for (const season of sortSeasonKeys(seasons)) {
    const key = `${season.year}:${season.quarter}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(season);
    }
  }

  return result;
}

export function calculateActiveSeasons(input: {
  schedule: Array<Pick<AnimeScheduleItem, "airDate">>;
  fallbackPrimarySeason?: SeasonKey | null;
}): SeasonKey[] {
  const fromSchedule = input.schedule.map((item) => seasonKeyFromDate(item.airDate));

  if (fromSchedule.length > 0) {
    return dedupeSeasonKeys(fromSchedule);
  }

  return input.fallbackPrimarySeason ? [input.fallbackPrimarySeason] : [];
}

export function isActiveInSeason(item: Pick<AnimeItem, "activeSeasons">, season: SeasonKey): boolean {
  return item.activeSeasons.some((activeSeason) => seasonKeyEquals(activeSeason, season));
}

export function isCrossQuarterContinuing(
  item: Pick<AnimeItem, "primarySeason" | "activeSeasons">,
  currentSeason: SeasonKey
): boolean {
  if (!isActiveInSeason(item, currentSeason) || item.primarySeason === null) return false;
  return compareSeasonKey(item.primarySeason, currentSeason) < 0;
}

export function classifySeasonMembership(
  item: Pick<AnimeItem, "primarySeason" | "activeSeasons">,
  currentSeason: SeasonKey
): "not_active" | "new" | "continuing" {
  if (!isActiveInSeason(item, currentSeason)) return "not_active";
  return isCrossQuarterContinuing(item, currentSeason) ? "continuing" : "new";
}
