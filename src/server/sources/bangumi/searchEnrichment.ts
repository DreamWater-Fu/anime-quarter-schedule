import { setTimeout as delay } from "node:timers/promises";

import { isCacheEligibleAnime } from "../../anime/cacheEligibility.ts";
import type { AnimeItem, AnimeSource, CoverImage } from "../../types/anime.ts";
import { BangumiApiClient } from "./client.ts";
import { generateBangumiSearchTitles, scoreBangumiCandidate } from "./matcher.ts";
import type { BangumiClient, BangumiSubject, Candidate } from "./types.ts";

export interface BangumiSearchEnrichmentResult {
  items: AnimeItem[];
  matched: number;
  failed: number;
}

export interface BangumiDetailRefreshResult {
  items: AnimeItem[];
  refreshed: number;
  failed: number;
}

export interface BangumiSearchEnrichmentOptions {
  client?: Pick<BangumiClient, "searchSubjects"> & Partial<Pick<BangumiClient, "getSubject">>;
  now?: () => Date;
  maxSearchTitles?: number;
}

export async function enrichMissingBangumiBySearch(
  items: AnimeItem[],
  options: BangumiSearchEnrichmentOptions = {}
): Promise<BangumiSearchEnrichmentResult> {
  const client = options.client ?? new BangumiApiClient({ usePowerShellFallback: process.platform === "win32" });
  const retrievedAt = (options.now?.() ?? new Date()).toISOString();
  const maxSearchTitles = options.maxSearchTitles ?? 8;
  let matched = 0;
  let failed = 0;
  const nextItems: AnimeItem[] = [];

  for (const item of items) {
    if (!shouldSearchMissingBangumi(item)) {
      nextItems.push(item);
      continue;
    }

    const explicitSubjectId = getExplicitBangumiSubjectId(item);
    if (explicitSubjectId !== null && client.getSubject) {
      try {
        const subject = await fetchSubjectDetailStrict(client, explicitSubjectId);
        nextItems.push(mergeBangumiSubject(item, subject, retrievedAt));
        matched += 1;
        continue;
      } catch {
        // Fall back to normal search so a temporary detail failure does not block other matches.
      }
    }

    const subjects = await fetchSearchSubjects(client, item, maxSearchTitles);
    if (subjects === null) {
      failed += 1;
      nextItems.push(item);
      continue;
    }

    const candidates = scoreSubjects(item, subjects);
    const candidate = candidates[0];
    if (!candidate || !isAcceptedOnlineMatch(candidate, candidates[1])) {
      nextItems.push(item);
      continue;
    }

    const subject = await fetchSubjectDetail(client, candidate.subject);
    nextItems.push(mergeBangumiSubject(item, subject, retrievedAt));
    matched += 1;
  }

  return { items: nextItems, matched, failed };
}

export async function refreshBangumiDetailsForItems(
  items: AnimeItem[],
  options: BangumiSearchEnrichmentOptions = {}
): Promise<BangumiDetailRefreshResult> {
  const client = options.client ?? new BangumiApiClient({ usePowerShellFallback: process.platform === "win32" });
  const retrievedAt = (options.now?.() ?? new Date()).toISOString();
  let refreshed = 0;
  let failed = 0;
  const nextItems: AnimeItem[] = [];

  for (const item of items) {
    const subjectId = item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId;
    if (subjectId === null || !shouldRefreshBangumiDetail(item)) {
      nextItems.push(item);
      continue;
    }
    if (!client.getSubject) {
      nextItems.push(item);
      continue;
    }

    try {
      const subject = await fetchSubjectDetailStrict(client, subjectId);
      nextItems.push(mergeBangumiSubject(item, subject, retrievedAt));
      refreshed += 1;
    } catch {
      failed += 1;
      nextItems.push(item);
    }
  }

  return { items: nextItems, refreshed, failed };
}

function shouldRefreshBangumiDetail(item: AnimeItem): boolean {
  return item.bangumi.rating === null || item.coverImage?.source !== "bangumi";
}

async function fetchSubjectDetail(
  client: Pick<BangumiClient, "searchSubjects"> & Partial<Pick<BangumiClient, "getSubject">>,
  subject: BangumiSubject
): Promise<BangumiSubject> {
  if (!client.getSubject) return subject;
  try {
    return await fetchSubjectDetailStrict(client, subject.id);
  } catch {
    return subject;
  }
}

async function fetchSubjectDetailStrict(
  client: Pick<BangumiClient, "searchSubjects"> & Partial<Pick<BangumiClient, "getSubject">>,
  subjectId: number
): Promise<BangumiSubject> {
  if (!client.getSubject) {
    throw new Error("Bangumi subject detail is unavailable");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await client.getSubject(subjectId);
    } catch (error) {
      lastError = error;
      if (attempt === 0) await delay(1_500);
    }
  }
  throw lastError;
}

export function shouldSearchMissingBangumi(item: AnimeItem): boolean {
  const subjectId = item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId;
  return (
    isCacheEligibleAnime(item) &&
    subjectId === null &&
    item.sources.some((source) =>
      source.name === "YucWiki" ||
      (source.name === "YourAnimes" && source.scope === "japan_broadcast")
    )
  );
}

