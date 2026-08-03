import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  inferUpdateWeekday,
  isValidDateString
} from "../src/server/anime/calculateSeason.ts";
import { clearFinalStatusBroadcastSlot } from "../src/server/anime/normalizeAnime.ts";
import { getDefaultStorage } from "../src/server/cache/jsonFileStorage.ts";
import { scoreBangumiCandidate } from "../src/server/sources/bangumi/matcher.ts";
import type { AnimeCache, AnimeItem, AnimeSource } from "../src/server/types/anime.ts";

const execFileAsync = promisify(execFile);
const now = new Date();
const today = now.toISOString().slice(0, 10);
const localOnly = process.argv.includes("--local-only");

interface BangumiDetail {
  id: number;
  date?: string;
  images?: {
    large?: string;
    common?: string;
    medium?: string;
    small?: string;
    grid?: string;
  };
  eps?: number;
  total_episodes?: number;
  rank?: number;
  rating?: {
    score?: number;
    total?: number;
    rank?: number;
  };
}

interface PowershellFetchResult {
  id: number;
  status: number;
  content?: string;
  error?: string;
}

async function main() {
  const storage = getDefaultStorage();
  const cache = await storage.readAnimeCache();
  const ids = [
    ...new Set(
      cache.items
        .map((item) => item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId)
        .filter((id): id is number => Number.isInteger(id))
    )
  ];
  const fetchedAt = now.toISOString();
  const details = localOnly ? new Map<number, BangumiDetail>() : await fetchBangumiDetails(ids);
  const snapshotSubjects = await readBangumiSubjectSnapshots();
  let ratingUpdated = 0;
  let matchedMissingBangumi = 0;
  let coverUpdated = 0;
  let episodeUpdated = 0;
  let statusUpdated = 0;

  const nextItems = cache.items.map((item) => {
    const subjectId = item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId;
    const detail = subjectId === null
      ? findBangumiSnapshotMatch(item, snapshotSubjects)
      : details.get(subjectId);
    if (!detail) return normalizeBroadcastState(item, fetchedAt);

    const next = mergeBangumiDetail(item, detail, fetchedAt);
    if (subjectId === null && next.bangumi.subjectId !== null) matchedMissingBangumi += 1;
    if (item.bangumi.rating === null && next.bangumi.rating !== null) ratingUpdated += 1;
    if (item.coverImage?.source !== "bangumi" && next.coverImage?.source === "bangumi") coverUpdated += 1;
    if (item.episodeCount === null && next.episodeCount !== null) episodeUpdated += 1;
    if (item.status !== next.status) statusUpdated += 1;
    return next;
  });

  const nextCache: AnimeCache = {
    ...cache,
    updatedAt: fetchedAt,
    generatedBy: "manual-update",
    items: nextItems
  };

  await storage.writeAnimeCache(nextCache);
  const status = await storage.readUpdateStatus();
  await storage.writeUpdateStatus({
    ...status,
    status: "success",
    lastSuccessAt: fetchedAt,
    lastError: null,
    currentJob: null,
    cache: {
      animeUpdatedAt: fetchedAt,
      itemCount: nextItems.length
    }
  });

  console.log(JSON.stringify({
    requested: localOnly ? 0 : ids.length,
    found: details.size,
    localOnly,
    matchedMissingBangumi,
    ratingUpdated,
    coverUpdated,
    episodeUpdated,
    statusUpdated
  }, null, 2));
}

