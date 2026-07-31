"use client";

import { useEffect, useMemo, useState } from "react";

import { UserAnimeActionButton } from "./UserAnimeActionButton";
import { loadAnimeSearch } from "../lib/apiClient";
import { statusLabels } from "../lib/format";
import { getSeasonMonthByQuarter, seasonOptions } from "../lib/season";
import type { UserAnimePrefsControls } from "../lib/userAnimePrefs";
import type { AnimeSearchPayload, AnimeSearchResult, SeasonKey } from "@/src/server/types/anime";

const SEARCH_LIMIT = 12;
const MIN_SEARCH_LENGTH = 1;

export function AnimeSearch({
  refreshKey,
  userPrefs,
  onSeasonSelect
}: {
  refreshKey: string;
  userPrefs: UserAnimePrefsControls;
  onSeasonSelect: (season: SeasonKey) => void;
}) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [state, setState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    data: AnimeSearchPayload | null;
    error: string | null;
  }>({ status: "idle", data: null, error: null });

  const trimmedQuery = query.trim();
  const hasSearchText = trimmedQuery.length >= MIN_SEARCH_LENGTH;
  const reconcileAnimeStatuses = userPrefs.reconcileAnimeStatuses;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(trimmedQuery);
    }, 220);

    return () => window.clearTimeout(timer);
  }, [trimmedQuery]);

  useEffect(() => {
    if (debouncedQuery.length < MIN_SEARCH_LENGTH) {
      setState({ status: "idle", data: null, error: null });
      return;
    }

    let active = true;
    setState((current) => ({ ...current, status: "loading", error: null }));

    void loadAnimeSearch({ query: debouncedQuery, limit: SEARCH_LIMIT })
      .then((data) => {
        if (!active) return;
        reconcileAnimeStatuses(data.results);
        setState({ status: "success", data, error: null });
      })
      .catch((error) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : "搜索失败，请稍后重试";
        setState({ status: "error", data: null, error: message });
      });

    return () => {
      active = false;
    };
  }, [debouncedQuery, refreshKey, reconcileAnimeStatuses]);

  const resultCountText = useMemo(() => {
    if (!hasSearchText) return "输入番剧名称后开始搜索";
    if (state.status === "loading") return "搜索中";
    if (state.status === "success") return `找到 ${state.data?.results.length ?? 0} 部`;
    if (state.status === "error") return "搜索暂不可用";
    return "准备搜索";
  }, [hasSearchText, state.data?.results.length, state.status]);

  return (
    <details className="animeSearch" aria-label="番剧搜索">
      <summary className="toolSummary">
        <span className="toolSummaryTitle">番剧搜索</span>
        <span className="toolSummaryText">{resultCountText}</span>
        <span aria-hidden="true" className="toolSummaryIcon" />
      </summary>

      <div className="searchBody">
        <div className="searchField">
          <label htmlFor="anime-search-input">搜索名称</label>
          <div className="searchInputWrap">
            <input
              autoComplete="off"
              id="anime-search-input"
              placeholder="输入中文、日文、英文或别名"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query ? (
              <button
                aria-label="清除搜索"
                className="searchClearButton"
                type="button"
                onClick={() => setQuery("")}
              >
                清除
              </button>
            ) : null}
          </div>
        </div>

        {hasSearchText ? (
          <div className="searchResults" aria-live="polite">
            {state.status === "loading" ? <SearchHint text="正在检索番剧库" /> : null}
            {state.status === "error" ? <SearchHint tone="danger" text={state.error ?? "搜索失败，请稍后重试"} /> : null}
            {state.status === "success" && state.data?.results.length === 0 ? (
              <SearchHint text="没有找到相关番剧，可以换一个标题或别名试试。" />
            ) : null}
            {state.status === "success" && state.data && state.data.results.length > 0 ? (
              <ul>
                {state.data.results.map((item) => (
                  <SearchResultItem
                    item={item}
                    key={item.id}
                    userPrefs={userPrefs}
                    onSeasonSelect={onSeasonSelect}
                  />
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function SearchResultItem({
  item,
  userPrefs,
  onSeasonSelect
}: {
  item: AnimeSearchResult;
  userPrefs: UserAnimePrefsControls;
  onSeasonSelect: (season: SeasonKey) => void;
}) {
  const canJump = item.primarySeason !== null;

  return (
    <li>
      <div className="searchResultRow">
        <button
          className="searchResultJump"
          disabled={!canJump}
          type="button"
          onClick={() => {
            if (item.primarySeason) onSeasonSelect(item.primarySeason);
          }}
        >
          <span className="searchResultMain">
            <strong>{item.displayTitle}</strong>
            <span>
              {item.secondaryTitle ? `${item.secondaryTitle} / ` : ""}
              {statusLabels[item.status]}
            </span>
            {item.matchedTitle !== item.displayTitle ? <small>匹配：{item.matchedTitle}</small> : null}
          </span>
          <span className="searchSeasonBadge">{formatSearchSeason(item.primarySeason)}</span>
        </button>
        <span className="searchResultAction">
          <UserAnimeActionButton item={item} userPrefs={userPrefs} />
        </span>
      </div>
    </li>
  );
}

function SearchHint({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "danger" }) {
  return (
    <div className="searchHint" data-tone={tone}>
      {text}
    </div>
  );
}

function formatSearchSeason(season: SeasonKey | null): string {
  if (!season) return "季度待确认";
  const label = seasonOptions.find((option) => option.value === getSeasonMonthByQuarter(season.quarter))?.label ?? "未知季度";
  return `${season.year}年 ${label}`;
}
