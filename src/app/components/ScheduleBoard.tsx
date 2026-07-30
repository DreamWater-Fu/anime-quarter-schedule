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
      </div>

      <AnimeTable
        currentSeason={currentSeason}
        items={items}
        sortMode={sortMode}
        onSortModeChange={onSortModeChange}
      />
    </section>
  );
}