async function fetchBangumiDetails(ids: number[]): Promise<Map<number, BangumiDetail>> {
  if (ids.length === 0) return new Map();
  const userAgent = process.env.BANGUMI_USER_AGENT || "anime-quarter-schedule-local/0.1.1 (contact: local-dev)";
  const script = String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ids = ConvertFrom-Json $env:BG_SYNC_IDS
$UserAgent = $env:BG_SYNC_USER_AGENT
$result = New-Object System.Collections.Generic.List[object]
foreach ($id in $ids) {
  try {
    $url = "https://api.bgm.tv/v0/subjects/$id"
    $response = Invoke-WebRequest -Uri $url -Headers @{"User-Agent"=$UserAgent; "Accept"="application/json"} -UseBasicParsing -TimeoutSec 20
    $result.Add([pscustomobject]@{ id = [int]$id; status = [int]$response.StatusCode; content = $response.Content })
  } catch {
    $result.Add([pscustomobject]@{ id = [int]$id; status = 0; error = $_.Exception.Message })
  }
  Start-Sleep -Milliseconds 250
}
$result | ConvertTo-Json -Depth 6 -Compress
`;
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], {
    maxBuffer: 50 * 1024 * 1024,
    timeout: Math.max(60_000, ids.length * 3_000),
    env: {
      ...process.env,
      BG_SYNC_IDS: JSON.stringify(ids),
      BG_SYNC_USER_AGENT: userAgent
    }
  });
  const raw = JSON.parse(stdout) as PowershellFetchResult[] | PowershellFetchResult;
  const rows = Array.isArray(raw) ? raw : [raw];
  const details = new Map<number, BangumiDetail>();
  for (const row of rows) {
    if (row.status !== 200 || !row.content) continue;
    const detail = JSON.parse(row.content) as BangumiDetail;
    if (Number.isInteger(detail.id)) details.set(detail.id, detail);
  }
  return details;
}

function mergeBangumiDetail(item: AnimeItem, detail: BangumiDetail, fetchedAt: string): AnimeItem {
  const rating = positiveNumberOrNull(detail.rating?.score);
  const ratingCount = positiveIntegerOrNull(detail.rating?.total);
  const rank = positiveIntegerOrNull(detail.rank) ?? positiveIntegerOrNull(detail.rating?.rank);
  const episodeCount = positiveIntegerOrNull(detail.eps) ?? positiveIntegerOrNull(detail.total_episodes) ?? item.episodeCount;
  const coverImage = mapBangumiCoverImage(detail) ?? item.coverImage;
  const startDate = item.startDate ?? normalizeDate(detail.date);
  const bangumiSource: AnimeSource = {
    name: "Bangumi",
    type: "bangumi",
    url: `https://bgm.tv/subject/${detail.id}`,
    retrievedAt: fetchedAt,
    scope: "metadata"
  };
  const schedule = buildWeeklySchedule({
    item: { ...item, startDate, episodeCount },
    source: item.schedule[0]?.source ?? bangumiSource
  });
  const existingEndDate = shouldClearSingleEpisodeEndDate(item, episodeCount) ? null : item.endDate;
  const endDate = episodeCount !== null ? schedule.at(-1)?.airDate ?? existingEndDate : existingEndDate;
  const primarySeason = calculatePrimarySeason(startDate);
  const normalized = normalizeBroadcastState(
    {
      ...item,
      startDate,
      endDate,
      episodeCount,
      airedEpisodeCount: capAiredEpisodeCount(countAiredEpisodes(schedule), episodeCount),
      primarySeason,
      activeSeasons: calculateActiveSeasons({ schedule, fallbackPrimarySeason: primarySeason }),
      updateWeekday: inferUpdateWeekday({
        updateWeekday: item.updateWeekday,
        schedule,
        startDate
      }),
      schedule,
      bangumi: {
        subjectId: detail.id,
        url: `https://bgm.tv/subject/${detail.id}`,
        rating,
        ratingCount,
        rank,
        lastSyncedAt: fetchedAt
      },
      coverImage,
      externalIds: {
        ...item.externalIds,
        bangumiSubjectId: detail.id
      },
      sources: dedupeSources([...item.sources, bangumiSource]),
      updatedAt: fetchedAt
    },
    fetchedAt
  );
  return normalized;
}

async function readBangumiSubjectSnapshots(): Promise<Map<string, BangumiSubject[]>> {
  const { readdir, readFile } = await import("node:fs/promises");
  const result = new Map<string, BangumiSubject[]>();
  let files: string[] = [];
  try {
    files = await readdir("data");
  } catch {
    return result;
  }

  for (const file of files) {
    const match = /^bangumi-(\d{4})(\d{2})-subjects\.json$/u.exec(file);
    if (!match) continue;
    const year = match[1]!;
    const month = Number(match[2]);
    try {
      const payload = JSON.parse(await readFile(`data/${file}`, "utf8")) as unknown;
      const subjects = extractSnapshotSubjects(payload);
      result.set(`${year}-${month}`, subjects);
    } catch {
      // Ignore corrupt local snapshots; online detail sync can still proceed.
    }
  }

  return result;
}

