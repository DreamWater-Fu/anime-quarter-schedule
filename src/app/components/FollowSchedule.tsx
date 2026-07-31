"use client";

import { Fragment, useEffect, useMemo, useState } from "react";

import { BangumiBadge } from "./BangumiBadge";
import { CoverImage } from "./CoverImage";
import { UserAnimeActionButton } from "./UserAnimeActionButton";
import { formatUpdateDisplay, statusLabels } from "../lib/format";
import { weekdayLabels } from "../lib/season";
import { getBeijingUpdateSlot, getUpdateWeekdaySlot } from "../lib/timezone";
import type { UserAnimePrefsControls } from "../lib/userAnimePrefs";
import type { AnimeItem, SeasonKey } from "@/src/server/types/anime";

const CURRENT_WINDOW_MINUTES = 10;

export function FollowSchedule({
  items,
  currentSeason,
  selectedWeekday,
  todayWeekday,
  userPrefs,
  title = "\u8ffd\u756a\u5217\u8868",
  description,
  emptyTitle,
  emptyDescription = "\u53ef\u4ee5\u5207\u6362\u5230\u5176\u4ed6\u65e5\u671f\u67e5\u770b\u672c\u5468\u5185\u7684\u8ffd\u756a\u65f6\u95f4\u8868\u3002",
  ariaLabel = title,
  onWeekdayChange
}: {
  items: AnimeItem[];
  currentSeason: SeasonKey;
  selectedWeekday: number;
  todayWeekday: number;
  userPrefs: UserAnimePrefsControls;
  title?: string;
  description?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  ariaLabel?: string;
  onWeekdayChange: (weekday: number) => void;
}) {
  const [now, setNow] = useState(() => getBeijingNow());
  const isViewingToday = selectedWeekday === todayWeekday;
  const selectedWeekdayLabel = weekdayLabels[selectedWeekday - 1] ?? "\u672c\u5468";
  const headerDescription = description ?? `\u672c\u5468${selectedWeekdayLabel}\u5171 ${items.length} \u90e8\u66f4\u65b0`;
  const emptyHeading = emptyTitle ?? `\u672c\u5468${selectedWeekdayLabel}\u6682\u65e0\u66f4\u65b0`;
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
    <section className="followSchedule" aria-label={ariaLabel}>
      <div className="groupHeader">
        <div>
          <h2>{title}</h2>
          <p>{headerDescription}</p>
        </div>
        <div className="weekdayPicker" aria-label={"\u9009\u62e9\u672c\u5468\u65e5\u671f"}>
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
                {today ? <small>{"\u4eca\u5929"}</small> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="followList">
        {entries.length === 0 ? (
          <div className="followEmpty">
            <strong>{emptyHeading}</strong>
            <span>{emptyDescription}</span>
          </div>
        ) : null}
        {entries.map((entry, index) => {
          const { beijingUpdateSlot, displayTitle, isCurrent, item, weekday, weekdaySlot } = entry;
          return (
            <Fragment key={item.id}>
              {isViewingToday && index === nowMarkerIndex ? <CurrentTimeMarker key="current-time-marker" now={now} /> : null}
              <article className="followRow" data-current={isCurrent} data-weekday={weekday ?? undefined}>
                <div className="followTimeline" aria-label={formatUpdateDisplay(item, currentSeason)}>
                  <span>{beijingUpdateSlot?.time ?? (weekdaySlot ? "\u5f85\u5b9a" : "\u672a\u5b9a")}</span>
                </div>
                <div className="followCard">
                  <CoverImage item={item} />
                  <div className="followMain">
                    <strong>{displayTitle}</strong>
                    <span className="followMetaLine">
                      {formatUpdateDisplay(item, currentSeason)} / {statusLabels[item.status]}
                      {isCurrent ? <span className="liveBadge">{"\u64ad\u653e\u7a97\u53e3"}</span> : null}
                    </span>
                  </div>
                  <BangumiBadge item={item} />
                  <UserAnimeActionButton item={item} userPrefs={userPrefs} />
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
    <div className="followNowRow" aria-label={`\u5f53\u524d\u5317\u4eac\u65f6\u95f4 ${now.label}`}>
      <div className="followNowMarker">
        <span />
      </div>
      <div className="followNowLabel">{"\u73b0\u5728"} {now.label}</div>
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
