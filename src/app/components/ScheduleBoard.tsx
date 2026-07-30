import { AnimeTable } from "./AnimeTable";
import type { SortMode } from "../lib/listing";
import type { AnimeItem, SeasonKey } from "@/src/server/types/anime";

export function ScheduleBoard({
  items,
  currentSeason,
  sortMode,
  onSortModeChange
}: {
  items: AnimeItem[];
  currentSeason: SeasonKey;
  sortMode: SortMode;
  onSortModeChange: (sortMode: SortMode) => void;
}) {
  return (
    <section className="scheduleGroup" aria-label="统计列表">
      <div className="groupHeader">
        <div>
          <h2>统计列表</h2>
          <p>当前筛选下共 {items.length} 部</p>
        </div>
        <div className="boardSorts" aria-label="排序">
          <SortToggle
            field="startDate"
            label="首播"
            sortMode={sortMode}
            onChange={onSortModeChange}
          />
          <SortToggle
            field="rating"
            label="评分"
            sortMode={sortMode}
            onChange={onSortModeChange}
          />
        </div>
      </div>

      <AnimeTable items={items} currentSeason={currentSeason} />
    </section>
  );
}

function SortToggle({
  field,
  label,
  sortMode,
  onChange
}: {
  field: "startDate" | "rating";
  label: string;
  sortMode: SortMode;
  onChange: (sortMode: SortMode) => void;
}) {
  const state = getSortState(field, sortMode);
  const nextMode = getNextSortMode(field, sortMode);

  return (
    <button
      aria-label={`${label}排序：${state.label}`}
      className="sortToggle"
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

function getSortState(field: "startDate" | "rating", sortMode: SortMode) {
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

function getNextSortMode(field: "startDate" | "rating", sortMode: SortMode): SortMode {
  if (field === "startDate") {
    if (sortMode === "startDateAsc") return "startDateDesc";
    if (sortMode === "startDateDesc") return "default";
    return "startDateAsc";
  }

  if (sortMode === "ratingDesc") return "ratingAsc";
  if (sortMode === "ratingAsc") return "default";
  return "ratingDesc";
}
