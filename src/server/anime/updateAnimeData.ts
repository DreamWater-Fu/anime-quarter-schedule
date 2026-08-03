import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { getDefaultStorage } from "../cache/jsonFileStorage.ts";
import { normalizeStaleUpdateStatus } from "../cache/statusCache.ts";
import type { AnimeStorage } from "../cache/storage.ts";
import { toSourceIssue, type AnimeSourceAdapter, type SourceIssue } from "../sources/types.ts";
import { BangumiSourceAdapter } from "../sources/bangumi/adapter.ts";
import { enrichMissingBangumiBySearch, refreshBangumiDetailsForItems } from "../sources/bangumi/searchEnrichment.ts";
import { YucWikiSourceAdapter } from "../sources/yucwiki/adapter.ts";
import { YourAnimesSourceAdapter } from "../sources/youranimes/adapter.ts";
import type { AnimeCache, AnimeItem, SeasonKey, SeasonMonth } from "../types/anime.ts";
import type { PublicApiError, UpdateInput, UpdateResult, UpdateStatusPayload, UpdateSummary } from "../types/api.ts";
import { ApiErrorException, toPublicApiError } from "../utils/errors.ts";
import { hasBlockingValidationIssues, validateAnimeCache } from "./validateAnime.ts";
import { clearFinalStatusBroadcastSlot } from "./normalizeAnime.ts";
import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  inferUpdateWeekday,
  isSeasonMonth,
  seasonKeyEquals,
  seasonMonthToQuarter
} from "./calculateSeason.ts";
import {
  hasExplicitExcludedBangumiSubjectId,
  hasExplicitNonJapaneseSignal,
  hasForeignPrimaryTitleSignal,
  hasKnownNonTvSpecialSignal,
  hasOverSeasonLimitSignal,
  hasTheatricalMovieSignal
} from "./contentRules.ts";

export interface UpdateAnimeDataOptions {
  storage?: AnimeStorage;
  adapters?: AnimeSourceAdapter[];
  now?: () => Date;
}

interface ManualBroadcastOverride {
  id: string;
  beijingDate: string;
  beijingTime: string;
  sourceName: string;
  sourceUrl: string;
  note?: string;
}

let runningInProcess = false;

