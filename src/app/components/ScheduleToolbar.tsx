import { formatDateTime } from "../lib/format";
import { SeasonSelector } from "./SeasonSelector";
import { UpdateButton } from "./UpdateButton";
import { YearSelector } from "./YearSelector";
import type { SeasonMonth } from "@/src/server/types/anime";
import type { UpdateStatusPayload } from "@/src/server/types/api";

export function ScheduleToolbar({
  year,
  season,
  updateState,
  cacheUpdatedAt,
  disableUpdate,
  onYearChange,
  onSeasonChange,
  onUpdate
}: {
  year: number;
  season: SeasonMonth;
  updateState: UpdateStatusPayload;
  cacheUpdatedAt: string | null;
  disableUpdate?: boolean;
  onYearChange: (year: number) => void;
  onSeasonChange: (season: SeasonMonth) => void;
  onUpdate: () => void;
}) {
  return (
    <header className="toolbar">
      <div className="toolbarMain">
        <div className="titleBlock">
          <h1>日本季度新番更新时间表</h1>
          <p>
            最后更新：{formatDateTime(cacheUpdatedAt ?? updateState.cache.animeUpdatedAt)}
            <span className="metaDivider">/</span>
            当前状态：{formatUpdateStatus(updateState.status)}
          </p>
        </div>
        <div className="toolbarActions">
          <YearSelector value={year} onChange={onYearChange} />
          <SeasonSelector value={season} onChange={onSeasonChange} />
          <UpdateButton disabled={disableUpdate} status={updateState.status} onClick={onUpdate} />
        </div>
      </div>
    </header>
  );
}

function formatUpdateStatus(status: UpdateStatusPayload["status"]) {
  if (status === "running") return "更新中";
  if (status === "success") return "更新成功";
  if (status === "failed") return "更新失败";
  return "空闲";
}
