import { readFile } from "node:fs/promises";

import {
  hasExplicitNonJapaneseSignal,
  hasForeignPrimaryTitleSignal,
  hasKnownNonTvSpecialSignal,
  hasOverSeasonLimitSignal,
  hasTheatricalMovieSignal,
  normalizeContentText
} from "../src/server/anime/contentRules.ts";
import { validateAnimeCache } from "../src/server/anime/validateAnime.ts";
import type { AnimeCache, AnimeItem } from "../src/server/types/anime.ts";

interface AuditEntry {
  id: string;
  title: string;
  season: string;
  format: AnimeItem["format"];
  status: AnimeItem["status"];
  subjectId: number | null;
}

const ADULT_PATTERN = /(r-?18|18\+|nsfw|adult|sex)/iu;

const cache = JSON.parse(await readFile("data/anime.json", "utf8")) as AnimeCache;
const items = Array.isArray(cache.items) ? cache.items : [];
const validationIssues = validateAnimeCache(cache);

const buckets = {
  nonTv: items.filter((item) => item.format !== "tv"),
  nonJapaneseFlag: items.filter((item) => item.isJapaneseAnime === false),
  excludedStatus: items.filter((item) => item.inclusionStatus === "excluded"),
  hiddenInclusionStatus: items.filter((item) => item.inclusionStatus !== "included"),
  theatricalMovieSignal: items.filter((item) => hasTheatricalMovieSignal(getTextValues(item))),
  knownNonTvSpecialSignal: items.filter((item) => hasKnownNonTvSpecialSignal(getTextValues(item))),
  overSeasonLimitSignal: items.filter((item) => hasOverSeasonLimitSignal(getTextValues(item))),
  explicitForeignSignal: items.filter((item) =>
    hasExplicitNonJapaneseSignal(getTextValues(item)) || hasForeignPrimaryTitleSignal(item.title.original)
  ),
  adultSignal: items.filter((item) => ADULT_PATTERN.test(getTextValues(item).filter(Boolean).join(" "))),
  finishedWithUpdateSlot: items.filter((item) =>
    (item.status === "finished" || item.status === "cancelled") &&
    (item.updateTime !== null || item.updateWeekday !== null)
  ),
  airedEpisodeOverTotal: items.filter((item) =>
    item.episodeCount !== null &&
    item.airedEpisodeCount !== null &&
    item.airedEpisodeCount > item.episodeCount
  ),
  missingSources: items.filter((item) => !Array.isArray(item.sources) || item.sources.length === 0),
  missingCover: items.filter((item) => !hasCover(item)),
  missingBangumiSubject: items.filter((item) => getSubjectId(item) === null),
  missingBangumiRating: items.filter((item) => item.bangumi.rating === null)
};

const duplicateIds = collectDuplicates(items, (item) => item.id);
const duplicateSubjectIds = collectSubjectDuplicates(items);
const duplicateSubjectIdsSameSeason = duplicateSubjectIds.filter((group) => {
  const seasons = new Set(group.items.map((item) => item.season));
  return seasons.size < group.items.length;
});
const duplicateTitleSeason = collectDuplicates(items, (item) => `${getSeasonLabel(item)}|${getTitleKey(item)}`)
  .filter((group) => group.key.split("|")[1] !== "");
const sourceCounts = collectSourceCounts(items);
const schemaSummary = summarizeValidationIssues();

const blockingBucketNames = [
  "nonTv",
  "nonJapaneseFlag",
  "excludedStatus",
  "theatricalMovieSignal",
  "knownNonTvSpecialSignal",
  "overSeasonLimitSignal",
  "explicitForeignSignal",
  "adultSignal",
  "finishedWithUpdateSlot",
  "airedEpisodeOverTotal",
  "missingSources",
  "missingCover"
] as const;

const blockingBusinessIssues =
  blockingBucketNames.reduce((count, key) => count + buckets[key].length, 0) +
  duplicateIds.length +
  duplicateSubjectIdsSameSeason.length +
  duplicateTitleSeason.length;
