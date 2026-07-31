import type { AnimeItem, AnimeSearchResult } from "../server/types/anime.ts";

export const DEFAULT_ANIME_SEARCH_LIMIT = 20;

export function searchAnimeItems(
  items: AnimeItem[],
  query: string,
  limit = DEFAULT_ANIME_SEARCH_LIMIT
): AnimeSearchResult[] {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return [];

  const tokens = normalizedQuery.split(" ").filter(Boolean);
  return items
    .filter(isSearchVisibleItem)
    .map((item) => {
      const titles = getTitleCandidates(item);
      const match = findBestTitleMatch(titles, normalizedQuery, tokens);
      return match ? { item, match } : null;
    })
    .filter((entry): entry is { item: AnimeItem; match: TitleMatch } => entry !== null)
    .sort((left, right) => compareSearchEntries(left, right))
    .slice(0, limit)
    .map(({ item, match }) => toSearchResult(item, match.rawTitle));
}

function isSearchVisibleItem(item: AnimeItem): boolean {
  return item.format === "tv" && item.isJapaneseAnime !== false && item.inclusionStatus !== "excluded";
}

function getTitleCandidates(item: AnimeItem): string[] {
  return [
    item.title.chinese,
    item.title.japanese,
    item.title.original,
    item.title.english,
    ...item.title.aliases
  ].filter((title): title is string => Boolean(title && title.trim()));
}

interface TitleMatch {
  rawTitle: string;
  normalizedTitle: string;
  score: number;
}

function findBestTitleMatch(titles: string[], query: string, tokens: string[]): TitleMatch | null {
  let bestMatch: TitleMatch | null = null;

  for (const rawTitle of titles) {
    const normalizedTitle = normalizeSearchText(rawTitle);
    if (!normalizedTitle) continue;

    const score = scoreTitleMatch(normalizedTitle, query, tokens);
    if (score === null) continue;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { rawTitle, normalizedTitle, score };
    }
  }

  return bestMatch;
}

function scoreTitleMatch(title: string, query: string, tokens: string[]): number | null {
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 65;

  const matchedTokens = tokens.filter((token) => title.includes(token));
  if (matchedTokens.length === tokens.length) return 45 + matchedTokens.length;
  if (matchedTokens.length > 0) return matchedTokens.length * 10;
  return null;
}

function compareSearchEntries(
  left: { item: AnimeItem; match: TitleMatch },
  right: { item: AnimeItem; match: TitleMatch }
): number {
  return (
    right.match.score - left.match.score ||
    compareSeasonForSearch(right.item, left.item) ||
    left.match.normalizedTitle.localeCompare(right.match.normalizedTitle)
  );
}

function compareSeasonForSearch(left: AnimeItem, right: AnimeItem): number {
  const leftSeason = left.primarySeason;
  const rightSeason = right.primarySeason;
  if (!leftSeason && !rightSeason) return 0;
  if (!leftSeason) return -1;
  if (!rightSeason) return 1;
  return getSeasonOrder(leftSeason) - getSeasonOrder(rightSeason);
}

function getSeasonOrder(season: NonNullable<AnimeItem["primarySeason"]>): number {
  const quarterMonth = { winter: 1, spring: 4, summer: 7, fall: 10 }[season.quarter];
  return season.year * 12 + quarterMonth;
}

function toSearchResult(item: AnimeItem, matchedTitle: string): AnimeSearchResult {
  const displayTitle = item.title.chinese || item.title.japanese || item.title.original;
  const secondaryTitle = [item.title.japanese, item.title.original, item.title.english]
    .find((title) => Boolean(title && title !== displayTitle)) ?? null;

  return {
    id: item.id,
    title: item.title,
    displayTitle,
    secondaryTitle,
    matchedTitle,
    startDate: item.startDate,
    primarySeason: item.primarySeason,
    status: item.status
  };
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/\s+/g, " ");
}
