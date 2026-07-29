import { readFile } from "node:fs/promises";

import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  inferUpdateWeekday
} from "../src/server/anime/calculateSeason.ts";
import { getDefaultStorage } from "../src/server/cache/jsonFileStorage.ts";
import {
  mapYourAnimesReferenceToAnimeItem,
  parseYourAnimesHtml
} from "../src/server/sources/youranimes/adapter.ts";
import type { AnimeCache, AnimeItem, AnimeSource } from "../src/server/types/anime.ts";

const NON_JAPANESE_PATTERN = new RegExp(
  [
    String.raw`primal`,
    String.raw`genndy\s+tartakovsky`,
    String.raw`\u53f2\u524d\u6218\u7eaa`,
    String.raw`\u91ce\u86ee\u7eaa\u6e90`,
    String.raw`\u539f\u59cb\u6218\u7eaa`,
    String.raw`\u718a\u718a\u5e2e\u5e2e\u56e2`,
    String.raw`\u5361\u9177\u52a8\u753b\u6625\u665a`,
    String.raw`\u6076\u641e\u4e4b\u5bb6`,
    String.raw`family\s+guy`,
    String.raw`spider-man`,
    String.raw`spider man`,
    String.raw`\u8718\u86db\u4fa0\u4e0e\u4ed6\u7684\u795e\u5947\u670b\u53cb\u4eec`,
    String.raw`paw\s*patrol`,
    String.raw`\u6c6a\u6c6a\u961f\u7acb\u5927\u529f`,
    String.raw`curtis`,
    String.raw`\u67ef\u8482\u65af\u603b\u7edf`,
    String.raw`ninjago`,
    String.raw`lego`,
    String.raw`\u4e50\u9ad8`,
    String.raw`\u5927\u5934\u513f\u5b50`,
    String.raw`\u5c0f\u5934\u7238\u7238`,
    String.raw`\u559c\u7f8a\u7f8a`,
    String.raw`\u718a\u51fa\u6ca1`,
    String.raw`sealook`,
    String.raw`pinkfong`,
    String.raw`baby\s*shark`
  ].join("|"),
  "iu"
);

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
  const nextItems: AnimeItem[] = [];

  for (const item of cache.items) {
    if (isExplicitNonJapanese(item) || isUnmatchedReferenceOnlyItem(item)) {
      removed += 1;
      continue;
    }

    const retaggedItem = normalizeSeasonTags(item);
    if (JSON.stringify(retaggedItem.primarySeason) !== JSON.stringify(item.primarySeason)) retagged += 1;

    const reference = findReference(retaggedItem, byBangumiId, byTitle);
    const merged = reference ? mergeReferenceTime(retaggedItem, reference) : retaggedItem;
    const override = manualOverrides.get(merged.id);
    const finalized = override ? applyManualBroadcastOverride(merged, override, now) : merged;
    if (item.updateTime === null && merged.updateTime !== null) filledTimes += 1;
    if (override && merged.updateTime !== finalized.updateTime) manualFilled += 1;
    nextItems.push(finalized);
  }

  const nextCache: AnimeCache = {
    ...cache,
    updatedAt: now,
    generatedBy: "manual-update",
    items: nextItems
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
      itemCount: nextItems.length
    }
  });

  console.log(JSON.stringify({ removed, retagged, filledTimes, manualFilled, written: nextItems.length }, null, 2));
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

function isExplicitNonJapanese(item: AnimeItem): boolean {
  const haystack = [
    item.title.original,
    item.title.japanese,
    item.title.chinese,
    item.title.english,
    ...item.title.aliases,
    item.officialUrl
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
  return NON_JAPANESE_PATTERN.test(haystack);
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
