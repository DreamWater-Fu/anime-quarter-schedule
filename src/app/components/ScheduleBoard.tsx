import { AnimeTable } from "./AnimeTable";
import type { AnimeItem, SeasonKey } from "@/src/server/types/anime";

export function ScheduleBoard({ items, currentSeason }: { items: AnimeItem[]; currentSeason: SeasonKey }) {
  return (
    <section className="scheduleGroup" aria-label="统计列表">
      <div className="groupHeader">
        <div>
          <h2>统计列表</h2>
          <p>当前筛选下共 {items.length} 部</p>
        </div>
      </div>

      <AnimeTable items={items} currentSeason={currentSeason} />
    </section>
  );
}
