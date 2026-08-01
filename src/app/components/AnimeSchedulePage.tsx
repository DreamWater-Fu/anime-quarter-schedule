"use client";

import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";

import { AnimeSearch } from "./AnimeSearch";
import { FollowSchedule } from "./FollowSchedule";
import { ScheduleBoard } from "./ScheduleBoard";
import { type FilterState, ScheduleControls } from "./ScheduleControls";
import { ScheduleToolbar } from "./ScheduleToolbar";
import { SkeletonRows, StateView } from "./StateView";
import { StatusSummary } from "./StatusSummary";
import { ViewModeSwitcher } from "./ViewModeSwitcher";
import { FrontendApiError, isStaticExportMode, loadAnimeItemsByIds, loadSeasonAnime, loadUpdateStatus, runSeasonUpdate } from "../lib/apiClient";
import { getFollowItemsByWeekday, sortAnimeItems, type ViewMode } from "../lib/listing";
import {
  classifySeasonMembership,
  getCurrentSeasonKey,
  getQuarterBySeason,
  getSeasonMonthByQuarter,
  parseSeasonFromUrl,
  seasonKeyEquals
} from "../lib/season";
import { getBeijingWeekday } from "../lib/timezone";
import { useUserAnimePrefs } from "../lib/userAnimePrefs";
import type { AnimeItem, AnimeSeasonPayload, SeasonKey, SeasonMonth } from "@/src/server/types/anime";
import type { PublicApiError, UpdateResult, UpdateStatusPayload } from "@/src/server/types/api";

