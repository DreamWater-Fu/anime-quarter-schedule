import type { AnimeItem } from "@/src/server/types/anime";
import { weekdayLabels } from "./season.ts";

const JAPAN_TO_BEIJING_MINUTE_OFFSET = -60;

export interface BeijingUpdateSlot {
  weekday: number;
  weekdayLabel: string;
  time: string;
  label: string;
}

export interface UpdateWeekdaySlot {
  weekday: number;
  weekdayLabel: string;
  label: string;
}

export function getBeijingUpdateSlot(item: AnimeItem): BeijingUpdateSlot | null {
  if (item.updateWeekday === null || item.updateTime === null) return null;
  if (item.updateWeekday < 1 || item.updateWeekday > 7) return null;

  const minutes = parseTimeToMinutes(item.updateTime);
  if (minutes === null) return null;

  const offset = item.timezone === "Asia/Shanghai" ? 0 : JAPAN_TO_BEIJING_MINUTE_OFFSET;
  const shifted = shiftWeekdayAndMinutes(item.updateWeekday, minutes + offset);
  const time = formatMinutes(shifted.minutes);
  const weekdayLabel = weekdayLabels[shifted.weekday - 1] ?? "";
  return {
    weekday: shifted.weekday,
    weekdayLabel,
    time,
    label: `${weekdayLabel} ${time}`
  };
}

export function getUpdateWeekdaySlot(item: AnimeItem): UpdateWeekdaySlot | null {
  if (item.updateWeekday === null || item.updateWeekday < 1 || item.updateWeekday > 7) return null;
  const weekdayLabel = weekdayLabels[item.updateWeekday - 1] ?? "";
  return {
    weekday: item.updateWeekday,
    weekdayLabel,
    label: `${weekdayLabel} 时间待定`
  };
}

export function getBeijingWeekday(date = new Date()): number {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short"
  }).format(date);

  return {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7
  }[weekday] ?? 1;
}

function shiftWeekdayAndMinutes(weekday: number, minutes: number): { weekday: number; minutes: number } {
  let nextWeekday = weekday;
  let nextMinutes = minutes;

  while (nextMinutes < 0) {
    nextMinutes += 1440;
    nextWeekday = nextWeekday === 1 ? 7 : nextWeekday - 1;
  }

  while (nextMinutes >= 1440) {
    nextMinutes -= 1440;
    nextWeekday = nextWeekday === 7 ? 1 : nextWeekday + 1;
  }

  return { weekday: nextWeekday, minutes: nextMinutes };
}

function parseTimeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function formatMinutes(value: number): string {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}