export async function updateAnimeData(input: UpdateInput, options: UpdateAnimeDataOptions = {}): Promise<UpdateResult> {
  assertUpdateInput(input);

  if (runningInProcess && !input.force) {
    throw new ApiErrorException("UPDATE_RUNNING", "another update job is already running", { status: 409 });
  }

  const storage = options.storage ?? getDefaultStorage();
  const now = options.now ?? (() => new Date());
  const quarter = seasonMonthToQuarter(input.season);
  const startedAt = now().toISOString();
  const jobId = `upd_${startedAt.replace(/\D/g, "").slice(0, 14)}_${randomUUID().slice(0, 8)}`;
  const job = { jobId, year: input.year, season: input.season, quarter, startedAt };

  const currentStatus = await storage.readUpdateStatus();
  const lockStatus = normalizeStaleUpdateStatus(currentStatus, now);
  if (lockStatus.status === "running" && !input.force) {
    throw new ApiErrorException("UPDATE_RUNNING", "another update job is already running", { status: 409 });
  }

  runningInProcess = true;
  const oldCache = await storage.readAnimeCache();
  await storage.writeUpdateStatus({
    ...lockStatus,
    schemaVersion: 1,
    status: "running",
    lastAttemptAt: startedAt,
    lastError: null,
    currentJob: job,
    cache: {
      animeUpdatedAt: oldCache.updatedAt,
      itemCount: oldCache.items.length
    }
  });

  try {
    const adapters = options.adapters ?? createDefaultAdapters();
    const fetched = await fetchSeasonCandidates(adapters, {
      year: input.year,
      season: input.season,
      quarter,
      now: now()
    });

    const targetSeason: SeasonKey = { year: input.year, quarter };
    const normalizedItems = fetched.items.map((item) => normalizeFetchedItem(item, now().toISOString()));
    const seasonCandidates = mergeDuplicateItems(normalizedItems).filter((item) => isPrimaryInSeason(item, targetSeason));
    const hasPrimaryCatalogCandidates = seasonCandidates.some((item) => isPrimaryCatalogItem(item) && isCacheEligibleAnime(item));
    const hasCatalogCandidates = seasonCandidates.some((item) => isCatalogItem(item) && isCacheEligibleAnime(item));
    const targetItems = seasonCandidates
      .filter((item) => !shouldDropSecondaryCatalogItem(item, hasPrimaryCatalogCandidates))
      .filter((item) => !shouldDropReferenceOnlyItem(item, oldCache.items, !hasCatalogCandidates))
      .map(markReferenceColdStartItem);
    let eligibleTargetItems = targetItems.filter(isCacheEligibleAnime);
    if (shouldRunBangumiSearchEnrichment(options, eligibleTargetItems)) {
      const enrichment = await enrichMissingBangumiBySearch(eligibleTargetItems, { now });
      eligibleTargetItems = enrichment.items;
      if (enrichment.failed > 0) {
        fetched.warnings.push({
          source: "Bangumi",
          code: "NETWORK_FAILED",
          message: `Bangumi search enrichment failed for ${enrichment.failed} items`,
          retryable: true
        });
      }
    }
    const fallbackSeasonItems = getOldSeasonItems(oldCache.items, targetSeason);
    if (shouldFailWeakHistoricalCatalogRefresh(fetched.warnings, eligibleTargetItems, targetSeason, now())) {
      throw new ApiErrorException("SOURCE_UNAVAILABLE", "historical season primary catalog was unavailable and fallback candidates were incomplete", {
        status: 503,
        details: {
          targetSeason,
          candidateCount: eligibleTargetItems.length,
          warnings: fetched.warnings
        }
      });
    }
    if (shouldFailUnenrichedHistoricalPrimaryCatalog(fetched.warnings, eligibleTargetItems, targetSeason, now())) {
      throw new ApiErrorException("SOURCE_UNAVAILABLE", "historical season Bangumi enrichment was unavailable and would write bare catalog items", {
        status: 503,
        details: {
          targetSeason,
          candidateCount: eligibleTargetItems.length,
          warnings: fetched.warnings
        }
      });
    }
    if (shouldFailEmptyUpdate(fetched.warnings, eligibleTargetItems, fallbackSeasonItems)) {
      throw new ApiErrorException("SOURCE_UNAVAILABLE", "target season has no cached items and external sources did not return usable data", {
        status: 503,
        details: {
          targetSeason,
          warnings: fetched.warnings
        }
      });
    }
    const hasCatalogItems = eligibleTargetItems.some(isCatalogItem);
    const nextSeasonItems = hasCatalogItems
      ? eligibleTargetItems
      : mergeDuplicateItems([...fallbackSeasonItems, ...eligibleTargetItems]);
    const skippedNonJapanese = targetItems.length - eligibleTargetItems.length;
    const manualOverrides = await readManualBroadcastOverrides();
    let mergedItems = mergeDuplicateItems(
      nextSeasonItems.map((item) =>
        applyManualBroadcastOverride(mergeWithOldItem(item, oldCache.items), manualOverrides, now().toISOString())
      )
    );
    if (shouldRunBangumiDetailRefresh(options, mergedItems)) {
      const detailRefresh = await refreshBangumiDetailsForItems(mergedItems, { now });
      mergedItems = detailRefresh.items;
      if (detailRefresh.failed > 0) {
        fetched.warnings.push({
          source: "Bangumi",
          code: "NETWORK_FAILED",
          message: `Bangumi detail refresh failed for ${detailRefresh.failed} items`,
          retryable: true
        });
      }
    }
    const nextCache = mergeSeasonIntoCache(oldCache, mergedItems, targetSeason, now().toISOString());
    const validationIssues = validateAnimeCache(nextCache);
    if (hasBlockingValidationIssues(validationIssues)) {
      throw new ApiErrorException("CACHE_VALIDATION_FAILED", "updated anime cache failed schema validation", {
        status: 500,
        details: validationIssues.filter((issue) => issue.severity === "error")
      });
    }
    const summary = summarizeUpdate(mergedItems, nextCache, skippedNonJapanese);

    await storage.writeAnimeCache(nextCache);

    const finishedAt = now().toISOString();
    const result: UpdateResult = {
      jobId,
      status: "success",
      year: input.year,
      season: input.season,
      quarter,
      startedAt,
      finishedAt,
      summary,
      warnings: fetched.warnings
    };

    await storage.writeUpdateStatus(createSuccessStatus(lockStatus, job, nextCache, finishedAt));
    await storage.appendUpdateLog({
      jobId,
      at: finishedAt,
      level: "info",
      event: "update_success",
      summary
    });

    if (fetched.warnings.length > 0) {
      await storage.appendUpdateLog({
        jobId,
        at: finishedAt,
        level: "info",
        event: "source_warnings",
        error: {
          code: "SOURCE_PARTIAL",
          message: "one or more optional sources returned warnings",
          details: fetched.warnings
        }
      });
    }

    return result;
  } catch (error) {
    const failedAt = now().toISOString();
    const publicError = toPublicApiError(error);
    await storage.writeUpdateStatus(createFailedStatus(lockStatus, job, oldCache, failedAt, publicError));
    await storage.appendUpdateLog({
      jobId,
      at: failedAt,
      level: "error",
      event: "update_failed",
      error: publicError
    });
    throw error;
  } finally {
    runningInProcess = false;
  }
}

