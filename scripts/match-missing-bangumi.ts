import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { getDefaultStorage } from "../src/server/cache/jsonFileStorage.ts";
import { repairMojibakeText } from "../src/server/anime/contentRules.ts";
import { shouldSearchMissingBangumi } from "../src/server/sources/bangumi/searchEnrichment.ts";
import { scoreBangumiCandidate } from "../src/server/sources/bangumi/matcher.ts";
import type { BangumiSubject, Candidate } from "../src/server/sources/bangumi/types.ts";
import type { AnimeCache, AnimeItem, AnimeSource, CoverImage } from "../src/server/types/anime.ts";

const execFileAsync = promisify(execFile);
const now = new Date().toISOString();
const batchLimit = readIntegerArg("--limit");

interface SearchRow {
  id: string;
  keyword: string;
  status: number;
  content?: string;
  error?: string;
}

async function main() {
  const storage = getDefaultStorage();
  const cache = await storage.readAnimeCache();
  const matched: Array<{ id: string; subjectId: number; title: string; score: number; fields: string[] }> = [];
  const failed: Array<{ id: string; title: string; error: string }> = [];
  const rejected: Array<{ id: string; title: string; subjectId: number; candidateTitle: string; score: number; fields: string[]; risks: string[] }> = [];
  const searchItems = cache.items.filter(shouldSearchMissingBangumi).slice(0, batchLimit ?? undefined);
  const searchResults = await fetchSearchResults(searchItems);

  const nextItems: AnimeItem[] = [];
  let changed = false;
  for (const item of cache.items) {
    if (!shouldSearchMissingBangumi(item)) {
      nextItems.push(item);
      continue;
    }
    if (!searchItems.some((candidate) => candidate.id === item.id)) {
      nextItems.push(item);
      continue;
    }

    const title = item.title.chinese ?? item.title.japanese ?? item.title.original;
    const subjects = searchResults.get(item.id);
    if (!subjects) {
      failed.push({
        id: item.id,
        title,
        error: "Bangumi search returned no usable response"
      });
      nextItems.push(item);
      continue;
    }
    const candidates = scoreSubjects(item, subjects);
    if (candidates.length === 0) {
      nextItems.push(item);
      continue;
    }
    const candidate = candidates[0];
    if (!candidate || !isAcceptedOnlineMatch(candidate, candidates[1])) {
      if (candidate && rejected.length < 30) {
        rejected.push({
          id: item.id,
          title,
          subjectId: candidate.subjectId,
          candidateTitle: candidate.nameCn ?? candidate.name,
          score: candidate.score,
          fields: candidate.matchedFields,
          risks: candidate.risks
        });
      }
      nextItems.push(item);
      continue;
    }

    nextItems.push(mergeBangumiSubject(item, candidate.subject, now));
    changed = true;
    matched.push({
      id: item.id,
      subjectId: candidate.subjectId,
      title,
      score: candidate.score,
      fields: candidate.matchedFields
    });
  }

  if (changed) {
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
  }

  console.log(JSON.stringify({
    eligible: cache.items.filter(shouldSearchMissingBangumi).length,
    processed: searchItems.length,
    matched: matched.length,
    failed: failed.length,
    rows: matched,
    rejected,
    failures: failed
  }, null, 2));
}

function scoreSubjects(item: AnimeItem, subjects: BangumiSubject[]): Candidate[] {
  const input = {
    title: item.title,
    year: item.primarySeason?.year ?? null,
    quarter: item.primarySeason?.quarter ?? null,
    startDate: item.startDate,
    format: item.format,
    episodeCount: item.episodeCount,
    officialUrl: item.officialUrl,
    studios: item.staff?.studio ?? [],
    sources: item.sources,
    existingBangumiId: null
  };

  return subjects
    .map((subject) => scoreBangumiCandidate(input, subject, { fromSearch: true, fromSeasonMonth: false }))
    .sort((left, right) => right.score - left.score);
}

function getSearchTitles(item: AnimeItem): string[] {
  return [
    item.title.japanese,
    item.title.chinese,
    item.title.original,
    item.title.english,
    ...item.title.aliases
  ]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .filter((value, index, values) => values.indexOf(value) === index);
}

