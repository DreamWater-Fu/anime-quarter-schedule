"use client";

import { BangumiBadge } from "./BangumiBadge";
import { CoverImage } from "./CoverImage";
import { formatUpdateDisplay, statusLabels } from "../lib/format";
import { weekdayLabels } from "../lib/season";
import { getBeijingUpdateSlot, getUpdateWeekdaySlot } from "../lib/timezone";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { AnimeItem, SeasonKey } from "@/src/server/types/anime";

const CURRENT_WINDOW_MINUTES = 10;

export function FollowSchedule({
  items,
  currentSeason,
  selectedWeekday,
  todayWeekday,
  onWeekdayChange
}: {
  items: AnimeItem[];
  currentSeason: SeasonKey;
  selectedWeekday: number;
  todayWeekday: number;
  onWeekdayChange: (weekday: number) => void;
}) {
  const [now, setNow] = useState(() => getBeijingNow());
  const isViewingToday = selectedWeekday === todayWeekday;
  const selectedWeekdayLabel = weekdayLabels[selectedWeekday - 1] ?? "本周";
  const entries = useMemo(
    () =>
      items.map((item) => {
        const beijingUpdateSlot = getBeijingUpdateSlot(item);
        const weekdaySlot = getUpdateWeekdaySlot(item);
        const minutes = beijingUpdateSlot ? parseSlotMinutes(beijingUpdateSlot.time) : null;
        const isCurrent =
          isViewingToday &&
          beijingUpdateSlot?.weekday === now.weekday &&
          minutes !== null &&
          Math.abs(minutes - now.minutes) <= CURRENT_WINDOW_MINUTES;
        return {
          beijingUpdateSlot,
          displayTitle: item.title.chinese || item.title.japanese || item.title.original,
          isCurrent,
          item,
          minutes,
          weekday: beijingUpdateSlot?.weekday ?? weekdaySlot?.weekday ?? null,
          weekdaySlot
        };
      }),
    [isViewingToday, items, now.minutes, now.weekday]
  );
  const nowMarkerIndex = useMemo(() => {
    if (!isViewingToday) return -1;
    const index = entries.findIndex((entry) => entry.minutes !== null && entry.minutes >= now.minutes);
    return index === -1 ? entries.length : index;
  }, [entries, isViewingToday, now.minutes]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(getBeijingNow());
    }, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  return (
    <section className="followSchedule" aria-label="追番列表">
      <div className="groupHeader">
        <div>
          <h2>追番列表</h2>
          <p>本周{selectedWeekdayLabel}共 {items.length} 部更新</p>
        </div>
        <div className="weekdayPicker" aria-label="选择本周日期">
          {weekdayLabels.map((label, index) => {
            const weekday = index + 1;
            const active = weekday === selectedWeekday;
            const today = weekday === todayWeekday;
            return (
              <button
                aria-pressed={active}
                className="weekdayButton"
                data-active={active}
                data-today={today}
                key={weekday}
                type="button"
                onClick={() => onWeekdayChange(weekday)}
              >
                <span>{label}</span>
                {today ? <small>今天</small> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="followList">
        {entries.length === 0 ? (
          <div className="followEmpty">
            <strong>本周{selectedWeekdayLabel}暂无更新</strong>
            <span>可以切换到其他日期查看本周内的追番时间表。</span>
          </div>
        ) : null}
        {entries.map((entry, index) => {
          const { beijingUpdateSlot, displayTitle, isCurrent, item, weekday, weekdaySlot } = entry;
          return (
            <Fragment key={item.id}>
              {isViewingToday && index === nowMarkerIndex ? <CurrentTimeMarker key="current-time-marker" now={now} /> : null}
              <article
                className="followRow"
                data-current={isCurrent}
                data-weekday={weekday ?? undefined}
              >
              <div className="followTimeline" aria-label={formatUpdateDisplay(item, currentSeason)}>
                <span>{beijingUpdateSlot?.time ?? (weekdaySlot ? "待定" : "未定")}</span>
              </div>
              <div className="followCard">
                <CoverImage item={item} />
                <div className="followMain">
                  <strong>{displayTitle}</strong>
                  <span className="followMetaLine">
                    {formatUpdateDisplay(item, currentSeason)} / {statusLabels[item.status]}
                    {isCurrent ? <span className="liveBadge">播放窗口</span> : null}
                  </span>
                </div>
                <BangumiBadge item={item} />
              </div>
            </article>
            </Fragment>
          );
        })}
        {isViewingToday && nowMarkerIndex === entries.length ? <CurrentTimeMarker now={now} /> : null}
      </div>
    </section>
  );
}

function CurrentTimeMarker({ now }: { now: BeijingNow }) {
  return (
    <div className="followNowRow" aria-label={`当前北京时间 ${now.label}`}>
      <div className="followNowMarker">
        <span />
      </div>
      <div className="followNowLabel">现在 {now.label}</div>
    </div>
  );
}

interface BeijingNow {
  weekday: number;
  minutes: number;
  label: string;
}

function getBeijingNow(date = new Date()): BeijingNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    timeZone: "Asia/Shanghai",
    weekday: "short"
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const hours = Number(byType.hour);
  const minutes = Number(byType.minute);
  const weekday =
    {
      Mon: 1,
      Tue: 2,
      Wed: 3,
      Thu: 4,
      Fri: 5,
      Sat: 6,
      Sun: 7
    }[byType.weekday ?? ""] ?? 1;

  return {
    weekday,
    minutes: hours * 60 + minutes,
    label: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
  };
}

function parseSlotMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}
