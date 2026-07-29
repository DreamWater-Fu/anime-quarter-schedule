import type { AnimeFormat, AnimeItem, AnimeStatus, DataStatus, SeasonKey } from "@/src/server/types/anime";
import { getBeijingUpdateSlot, getUpdateWeekdaySlot } from "./timezone.ts";

export const formatLabels: Record<AnimeFormat, string> = {
  tv: "TV",
  web: "WEB",
  ova: "OVA",
  movie: "剧场版",
  sp: "SP",
  recap: "总集篇",
  pv: "PV",
  cm: "CM",
  music_video: "MV",
  rebroadcast: "重播",
  unknown: "未知"
};

export const statusLabels: Record<AnimeStatus, string> = {
  announced: "未开播",
  airing: "连载中",
  finished: "已完结",
  delayed: "延期",
  cancelled: "已取消",
  unknown: "未知"
};

export const dataStatusLabels: Record<DataStatus, string> = {
  complete: "完整",
  partial: "信息缺失",
  conflicting: "来源冲突",
  unverified: "待确认"
};

export function formatDate(value: string | null | undefined): string {
  return value ?? "待确认";
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai"
  }).format(date);
}

export function formatTime(value: string | null | undefined): string {
  return value ?? "时间待确认";
}

export function formatUpdateDisplay(item: AnimeItem, _currentSeason: SeasonKey): string {
  if (item.status === "finished") return "已完结";

  const beijingUpdateSlot = getBeijingUpdateSlot(item);
  if (beijingUpdateSlot) return beijingUpdateSlot.label;
  const weekdaySlot = getUpdateWeekdaySlot(item);
  if (weekdaySlot) return weekdaySlot.label;
  return "暂未确定";
}
