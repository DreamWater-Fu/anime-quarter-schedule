import { BangumiBadge } from "./BangumiBadge";
import { CoverImage } from "./CoverImage";
import { formatDate, formatUpdateDisplay, statusLabels } from "../lib/format";
import { classifySeasonMembership } from "../lib/season";
import type { AnimeItem, SeasonKey } from "@/src/server/types/anime";

export function AnimeTable({ items, currentSeason }: { items: AnimeItem[]; currentSeason: SeasonKey }) {
  return (
    <div className="tableShell">
      <table className="animeTable">
        <thead>
          <tr>
            <th>作品</th>
            <th>更新时间</th>
            <th>首播</th>
            <th>评分</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const displayTitle = item.title.chinese || item.title.japanese || item.title.original;
            const membership = classifySeasonMembership(item, currentSeason);
            return (
              <tr key={item.id}>
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
                      <span>
                        {item.title.japanese || item.title.original} / {statusLabels[item.status]}
                      </span>
                    </div>
                  </div>
                </td>
                <td className="updateCell" data-label="更新时间">
                  {formatUpdateDisplay(item, currentSeason)}
                  {item.updateTime !== null ? <span className="timezoneHint">北京时间</span> : null}
                </td>
                <td className="numericCell" data-label="首播">
                  {formatDate(item.startDate)}
                </td>
                <td data-label="评分">
                  <BangumiBadge item={item} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
