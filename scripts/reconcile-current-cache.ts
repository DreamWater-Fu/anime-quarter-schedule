import { readFile, readdir } from "node:fs/promises";

import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  inferUpdateWeekday
} from "../src/server/anime/calculateSeason.ts";
import { isCacheEligibleAnime } from "../src/server/anime/cacheEligibility.ts";
import {
  hasExplicitExcludedBangumiSubjectId,
  hasExplicitNonJapaneseMetadataSignal,
  hasExplicitNonJapaneseSignal,
  hasForeignPrimaryTitleSignal,
  hasKnownNonTvSpecialSignal,
  hasOverSeasonLimitSignal,
  hasTheatricalMovieSignal,
  repairMojibakeText
} from "../src/server/anime/contentRules.ts";
import { clearFinalStatusBroadcastSlot } from "../src/server/anime/normalizeAnime.ts";
import { getDefaultStorage } from "../src/server/cache/jsonFileStorage.ts";
import {
  mapYourAnimesReferenceToAnimeItem,
  parseYourAnimesHtml
} from "../src/server/sources/youranimes/adapter.ts";
import type { AnimeCache, AnimeItem, AnimeSource } from "../src/server/types/anime.ts";
import type { BangumiSubject } from "../src/server/sources/bangumi/types.ts";

const ADULT_PATTERN = /(r-?18|18\+|nsfw|adult|アダルト|成人|里番|裏番|僧侣档|僧侶枠|オンエア版|無修正|av女优|av女優|セックス|sex)/iu;

interface ManualBroadcastOverride {
  id: string;
  beijingDate: string;
  beijingTime: string;
  sourceName: string;
  sourceUrl: string;
  note?: string;
}

async function main() {
  const storage = getDefaultStorage();
  const cache = await storage.readAnimeCache();
  const now = new Date().toISOString();
  const references = await readYourAnimesReferences(now);
  const manualOverrides = await readManualBroadcastOverrides();
  const byBangumiId = new Map<number, AnimeItem>();
  const byTitle = new Map<string, AnimeItem>();
  for (const item of references) {
    const subjectId = item.bangumi.subjectId;
    if (subjectId !== null && item.updateTime !== null) byBangumiId.set(subjectId, item);
    for (const title of getTitleKeys(item)) {
      if (item.updateTime !== null && !byTitle.has(title)) byTitle.set(title, item);
    }
  }

  let removed = 0;
  let retagged = 0;
  let filledTimes = 0;
  let manualFilled = 0;
  let clearedFinalSlots = 0;
  const nextItems: AnimeItem[] = [];

  for (const item of cache.items) {
    if (!isCacheEligibleAnime(item) || isUnmatchedReferenceOnlyItem(item)) {
      removed += 1;
      continue;
    }

    const retaggedItem = normalizeSeasonTags(item);
    if (JSON.stringify(retaggedItem.primarySeason) !== JSON.stringify(item.primarySeason)) retagged += 1;

    const reference = findReference(retaggedItem, byBangumiId, byTitle);
    const merged = reference ? mergeReferenceTime(retaggedItem, reference) : retaggedItem;
    const override = manualOverrides.get(merged.id);
    const finalized = override ? applyManualBroadcastOverride(merged, override, now) : merged;
    const normalizedFinal = clearFinalStatusBroadcastSlot(finalized);
    if (item.updateTime === null && merged.updateTime !== null) filledTimes += 1;
    if (override && merged.updateTime !== finalized.updateTime) manualFilled += 1;
    if (
      (finalized.updateTime !== normalizedFinal.updateTime) ||
      (finalized.updateWeekday !== normalizedFinal.updateWeekday)
    ) {
      clearedFinalSlots += 1;
    }
    nextItems.push(normalizedFinal);
  }

  const dedupedItems = removeSameSeasonSecondarySubjectDuplicates(nextItems);
  const nextCache: AnimeCache = {
    ...cache,
    updatedAt: now,
    generatedBy: "manual-update",
    items: dedupedItems
  };

  await storage.writeAnimeCache(nextCache);
  const status = await storage.readUpdateStatus();
  await storage.writeUpdateStatus({
    ...status,
    status: "success",
    lastSuccessAt: now,
    lastError: null,
    currentJob: null,
    cache: {
      animeUpdatedAt: now,
      itemCount: dedupedItems.length
    }
  });

  console.log(JSON.stringify({
    removed,
    retagged,
    filledTimes,
    manualFilled,
    clearedFinalSlots,
    removedDuplicateSubjects: nextItems.length - dedupedItems.length,
    written: dedupedItems.length
  }, null, 2));
}

