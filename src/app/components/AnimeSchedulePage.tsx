"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { FollowSchedule } from "./FollowSchedule";
import { ScheduleBoard } from "./ScheduleBoard";
import { type FilterState, ScheduleControls } from "./ScheduleControls";
import { ScheduleToolbar } from "./ScheduleToolbar";
import { SkeletonRows, StateView } from "./StateView";
import { StatusSummary } from "./StatusSummary";
import { FrontendApiError, loadSeasonAnime, loadUpdateStatus, runSeasonUpdate } from "../lib/apiClient";
import { getTodayFollowItems, sortAnimeItems } from "../lib/listing";
import {
  classifySeasonMembership,
  getCurrentSeasonMonth,
  getQuarterBySeason,
  parseSeasonFromUrl,
  seasonKeyEquals
} from "../lib/season";
import type { AnimeItem, AnimeSeasonPayload, SeasonKey, SeasonMonth } from "@/src/server/types/anime";
import type { PublicApiError, UpdateResult, UpdateStatusPayload } from "@/src/server/types/api";

const defaultFilterState: FilterState = {
  viewMode: "stats",
  sortMode: "default",
  scope: "all",
  statuses: "all"
};

const emptyUpdateStatus: UpdateStatusPayload = {
  schemaVersion: 1,
  status: "idle",
  lastSuccessAt: null,
  lastAttemptAt: null,
  lastError: null,
  currentJob: null,
  cache: {
    animeUpdatedAt: null,
    itemCount: 0
  }
};

