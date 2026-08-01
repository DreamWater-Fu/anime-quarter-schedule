import type { AnimeItem } from "../types/anime.ts";

const HISTORICAL_SEASON_GRACE_DAYS = 90;

export function inferReferenceLifecycle(startDate: string, now: Date): Pick<AnimeItem, "status" | "endDate"> {
  const nowTime = now.getTime();
  const startTime = Date.parse(`${startDate}T00:00:00+09:00`);
  if (Number.isFinite(nowTime) && Number.isFinite(startTime) && startTime > nowTime) {
    return { status: "announced", endDate: null };
  }

  const seasonEndDate = inferSeasonEndDate(startDate);
  const seasonEndTime = Date.parse(`${seasonEndDate}T23:59:59+09:00`);
  if (
    Number.isFinite(nowTime) &&
    Number.isFinite(seasonEndTime) &&
    nowTime - seasonEndTime > HISTORICAL_SEASON_GRACE_DAYS * 86_400_000
  ) {
    return { status: "finished", endDate: seasonEndDate };
  }

  return { status: "airing", endDate: null };
}

function inferSeasonEndDate(startDate: string): string {
  const date = new Date(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return startDate;
  const month = date.getUTCMonth() + 1;
  const quarterStartMonth = month <= 3 ? 1 : month <= 6 ? 4 : month <= 9 ? 7 : 10;
  const quarterEndMonth = quarterStartMonth + 2;
  return new Date(Date.UTC(date.getUTCFullYear(), quarterEndMonth, 0)).toISOString().slice(0, 10);
}
