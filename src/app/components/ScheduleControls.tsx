import { statusLabels } from "../lib/format";
import type { ReactNode } from "react";
import type { AnimeStatus } from "@/src/server/types/anime";
import type { SortMode, ViewMode } from "../lib/listing";

export type ScopeFilter = "all" | "new" | "continuing";
export type FieldFilter<T extends string> = "all" | T[];

export interface FilterState {
  viewMode: ViewMode;
  sortMode: SortMode;
  scope: ScopeFilter;
  statuses: FieldFilter<AnimeStatus>;
}

const statusOptions: AnimeStatus[] = ["announced", "airing", "finished", "delayed"];
const viewModeLabels: Record<ViewMode, string> = {
  stats: "统计列表",
  following: "追番列表"
};

const scopeLabels: Record<ScopeFilter, string> = {
  all: "全部",
  new: "本季新开播",
  continuing: "跨季度续播"
};

export function ScheduleControls({
  value,
  onChange,
  onReset
}: {
  value: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
}) {
  return (
    <details className="controls" aria-label="筛选控制">
      <summary className="controlsSummary">
        <span className="controlsSummaryTitle">筛选</span>
        <span className="controlsSummaryText">{getFilterSummary(value)}</span>
        <span aria-hidden="true" className="controlsSummaryIcon" />
      </summary>

      <div className="controlsBody">
        <ControlGroup label="视图">
          <SegmentButton active={value.viewMode === "stats"} onClick={() => onChange({ viewMode: "stats" })}>
            统计列表
          </SegmentButton>
          <SegmentButton active={value.viewMode === "following"} onClick={() => onChange({ viewMode: "following" })}>
            追番列表
          </SegmentButton>
        </ControlGroup>

        <ControlGroup label="范围">
          <SegmentButton active={value.scope === "all"} onClick={() => onChange({ scope: "all" })}>
            全部
          </SegmentButton>
          <SegmentButton active={value.scope === "new"} onClick={() => onChange({ scope: "new" })}>
            本季新开播
          </SegmentButton>
          <SegmentButton active={value.scope === "continuing"} onClick={() => onChange({ scope: "continuing" })}>
            跨季度续播
          </SegmentButton>
        </ControlGroup>

        <ChipGroup
          label="状态"
          values={value.statuses}
          options={statusOptions}
          labelMap={statusLabels}
          onChange={(statuses) => onChange({ statuses })}
        />

        <button className="ghostButton" type="button" onClick={onReset}>
          重置
        </button>
      </div>
    </details>
  );
}

function getFilterSummary(value: FilterState): string {
  return [viewModeLabels[value.viewMode], scopeLabels[value.scope], getStatusSummary(value.statuses)].join(" / ");
}

function getStatusSummary(statuses: FieldFilter<AnimeStatus>): string {
  if (statuses === "all") return "全部状态";
  return statuses.map((status) => statusLabels[status]).join("、");
}

function ControlGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="controlGroup">
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

function SegmentButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button aria-pressed={active} className="chipButton" data-active={active} type="button" onClick={onClick}>
      {children}
    </button>
  );
}

function ChipGroup<T extends string>({
  label,
  values,
  options,
  labelMap,
  onChange
}: {
  label: string;
  values: FieldFilter<T>;
  options: T[];
  labelMap: Record<T, string>;
  onChange: (values: FieldFilter<T>) => void;
}) {
  return (
    <fieldset className="controlGroup">
      <legend>{label}</legend>
      <div>
        <button
          aria-pressed={values === "all"}
          className="chipButton"
          data-active={values === "all"}
          type="button"
          onClick={() => onChange("all")}
        >
          全部
        </button>
        {options.map((option) => {
          const active = values !== "all" && values.includes(option);
          return (
            <button
              aria-pressed={active}
              className="chipButton"
              data-active={active}
              key={option}
              type="button"
              onClick={() => {
                if (values === "all") {
                  onChange([option]);
                  return;
                }
                const next = active ? values.filter((item) => item !== option) : [...values, option];
                onChange(next.length > 0 ? next : "all");
              }}
            >
              {labelMap[option]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
