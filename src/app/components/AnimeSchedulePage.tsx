"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { FollowSchedule } from "./FollowSchedule";
import { ScheduleBoard } from "./ScheduleBoard";
import { type FilterState, ScheduleControls } from "./ScheduleControls";
import { ScheduleToolbar } from "./ScheduleToolbar";
import { SkeletonRows, StateView } from "./StateView";
import { StatusSummary } from "./StatusSummary";
import { FrontendApiError, isStaticExportMode, loadSeasonAnime, loadUpdateStatus, runSeasonUpdate } from "../lib/apiClient";
import { getFollowItemsByWeekday, sortAnimeItems } from "../lib/listing";
import {
  classifySeasonMembership,
  getCurrentSeasonMonth,
  getQuarterBySeason,
  parseSeasonFromUrl,
  seasonKeyEquals
} from "../lib/season";
import { getBeijingWeekday } from "../lib/timezone";
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
  const [todayWeekday, setTodayWeekday] = useState(() => getBeijingWeekday());
  const [followWeekday, setFollowWeekday] = useState(() => getBeijingWeekday());
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
  const [statusWarning, setStatusWarning] = useState<PublicApiError | null>(null);
  const staticMode = isStaticExportMode();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlYear = Number(params.get("year"));
    const urlSeason = parseSeasonFromUrl(params.get("season"));
    if (Number.isInteger(urlYear) && urlYear >= 1900 && urlYear <= 2100) setYear(urlYear);
    if (urlSeason) setSeason(urlSeason);
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTodayWeekday(getBeijingWeekday());
    }, 60_000);

    return () => window.clearInterval(timer);
  }, []);

  const loadData = useCallback(async () => {
    setQueryState((current) => ({ ...current, status: "loading", error: null }));
    const [dataResult, statusResult] = await Promise.allSettled([
      loadSeasonAnime({
        year,
        season
      }),
      loadUpdateStatus()
    ]);

    if (dataResult.status === "fulfilled") {
      setQueryState({ status: "success", error: null, data: dataResult.value });
    } else {
      setQueryState((current) => ({
        ...current,
        status: "error",
        error: toApiError(dataResult.reason, "加载失败，请稍后重试")
      }));
    }

    if (statusResult.status === "fulfilled") {
      setUpdateState(statusResult.value);
      setStatusWarning(null);
    } else {
      setStatusWarning(toApiError(statusResult.reason, "更新状态读取失败，请稍后重试"));
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
      void loadUpdateStatus()
        .then((status) => {
          setUpdateState(status);
          if (status.status !== "running") void loadData();
        })
        .catch((error) => {
          setUpdateState((current) => ({
            ...current,
            status: "failed",
            lastError: { ...toApiError(error, "更新状态读取失败，请稍后重试"), at: new Date().toISOString() },
            currentJob: null
          }));
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
      setStatusWarning(null);
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
  const followItems = useMemo(() => getFollowItemsByWeekday(filteredItems, followWeekday), [filteredItems, followWeekday]);
  const hasSourceData = (queryState.data?.items.length ?? 0) > 0;
  const hasFilteredEmpty = hasSourceData && filteredItems.length === 0;
  const showBlockingError = queryState.status === "error" && !queryState.data;

  return (
    <main className="pageShell">
      <ScheduleToolbar
        cacheUpdatedAt={queryState.data?.meta.cacheUpdatedAt ?? null}
        disableUpdate={staticMode}
        staticMode={staticMode}
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

        <StatusSummary data={queryState.data} updateState={updateState} />

        <div className="stateStack" aria-live="polite">
          {queryState.status === "loading" ? (
            <StateView type="loading" title="加载中" description="正在读取当前季度新番缓存。" />
          ) : null}
          {updateState.status === "running" ? (
            <StateView type="updating" title="更新中" description="正在更新当前季度数据，页面仍可浏览旧缓存。" />
          ) : null}
          {staticMode ? (
            <StateView
              type="partial"
              title="只读模式"
              description="当前页面读取随部署发布的静态 JSON，不会调用 /api/update；请在本地更新数据后重新部署。"
            />
          ) : null}
          {statusWarning ? (
            <StateView
              type="partial"
              title="状态读取失败"
              description={`${statusWarning.code}：${statusWarning.message}。番剧列表已尽量正常显示。`}
              actionLabel="重试状态"
              onAction={loadData}
            />
          ) : null}
          {updateState.status === "failed" && updateState.lastError ? (
            <StateView
              type="error"
              title="更新失败"
              description={`${updateState.lastError.code}：${updateState.lastError.message}。当前仍显示上次成功缓存。`}
              actionLabel={staticMode ? undefined : "重试更新"}
              onAction={staticMode ? undefined : handleUpdate}
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
            description={
              staticMode
                ? "当前季度暂无静态数据，请切换年份/季度，或在本地更新 JSON 后重新部署。"
                : "当前季度暂无数据，可以尝试手动更新，或切换年份/季度。"
            }
            actionLabel={staticMode ? undefined : "更新数据"}
            onAction={staticMode ? undefined : handleUpdate}
          />
        ) : null}

        {hasFilteredEmpty ? (
          <StateView
            type="empty"
            title="没有符合筛选条件的作品"
            description="可以放宽状态或范围筛选。"
            actionLabel="清空筛选"
            onAction={() => setFilters(defaultFilterState)}
          />
        ) : null}

        {filters.viewMode === "stats" && displayItems.length > 0 ? (
          <ScheduleBoard
            currentSeason={currentSeason}
            items={displayItems}
            sortMode={filters.sortMode}
            onSortModeChange={(sortMode) => setFilters((current) => ({ ...current, sortMode }))}
          />
        ) : null}

        {filters.viewMode === "following" && filteredItems.length > 0 ? (
          <FollowSchedule
            currentSeason={currentSeason}
            items={followItems}
            selectedWeekday={followWeekday}
            todayWeekday={todayWeekday}
            onWeekdayChange={setFollowWeekday}
          />
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
            <dt>缺少评分</dt>
            <dd>{report.result.summary.missingRating}</dd>
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
                  <strong>{warning.source}</strong>
                  <span>
                    {warning.code}
                    {warning.status ? ` / HTTP ${warning.status}` : ""}：{warning.message}
                  </span>
                  {warning.details ? <pre>{formatErrorDetails(warning.details)}</pre> : null}
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
          <span>错误原因</span>
          <p>{error.message}</p>
          <span>错误详情</span>
          {error.details ? <pre>{formatErrorDetails(error.details)}</pre> : <p>接口未返回更多详情。</p>}
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