async function fetchSearchResults(items: AnimeItem[]): Promise<Map<string, BangumiSubject[]>> {
  if (items.length === 0) return new Map();
  const userAgent = process.env.BANGUMI_USER_AGENT || "anime-quarter-schedule-local/0.1.1 (contact: local-dev)";
  const requests = items.map((item) => ({
    id: item.id,
    keywords: getSearchTitles(item).slice(0, 2)
  }));
  const script = String.raw`
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$requests = ConvertFrom-Json $env:BG_MATCH_REQUESTS
$UserAgent = $env:BG_MATCH_USER_AGENT
$result = New-Object System.Collections.Generic.List[object]
foreach ($entry in $requests) {
  foreach ($keyword in $entry.keywords) {
    try {
      $payload = @{ keyword = [string]$keyword; filter = @{ type = @(2) }; limit = 10 } | ConvertTo-Json -Compress -Depth 5
      $body = [System.Text.Encoding]::UTF8.GetBytes($payload)
      $response = Invoke-WebRequest -Uri "https://api.bgm.tv/v0/search/subjects" -Method POST -Headers @{"User-Agent"=$UserAgent; "Accept"="application/json"} -ContentType "application/json; charset=utf-8" -Body $body -UseBasicParsing -TimeoutSec 30
      $result.Add([pscustomobject]@{ id = [string]$entry.id; keyword = [string]$keyword; status = [int]$response.StatusCode; content = $response.Content })
    } catch {
      $result.Add([pscustomobject]@{ id = [string]$entry.id; keyword = [string]$keyword; status = 0; error = $_.Exception.Message })
    }
    Start-Sleep -Milliseconds 350
  }
}
$result | ConvertTo-Json -Depth 12 -Compress
`;
  const requestCount = requests.reduce((sum, item) => sum + item.keywords.length, 0);
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script
  ], {
    maxBuffer: 100 * 1024 * 1024,
    timeout: Math.max(60_000, requestCount * 20_000),
    env: {
      ...process.env,
      BG_MATCH_REQUESTS: JSON.stringify(requests),
      BG_MATCH_USER_AGENT: userAgent
    }
  });

  const raw = JSON.parse(stdout) as SearchRow[] | SearchRow;
  const rows = Array.isArray(raw) ? raw : [raw];
  const byItem = new Map<string, Map<number, BangumiSubject>>();
  for (const row of rows) {
    if (row.status !== 200 || !row.content) continue;
    const payload = JSON.parse(row.content.replace(/^\uFEFF/u, "")) as unknown;
    const subjects = extractSearchSubjects(payload);
    const bucket = byItem.get(row.id) ?? new Map<number, BangumiSubject>();
    for (const subject of subjects) bucket.set(subject.id, subject);
    byItem.set(row.id, bucket);
  }

  return new Map([...byItem].map(([id, subjects]) => [id, [...subjects.values()]]));
}

function extractSearchSubjects(payload: unknown): BangumiSubject[] {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  return rows.filter(isBangumiSubject).map(repairBangumiSubject);
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

function repairBangumiSubject(subject: BangumiSubject): BangumiSubject {
  return repairMojibakeValue(subject) as BangumiSubject;
}

function repairMojibakeValue(value: unknown): unknown {
  if (typeof value === "string") return repairMojibakeText(value);
  if (Array.isArray(value)) return value.map(repairMojibakeValue);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = repairMojibakeValue(nested);
    }
    return result;
  }
  return value;
}

