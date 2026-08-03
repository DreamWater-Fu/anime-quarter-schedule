import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  inferUpdateWeekday,
  isValidDateString
} from "../../anime/calculateSeason.ts";
import {
  hasExplicitExcludedBangumiSubjectId,
  hasExplicitNonJapaneseBangumiSubjectId,
  hasExplicitNonJapaneseMetadataSignal,
  hasExplicitNonJapaneseSignal,
  hasForeignPrimaryTitleSignal,
  hasKnownNonTvSpecialSignal,
  hasOverSeasonLimitSignal,
  hasTheatricalMovieSignal,
  normalizeContentText,
  repairMojibakeText
} from "../../anime/contentRules.ts";
import type { AnimeItem, AnimeSource, CoverImage, DatePrecision, InclusionStatus } from "../../types/anime.ts";
import type { BangumiEpisode, BangumiFormatMapping, BangumiMapperOptions, BangumiSubject } from "./types.ts";

export function mapBangumiSubjectToAnimeItem(
  subject: BangumiSubject,
  episodes: BangumiEpisode[],
  options: BangumiMapperOptions
): AnimeItem {
  const retrievedAt = options.retrievedAt;
  const startDate = normalizeBangumiDate(subject.date);
  const primarySeason = calculatePrimarySeason(startDate);
  const schedule = mapBangumiEpisodesToSchedule(episodes);
  const activeSeasons = calculateActiveSeasons({ schedule, fallbackPrimarySeason: primarySeason });
  const formatMapping = mapBangumiPlatformToFormat(subject.platform);
  const rawEpisodeCounts = resolveEpisodeCounts({
    episodeCount: positiveIntegerOrNull(subject.eps) ?? positiveIntegerOrNull(subject.total_episodes),
    airedEpisodeCount: schedule.length > 0 ? schedule.length : positiveIntegerOrNull(subject.total_episodes)
  });
  const now = options.now ?? new Date();
  const endDate = inferEndDate({
    schedule,
    episodeCount: rawEpisodeCounts.episodeCount,
    startDate,
    now
  });
  const rating = positiveNumberOrNull(subject.rating?.score);
  const updateWeekday = inferUpdateWeekday({ schedule, startDate });
  const source = createBangumiSource(subject, retrievedAt);
  const japanDecision = resolveJapaneseAnimeDecision(subject);
  const contentExclusionReason = resolveContentExclusionReason(subject);
  const inclusionStatus: InclusionStatus = japanDecision.isJapaneseAnime && contentExclusionReason === null
    ? formatMapping.inclusionStatus
    : "excluded";
  const exclusionReason = !japanDecision.isJapaneseAnime
    ? japanDecision.reason
    : contentExclusionReason ?? formatMapping.exclusionReason;

  return {
    id: `anime:${subject.id}`,
    title: {
      original: repairMojibakeText(subject.name),
      japanese: repairMojibakeText(subject.name),
      chinese: nonEmptyStringOrNull(subject.name_cn),
      english: null,
      aliases: extractAliases(subject)
    },
    format: formatMapping.format,
    status: inferStatus(startDate, endDate, now),
    startDate,
    endDate,
    datePrecision: inferDatePrecision(subject.date),
    primarySeason,
    activeSeasons,
    updateWeekday,
    updateTime: null,
    timezone: "Asia/Tokyo",
    episodeCount: rawEpisodeCounts.episodeCount,
    airedEpisodeCount: rawEpisodeCounts.airedEpisodeCount,
    isJapaneseAnime: japanDecision.isJapaneseAnime,
    inclusionStatus,
    ...(exclusionReason ? { exclusionReason } : {}),
    officialUrl: extractOfficialUrl(subject),
    coverImage: mapCoverImage(subject),
    externalIds: {
      bangumiSubjectId: subject.id,
      bahamutSn: null
    },
    bangumi: {
      subjectId: subject.id,
      url: `https://bgm.tv/subject/${subject.id}`,
      rating,
      ratingCount: positiveIntegerOrNull(subject.rating?.total),
      rank: positiveIntegerOrNull(subject.rank) ?? positiveIntegerOrNull(subject.rating?.rank),
      lastSyncedAt: retrievedAt
    },
    schedule: schedule.map((item) => ({ ...item, source })),
    staff: {
      studio: extractStringListFromInfobox(subject, ["动画制作", "アニメーション制作", "制作公司", "studio"]),
      productionCommittee: [],
      originalWorkType: extractFirstStringFromInfobox(subject, ["原作", "原作类型"])
    },
    sources: [source],
    dataStatus: resolveBangumiOnlyDataStatus({
      startDate,
      scheduleCount: schedule.length,
      hasEpisodeCountConflict: rawEpisodeCounts.hasConflict
    }),
    updatedAt: retrievedAt,
    createdAt: retrievedAt
  };
}

