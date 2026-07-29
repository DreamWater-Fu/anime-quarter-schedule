import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  inferUpdateWeekday,
  isValidDateString
} from "../src/server/anime/calculateSeason.ts";
import { getDefaultStorage } from "../src/server/cache/jsonFileStorage.ts";
import type { AnimeCache, AnimeItem, AnimeSource } from "../src/server/types/anime.ts";

const execFileAsync = promisify(execFile);
const now = new Date();
const today = now.toISOString().slice(0, 10);

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
  const details = await fetchBangumiDetails(ids);
  let ratingUpdated = 0;
  let episodeUpdated = 0;
  let statusUpdated = 0;

  const nextItems = cache.items.map((item) => {
    const subjectId = item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId;
    const detail = subjectId === null ? undefined : details.get(subjectId);
    if (!detail) return normalizeBroadcastState(item, fetchedAt);

    const next = mergeBangumiDetail(item, detail, fetchedAt);
    if (item.bangumi.rating === null && next.bangumi.rating !== null) ratingUpdated += 1;
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

  console.log(JSON.stringify({ requested: ids.length, found: details.size, ratingUpdated, episodeUpdated, statusUpdated }, null, 2));
}

async function fetchBangumiDetails(ids: number[]): Promise<Map<number, BangumiDetail>> {
  if (ids.length === 0) return new Map();
  const userAgent = process.env.BANGUMI_USER_AGENT || "anime-quarter-schedule-local/0.1.0 (contact: local-dev)";
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
      airedEpisodeCount: countAiredEpisodes(schedule),
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

function normalizeBroadcastState(item: AnimeItem, updatedAt: string): AnimeItem {
  const status = inferStatusFromDates(item.startDate, item.endDate);
  return {
    ...item,
    status,
    updatedAt
  };
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