function isAcceptedOnlineMatch(best: Candidate, second: Candidate | undefined): boolean {
  const blockingRisks = new Set([
    "format_conflict",
    "multiple_close_candidates"
  ]);
  if (best.risks.some((risk) => blockingRisks.has(risk))) return false;

  const hasStrongTitle = best.matchedFields.some((field) => field === "name" || field === "name_cn" || field === "english" || field === "alias");
  const hasAuxEvidence = best.matchedFields.some(
    (field) => field === "date" || field === "officialUrl" || field === "episodeCount" || field === "seasonToken" || field === "studio"
  );
  const lead = second ? best.score - second.score : 100;
  const hasOfficialUrl = best.matchedFields.includes("officialUrl");
  const hasDate = best.matchedFields.includes("date");
  const hasSeasonOrProductionEvidence =
    best.matchedFields.includes("seasonToken") ||
    best.matchedFields.includes("episodeCount") ||
    best.matchedFields.includes("studio");
  const hasCourMergeEvidence = hasOfficialUrl && hasSeasonOrProductionEvidence && best.score >= 50;
  const hasStrongOfficialEvidence = hasOfficialUrl && (hasDate || hasSeasonOrProductionEvidence) && best.score >= 55;
  if ((!hasStrongTitle || !hasAuxEvidence) && !hasStrongOfficialEvidence) {
    return false;
  }
  if (lead < 15 && !hasStrongOfficialEvidence && !hasCourMergeEvidence) return false;

  if (best.risks.includes("year_mismatch") && !hasCourMergeEvidence) {
    return false;
  }

  if (best.risks.includes("date_conflict") && !hasCourMergeEvidence) {
    return false;
  }
  if (best.risks.includes("season_token_mismatch") && !(hasOfficialUrl && (hasDate || hasSeasonOrProductionEvidence) && best.score >= 55)) {
    return false;
  }
  if (best.risks.includes("alias_only") && !(hasAuxEvidence && best.score >= 80)) {
    return false;
  }

  if (hasStrongOfficialEvidence && (hasStrongTitle || hasDate || hasSeasonOrProductionEvidence)) return true;
  if (hasCourMergeEvidence && (hasStrongTitle || hasDate)) return true;
  if (hasOfficialUrl && hasDate && best.score >= 60) return true;
  if (best.score >= 74) return true;
  return best.score >= 66 && best.matchedFields.includes("date") && lead >= 25;
}

function readIntegerArg(name: string): number | null {
  const index = process.argv.indexOf(name);
  if (index < 0) return null;
  const raw = process.argv[index + 1];
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function mergeBangumiSubject(item: AnimeItem, subject: BangumiSubject, retrievedAt: string): AnimeItem {
  const source: AnimeSource = {
    name: "Bangumi",
    type: "bangumi",
    url: `https://bgm.tv/subject/${subject.id}`,
    retrievedAt,
    scope: "metadata"
  };
  return {
    ...item,
    title: {
      ...item.title,
      japanese: item.title.japanese ?? subject.name,
      chinese: item.title.chinese ?? nonEmptyStringOrNull(subject.name_cn),
      aliases: [...new Set([...item.title.aliases, ...extractAliases(subject)])]
    },
    coverImage: mapBangumiCoverImage(subject) ?? item.coverImage,
    externalIds: {
      ...item.externalIds,
      bangumiSubjectId: subject.id
    },
    bangumi: {
      subjectId: subject.id,
      url: `https://bgm.tv/subject/${subject.id}`,
      rating: positiveNumberOrNull(subject.rating?.score),
      ratingCount: positiveIntegerOrNull(subject.rating?.total),
      rank: positiveIntegerOrNull(subject.rank) ?? positiveIntegerOrNull(subject.rating?.rank),
      lastSyncedAt: retrievedAt
    },
    sources: dedupeSources([...item.sources, source]),
    updatedAt: retrievedAt
  };
}

function mapBangumiCoverImage(subject: BangumiSubject): CoverImage | null {
  const images = subject.images;
  if (!images) return null;
  return {
    large: images.large ?? images.common ?? null,
    medium: images.medium ?? images.common ?? null,
    small: images.small ?? images.grid ?? null,
    source: "bangumi"
  };
}

function extractAliases(subject: BangumiSubject): string[] {
  if (!Array.isArray(subject.infobox)) return [];
  const result: string[] = [];
  for (const item of subject.infobox) {
    if (typeof item.key !== "string") continue;
    const key = item.key.normalize("NFKC").toLowerCase();
    if (!["别名", "別名", "aliases", "alias", "英文名", "english"].includes(key)) continue;
    result.push(...unknownToStrings(item.value));
  }
  return [...new Set(result.map((value) => value.trim()).filter(Boolean))];
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

function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
