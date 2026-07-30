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
  staticMode,
  onYearChange,
  onSeasonChange,
  onUpdate
}: {
  year: number;
  season: SeasonMonth;
  updateState: UpdateStatusPayload;
  cacheUpdatedAt: string | null;
  disableUpdate?: boolean;
  staticMode?: boolean;
  onYearChange: (year: number) => void;
  onSeasonChange: (season: SeasonMonth) => void;
  onUpdate: () => void;
}) {
  return (
    <header className="toolbar">
      <div className="toolbarMain">
        <div className="titleBlock">
          <h1>番剧更新表</h1>
          <p className="titleMeta">
            <span>最后更新时间：{formatDateTime(cacheUpdatedAt ?? updateState.cache.animeUpdatedAt)}</span>
            <StatusBadge status={updateState.status} />
            {staticMode ? (
              <>
                <span className="metaDivider">/</span>
                <span>只读</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="toolbarRight">
          <div className="toolbarActions">
            <div className="timePickerPanel" aria-label="时间范围选择">
              <YearSelector value={year} onChange={onYearChange} />
              <SeasonSelector value={season} onChange={onSeasonChange} />
            </div>
            <UpdateButton
              disabled={disableUpdate}
              disabledReason={staticMode ? "静态页面不能直接更新数据，请在本地更新 JSON 后重新部署。" : undefined}
              status={updateState.status}
              onClick={onUpdate}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

function StatusBadge({ status }: { status: UpdateStatusPayload["status"] }) {
  return (
    <span className="statusBadge" data-status={status} role="status">
      <span>{formatUpdateStatus(status)}</span>
    </span>
  );
}

function formatUpdateStatus(status: UpdateStatusPayload["status"]) {
  if (status === "running") return "更新中";
  if (status === "success") return "已更新";
  if (status === "failed") return "更新失败";
  return "待更新";
}
