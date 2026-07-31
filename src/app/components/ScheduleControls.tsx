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
  stats: "\u7edf\u8ba1\u5217\u8868",
  following: "\u8ffd\u756a\u5217\u8868",
  personalFollowing: "\u4e2a\u4eba\u8ffd\u756a",
  watchHistory: "\u89c2\u770b\u8bb0\u5f55"
};

const scopeLabels: Record<ScopeFilter, string> = {
  all: "\u5168\u90e8\u8303\u56f4",
  new: "\u672c\u5b63\u65b0\u5f00\u64ad",
  continuing: "\u8de8\u5b63\u5ea6\u7eed\u64ad"
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
    <details className="controls" aria-label={"\u7b5b\u9009\u63a7\u5236"}>
      <summary className="controlsSummary">
        <span className="controlsSummaryTitle">{"\u7b5b\u9009"}</span>
        <span className="controlsSummaryText">{getFilterSummary(value)}</span>
        <span aria-hidden="true" className="controlsSummaryIcon" />
      </summary>

      <div className="controlsBody">
        <ControlGroup label={"\u89c6\u56fe"}>
          <SegmentButton active={value.viewMode === "stats"} onClick={() => onChange({ viewMode: "stats" })}>
            {"\u7edf\u8ba1\u5217\u8868"}
          </SegmentButton>
          <SegmentButton active={value.viewMode === "following"} onClick={() => onChange({ viewMode: "following" })}>
            {"\u8ffd\u756a\u5217\u8868"}
          </SegmentButton>
          <SegmentButton
            active={value.viewMode === "personalFollowing"}
            onClick={() => onChange({ viewMode: "personalFollowing" })}
          >
            {"\u4e2a\u4eba\u8ffd\u756a"}
          </SegmentButton>
          <SegmentButton
            active={value.viewMode === "watchHistory"}
            onClick={() => onChange({ viewMode: "watchHistory" })}
          >
            {"\u89c2\u770b\u8bb0\u5f55"}
          </SegmentButton>
        </ControlGroup>

        <ControlGroup label={"\u8303\u56f4"}>
          <SegmentButton active={value.scope === "all"} onClick={() => onChange({ scope: "all" })}>
            {"\u5168\u90e8\u8303\u56f4"}
          </SegmentButton>
          <SegmentButton active={value.scope === "new"} onClick={() => onChange({ scope: "new" })}>
            {"\u672c\u5b63\u65b0\u5f00\u64ad"}
          </SegmentButton>
          <SegmentButton active={value.scope === "continuing"} onClick={() => onChange({ scope: "continuing" })}>
            {"\u8de8\u5b63\u5ea6\u7eed\u64ad"}
          </SegmentButton>
        </ControlGroup>

        <ChipGroup
          label={"\u72b6\u6001"}
          values={value.statuses}
          options={statusOptions}
          labelMap={statusLabels}
          onChange={(statuses) => onChange({ statuses })}
        />

        <button className="ghostButton" type="button" onClick={onReset}>
          {"\u91cd\u7f6e"}
        </button>
      </div>
    </details>
  );
}

function getFilterSummary(value: FilterState): string {
  return [viewModeLabels[value.viewMode], scopeLabels[value.scope], getStatusSummary(value.statuses)].join(" / ");
}

function getStatusSummary(statuses: FieldFilter<AnimeStatus>): string {
  if (statuses === "all") return "\u5168\u90e8\u72b6\u6001";
  return statuses.map((status) => statusLabels[status]).join("\u3001");
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
          {"\u5168\u90e8\u72b6\u6001"}
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