function getExplicitBangumiSubjectId(item: AnimeItem): number | null {
  const titles = [
    item.title.original,
    item.title.japanese,
    item.title.chinese,
    item.title.english,
    ...item.title.aliases
  ].filter((value): value is string => typeof value === "string");

  if (titles.some((title) => /終末のワルキューレ|终末的女武神|Record of Ragnarok|Shuumatsu no (?:Walkure|Valkyrie)/iu.test(title))) {
    return 322900;
  }

  if (
    item.startDate === "2021-04-10" &&
    titles.some((title) => /東京卍?リベンジャーズ|东京卍?复仇者|Tokyo Revengers/iu.test(title))
  ) {
    return 308936;
  }

  if (
    item.startDate === "2020-10-01" &&
    titles.some((title) => /ひぐらしのなく頃に|新\s*寒蝉鸣泣之时|寒蝉鸣泣之时\s*业/iu.test(title))
  ) {
    return 297969;
  }

  if (
    item.startDate === "2021-04-01" &&
    titles.some((title) => /シャーマンキング|新\s*通灵王|SHAMAN KING/iu.test(title))
  ) {
    return 308558;
  }

  if (
    item.startDate === "2021-10-08" &&
    titles.some((title) => /終末のハーレム|终末的后宫|World'?s End Harem/iu.test(title))
  ) {
    return 306559;
  }

  if (
    item.startDate === "2021-04-04" &&
    titles.some((title) => /キングダム\s*第3シリーズ|王者天下\s*第3期|Kingdom\s*(?:3rd|Third)/iu.test(title))
  ) {
    return 294288;
  }

  if (
    item.startDate === "2020-01-10" &&
    titles.some((title) => /とある科学の超電磁砲(?:レールガン)?T\.?|某科学的超电磁炮\s*(?:第3期|T)|Toaru Kagaku no Railgun T/iu.test(title))
  ) {
    return 262940;
  }

  return null;
}

async function fetchSearchSubjects(
  client: Pick<BangumiClient, "searchSubjects">,
  item: AnimeItem,
  maxSearchTitles: number
): Promise<BangumiSubject[] | null> {
  const titles = generateBangumiSearchTitles(
    {
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
    },
    maxSearchTitles
  );
  const subjectsById = new Map<number, BangumiSubject>();
  let usableResponse = false;

  for (const keyword of titles) {
    try {
      const subjects = await client.searchSubjects({ keyword, type: [2], limit: 10 });
      usableResponse = true;
      for (const subject of subjects) subjectsById.set(subject.id, subject);
      const candidates = scoreSubjects(item, [...subjectsById.values()]);
      const candidate = candidates[0];
      if (candidate && isAcceptedOnlineMatch(candidate, candidates[1])) break;
    } catch {
      // A later keyword may still work; report failure only when every search fails.
    }
  }

  return usableResponse ? [...subjectsById.values()] : null;
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
  if ((!hasStrongTitle || !hasAuxEvidence) && !hasStrongOfficialEvidence) return false;
  if (lead < 15 && !hasStrongOfficialEvidence && !hasCourMergeEvidence) return false;
  if (best.risks.includes("year_mismatch") && !hasCourMergeEvidence) return false;
  if (best.risks.includes("date_conflict") && !hasCourMergeEvidence) return false;
  if (best.risks.includes("season_token_mismatch") && !(hasOfficialUrl && (hasDate || hasSeasonOrProductionEvidence) && best.score >= 55)) {
    return false;
  }
  if (best.risks.includes("alias_only") && !(hasAuxEvidence && best.score >= 80)) return false;

  if (hasStrongOfficialEvidence && (hasStrongTitle || hasDate || hasSeasonOrProductionEvidence)) return true;
  if (hasCourMergeEvidence && (hasStrongTitle || hasDate)) return true;
  if (hasOfficialUrl && hasDate && best.score >= 60) return true;
  if (best.score >= 74) return true;
  return best.score >= 66 && best.matchedFields.includes("date") && lead >= 25;
}

function mergeBangumiSubject(item: AnimeItem, subject: BangumiSubject, retrievedAt: string): AnimeItem {
  const source: AnimeSource = {
    name: "Bangumi",
    type: "bangumi",
    url: `https://bgm.tv/subject/${subject.id}`,
    retrievedAt,
    scope: "metadata"
  };
  const episodeCount = positiveIntegerOrNull(subject.eps) ?? positiveIntegerOrNull(subject.total_episodes);
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
    episodeCount: item.episodeCount ?? episodeCount,
    airedEpisodeCount: item.airedEpisodeCount ?? episodeCount,
    sources: dedupeSources([...item.sources, source]),
    updatedAt: retrievedAt
  };
}

function extractAliases(subject: BangumiSubject): string[] {
  if (!Array.isArray(subject.infobox)) return [];
  const aliases: string[] = [];
  for (const item of subject.infobox) {
    if (!item.key || !/别名|別名|alias|英文名|日文名|中文名/iu.test(item.key)) continue;
    aliases.push(...unknownToStrings(item.value));
  }
  return [...new Set(aliases.map((value) => value.trim()).filter(Boolean))];
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

function dedupeSources(sources: AnimeSource[]): AnimeSource[] {
  const seen = new Set<string>();
  const result: AnimeSource[] = [];
  for (const source of sources) {
    const key = `${source.name}:${source.type}:${source.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(source);
  }
  return result;
}

function nonEmptyStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveIntegerOrNull(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}