export function AnimeSchedulePage() {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [season, setSeason] = useState<SeasonMonth>(() => getCurrentSeasonMonth());
  const [filters, setFilters] = useState<FilterState>(defaultFilterState);
  const [queryState, setQueryState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    error: PublicApiError | null;
    data: AnimeSeasonPayload | null;
  }>({ status: "idle", error: null, data: null });
  const [updateState, setUpdateState] = useState<UpdateStatusPayload>(emptyUpdateStatus);
  const [updateReport, setUpdateReport] = useState<{
    result: UpdateResult;
    data: AnimeSeasonPayload;
  } | null>(null);
  const [updateError, setUpdateError] = useState<PublicApiError | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlYear = Number(params.get("year"));
    const urlSeason = parseSeasonFromUrl(params.get("season"));
    if (Number.isInteger(urlYear) && urlYear >= 1900 && urlYear <= 2100) setYear(urlYear);
    if (urlSeason) setSeason(urlSeason);
  }, []);

  const loadData = useCallback(async () => {
    setQueryState((current) => ({ ...current, status: "loading", error: null }));
    try {
      const [nextData, nextStatus] = await Promise.all([
        loadSeasonAnime({
          year,
          season
        }),
        loadUpdateStatus()
      ]);
      setQueryState({ status: "success", error: null, data: nextData });
      setUpdateState(nextStatus);
    } catch (error) {
      setQueryState((current) => ({
        ...current,
        status: "error",
        error: toApiError(error, "加载失败，请稍后重试")
      }));
    }
  }, [season, year]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    params.set("year", String(year));
    params.set("season", String(season));
    window.history.replaceState(null, "", `?${params.toString()}`);
    void loadData();
  }, [loadData, season, year]);

  useEffect(() => {
    if (updateState.status !== "running") return;

    const timer = window.setInterval(() => {
      void loadUpdateStatus().then((status) => {
        setUpdateState(status);
        if (status.status !== "running") void loadData();
      });
    }, 2500);

    return () => window.clearInterval(timer);
  }, [loadData, updateState.status]);

  async function handleUpdate() {
    setUpdateReport(null);
    setUpdateError(null);
    setUpdateState((current) => ({
      ...current,
      status: "running",
      lastAttemptAt: new Date().toISOString(),
      lastError: null,
      currentJob: {
        jobId: "pending",
        year,
        season,
        quarter: getQuarterBySeason(season),
        startedAt: new Date().toISOString()
      }
    }));

    try {
      const result = await runSeasonUpdate({ year, season });
      const [nextData, nextStatus] = await Promise.all([
        loadSeasonAnime({ year, season }),
        loadUpdateStatus()
      ]);
      setQueryState({ status: "success", error: null, data: nextData });
      setUpdateState(nextStatus);
      setUpdateReport({ result, data: nextData });
    } catch (error) {
      const apiError = toApiError(error, "本次更新失败，当前仍显示上次成功缓存");
      if (apiError.code === "UPDATE_RUNNING") {
        setUpdateState((current) => ({ ...current, status: "running" }));
        return;
      }
      setUpdateError(apiError);
      setUpdateState((current) => ({
        ...current,
        status: "failed",
        lastError: { ...apiError, at: new Date().toISOString() },
        currentJob: null
      }));
    }
  }

  const currentSeason = useMemo<SeasonKey>(() => ({ year, quarter: getQuarterBySeason(season) }), [season, year]);
  const filteredItems = useMemo(
    () => filterItems(queryState.data?.items ?? [], filters, currentSeason),
    [currentSeason, filters, queryState.data?.items]
  );
  const displayItems = useMemo(() => sortAnimeItems(filteredItems, filters.sortMode), [filteredItems, filters.sortMode]);
  const followItems = useMemo(() => getTodayFollowItems(filteredItems), [filteredItems]);
  const hasSourceData = (queryState.data?.items.length ?? 0) > 0;
  const hasFilteredEmpty = hasSourceData && filteredItems.length === 0;
  const hasFollowEmpty = filters.viewMode === "following" && hasSourceData && filteredItems.length > 0 && followItems.length === 0;
  const showBlockingError = queryState.status === "error" && !queryState.data;

  return (
    <main className="pageShell">
      <ScheduleToolbar
        cacheUpdatedAt={queryState.data?.meta.cacheUpdatedAt ?? null}
        season={season}
        updateState={updateState}
        year={year}
        onSeasonChange={setSeason}
        onUpdate={handleUpdate}
        onYearChange={setYear}
      />

      <div className="contentShell">
        <ScheduleControls
          value={filters}
          onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
          onReset={() => setFilters(defaultFilterState)}
        />

        <StatusSummary data={queryState.data} />

        <div className="stateStack" aria-live="polite">
          {queryState.status === "loading" ? (
            <StateView type="loading" title="加载中" description="正在读取当前季度新番缓存。" />
          ) : null}
          {updateState.status === "running" ? (
            <StateView type="updating" title="更新中" description="正在更新当前季度数据，页面仍可浏览旧缓存。" />
          ) : null}
          {updateState.status === "failed" && updateState.lastError ? (
            <StateView
              type="error"
              title="更新失败"
              description={`${updateState.lastError.code}：${updateState.lastError.message}。当前仍显示上次成功缓存。`}
              actionLabel="重试更新"
              onAction={handleUpdate}
            />
          ) : null}
          {queryState.status === "error" && queryState.data ? (
            <StateView
              type="error"
              title="加载失败"
              description={`${queryState.error?.code ?? "UNKNOWN"}：${queryState.error?.message ?? "当前仍显示旧缓存。"}`}
              actionLabel="重试"
              onAction={loadData}
            />
          ) : null}
        </div>

        {queryState.status === "loading" && !queryState.data ? <SkeletonRows /> : null}

        {showBlockingError ? (
          <StateView
            type="error"
            title="加载失败"
            description={`${queryState.error?.code ?? "UNKNOWN"}：${queryState.error?.message ?? "请稍后重试。"}`}
            actionLabel="重试"
            onAction={loadData}
          />
        ) : null}

        {queryState.status !== "loading" && queryState.data && queryState.data.items.length === 0 ? (
          <StateView
            type="empty"
            title="无数据"
            description="当前季度暂无数据，可以尝试手动更新，或切换年份/季度。"
            actionLabel="更新数据"
            onAction={handleUpdate}
          />
        ) : null}

        {hasFilteredEmpty ? (
          <StateView
            type="empty"
            title="没有符合筛选条件的作品"
            description="可以放宽状态、范围或数据状态筛选。"
            actionLabel="清空筛选"
            onAction={() => setFilters(defaultFilterState)}
          />
        ) : null}

        {hasFollowEmpty ? (
          <StateView
            type="empty"
            title="今日暂无更新"
            description="当前筛选条件下，今天没有按时刻表更新的新番。"
            actionLabel="查看统计列表"
            onAction={() => setFilters((current) => ({ ...current, viewMode: "stats" }))}
          />
        ) : null}

        {filters.viewMode === "stats" && displayItems.length > 0 ? (
          <ScheduleBoard currentSeason={currentSeason} items={displayItems} />
        ) : null}

        {filters.viewMode === "following" && followItems.length > 0 ? (
          <FollowSchedule currentSeason={currentSeason} items={followItems} />
        ) : null}
      </div>

      {updateReport ? (
        <UpdateReportDialog report={updateReport} onClose={() => setUpdateReport(null)} />
      ) : null}
      {updateError ? (
        <UpdateErrorDialog error={updateError} onClose={() => setUpdateError(null)} onRetry={handleUpdate} />
      ) : null}
    </main>
  );
}

