import type { AnimeItem } from "@/src/server/types/anime";
import { getBeijingUpdateSlot, getBeijingWeekday, getUpdateWeekdaySlot, parseTimeToMinutes } from "./timezone.ts";

export type ViewMode = "stats" | "following" | "personalFollowing" | "watching" | "watchHistory";
export type SortMode =
  | "default"
  | "ratingAsc"
  | "ratingDesc"
  | "startDateAsc"
  | "startDateDesc"
  | "updateTimeAsc"
  | "updateTimeDesc";

export function sortAnimeItems(items: AnimeItem[], sortMode: SortMode): AnimeItem[] {
  const sorted = [...items];
  if (sortMode === "default") return sorted;

  return sorted.sort((left, right) => {
    if (sortMode === "ratingAsc") {
      return compareNullableNumber(left.bangumi.rating, right.bangumi.rating, "asc") || compareTitle(left, right);
    }
    if (sortMode === "ratingDesc") {
      return compareNullableNumber(left.bangumi.rating, right.bangumi.rating, "desc") || compareTitle(left, right);
    }
    if (sortMode === "startDateAsc") {
      return compareNullableString(left.startDate, right.startDate, "asc") || compareTitle(left, right);
    }
    if (sortMode === "startDateDesc") {
      return compareNullableString(left.startDate, right.startDate, "desc") || compareTitle(left, right);
    }
    if (sortMode === "updateTimeAsc") {
      return compareNullableNumber(getUpdateSortValue(left), getUpdateSortValue(right), "asc") || compareTitle(left, right);
    }
    return compareNullableNumber(getUpdateSortValue(left), getUpdateSortValue(right), "desc") || compareTitle(left, right);
  });
}

export function getTodayFollowItems(items: AnimeItem[], date = new Date()): AnimeItem[] {
  const weekday = getBeijingWeekday(date);
  return getFollowItemsByWeekday(items, weekday);
}

export function getFollowItemsByWeekday(
  items: AnimeItem[],
  weekday: number,
  shouldInclude?: (item: AnimeItem) => boolean
): AnimeItem[] {
  return items
    .filter((item) => {
      const updateWeekday = getBeijingUpdateSlot(item)?.weekday ?? getUpdateWeekdaySlot(item)?.weekday;
      return (
        updateWeekday === weekday &&
        (item.status === "airing" || item.status === "delayed") &&
        (shouldInclude?.(item) ?? true)
      );
    })
    .sort((left, right) => {
      const leftTime = getBeijingUpdateSlot(left)?.time ?? null;
      const rightTime = getBeijingUpdateSlot(right)?.time ?? null;
      return compareNullableString(leftTime, rightTime, "asc") || compareTitle(left, right);
    });
}

function compareNullableNumber(
  left: number | null,
  right: number | null,
  direction: "asc" | "desc"
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === "asc" ? left - right : right - left;
}

function compareNullableString(
  left: string | null,
  right: string | null,
  direction: "asc" | "desc"
): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
}

function compareTitle(left: AnimeItem, right: AnimeItem): number {
  return left.title.original.localeCompare(right.title.original);
}

function getUpdateSortValue(item: AnimeItem): number | null {
  const beijingSlot = getBeijingUpdateSlot(item);
  if (beijingSlot) {
    const minutes = parseTimeToMinutes(beijingSlot.time);
    if (minutes !== null) return (beijingSlot.weekday - 1) * 1440 + minutes;
  }

  const weekdaySlot = getUpdateWeekdaySlot(item);
  if (weekdaySlot) return (weekdaySlot.weekday - 1) * 1440 + 1439;

  return null;
}