const blockingSchemaIssues = validationIssues.filter((issue) => issue.severity === "error").length;

const report = {
  total: items.length,
  schema: {
    issues: validationIssues.length,
    errors: blockingSchemaIssues,
    warnings: validationIssues.filter((issue) => issue.severity === "warning").length,
    summary: schemaSummary
  },
  business: Object.fromEntries(
    Object.entries(buckets).map(([key, value]) => [
      key,
      {
        count: value.length,
        examples: value.slice(0, 40).map(toEntry)
      }
    ])
  ),
  duplicates: {
    ids: duplicateIds.map(formatDuplicateGroup),
    subjectIds: duplicateSubjectIds,
    subjectIdsSameSeason: duplicateSubjectIdsSameSeason,
    titleSeason: duplicateTitleSeason.map(formatDuplicateGroup)
  },
  sources: sourceCounts,
  result: {
    blockingSchemaIssues,
    blockingBusinessIssues,
    acceptedWarnings: {
      missingBangumiSubject: buckets.missingBangumiSubject.length,
      missingBangumiRating: buckets.missingBangumiRating.length,
      duplicateSubjectIds: duplicateSubjectIds.length,
      duplicateSubjectIdsSameSeason: duplicateSubjectIdsSameSeason.length,
      duplicateTitleSeason: duplicateTitleSeason.length
    }
  }
};

console.log(JSON.stringify(report, null, 2));

if (blockingSchemaIssues > 0 || blockingBusinessIssues > 0) {
  process.exitCode = 1;
}

function getTextValues(item: AnimeItem): Array<string | null | undefined> {
  return [
    item.title.original,
    item.title.japanese,
    item.title.chinese,
    item.title.english,
    ...item.title.aliases,
    item.officialUrl,
    item.exclusionReason
  ];
}

function getSubjectId(item: AnimeItem): number | null {
  return item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId;
}

function getTitle(item: AnimeItem): string {
  return item.title.chinese ?? item.title.japanese ?? item.title.original ?? item.title.english ?? item.id;
}

function getSeasonLabel(item: AnimeItem): string {
  if (item.primarySeason === null) return "unknown";
  return `${item.primarySeason.year}-${item.primarySeason.quarter}`;
}

function getTitleKey(item: AnimeItem): string {
  return normalizeContentText(getTitle(item)).replace(/[\s!"'`()[\]{}<>.,:;?/\\_-]+/gu, "");
}

function hasCover(item: AnimeItem): boolean {
  return Boolean(item.coverImage?.large ?? item.coverImage?.medium ?? item.coverImage?.small);
}

function toEntry(item: AnimeItem): AuditEntry {
  return {
    id: item.id,
    title: getTitle(item),
    season: getSeasonLabel(item),
    format: item.format,
    status: item.status,
    subjectId: getSubjectId(item)
  };
}

function collectDuplicates<T>(values: T[], keyOf: (value: T) => string): Array<{ key: string; items: T[] }> {
  const map = new Map<string, T[]>();
  for (const value of values) {
    const key = keyOf(value);
    const group = map.get(key) ?? [];
    group.push(value);
    map.set(key, group);
  }
  return [...map.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({ key, items: group }));
}

function collectSubjectDuplicates(items: AnimeItem[]) {
  return collectDuplicates(
    items.filter((item) => getSubjectId(item) !== null),
    (item) => String(getSubjectId(item))
  ).map((group) => ({
    subjectId: Number(group.key),
    count: group.items.length,
    items: group.items.map(toEntry)
  }));
}

function formatDuplicateGroup(group: { key: string; items: AnimeItem[] }) {
  return {
    key: group.key,
    count: group.items.length,
    items: group.items.map(toEntry)
  };
}

function collectSourceCounts(items: AnimeItem[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    for (const source of item.sources) {
      counts[source.name] = (counts[source.name] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1]));
}

function summarizeValidationIssues(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of validationIssues) {
    const key = `${issue.severity}:${issue.code}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort());
}