export function mapBangumiEpisodesToSchedule(episodes: BangumiEpisode[]): AnimeItem["schedule"] {
  return episodes
    .filter((episode) => episode.type === undefined || episode.type === 0)
    .filter((episode) => isValidDateString(episode.airdate))
    .map((episode) => ({
      episodeNumber: positiveIntegerOrNull(episode.ep) ?? positiveIntegerOrNull(episode.sort),
      episodeTitle: nonEmptyStringOrNull(episode.name_cn) ?? nonEmptyStringOrNull(episode.name),
      airDate: episode.airdate!,
      airTime: null,
      timezone: "Asia/Tokyo" as const,
      status: "confirmed" as const
    }));
}

function createBangumiSource(subject: BangumiSubject, retrievedAt: string): AnimeSource {
  return {
    name: "Bangumi",
    type: "bangumi",
    url: `https://bgm.tv/subject/${subject.id}`,
    retrievedAt,
    scope: "metadata"
  };
}

function resolveJapaneseAnimeDecision(subject: BangumiSubject): { isJapaneseAnime: boolean; reason?: string } {
  if (subject.nsfw === true) return { isJapaneseAnime: false, reason: "R18 or NSFW content" };
  if (hasExplicitNonJapaneseBangumiSubjectId(subject.id)) {
    return { isJapaneseAnime: false, reason: "Not Japanese anime" };
  }

  const titleValuesForOrigin = [
    subject.name,
    subject.name_cn,
    extractOfficialUrl(subject),
    ...extractAliases(subject)
  ];
  const metadataValuesForOrigin = [
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
  if (
    hasExplicitNonJapaneseSignal(titleValuesForOrigin) ||
    hasForeignPrimaryTitleSignal(subject.name) ||
    hasExplicitNonJapaneseMetadataSignal([...metadataValuesForOrigin, ...titleValuesForOrigin])
  ) {
    return { isJapaneseAnime: false, reason: "Not Japanese anime" };
  }

  const haystack = [
    subject.name,
    subject.name_cn,
    subject.platform,
    extractOfficialUrl(subject),
    ...extractStringListFromInfobox(subject, [
      "国家",
      "国家/地区",
      "地区",
      "产地",
      "製作国家",
      "制作国家",
      "制作",
      "製作",
      "出品",
      "企画",
      "Country"
    ])
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();

  if (hasExplicitNonJapaneseSignal([haystack])) {
    return { isJapaneseAnime: false, reason: "Not Japanese anime" };
  }
  if (/(日本|japan|japanese)/iu.test(haystack)) return { isJapaneseAnime: true };

  const explicitAdultPattern =
    /(r-?18|18\+|nsfw|adult|アダルト|成人|里番|裏番|僧侣档|僧侶枠|オンエア版|無修正|av女优|av女優|セックス|sex)/iu;
  if (explicitAdultPattern.test(haystack)) {
    return { isJapaneseAnime: false, reason: "R18 or adult content" };
  }

  if (/[ぁ-ゖァ-ヺー]/u.test(subject.name)) return { isJapaneseAnime: true };

  return { isJapaneseAnime: true };
}

function resolveContentExclusionReason(subject: BangumiSubject): string | null {
  if (hasExplicitExcludedBangumiSubjectId(subject.id)) return "Known out-of-scope subject";

  const values = [
    subject.name,
    subject.name_cn,
    subject.platform,
    extractOfficialUrl(subject),
    ...extractStringListFromInfobox(subject, ["别名", "aliases", "Alias", "英文名", "English"])
  ];
  if (hasTheatricalMovieSignal(values)) return "Theatrical movie";
  if (hasKnownNonTvSpecialSignal(values)) return "Non-TV special";
  if (hasOverSeasonLimitSignal(values)) return "Season number exceeds 10";
  return null;
}

export function mapBangumiPlatformToFormat(platform: string | undefined): BangumiFormatMapping {
  const value = (platform ?? "").toLowerCase();

  if (value.includes("tv")) return { format: "tv", inclusionStatus: "included" };
  if (value.includes("web") || value.includes("ona") || value.includes("网络")) {
    return { format: "web", inclusionStatus: "included" };
  }
  if (value.includes("ova") || value.includes("oad")) return { format: "ova", inclusionStatus: "optional" };
  if (value.includes("movie") || value.includes("剧场") || value.includes("映画")) {
    return { format: "movie", inclusionStatus: "optional" };
  }
  if (value.includes("sp") || value.includes("special")) return { format: "sp", inclusionStatus: "optional" };

  return { format: "unknown", inclusionStatus: "needs_review" };
}

function resolveBangumiOnlyDataStatus(input: {
  startDate: string | null;
  scheduleCount: number;
  hasEpisodeCountConflict: boolean;
}): AnimeItem["dataStatus"] {
  if (
    input.startDate === null ||
    input.scheduleCount === 0 ||
    input.hasEpisodeCountConflict
  ) {
    return "partial";
  }
  return "complete";
}

function resolveEpisodeCounts(input: {
  episodeCount: number | null;
  airedEpisodeCount: number | null;
}): {
  episodeCount: number | null;
  airedEpisodeCount: number | null;
  hasConflict: boolean;
} {
  if (
    input.episodeCount !== null &&
    input.airedEpisodeCount !== null &&
    input.airedEpisodeCount > input.episodeCount
  ) {
    return {
      episodeCount: null,
      airedEpisodeCount: input.airedEpisodeCount,
      hasConflict: true
    };
  }

  return {
    episodeCount: input.episodeCount,
    airedEpisodeCount: input.airedEpisodeCount,
    hasConflict: false
  };
}

function normalizeBangumiDate(value: string | undefined): string | null {
  return isValidDateString(value) ? value : null;
}

function inferDatePrecision(value: string | undefined): DatePrecision {
  if (isValidDateString(value)) return "day";
  if (typeof value === "string" && /^\d{4}-\d{2}$/.test(value)) return "month";
  if (typeof value === "string" && /^\d{4}$/.test(value)) return "year";
  return "unknown";
}

function inferStatus(
  startDate: string | null,
  endDate: string | null,
  now: Date
): AnimeItem["status"] {
  if (startDate !== null && Date.parse(`${startDate}T00:00:00+09:00`) > now.getTime()) return "announced";
  if (endDate !== null && Date.parse(`${endDate}T23:59:59+09:00`) < now.getTime()) return "finished";
  return startDate === null ? "unknown" : "airing";
}

function inferEndDate(input: {
  schedule: AnimeItem["schedule"];
  episodeCount: number | null;
  startDate: string | null;
  now: Date;
}): string | null {
  const { schedule, episodeCount, startDate, now } = input;
  if (schedule.length > 0) {
    if (episodeCount !== null && schedule.length < episodeCount) return inferWeeklyEndDate(startDate, episodeCount);
    return schedule[schedule.length - 1]?.airDate ?? null;
  }
  if (episodeCount !== null) return inferWeeklyEndDate(startDate, episodeCount);
  if (startDate !== null && isHistoricalSeason(startDate, now)) return inferSeasonEndDate(startDate);
  return null;
}

function inferWeeklyEndDate(startDate: string | null, episodeCount: number): string | null {
  if (startDate === null || episodeCount <= 0) return null;
  return shiftDate(startDate, (episodeCount - 1) * 7);
}

function isHistoricalSeason(startDate: string, now: Date): boolean {
  const seasonEnd = Date.parse(`${inferSeasonEndDate(startDate)}T23:59:59+09:00`);
  return Number.isFinite(seasonEnd) && now.getTime() - seasonEnd > 90 * 86_400_000;
}

function inferSeasonEndDate(startDate: string): string {
  const date = new Date(`${startDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) return startDate;
  const month = date.getUTCMonth() + 1;
  const quarterStartMonth = month <= 3 ? 1 : month <= 6 ? 4 : month <= 9 ? 7 : 10;
  const quarterEndMonth = quarterStartMonth + 2;
  return new Date(Date.UTC(date.getUTCFullYear(), quarterEndMonth, 0)).toISOString().slice(0, 10);
}

function shiftDate(date: string, days: number): string | null {
  const time = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  return new Date(time + days * 86_400_000).toISOString().slice(0, 10);
}

function mapCoverImage(subject: BangumiSubject): CoverImage | null {
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
  const aliases = [
    ...extractStringListFromInfobox(subject, ["别名", "aliases", "Alias"]),
    ...extractStringListFromInfobox(subject, ["英文名", "English"])
  ];
  const subjectNames = new Set([repairMojibakeText(subject.name), nonEmptyStringOrNull(subject.name_cn)].filter(Boolean));
  return [...new Set(aliases.filter((alias) => !subjectNames.has(alias)))];
}

function extractOfficialUrl(subject: BangumiSubject): string | null {
  return extractFirstStringFromInfobox(subject, ["官方网站", "官网", "公式サイト", "Official website"]);
}

function extractFirstStringFromInfobox(subject: BangumiSubject, keys: string[]): string | null {
  return extractStringListFromInfobox(subject, keys)[0] ?? null;
}

function extractStringListFromInfobox(subject: BangumiSubject, keys: string[]): string[] {
  if (!Array.isArray(subject.infobox)) return [];
  const normalizedKeys = new Set(keys.map(normalizeContentText));
  const result: string[] = [];

  for (const item of subject.infobox) {
    const key = typeof item.key === "string" ? normalizeContentText(item.key) : null;
    if (!key || !normalizedKeys.has(key)) continue;
    result.push(...unknownToStrings(item.value));
  }

  return [...new Set(result.map((value) => repairMojibakeText(value).trim()).filter(Boolean))];
}

function extractBangumiTagNames(subject: BangumiSubject): string[] {
  if (!Array.isArray(subject.tags)) return [];
  return subject.tags
    .map((tag) => tag.name)
    .filter((value): value is string => typeof value === "string")
    .map((value) => repairMojibakeText(value).trim())
    .filter(Boolean);
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
  if (typeof value !== "string") return null;
  const repaired = repairMojibakeText(value).trim();
  return repaired !== "" ? repaired : null;
}

function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveIntegerOrNull(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}