function removeSameSeasonSecondarySubjectDuplicates(items: AnimeItem[]): AnimeItem[] {
  const groups = new Map<string, AnimeItem[]>();
  for (const item of items) {
    const subjectId = item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId;
    if (subjectId === null || item.primarySeason === null) continue;
    const key = `${subjectId}:${item.primarySeason.year}:${item.primarySeason.quarter}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  const removeIds = new Set<string>();
  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const keeper = group.toSorted(compareDuplicateSubjectCandidate)[0];
    for (const item of group) {
      if (item !== keeper) removeIds.add(item.id);
    }
  }

  return items.filter((item) => !removeIds.has(item.id));
}

function compareDuplicateSubjectCandidate(left: AnimeItem, right: AnimeItem): number {
  return (
    scoreDuplicateSubjectCandidate(right) - scoreDuplicateSubjectCandidate(left) ||
    left.id.localeCompare(right.id)
  );
}

function scoreDuplicateSubjectCandidate(item: AnimeItem): number {
  let score = 0;
  if (item.sources.some((source) => source.name === "YucWiki")) score += 100;
  if (item.sources.some((source) => source.name === "Bangumi")) score += 20;
  if (item.sources.some((source) => source.name === "YourAnimes")) score += 10;
  if (item.id.startsWith("anime:yucwiki:")) score += 5;
  if (item.coverImage !== null) score += 2;
  if (item.bangumi.rating !== null) score += 2;
  return score;
}

async function readYourAnimesReferences(retrievedAt: string): Promise<AnimeItem[]> {
  const items: AnimeItem[] = [];
  for (const season of ["202601", "202604", "202607", "202610"]) {
    try {
      const file = `data/youranimes-${season}.html`;
      const html = await readFile(file, "utf8");
      const entries = parseYourAnimesHtml(html, { url: file, retrievedAt });
      for (const entry of entries) {
        const item = mapYourAnimesReferenceToAnimeItem(entry, retrievedAt);
        if (item) items.push(item);
      }
    } catch {
      // Local snapshots are optional; the online adapter can still run during updates.
    }
  }
  return items;
}

async function readManualBroadcastOverrides(): Promise<Map<string, ManualBroadcastOverride>> {
  try {
    const raw = await readFile("data/manual-broadcast-overrides.json", "utf8");
    const parsed = JSON.parse(raw) as { overrides?: ManualBroadcastOverride[] };
    return new Map((parsed.overrides ?? []).map((item) => [item.id, item]));
  } catch {
    return new Map();
  }
}

async function readBangumiSubjectSnapshots(): Promise<Map<number, BangumiSubject>> {
  const result = new Map<number, BangumiSubject>();
  let files: string[] = [];
  try {
    files = await readdir("data");
  } catch {
    return result;
  }

  for (const file of files) {
    if (!/^bangumi-\d{6}-subjects\.json$/u.test(file)) continue;
    try {
      const parsed = JSON.parse(await readFile(`data/${file}`, "utf8")) as BangumiSubject[];
      for (const subject of parsed) {
        if (Number.isInteger(subject.id)) result.set(subject.id, subject);
      }
    } catch {
      // Corrupt or incomplete local snapshots should not block cache cleanup.
    }
  }
  return result;
}

function isExplicitExcludedBangumiSubject(item: AnimeItem): boolean {
  return hasExplicitExcludedBangumiSubjectId(item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId);
}

function isExplicitNonJapanese(item: AnimeItem, bangumiSubjects: Map<number, BangumiSubject>): boolean {
  const textValues = getAnimeTextValues(item);
  const subjectId = item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId;
  const subject = subjectId !== null ? bangumiSubjects.get(subjectId) : null;
  return (
    hasExplicitNonJapaneseSignal(textValues) ||
    hasForeignPrimaryTitleSignal(item.title.original) ||
    (subject !== null && subject !== undefined && (
      hasExplicitNonJapaneseSignal(getBangumiTitleValues(subject)) ||
      hasForeignPrimaryTitleSignal(subject.name) ||
      hasExplicitNonJapaneseMetadataSignal([...getBangumiMetadataValues(subject), ...getBangumiTitleValues(subject)])
    ))
  );
}

function isTheatricalMovie(item: AnimeItem): boolean {
  return hasTheatricalMovieSignal(getAnimeTextValues(item));
}

function isKnownNonTvSpecial(item: AnimeItem): boolean {
  return hasKnownNonTvSpecialSignal(getAnimeTextValues(item));
}

function isOverSeasonLimit(item: AnimeItem): boolean {
  return hasOverSeasonLimitSignal(getAnimeTextValues(item));
}

function getAnimeTextValues(item: AnimeItem): Array<string | null | undefined> {
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

function getBangumiTitleValues(subject: BangumiSubject): Array<string | null | undefined> {
  return [
    subject.name,
    subject.name_cn,
    ...extractStringListFromInfobox(subject, ["别名", "別名", "aliases", "Alias", "英文名", "English"])
  ];
}

function getBangumiMetadataValues(subject: BangumiSubject): Array<string | null | undefined> {
  return [
    ...extractBangumiTagNames(subject),
    ...extractStringListFromInfobox(subject, [
      "国家",
      "国家/地区",
      "地区",
      "产地",
      "製作国",
      "制作国",
      "制作国家",
      "动画制作国家",
      "Country"
    ])
  ];
}

function extractBangumiTagNames(subject: BangumiSubject): string[] {
  if (!Array.isArray(subject.tags)) return [];
  return subject.tags
    .map((tag) => tag.name)
    .filter((value): value is string => typeof value === "string")
    .map((value) => repairMojibakeText(value).trim())
    .filter(Boolean);
}

function extractStringListFromInfobox(subject: BangumiSubject, keys: string[]): string[] {
  if (!Array.isArray(subject.infobox)) return [];
  const normalizedKeys = new Set(keys.map((key) => repairMojibakeText(key).normalize("NFKC").trim().toLowerCase()));
  const result: string[] = [];

  for (const item of subject.infobox) {
    const key = typeof item.key === "string"
      ? repairMojibakeText(item.key).normalize("NFKC").trim().toLowerCase()
      : null;
    if (!key || !normalizedKeys.has(key)) continue;
    result.push(...unknownToStrings(item.value));
  }

  return [...new Set(result.map((value) => repairMojibakeText(value).trim()).filter(Boolean))];
}

function unknownToStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(unknownToStrings);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.v === "string") return [record.v];
    if (typeof record.value === "string") return [record.value];
  }
  return [];
}

function isUnmatchedReferenceOnlyItem(item: AnimeItem): boolean {
  const hasBangumiIdentity = item.bangumi.subjectId !== null || item.externalIds.bangumiSubjectId !== null;
  if (hasBangumiIdentity) return false;
  return item.sources.some((source) => source.name === "Bahamut Anime Crazy" || source.name === "YourAnimes");
}

function normalizeSeasonTags(item: AnimeItem): AnimeItem {
  const primarySeason = calculatePrimarySeason(item.startDate);
  return {
    ...item,
    primarySeason,
    activeSeasons: calculateActiveSeasons({
      schedule: item.schedule,
      fallbackPrimarySeason: primarySeason
    })
  };
}

function mergeReferenceTime(item: AnimeItem, reference: AnimeItem): AnimeItem {
  if (item.status === "finished" || item.status === "cancelled") return item;
  if (reference.updateTime === null || reference.schedule[0] === undefined) return item;
  const source = reference.sources[0];
  const schedule = item.schedule.map((scheduleItem) => ({
    ...scheduleItem,
    airTime: reference.updateTime,
    timezone: "Asia/Shanghai" as const,
    source: source ?? scheduleItem.source
  }));
  if (schedule.length === 0) schedule.push(reference.schedule[0]);

  return {
    ...item,
    startDate: reference.startDate ?? item.startDate,
    primarySeason: reference.primarySeason ?? item.primarySeason,
    activeSeasons: calculateActiveSeasons({
      schedule,
      fallbackPrimarySeason: reference.primarySeason ?? item.primarySeason
    }),
    updateWeekday: inferUpdateWeekday({
      updateWeekday: reference.updateWeekday,
      schedule,
      startDate: reference.startDate ?? item.startDate
    }),
    updateTime: reference.updateTime,
    timezone: "Asia/Shanghai",
    schedule,
    sources: source ? dedupeSources([...item.sources, source]) : item.sources,
    updatedAt: reference.updatedAt
  };
}

function applyManualBroadcastOverride(
  item: AnimeItem,
  override: ManualBroadcastOverride,
  retrievedAt: string
): AnimeItem {
  const source: AnimeSource = {
    name: override.sourceName,
    type: "manual",
    url: override.sourceUrl,
    retrievedAt,
    confidence: 0.95,
    scope: "japan_broadcast"
  };
  const schedule = normalizeScheduleToBeijing(item, override, source);
  const primarySeason = calculatePrimarySeason(override.beijingDate);

  return {
    ...item,
    startDate: override.beijingDate,
    primarySeason,
    activeSeasons: calculateActiveSeasons({ schedule, fallbackPrimarySeason: primarySeason }),
    updateWeekday: inferUpdateWeekday({
      schedule,
      startDate: override.beijingDate
    }),
    updateTime: override.beijingTime,
    timezone: "Asia/Shanghai",
    schedule,
    sources: dedupeSources([...item.sources, source]),
    dataStatus: item.dataStatus === "complete" ? item.dataStatus : "partial",
    updatedAt: retrievedAt
  };
}

function normalizeScheduleToBeijing(
  item: AnimeItem,
  override: ManualBroadcastOverride,
  source: AnimeSource
): AnimeItem["schedule"] {
  const shiftDays = getDateShiftDays(item.startDate, override.beijingDate);
  const schedule = item.schedule.length > 0
    ? item.schedule.map((scheduleItem) => ({
        ...scheduleItem,
        airDate: shiftDate(scheduleItem.airDate, shiftDays),
        airTime: override.beijingTime,
        timezone: "Asia/Shanghai" as const,
        source,
        rawTimeText: override.note ?? scheduleItem.rawTimeText ?? null
      }))
    : [
        {
          episodeNumber: 1,
          episodeTitle: null,
          airDate: override.beijingDate,
          airTime: override.beijingTime,
          timezone: "Asia/Shanghai" as const,
          status: "confirmed" as const,
          source,
          rawTimeText: override.note ?? null
        }
      ];

  return dedupeSchedule(schedule);
}

function getDateShiftDays(oldDate: string | null, newDate: string): number {
  if (!oldDate) return 0;
  const oldTime = Date.parse(`${oldDate}T00:00:00Z`);
  const newTime = Date.parse(`${newDate}T00:00:00Z`);
  if (!Number.isFinite(oldTime) || !Number.isFinite(newTime)) return 0;
  return Math.round((newTime - oldTime) / 86_400_000);
}

function shiftDate(date: string, shiftDays: number): string {
  if (shiftDays === 0) return date;
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return date;
  return new Date(time + shiftDays * 86_400_000).toISOString().slice(0, 10);
}

function findReference(
  item: AnimeItem,
  byBangumiId: Map<number, AnimeItem>,
  byTitle: Map<string, AnimeItem>
): AnimeItem | null {
  if (item.bangumi.subjectId !== null) {
    const byId = byBangumiId.get(item.bangumi.subjectId);
    if (byId) return byId;
  }

  for (const title of getTitleKeys(item)) {
    const match = byTitle.get(title);
    if (match) return match;
  }
  return null;
}

function getTitleKeys(item: AnimeItem): string[] {
  return [
    item.title.original,
    item.title.japanese,
    item.title.chinese,
    item.title.english,
    ...item.title.aliases
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map(normalizeTitleForMerge)
    .filter(Boolean);
}

function normalizeTitleForMerge(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[!"'`()[\]{}<>.,:;?/\u3000\u3001\u3002\u300c\u300d\u300e\u300f\u300a\u300b\s_-]+/gu, "");
}

function dedupeSchedule(schedule: AnimeItem["schedule"]): AnimeItem["schedule"] {
  const seen = new Set<string>();
  const result: AnimeItem["schedule"] = [];
  for (const item of schedule) {
    const key = `${item.episodeNumber ?? "?"}:${item.airDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result.sort((left, right) => left.airDate.localeCompare(right.airDate));
}

function dedupeSources(sources: AnimeSource[]): AnimeSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.name}:${source.type}:${source.url ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
