import { BangumiBadge } from "./BangumiBadge";
import { CoverImage } from "./CoverImage";
import { UserAnimeActionButton } from "./UserAnimeActionButton";
import { formatDate, formatUpdateDisplay, statusLabels } from "../lib/format";
import type { SortMode } from "../lib/listing";
import type { UserAnimePrefsControls } from "../lib/userAnimePrefs";
import { classifySeasonMembership } from "../lib/season";
import { getBeijingUpdateSlot, getUpdateWeekdaySlot } from "../lib/timezone";
import type { AnimeItem, SeasonKey } from "@/src/server/types/anime";

export function AnimeTable({
  items,
  currentSeason,
  sortMode,
  userPrefs,
  onSortModeChange
}: {
  items: AnimeItem[];
  currentSeason: SeasonKey;
  sortMode: SortMode;
  userPrefs: UserAnimePrefsControls;
  onSortModeChange: (sortMode: SortMode) => void;
}) {
  return (
    <div className="tableShell">
      <div className="tableMobileSorts" aria-label="排序">
        <HeaderSortButton
          field="updateTime"
          label="更新时间"
          sortMode={sortMode}
          onChange={onSortModeChange}
        />
        <HeaderSortButton
          field="startDate"
          label="首播"
          sortMode={sortMode}
          onChange={onSortModeChange}
        />
        <HeaderSortButton
          field="rating"
          label="评分"
          sortMode={sortMode}
          onChange={onSortModeChange}
        />
      </div>
      <table className="animeTable">
        <thead>
          <tr>
            <th>作品</th>
            <th>
              <HeaderSortButton
                field="updateTime"
                label="更新时间"
                sortMode={sortMode}
                onChange={onSortModeChange}
              />
            </th>
            <th>
              <HeaderSortButton
                field="startDate"
                label="首播"
                sortMode={sortMode}
                onChange={onSortModeChange}
              />
            </th>
            <th>集数</th>
            <th>
              <HeaderSortButton
                field="rating"
                label="评分"
                sortMode={sortMode}
                onChange={onSortModeChange}
              />
            </th>
            <th>{"\u64cd\u4f5c"}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const displayTitle = item.title.chinese || item.title.japanese || item.title.original;
            const membership = classifySeasonMembership(item, currentSeason);
            const secondaryTitle = getSecondaryTitle(item, displayTitle);
            const updateWeekday = getBeijingUpdateSlot(item)?.weekday ?? getUpdateWeekdaySlot(item)?.weekday ?? null;
            return (
              <tr data-weekday={updateWeekday ?? undefined} key={item.id}>
                <td data-label="作品">
                  <div className="tableTitleCell">
                    <CoverImage item={item} />
                    <div>
                      <div className="animeTitleRow">
                        <strong>{displayTitle}</strong>
                        <span className="badge" data-tone={membership === "continuing" ? "info" : "neutral"}>
                          {membership === "continuing" ? "续播" : "新开播"}
                        </span>
                      </div>
                      <span>{secondaryTitle ? `${secondaryTitle} / ` : ""}{statusLabels[item.status]}</span>
                    </div>
                  </div>
                </td>
                <td className="updateCell" data-label="更新时间">
                  <div className="updateStack">
                    <span className="updatePill">{formatUpdateDisplay(item, currentSeason)}</span>
                    {item.updateTime !== null ? <span className="timezoneHint">北京时间</span> : null}
                  </div>
                </td>
                <td className="numericCell" data-label="首播">
                  {formatDate(item.startDate)}
                </td>
                <td className="numericCell" data-label="集数">
                  {formatEpisodeCount(item)}
                </td>
                <td data-label="评分">
                  <BangumiBadge item={item} />
                </td>
                <td data-label="操作">
                  <UserAnimeActionButton item={item} userPrefs={userPrefs} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HeaderSortButton({
  field,
  label,
  sortMode,
  onChange
}: {
  field: SortField;
  label: string;
  sortMode: SortMode;
  onChange: (sortMode: SortMode) => void;
}) {
  const state = getSortState(field, sortMode);
  const nextMode = getNextSortMode(field, sortMode);

  return (
    <button
      aria-label={`${label}排序：${state.label}`}
      className="tableSortButton"
      data-active={state.direction !== "default"}
      title={`当前：${state.label}。点击切换排序。`}
      type="button"
      onClick={() => onChange(nextMode)}
    >
      <span>{label}</span>
      <span aria-hidden="true" className="sortIcon">
        {state.icon}
      </span>
    </button>
  );
}

type SortField = "updateTime" | "startDate" | "rating";

function getSortState(field: SortField, sortMode: SortMode) {
  if (field === "updateTime") {
    if (sortMode === "updateTimeAsc") return { direction: "down", icon: "↓", label: "更新时间早到晚" };
    if (sortMode === "updateTimeDesc") return { direction: "up", icon: "↑", label: "更新时间晚到早" };
  }
  if (field === "startDate") {
    if (sortMode === "startDateAsc") return { direction: "down", icon: "↓", label: "首播早到晚" };
    if (sortMode === "startDateDesc") return { direction: "up", icon: "↑", label: "首播晚到早" };
  }
  if (field === "rating") {
    if (sortMode === "ratingDesc") return { direction: "down", icon: "↓", label: "评分高到低" };
    if (sortMode === "ratingAsc") return { direction: "up", icon: "↑", label: "评分低到高" };
  }
  return { direction: "default", icon: "↕", label: "默认" };
}

function getNextSortMode(field: SortField, sortMode: SortMode): SortMode {
  if (field === "updateTime") {
    if (sortMode === "updateTimeAsc") return "updateTimeDesc";
    if (sortMode === "updateTimeDesc") return "default";
    return "updateTimeAsc";
  }

  if (field === "startDate") {
    if (sortMode === "startDateAsc") return "startDateDesc";
    if (sortMode === "startDateDesc") return "default";
    return "startDateAsc";
  }

  if (sortMode === "ratingDesc") return "ratingAsc";
  if (sortMode === "ratingAsc") return "default";
  return "ratingDesc";
}

function getSecondaryTitle(item: AnimeItem, displayTitle: string): string | null {
  const candidates = [item.title.japanese, item.title.original, item.title.english].filter(
    (title): title is string => Boolean(title && title !== displayTitle)
  );
  return candidates[0] ?? null;
}

function formatEpisodeCount(item: AnimeItem): string {
  if (item.episodeCount === null) return "待确认";
  return `全 ${item.episodeCount} 集`;
}