function UpdateReportDialog({
  report,
  onClose
}: {
  report: { result: UpdateResult; data: AnimeSeasonPayload };
  onClose: () => void;
}) {
  const summary = report.data.meta.dataStatusSummary;
  const incomplete = summary.partial + summary.unverified + summary.conflicting;

  return (
    <div className="modalScrim" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="update-report-title"
        aria-modal="true"
        className="updateDialog"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2 id="update-report-title">更新完成</h2>
          <p>已重新审查当前季度番剧和更新时间。</p>
        </div>
        <dl className="reportGrid">
          <div>
            <dt>当前番剧</dt>
            <dd>{report.data.meta.total}</dd>
          </div>
          <div>
            <dt>信息完整</dt>
            <dd>{summary.complete}</dd>
          </div>
          <div>
            <dt>信息不完整</dt>
            <dd>{incomplete}</dd>
          </div>
          <div>
            <dt>缺少评分</dt>
            <dd>{report.result.summary.missingRating}</dd>
          </div>
          <div>
            <dt>来源冲突</dt>
            <dd>{report.result.summary.conflicting}</dd>
          </div>
          <div>
            <dt>过滤非日漫</dt>
            <dd>{report.result.summary.skippedNonJapanese}</dd>
          </div>
        </dl>
        {report.result.warnings.length > 0 ? (
          <div className="warningList">
            <span>外部来源提示</span>
            <ul>
              {report.result.warnings.map((warning, index) => (
                <li key={`${warning.source}-${warning.code}-${index}`}>
                  {warning.source}：{warning.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <button className="primaryButton" type="button" onClick={onClose}>
          知道了
        </button>
      </section>
    </div>
  );
}

function UpdateErrorDialog({
  error,
  onClose,
  onRetry
}: {
  error: PublicApiError;
  onClose: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="modalScrim" role="presentation" onClick={onClose}>
      <section
        aria-labelledby="update-error-title"
        aria-modal="true"
        className="updateDialog"
        data-tone="danger"
        role="dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <div>
          <h2 id="update-error-title">更新失败</h2>
          <p>{error.message}</p>
        </div>
        <div className="errorDetails">
          <span>错误代码</span>
          <strong>{error.code}</strong>
          {error.details ? <pre>{formatErrorDetails(error.details)}</pre> : null}
        </div>
        <div className="dialogActions">
          <button className="secondaryButton" type="button" onClick={onClose}>
            关闭
          </button>
          <button className="primaryButton" type="button" onClick={onRetry}>
            重试更新
          </button>
        </div>
      </section>
    </div>
  );
}

function formatErrorDetails(details: unknown): string {
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details, null, 2);
  } catch {
    return "错误详情无法序列化";
  }
}

function filterItems(items: AnimeItem[], filters: FilterState, currentSeason: SeasonKey) {
  return items.filter((item) => {
    if (filters.statuses !== "all" && !filters.statuses.includes(item.status)) return false;
    if (filters.scope === "new" && !seasonKeyEquals(item.primarySeason, currentSeason)) return false;
    if (filters.scope === "continuing" && classifySeasonMembership(item, currentSeason) !== "continuing") return false;
    return true;
  });
}

function toApiError(error: unknown, fallback: string): PublicApiError {
  if (error instanceof FrontendApiError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof Error) return { code: "UNKNOWN", message: error.message || fallback };
  return { code: "UNKNOWN", message: fallback };
}