function createDefaultAdapters(): AnimeSourceAdapter[] {
  return [new YucWikiSourceAdapter(), new BangumiSourceAdapter(), new YourAnimesSourceAdapter()];
}

async function readManualBroadcastOverrides(): Promise<Map<string, ManualBroadcastOverride>> {
  const file = process.env.MANUAL_BROADCAST_OVERRIDES_FILE || "data/manual-broadcast-overrides.json";
  try {
    const raw = await readFile(resolve(/* turbopackIgnore: true */ process.cwd(), file), "utf8");
    const parsed = JSON.parse(raw) as { overrides?: ManualBroadcastOverride[] };
    return new Map((parsed.overrides ?? []).map((item) => [item.id, item]));
  } catch {
    return new Map();
  }
}

function applyManualBroadcastOverride(
  item: AnimeItem,
  overrides: Map<string, ManualBroadcastOverride>,
  retrievedAt: string
): AnimeItem {
  if (isFinalStatus(item.status)) return item;
  const override = overrides.get(item.id);
  if (!override) return item;

  const source = {
    name: override.sourceName,
    type: "manual" as const,
    url: override.sourceUrl,
    retrievedAt,
    confidence: 0.95,
    scope: "japan_broadcast" as const
  };
  const schedule = normalizeScheduleToManualBeijingTime(item, override, source);
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

function normalizeScheduleToManualBeijingTime(
  item: AnimeItem,
  override: ManualBroadcastOverride,
  source: AnimeItem["sources"][number]
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

function assertUpdateInput(input: UpdateInput): void {
  if (!Number.isInteger(input.year) || input.year < 1900 || input.year > 2100) {
    throw new ApiErrorException("INVALID_QUERY", "year is invalid", { status: 400 });
  }
  if (!isSeasonMonth(input.season)) {
    throw new ApiErrorException("INVALID_QUERY", "season must be one of 1, 4, 7, 10", { status: 400 });
  }
}

async function fetchSeasonCandidates(
  adapters: AnimeSourceAdapter[],
  input: { year: number; season: SeasonMonth; quarter: SeasonKey["quarter"]; now: Date }
): Promise<{ items: AnimeItem[]; warnings: SourceIssue[] }> {
  const items: AnimeItem[] = [];
  const warnings: SourceIssue[] = [];

  for (const adapter of adapters) {
    try {
      const result = await adapter.fetchSeason(input);
      items.push(...result.items);
      warnings.push(...result.warnings);
    } catch (error) {
      warnings.push(toSourceIssue(adapter.name, error));
    }
  }

  return { items, warnings };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeFetchedItem(item: AnimeItem, now: string): AnimeItem {
  const primarySeason = calculatePrimarySeason(item.startDate);
  const activeSeasons = calculateActiveSeasons({
    schedule: item.schedule,
    fallbackPrimarySeason: primarySeason
  });
  const dataStatus = item.dataStatus === "complete" && item.schedule.length === 0
    ? "partial"
    : item.dataStatus;

  return clearFinalStatusBroadcastSlot({
    ...item,
    title: {
      original: item.title.original,
      japanese: item.title.japanese ?? null,
      chinese: item.title.chinese ?? null,
      english: item.title.english ?? null,
      aliases: item.title.aliases ?? []
    },
    primarySeason,
    activeSeasons,
    updateWeekday: inferUpdateWeekday({
      updateWeekday: item.updateWeekday,
      schedule: item.schedule,
      startDate: item.startDate
    }),
    dataStatus,
    updatedAt: item.updatedAt || now,
    createdAt: item.createdAt || now
  });
}

function mergeDuplicateItems(items: AnimeItem[]): AnimeItem[] {
  const byIdentity = new Map<string, AnimeItem>();
  for (const item of items) {
    const key = findExistingMergeKey(item, byIdentity) ?? getMergeIdentity(item);
    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, item);
      continue;
    }
    byIdentity.set(key, mergeTwoItems(existing, item));
  }
  return [...byIdentity.values()];
}

function findExistingMergeKey(item: AnimeItem, existingItems: Map<string, AnimeItem>): string | null {
  if (item.bangumi.subjectId !== null || item.externalIds.bangumiSubjectId !== null) {
    const itemTitles = getNormalizedCoreTitleSet(item);
    for (const [key, existing] of existingItems) {
      if (!isPrimaryCatalogItem(existing)) continue;
      const existingTitles = getNormalizedCoreTitleSet(existing);
      if ([...itemTitles].some((title) => existingTitles.has(title))) return key;
    }
    return null;
  }
  if (!isScheduleReviewItem(item)) return null;

  const itemTitles = getNormalizedTitleSet(item);
  for (const [key, existing] of existingItems) {
    const existingComesFromBangumi =
      existing.bangumi.subjectId !== null ||
      existing.externalIds.bangumiSubjectId !== null ||
      existing.sources.some((source) => source.name === "Bangumi");
    if (!existingComesFromBangumi) continue;
    const existingTitles = getNormalizedTitleSet(existing);
    if ([...itemTitles].some((title) => existingTitles.has(title))) return key;
  }

  return null;
}

function mergeTwoItems(left: AnimeItem, right: AnimeItem): AnimeItem {
  if (isPrimaryCatalogItem(left) && isBangumiCatalogItem(right)) {
    return mergeBangumiMetadataIntoPrimaryCatalog(left, right);
  }

  const mergedStatus = resolveMergedStatus(left.status, right.status);
  const suppressBroadcastTime = isFinalStatus(mergedStatus);
  const rightUsesJapanBroadcastTime = !suppressBroadcastTime && isJapanBroadcastReviewItem(right) && right.startDate !== null;
  const schedule = rightUsesJapanBroadcastTime && right.updateTime !== null
    ? mergeScheduleFromJapanBroadcastReference(left, right)
    : dedupeSchedule([...left.schedule, ...right.schedule]);
  const primarySeason = rightUsesJapanBroadcastTime ? right.primarySeason : left.primarySeason ?? right.primarySeason;
  const startDate = rightUsesJapanBroadcastTime ? right.startDate : left.startDate ?? right.startDate;
  const updateTime = suppressBroadcastTime ? null : left.updateTime ?? right.updateTime;
  const bangumi = left.bangumi.subjectId !== null ? left.bangumi : right.bangumi;
  const externalIds = {
    bangumiSubjectId: left.externalIds.bangumiSubjectId ?? right.externalIds.bangumiSubjectId,
    bahamutSn: left.externalIds.bahamutSn ?? right.externalIds.bahamutSn
  };

  return {
    ...left,
    ...right,
    id: bangumi.subjectId !== null ? `anime:${bangumi.subjectId}` : left.id,
    title: {
      ...left.title,
      ...right.title,
      original: left.title.original || right.title.original,
      japanese: left.title.japanese ?? right.title.japanese,
      chinese: left.title.chinese ?? right.title.chinese,
      english: left.title.english ?? right.title.english,
      aliases: [...new Set([...left.title.aliases, ...right.title.aliases])]
    },
    format: left.format !== "unknown" ? left.format : right.format,
    status: mergedStatus,
    startDate,
    endDate: left.endDate ?? right.endDate,
    officialUrl: left.officialUrl ?? right.officialUrl,
    coverImage: left.coverImage ?? right.coverImage,
    externalIds,
    bangumi,
    activeSeasons: calculateActiveSeasons({
      schedule,
      fallbackPrimarySeason: primarySeason
    }),
    primarySeason,
    updateWeekday: suppressBroadcastTime
      ? null
      : inferUpdateWeekday({
          updateWeekday: right.updateWeekday ?? left.updateWeekday,
          schedule,
          startDate
        }),
    updateTime,
    episodeCount: left.episodeCount ?? right.episodeCount,
    airedEpisodeCount: left.airedEpisodeCount ?? right.airedEpisodeCount,
    schedule,
    sources: dedupeSources([...left.sources, ...right.sources]),
    createdAt: left.createdAt,
    updatedAt: right.updatedAt
  };
}

function mergeBangumiMetadataIntoPrimaryCatalog(primary: AnimeItem, bangumiItem: AnimeItem): AnimeItem {
  const bangumi = primary.bangumi.subjectId !== null ? primary.bangumi : bangumiItem.bangumi;
  const externalIds = {
    bangumiSubjectId: primary.externalIds.bangumiSubjectId ?? bangumiItem.externalIds.bangumiSubjectId,
    bahamutSn: primary.externalIds.bahamutSn ?? bangumiItem.externalIds.bahamutSn
  };

  return clearFinalStatusBroadcastSlot({
    ...primary,
    id: bangumi.subjectId !== null ? `anime:${bangumi.subjectId}` : primary.id,
    title: {
      ...primary.title,
      aliases: [...new Set([...primary.title.aliases, ...bangumiItem.title.aliases])]
    },
    coverImage: primary.coverImage ?? bangumiItem.coverImage,
    externalIds,
    bangumi,
    sources: dedupeSources([...primary.sources, ...bangumiItem.sources]),
    updatedAt: bangumiItem.updatedAt
  });
}

function resolveMergedStatus(left: AnimeItem["status"], right: AnimeItem["status"]): AnimeItem["status"] {
  if (left === "finished" || right === "finished") return "finished";
  if (left === "cancelled" || right === "cancelled") return "cancelled";
  if (left === "delayed" || right === "delayed") return "delayed";
  if (left === "airing" || right === "airing") return "airing";
  if (left === "announced" || right === "announced") return "announced";
  return "unknown";
}

function isFinalStatus(status: AnimeItem["status"]): boolean {
  return status === "finished" || status === "cancelled";
}

function isJapanBroadcastReviewItem(item: AnimeItem): boolean {
  return item.sources.some((source) => source.name === "YourAnimes" && source.scope === "japan_broadcast");
}

function mergeScheduleFromJapanBroadcastReference(base: AnimeItem, reference: AnimeItem): AnimeItem["schedule"] {
  if (reference.updateTime === null || reference.startDate === null) return dedupeSchedule([...base.schedule, ...reference.schedule]);

  const source = reference.sources[0];
  const shiftDays = getDateShiftDays(base.startDate, reference.startDate);
  const sourceSchedule = base.schedule.length > 0 ? base.schedule : reference.schedule;
  return dedupeSchedule(
    sourceSchedule.map((scheduleItem) => ({
      ...scheduleItem,
      airDate: shiftDate(scheduleItem.airDate, shiftDays),
      airTime: reference.updateTime,
      timezone: "Asia/Shanghai" as const,
      source: source ?? scheduleItem.source
    }))
  );
}

function getMergeIdentity(item: AnimeItem): string {
  const bangumiSubjectId = item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId;
  if (bangumiSubjectId !== null) return `bangumi:${bangumiSubjectId}`;
  const normalizedTitle = item.title.original.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, "");
  return `title:${normalizedTitle}:${item.startDate ?? ""}:${item.format}`;
}

