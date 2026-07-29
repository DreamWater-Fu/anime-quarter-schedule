import { BangumiBadge } from "./BangumiBadge";
import { CoverImage } from "./CoverImage";
import { formatLabels, formatUpdateDisplay, statusLabels } from "../lib/format";
import { getBeijingUpdateSlot, getUpdateWeekdaySlot } from "../lib/timezone";
import type { AnimeItem, SeasonKey } from "@/src/server/types/anime";

export function FollowSchedule({ items, currentSeason }: { items: AnimeItem[]; currentSeason: SeasonKey }) {
  return (
    <section className="followSchedule" aria-label="追番列表">
      <div className="groupHeader">
        <div>
          <h2>追番列表</h2>
          <p>今日共 {items.length} 部更新</p>
        </div>
      </div>

      <div className="followList">
        {items.map((item) => {
          const displayTitle = item.title.chinese || item.title.japanese || item.title.original;
          const beijingUpdateSlot = getBeijingUpdateSlot(item);
          const weekdaySlot = getUpdateWeekdaySlot(item);
          return (
            <article className="followRow" key={item.id}>
              <div className="followTime">{beijingUpdateSlot?.time ?? (weekdaySlot ? "时间待定" : "未定")}</div>
              <CoverImage item={item} />
              <div className="followMain">
                <strong>{displayTitle}</strong>
                <span>
                  {formatUpdateDisplay(item, currentSeason)} / {formatLabels[item.format]} / {statusLabels[item.status]}
                </span>
              </div>
              <BangumiBadge item={item} />
            </article>
          );
        })}
      </div>
    </section>
  );
}