const defaultFilterState: FilterState = {
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

type LocalRecordState = {
  status: "idle" | "loading" | "success" | "error";
  error: PublicApiError | null;
  items: AnimeItem[];
};

function getDefaultSeasonSelection(): { year: number; season: SeasonMonth } {
  const currentSeason = getCurrentSeasonKey();
  return {
    year: currentSeason.year,
    season: getSeasonMonthByQuarter(currentSeason.quarter)
  };
}

export function AnimeSchedulePage() {
  const [year, setYear] = useState(() => getDefaultSeasonSelection().year);
  const [season, setSeason] = useState<SeasonMonth>(() => getDefaultSeasonSelection().season);
  const [todayWeekday, setTodayWeekday] = useState(() => getBeijingWeekday());
  const [followWeekday, setFollowWeekday] = useState(() => getBeijingWeekday());
  const [viewMode, setViewMode] = useState<ViewMode>("stats");
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
  const [watchingState, setWatchingState] = useState<LocalRecordState>({ status: "idle", error: null, items: [] });
  const [watchHistoryState, setWatchHistoryState] = useState<LocalRecordState>({ status: "idle", error: null, items: [] });
  const [updateError, setUpdateError] = useState<PublicApiError | null>(null);
  const [statusWarning, setStatusWarning] = useState<PublicApiError | null>(null);
  const staticMode = isStaticExportMode();
  const userPrefs = useUserAnimePrefs();
  const reconcileAnimeStatuses = userPrefs.reconcileAnimeStatuses;

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

  useEffect(() => {
    if (!queryState.data) return;
    reconcileAnimeStatuses(queryState.data.items);
  }, [queryState.data, reconcileAnimeStatuses]);

  const loadLocalRecordItems = useCallback(
    async (
      ids: string[],
      setState: Dispatch<SetStateAction<LocalRecordState>>,
      fallback: string,
      shouldCommit: () => boolean = () => true
    ) => {
      if (ids.length === 0) {
        if (shouldCommit()) setState({ status: "idle", error: null, items: [] });
        return;
      }

      setState((current) => ({ ...current, status: "loading", error: null }));

      try {
        const payload = await loadAnimeItemsByIds({ ids });
        if (!shouldCommit()) return;
        setState({ status: "success", error: null, items: payload.items });
        reconcileAnimeStatuses(payload.items);
      } catch (error) {
        if (!shouldCommit()) return;
        setState((current) => ({
          ...current,
          status: "error",
          error: toApiError(error, fallback)
        }));
      }
    },
    [reconcileAnimeStatuses]
  );

  const watchingIdsKey = useMemo(
    () => [...userPrefs.watchingIds].sort().join("\n"),
    [userPrefs.watchingIds]
  );

  const completedIdsKey = useMemo(
    () => [...userPrefs.completedIds].sort().join("\n"),
    [userPrefs.completedIds]
  );

  useEffect(() => {
    if (!userPrefs.isLoaded) return;

    let active = true;
    const ids = watchingIdsKey ? watchingIdsKey.split("\n") : [];
    void loadLocalRecordItems(ids, setWatchingState, "在看记录读取失败，请稍后重试", () => active);

    return () => {
      active = false;
    };
  }, [loadLocalRecordItems, userPrefs.isLoaded, watchingIdsKey]);

  useEffect(() => {
    if (!userPrefs.isLoaded) return;

    let active = true;
    const ids = completedIdsKey ? completedIdsKey.split("\n") : [];
    void loadLocalRecordItems(ids, setWatchHistoryState, "观看记录读取失败，请稍后重试", () => active);

    return () => {
      active = false;
    };
  }, [completedIdsKey, loadLocalRecordItems, userPrefs.isLoaded]);

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

  function handleViewModeChange(nextViewMode: ViewMode) {
    if (nextViewMode === "following") {
      const currentSeasonSelection = getDefaultSeasonSelection();
      setYear(currentSeasonSelection.year);
      setSeason(currentSeasonSelection.season);
    }
    setViewMode(nextViewMode);
  }

  const currentSeason = useMemo<SeasonKey>(() => ({ year, quarter: getQuarterBySeason(season) }), [season, year]);
  const filteredItems = useMemo(
    () => filterItems(queryState.data?.items ?? [], filters, currentSeason),
    [currentSeason, filters, queryState.data?.items]
  );
  const displayItems = useMemo(() => sortAnimeItems(filteredItems, filters.sortMode), [filteredItems, filters.sortMode]);
  const followItems = useMemo(() => getFollowItemsByWeekday(filteredItems, followWeekday), [filteredItems, followWeekday]);
  const personalFollowItems = useMemo(
    () => getFollowItemsByWeekday(filteredItems, followWeekday, (item) => userPrefs.followedIds.has(item.id)),
    [filteredItems, followWeekday, userPrefs.followedIds]
  );
  const watchingItems = useMemo(
    () => sortAnimeItems(watchingState.items, filters.sortMode),
    [filters.sortMode, watchingState.items]
  );
  const completedItems = useMemo(
    () => sortAnimeItems(watchHistoryState.items, filters.sortMode),
    [filters.sortMode, watchHistoryState.items]
  );
  const hasPersonalFollowSelection = userPrefs.followedIds.size > 0;
  const hasSourceData = (queryState.data?.items.length ?? 0) > 0;
  const usesSeasonItems = viewMode !== "watching" && viewMode !== "watchHistory";
  const hasFilteredEmpty = usesSeasonItems && hasSourceData && filteredItems.length === 0;
  const showBlockingError = queryState.status === "error" && !queryState.data;
  const searchRefreshKey = `${queryState.data?.meta.cacheUpdatedAt ?? ""}:${updateState.cache.animeUpdatedAt ?? ""}`;

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
        <ViewModeSwitcher value={viewMode} onChange={handleViewModeChange} />

        <div className="utilityRow">
          <AnimeSearch
            refreshKey={searchRefreshKey}
            userPrefs={userPrefs}
            onSeasonSelect={(selectedSeason) => {
              setYear(selectedSeason.year);
              setSeason(getSeasonMonthByQuarter(selectedSeason.quarter));
            }}
          />

          <ScheduleControls
            value={filters}
            onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
            onReset={() => setFilters(defaultFilterState)}
          />
        </div>

        {usesSeasonItems ? <StatusSummary data={queryState.data} updateState={updateState} /> : null}

        <div className="stateStack" aria-live="polite">
          {usesSeasonItems && queryState.status === "loading" ? (
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
          {usesSeasonItems && queryState.status === "error" && queryState.data ? (
            <StateView
              type="error"
              title="加载失败"
              description={`${queryState.error?.code ?? "UNKNOWN"}：${queryState.error?.message ?? "当前仍显示旧缓存。"}`}
              actionLabel="重试"
              onAction={loadData}
            />
          ) : null}
        </div>

        {usesSeasonItems && queryState.status === "loading" && !queryState.data ? <SkeletonRows /> : null}

        {usesSeasonItems && showBlockingError ? (
          <StateView
            type="error"
            title="加载失败"
            description={`${queryState.error?.code ?? "UNKNOWN"}：${queryState.error?.message ?? "请稍后重试。"}`}
            actionLabel="重试"
            onAction={loadData}
          />
        ) : null}

        {usesSeasonItems && queryState.status !== "loading" && queryState.data && queryState.data.items.length === 0 ? (
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

        {viewMode === "stats" && displayItems.length > 0 ? (
          <ScheduleBoard
            currentSeason={currentSeason}
            items={displayItems}
            sortMode={filters.sortMode}
            userPrefs={userPrefs}
            onSortModeChange={(sortMode) => setFilters((current) => ({ ...current, sortMode }))}
          />
        ) : null}

        {viewMode === "following" && filteredItems.length > 0 ? (
          <FollowSchedule
            currentSeason={currentSeason}
            items={followItems}
            selectedWeekday={followWeekday}
            todayWeekday={todayWeekday}
            userPrefs={userPrefs}
            onWeekdayChange={setFollowWeekday}
          />
        ) : null}

        {viewMode === "personalFollowing" && hasPersonalFollowSelection ? (
          <FollowSchedule
            ariaLabel={"\u4e2a\u4eba\u8ffd\u756a"}
            currentSeason={currentSeason}
            emptyDescription={"\u8fd9\u4e00\u5929\u6ca1\u6709\u5df2\u8ffd\u756a\u4f5c\u54c1\u66f4\u65b0\uff0c\u53ef\u4ee5\u5207\u6362\u5230\u5176\u4ed6\u65e5\u671f\u67e5\u770b\u3002"}
            emptyTitle={"\u5f53\u5929\u6682\u65e0\u4e2a\u4eba\u8ffd\u756a"}
            items={personalFollowItems}
            selectedWeekday={followWeekday}
            todayWeekday={todayWeekday}
            title={"\u4e2a\u4eba\u8ffd\u756a"}
            userPrefs={userPrefs}
            onWeekdayChange={setFollowWeekday}
          />
        ) : null}

        {viewMode === "personalFollowing" && filteredItems.length > 0 && !hasPersonalFollowSelection ? (
          <StateView
            type="empty"
            title={"\u8fd8\u6ca1\u6709\u4e2a\u4eba\u8ffd\u756a"}
            description={"\u5728\u8fde\u8f7d\u4e2d\u7684\u4f5c\u54c1\u4e0a\u70b9\u51fb\u8ffd\u756a\u540e\uff0c\u8fd9\u91cc\u4f1a\u751f\u6210\u53ea\u5c5e\u4e8e\u4f60\u7684\u8ffd\u756a\u8868\u3002"}
          />
        ) : null}

        {viewMode === "watching" && watchingState.status === "loading" && watchingItems.length === 0 ? (
          <StateView type="loading" title={"\u8bfb\u53d6\u5728\u770b\u8bb0\u5f55"} description={"\u6b63\u5728\u4ece\u756a\u5267\u5e93\u5339\u914d\u5728\u770b\u4f5c\u54c1\u3002"} />
        ) : null}

        {viewMode === "watching" && watchingState.status === "error" ? (
          <StateView
            type="error"
            title={"\u5728\u770b\u8bb0\u5f55\u8bfb\u53d6\u5931\u8d25"}
            description={`${watchingState.error?.code ?? "UNKNOWN"}\uff1a${watchingState.error?.message ?? "\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002"}`}
            actionLabel={"\u91cd\u8bd5"}
            onAction={() => {
              const ids = watchingIdsKey ? watchingIdsKey.split("\n") : [];
              void loadLocalRecordItems(ids, setWatchingState, "\u5728\u770b\u8bb0\u5f55\u8bfb\u53d6\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5");
            }}
          />
        ) : null}

        {viewMode === "watching" && watchingItems.length > 0 ? (
          <ScheduleBoard
            ariaLabel={"\u5728\u770b\u8bb0\u5f55"}
            currentSeason={currentSeason}
            description={`\u5168\u90e8\u8bb0\u5f55\u4e2d\u5171 ${watchingItems.length} \u90e8\u5728\u770b`}
            items={watchingItems}
            showSeasonColumn={true}
            sortMode={filters.sortMode}
            title={"\u5728\u770b\u8bb0\u5f55"}
            userPrefs={userPrefs}
            onSortModeChange={(sortMode) => setFilters((current) => ({ ...current, sortMode }))}
          />
        ) : null}

        {viewMode === "watching" && userPrefs.isLoaded && watchingIdsKey.length === 0 ? (
          <StateView
            type="empty"
            title={"\u6682\u65e0\u5728\u770b\u8bb0\u5f55"}
            description={"\u5728\u5df2\u5b8c\u7ed3\u4f5c\u54c1\u4e0a\u70b9\u51fb\u5728\u770b\u540e\uff0c\u8fd9\u91cc\u4f1a\u663e\u793a\u4f60\u5c1a\u672a\u770b\u5b8c\u7684\u5b8c\u7ed3\u756a\u5267\u3002"}
          />
        ) : null}

        {viewMode === "watching" && watchingIdsKey.length > 0 && watchingState.status === "success" && watchingItems.length === 0 ? (
          <StateView
            type="empty"
            title={"\u6682\u65e0\u53ef\u663e\u793a\u7684\u5728\u770b\u8bb0\u5f55"}
            description={"\u5df2\u6807\u8bb0\u7684\u4f5c\u54c1\u672a\u5728\u5f53\u524d\u516c\u5171\u756a\u5267\u5e93\u4e2d\u5339\u914d\u5230\uff0c\u53ef\u80fd\u5df2\u88ab\u8fc7\u6ee4\u6216\u79fb\u9664\u3002"}
          />
        ) : null}

        {viewMode === "watchHistory" && watchHistoryState.status === "loading" && completedItems.length === 0 ? (
          <StateView type="loading" title="读取观看记录" description="正在从番剧库匹配已观毕作品。" />
        ) : null}

        {viewMode === "watchHistory" && watchHistoryState.status === "error" ? (
          <StateView
            type="error"
            title="观看记录读取失败"
            description={`${watchHistoryState.error?.code ?? "UNKNOWN"}：${watchHistoryState.error?.message ?? "请稍后重试。"}`}
            actionLabel="重试"
            onAction={() => {
              const ids = completedIdsKey ? completedIdsKey.split("\n") : [];
              void loadLocalRecordItems(ids, setWatchHistoryState, "观看记录读取失败，请稍后重试");
            }}
          />
        ) : null}

        {viewMode === "watchHistory" && completedItems.length > 0 ? (
          <ScheduleBoard
            ariaLabel={"\u89c2\u770b\u8bb0\u5f55"}
            currentSeason={currentSeason}
            description={`\u5168\u90e8\u8bb0\u5f55\u4e2d\u5171 ${completedItems.length} \u90e8\u5df2\u89c2\u6bd5`}
            items={completedItems}
            showSeasonColumn={true}
            sortMode={filters.sortMode}
            title={"\u89c2\u770b\u8bb0\u5f55"}
            userPrefs={userPrefs}
            onSortModeChange={(sortMode) => setFilters((current) => ({ ...current, sortMode }))}
          />
        ) : null}

        {viewMode === "watchHistory" && userPrefs.isLoaded && completedIdsKey.length === 0 ? (
          <StateView
            type="empty"
            title={"\u6682\u65e0\u89c2\u770b\u8bb0\u5f55"}
            description={"\u5728\u5df2\u5b8c\u7ed3\u4f5c\u54c1\u4e0a\u70b9\u51fb\u89c2\u6bd5\u540e\uff0c\u8fd9\u91cc\u4f1a\u663e\u793a\u4f60\u6807\u8bb0\u8fc7\u7684\u4f5c\u54c1\u3002"}
          />
        ) : null}

        {viewMode === "watchHistory" && completedIdsKey.length > 0 && watchHistoryState.status === "success" && completedItems.length === 0 ? (
          <StateView
            type="empty"
            title={"\u6682\u65e0\u53ef\u663e\u793a\u7684\u89c2\u770b\u8bb0\u5f55"}
            description={"\u5df2\u6807\u8bb0\u7684\u4f5c\u54c1\u672a\u5728\u5f53\u524d\u516c\u5171\u756a\u5267\u5e93\u4e2d\u5339\u914d\u5230\uff0c\u53ef\u80fd\u5df2\u88ab\u8fc7\u6ee4\u6216\u79fb\u9664\u3002"}
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
