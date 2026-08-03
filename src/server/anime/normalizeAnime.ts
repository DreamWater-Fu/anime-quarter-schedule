import type { AnimeItem } from "../types/anime.ts";

export function isFinalAnimeStatus(status: AnimeItem["status"]): boolean {
  return status === "finished" || status === "cancelled";
}

export function clearFinalStatusBroadcastSlot(item: AnimeItem): AnimeItem {
  if (!isFinalAnimeStatus(item.status)) return item;
  if (item.updateTime === null && item.updateWeekday === null) return item;
  return {
    ...item,
    updateTime: null,
    updateWeekday: null
  };
}