function getNormalizedTitleSet(item: AnimeItem): Set<string> {
  return new Set(
    [
      item.title.original,
      item.title.japanese,
      item.title.chinese,
      item.title.english,
      ...item.title.aliases
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(normalizeTitleForMerge)
      .filter((value) => value.length > 0)
  );
}

function getNormalizedCoreTitleSet(item: AnimeItem): Set<string> {
  return new Set(
    [
      item.title.original,
      item.title.japanese,
      item.title.chinese,
      item.title.english
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map(normalizeTitleForMerge)
      .filter((value) => value.length > 0)
  );
}

function normalizeTitleForMerge(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[!！?？:：,，.。'"“”‘’《》「」『』（）()[\]\s_-]+/gu, "");
}

function mergeWithOldItem(item: AnimeItem, oldItems: AnimeItem[]): AnimeItem {
  const oldItem = oldItems.find((candidate) => candidate.id === item.id);
  if (oldItem && isScheduleReviewItem(item)) return mergeScheduleReviewWithOldItem(oldItem, item);
  if (!oldItem) {
    const oldTitleMatch = isScheduleReviewItem(item) ? findOldItemByTitle(item, oldItems) : null;
    return oldTitleMatch ? mergeScheduleReviewWithOldItem(oldTitleMatch, item) : item;
  }

  const mergedStatus = resolveMergedStatus(item.status, oldItem.status);
  const suppressBroadcastTime = isFinalStatus(mergedStatus);
  return {
    ...item,
    status: mergedStatus,
    createdAt: oldItem.createdAt,
    schedule: mergeSchedulePreservingTimedEntries(item.schedule, oldItem.schedule),
    updateWeekday: suppressBroadcastTime
      ? null
      : item.updateTime === null ? oldItem.updateWeekday ?? item.updateWeekday : item.updateWeekday,
    updateTime: suppressBroadcastTime ? null : item.updateTime ?? oldItem.updateTime,
    timezone: suppressBroadcastTime
      ? item.timezone
      : item.updateTime === null && oldItem.updateTime !== null ? oldItem.timezone : item.timezone,
    bangumi: item.bangumi.rating === null && oldItem.bangumi.subjectId === item.bangumi.subjectId
      ? oldItem.bangumi
      : item.bangumi,
    sources: dedupeSources([...oldItem.sources, ...item.sources])
  };
}

function isScheduleReviewItem(item: AnimeItem): boolean {
  return item.sources.some((source) => source.name === "Bahamut Anime Crazy" || source.name === "YourAnimes");
}

function isCatalogItem(item: AnimeItem): boolean {
  return item.sources.some((source) => source.name === "YucWiki" || source.name === "Bangumi");
}

function isPrimaryCatalogItem(item: AnimeItem): boolean {
  return item.sources.some((source) => source.name === "YucWiki");
}

function isBangumiCatalogItem(item: AnimeItem): boolean {
  return item.sources.some((source) => source.name === "Bangumi");
}

function shouldDropSecondaryCatalogItem(item: AnimeItem, hasPrimaryCatalogCandidates: boolean): boolean {
  if (!hasPrimaryCatalogCandidates) return false;
  if (isPrimaryCatalogItem(item)) return false;
  return item.sources.some((source) => source.name === "Bangumi");
}

function findOldItemByTitle(item: AnimeItem, oldItems: AnimeItem[]): AnimeItem | null {
  const itemTitles = getNormalizedTitleSet(item);
  const itemSubjectId = item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId;
  return oldItems.find((oldItem) => {
    if (!isCacheEligibleAnime(oldItem)) return false;
    const oldSubjectId = oldItem.bangumi.subjectId ?? oldItem.externalIds.bangumiSubjectId;
    if (itemSubjectId !== null && oldSubjectId !== null && itemSubjectId !== oldSubjectId) return false;
    const oldTitles = getNormalizedTitleSet(oldItem);
    return [...itemTitles].some((title) => oldTitles.has(title));
  }) ?? null;
}

function isUnmatchedReferenceOnlyItem(item: AnimeItem, oldItems: AnimeItem[]): boolean {
  if (!isScheduleReviewItem(item) || isCatalogItem(item)) return false;
  if (item.bangumi.subjectId !== null || item.externalIds.bangumiSubjectId !== null) return false;
  return findOldItemByTitle(item, oldItems) === null;
}

function shouldDropReferenceOnlyItem(item: AnimeItem, oldItems: AnimeItem[], allowColdStart: boolean): boolean {
  if (!isScheduleReviewItem(item) || isCatalogItem(item)) return false;
  if (item.bangumi.subjectId !== null || item.externalIds.bangumiSubjectId !== null) return false;
  if (!allowColdStart) return true;
  if (findOldItemByTitle(item, oldItems) !== null) return false;
  return !isTrustedReferenceColdStartItem(item);
}

function isTrustedReferenceColdStartItem(item: AnimeItem): boolean {
  const hasTrustedSource = item.sources.some(
    (source) =>
      source.name === "YourAnimes" && source.scope === "japan_broadcast"
  );
  return hasTrustedSource && item.format === "tv" && item.startDate !== null && item.schedule.length > 0;
}

function markReferenceColdStartItem(item: AnimeItem): AnimeItem {
  if (!isScheduleReviewItem(item) || isCatalogItem(item)) return item;
  if (item.bangumi.subjectId !== null || item.externalIds.bangumiSubjectId !== null) return item;
  return {
    ...item,
    inclusionStatus: item.inclusionStatus === "included" ? "needs_review" : item.inclusionStatus,
    dataStatus: item.dataStatus === "complete" ? "partial" : item.dataStatus
  };
}

function mergeScheduleReviewWithOldItem(oldItem: AnimeItem, scheduleItem: AnimeItem): AnimeItem {
  const merged = mergeTwoItems(oldItem, scheduleItem);
  if (isFinalStatus(merged.status)) {
    return {
      ...merged,
      updateTime: null,
      updateWeekday: null,
      dataStatus: merged.dataStatus === "complete" && scheduleItem.dataStatus !== "complete" ? "partial" : merged.dataStatus
    };
  }
  return {
    ...merged,
    updateTime: scheduleItem.updateTime ?? merged.updateTime,
    updateWeekday: scheduleItem.updateWeekday ?? merged.updateWeekday,
    timezone: scheduleItem.updateTime !== null ? scheduleItem.timezone : merged.timezone,
    dataStatus: merged.dataStatus === "complete" && scheduleItem.dataStatus !== "complete" ? "partial" : merged.dataStatus
  };
}

function mergeSeasonIntoCache(
  oldCache: AnimeCache,
  seasonItems: AnimeItem[],
  targetSeason: SeasonKey,
  updatedAt: string
): AnimeCache {
  const seasonItemIds = new Set(seasonItems.map((item) => item.id));
  const unrelatedOldItems = oldCache.items.filter((item) => {
    if (seasonItemIds.has(item.id)) return false;
    return !isPrimaryInSeason(item, targetSeason);
  });

  return {
    schemaVersion: 1,
    updatedAt,
    generatedBy: "manual-update",
    items: [...unrelatedOldItems, ...seasonItems].map(clearFinalStatusBroadcastSlot)
  };
}

function getOldSeasonItems(oldItems: AnimeItem[], targetSeason: SeasonKey): AnimeItem[] {
  return oldItems
    .filter((item) => isPrimaryInSeason(item, targetSeason))
    .filter(isCacheEligibleAnime);
}

function shouldFailEmptyUpdate(
  warnings: SourceIssue[],
  targetItems: AnimeItem[],
  fallbackSeasonItems: AnimeItem[]
): boolean {
  return warnings.length > 0 && targetItems.length === 0 && fallbackSeasonItems.length === 0;
}

function shouldFailWeakHistoricalCatalogRefresh(
  warnings: SourceIssue[],
  targetItems: AnimeItem[],
  targetSeason: SeasonKey,
  now: Date
): boolean {
  const minimumHistoricalCatalogItems = parsePositiveInteger(process.env.MIN_HISTORICAL_CATALOG_ITEMS, 13);
  if (targetItems.length >= minimumHistoricalCatalogItems) return false;
  if (!isPastSeason(targetSeason, now)) return false;
  if (targetItems.some(isPrimaryCatalogItem)) return true;
  return warnings.some((warning) => warning.source === "YucWiki" && warning.code !== "SOURCE_DISABLED");
}

function shouldRunBangumiSearchEnrichment(options: UpdateAnimeDataOptions, targetItems: AnimeItem[]): boolean {
  if (options.adapters !== undefined) return false;
  return targetItems.some((item) =>
    item.sources.some((source) => source.name === "YucWiki") &&
    (item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId) === null
  );
}

function shouldRunBangumiDetailRefresh(options: UpdateAnimeDataOptions, items: AnimeItem[]): boolean {
  if (options.adapters !== undefined) return false;
  return items.some((item) =>
    (item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId) !== null &&
    (item.bangumi.rating === null || item.coverImage?.source !== "bangumi")
  );
}

function shouldFailUnenrichedHistoricalPrimaryCatalog(
  warnings: SourceIssue[],
  targetItems: AnimeItem[],
  targetSeason: SeasonKey,
  now: Date
): boolean {
  const minimumHistoricalCatalogItems = parsePositiveInteger(process.env.MIN_HISTORICAL_CATALOG_ITEMS, 13);
  if (targetItems.length < minimumHistoricalCatalogItems) return false;
  if (!targetItems.some(isPrimaryCatalogItem)) return false;
  if (!isPastSeason(targetSeason, now)) return false;
  if (targetItems.some((item) => (item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId) !== null)) return false;
  return warnings.some((warning) => warning.source === "Bangumi");
}

function isPastSeason(targetSeason: SeasonKey, now: Date): boolean {
  const currentSeason = calculatePrimarySeason(now.toISOString().slice(0, 10));
  if (currentSeason === null) return false;
  return seasonOrder(targetSeason) < seasonOrder(currentSeason);
}

function seasonOrder(season: SeasonKey): number {
  return season.year * 4 + quarterOrder(season.quarter);
}

function quarterOrder(quarter: SeasonKey["quarter"]): number {
  switch (quarter) {
    case "winter":
      return 0;
    case "spring":
      return 1;
    case "summer":
      return 2;
    case "fall":
      return 3;
  }
}

function isPrimaryInSeason(item: Pick<AnimeItem, "primarySeason">, targetSeason: SeasonKey): boolean {
  return seasonKeyEquals(item.primarySeason, targetSeason);
}

function isCacheEligibleAnime(item: AnimeItem): boolean {
  const textValues = getAnimeTextValues(item);
  const subjectId = item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId;
  return (
    item.format === "tv" &&
    !hasExplicitExcludedBangumiSubjectId(subjectId) &&
    item.isJapaneseAnime !== false &&
    item.inclusionStatus !== "excluded" &&
    !isAdultAnime(item) &&
    !hasExplicitNonJapaneseSignal(textValues) &&
    !hasForeignPrimaryTitleSignal(item.title.original) &&
    !hasTheatricalMovieSignal(textValues) &&
    !hasKnownNonTvSpecialSignal(textValues) &&
    !hasOverSeasonLimitSignal(textValues)
  );
}

function isAdultAnime(item: AnimeItem): boolean {
  const haystack = getAnimeTextValues(item)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
  return /(インゴクダンチ|淫狱团地|淫獄団地|r-?18|18\+|nsfw|adult|アダルト|成人|里番|裏番|僧侣档|僧侶枠|オンエア版|無修正|av女优|av女優|セックス|sex)/iu.test(haystack);
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

function summarizeUpdate(seasonItems: AnimeItem[], nextCache: AnimeCache, skippedNonJapanese: number): UpdateSummary {
  return {
    fetched: seasonItems.length,
    matchedBangumi: seasonItems.filter((item) => item.bangumi.subjectId !== null).length,
    missingBangumi: seasonItems.filter((item) => item.bangumi.subjectId === null).length,
    missingRating: seasonItems.filter((item) => item.bangumi.rating === null).length,
    conflicting: seasonItems.filter((item) => item.dataStatus === "conflicting").length,
    incomplete: seasonItems.filter((item) => item.dataStatus !== "complete").length,
    skippedNonJapanese,
    written: nextCache.items.length
  };
}

function createSuccessStatus(
  previous: UpdateStatusPayload,
  job: NonNullable<UpdateStatusPayload["currentJob"]>,
  cache: AnimeCache,
  finishedAt: string
): UpdateStatusPayload {
  return {
    ...previous,
    schemaVersion: 1,
    status: "success",
    lastSuccessAt: finishedAt,
    lastAttemptAt: job.startedAt,
    lastError: null,
    currentJob: null,
    cache: {
      animeUpdatedAt: cache.updatedAt,
      itemCount: cache.items.length
    }
  };
}

function createFailedStatus(
  previous: UpdateStatusPayload,
  job: NonNullable<UpdateStatusPayload["currentJob"]>,
  oldCache: AnimeCache,
  failedAt: string,
  error: PublicApiError
): UpdateStatusPayload {
  return {
    ...previous,
    schemaVersion: 1,
    status: "failed",
    lastAttemptAt: job.startedAt,
    lastError: {
      ...error,
      at: failedAt
    },
    currentJob: null,
    cache: {
      animeUpdatedAt: oldCache.updatedAt,
      itemCount: oldCache.items.length
    }
  };
}

function dedupeSchedule(schedule: AnimeItem["schedule"]): AnimeItem["schedule"] {
  const seen = new Set<string>();
  const result: AnimeItem["schedule"] = [];
  for (const item of schedule) {
    const key = `${item.episodeNumber ?? "?"}:${item.airDate}:${item.airTime ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result.sort((left, right) => left.airDate.localeCompare(right.airDate));
}

function mergeSchedulePreservingTimedEntries(
  incomingSchedule: AnimeItem["schedule"],
  oldSchedule: AnimeItem["schedule"]
): AnimeItem["schedule"] {
  if (oldSchedule.length === 0) return incomingSchedule;

  const oldTimedByEpisodeAndDate = new Map(
    oldSchedule
      .filter((item) => item.airTime !== null)
      .map((item) => [`${item.episodeNumber ?? "?"}:${item.airDate}`, item])
  );

  return dedupeSchedule(
    incomingSchedule.map((item) => oldTimedByEpisodeAndDate.get(`${item.episodeNumber ?? "?"}:${item.airDate}`) ?? item)
  );
}

function dedupeSources(sources: AnimeItem["sources"]): AnimeItem["sources"] {
  const seen = new Set<string>();
  const result: AnimeItem["sources"] = [];
  for (const source of sources) {
    const key = `${source.name}:${source.type}:${source.url ?? ""}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(source);
    }
  }
  return result;
}