function extractSnapshotSubjects(payload: unknown): BangumiSubject[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  return rows.filter(isBangumiSubject);
}

function isBangumiSubject(value: unknown): value is BangumiSubject {
  return Boolean(
    value &&
    typeof value === "object" &&
    Number.isInteger((value as { id?: unknown }).id) &&
    (value as { type?: unknown }).type === 2 &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

function findBangumiSnapshotMatch(
  item: AnimeItem,
  snapshots: Map<string, BangumiSubject[]>
): BangumiSubject | undefined {
  if (!item.sources.some((source) => source.name === "YucWiki")) return undefined;
  if (item.primarySeason === null) return undefined;

  const lookupMonths = getBangumiLookupMonths(item.primarySeason.year, item.primarySeason.quarter);
  const subjectsById = new Map<number, BangumiSubject>();
  for (const { year, month } of lookupMonths) {
    for (const subject of snapshots.get(`${year}-${month}`) ?? []) {
      subjectsById.set(subject.id, subject);
    }
  }

  const input = {
    title: item.title,
    year: item.primarySeason.year,
    quarter: item.primarySeason.quarter,
    startDate: item.startDate,
    format: item.format,
    episodeCount: item.episodeCount,
    officialUrl: item.officialUrl,
    studios: item.staff?.studio ?? [],
    sources: item.sources,
    existingBangumiId: null
  };
  const scored = [...subjectsById.values()]
    .map((subject) => scoreBangumiCandidate(input, subject, { fromSearch: false, fromSeasonMonth: true }))
    .sort((left, right) => right.score - left.score);
  const localBest = scored[0];
  if (localBest && isAcceptedSnapshotMatch(localBest, scored[1])) return localBest.subject;

  const globalSubjectsById = new Map<number, BangumiSubject>();
  for (const subjects of snapshots.values()) {
    for (const subject of subjects) globalSubjectsById.set(subject.id, subject);
  }
  const globalScored = [...globalSubjectsById.values()]
    .map((subject) => scoreBangumiCandidate(input, subject, { fromSearch: false, fromSeasonMonth: false }))
    .sort((left, right) => right.score - left.score);
  const globalBest = globalScored[0];
  if (!globalBest || !isAcceptedSnapshotMatch(globalBest, globalScored[1])) return undefined;
  return globalBest.subject;
}

function isAcceptedSnapshotMatch(
  best: ReturnType<typeof scoreBangumiCandidate>,
  second: ReturnType<typeof scoreBangumiCandidate> | undefined
): boolean {
  const disallowedRisks = new Set([
    "format_conflict",
    "multiple_close_candidates"
  ]);
  if (best.risks.some((risk) => disallowedRisks.has(risk))) return false;
  const hasTitleEvidence = best.matchedFields.some((field) => field === "name" || field === "name_cn" || field === "alias" || field === "english");
  const hasAuxEvidence = best.matchedFields.some((field) => field === "date" || field === "quarter" || field === "officialUrl" || field === "episodeCount" || field === "seasonToken");
  const hasOfficialUrl = best.matchedFields.includes("officialUrl");
  const hasSeasonOrEpisodeEvidence = best.matchedFields.includes("seasonToken") || best.matchedFields.includes("episodeCount");
  const hasDateEvidence = best.matchedFields.includes("date") || best.matchedFields.includes("quarter");
  const lead = second ? best.score - second.score : 100;
  const hasCourMergeEvidence = hasOfficialUrl && hasTitleEvidence && hasSeasonOrEpisodeEvidence && best.score >= 52;
  const hasTranslationVariantEvidence = hasOfficialUrl && hasTitleEvidence && (hasDateEvidence || hasSeasonOrEpisodeEvidence) && best.score >= 56;

  if (!hasTitleEvidence || !hasAuxEvidence) return false;
  if (best.risks.includes("chinese_title_only") && !hasTranslationVariantEvidence) return false;
  if (best.risks.includes("alias_only") && !hasTranslationVariantEvidence) return false;
  if (
    (best.risks.includes("year_mismatch") ||
      best.risks.includes("date_conflict") ||
      best.risks.includes("season_token_mismatch")) &&
    !hasCourMergeEvidence &&
    !hasTranslationVariantEvidence
  ) {
    return false;
  }
  if (lead < 12 && !hasOfficialUrl) return false;
  if (hasCourMergeEvidence || hasTranslationVariantEvidence) return true;
  if (best.score < 74) return false;
  if (lead < 15) return false;
  return true;
}

function getBangumiLookupMonths(
  year: number,
  quarter: AnimeItem["primarySeason"] extends infer T ? T extends { quarter: infer Q } ? Q : never : never
): Array<{ year: number; month: number }> {
  const seasonMonth = quarterToSeasonMonth(quarter);
  const months = seasonMonth === 1 ? [12, 1, 2, 3] : [seasonMonth - 1, seasonMonth, seasonMonth + 1, seasonMonth + 2];
  return months.map((month) => ({
    year: seasonMonth === 1 && month === 12 ? year - 1 : year,
    month
  }));
}

function quarterToSeasonMonth(quarter: AnimeItem["primarySeason"] extends infer T ? T extends { quarter: infer Q } ? Q : never : never): number {
  switch (quarter) {
    case "winter":
      return 1;
    case "spring":
      return 4;
    case "summer":
      return 7;
    case "fall":
      return 10;
    default:
      return 1;
  }
}

function normalizeBroadcastState(item: AnimeItem, updatedAt: string): AnimeItem {
  const status = inferStatusFromDates(item.startDate, item.endDate);
  return clearFinalStatusBroadcastSlot({
    ...item,
    status,
    updatedAt
  });
}

function shouldClearSingleEpisodeEndDate(item: AnimeItem, episodeCount: number | null): boolean {
  return (
    episodeCount === null &&
    item.startDate !== null &&
    item.endDate === item.startDate &&
    item.schedule.length <= 1
  );
}

function buildWeeklySchedule(input: { item: AnimeItem; source: AnimeSource }): AnimeItem["schedule"] {
  const { item, source } = input;
  if (!item.startDate || !item.updateTime || item.episodeCount === null || item.episodeCount <= 1) {
    return item.schedule;
  }

  const firstAirDate = item.schedule[0]?.airDate ?? item.startDate;
  const firstEpisodeNumber = item.schedule[0]?.episodeNumber ?? 1;
  return Array.from({ length: item.episodeCount }, (_, index) => ({
    episodeNumber: firstEpisodeNumber + index,
    episodeTitle: item.schedule[index]?.episodeTitle ?? null,
    airDate: addDays(firstAirDate, index * 7),
    airTime: item.updateTime,
    timezone: "Asia/Shanghai" as const,
    status: "confirmed" as const,
    source,
    rawTimeText: item.schedule[index]?.rawTimeText ?? null
  }));
}

function inferStatusFromDates(startDate: string | null, endDate: string | null): AnimeItem["status"] {
  if (startDate && Date.parse(`${startDate}T00:00:00+08:00`) > now.getTime()) return "announced";
  if (endDate && Date.parse(`${endDate}T23:59:59+08:00`) < now.getTime()) return "finished";
  return startDate ? "airing" : "unknown";
}

function countAiredEpisodes(schedule: AnimeItem["schedule"]): number | null {
  if (schedule.length === 0) return null;
  return schedule.filter((item) => item.airDate <= today).length;
}

function capAiredEpisodeCount(value: number | null, episodeCount: number | null): number | null {
  if (value === null) return null;
  return episodeCount === null ? value : Math.min(value, episodeCount);
}

function addDays(date: string, days: number): string {
  if (!isValidDateString(date)) return date;
  const time = Date.parse(`${date}T00:00:00Z`);
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

function normalizeDate(value: string | undefined): string | null {
  return isValidDateString(value) ? value : null;
}

function mapBangumiCoverImage(detail: BangumiDetail): AnimeItem["coverImage"] {
  const images = detail.images;
  if (!images) return null;
  return {
    large: images.large ?? images.common ?? null,
    medium: images.medium ?? images.common ?? null,
    small: images.small ?? images.grid ?? null,
    source: "bangumi"
  };
}

function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveIntegerOrNull(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
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
