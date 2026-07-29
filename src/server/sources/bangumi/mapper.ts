import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  inferUpdateWeekday,
  isValidDateString
} from "../../anime/calculateSeason.ts";
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
  const endDate = inferEndDate(schedule, rawEpisodeCounts.episodeCount);
  const rating = positiveNumberOrNull(subject.rating?.score);
  const now = options.now ?? new Date();
  const updateWeekday = inferUpdateWeekday({ schedule, startDate });
  const source = createBangumiSource(subject, retrievedAt);
  const japanDecision = resolveJapaneseAnimeDecision(subject);
  const inclusionStatus: InclusionStatus = japanDecision.isJapaneseAnime
    ? formatMapping.inclusionStatus
    : "excluded";
  const exclusionReason = japanDecision.isJapaneseAnime
    ? formatMapping.exclusionReason
    : japanDecision.reason;

  return {
    id: `anime:${subject.id}`,
    title: {
      original: subject.name,
      japanese: subject.name,
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
      hasEpisodeCountConflict: rawEpisodeCounts.hasConflict,
      rating,
      updateTime: null
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

  if (/(日本|japan|japanese)/iu.test(haystack)) return { isJapaneseAnime: true };

  const explicitNonJapanesePattern =
    /(中国|中國|国产|國產|大陆|大陸|台湾|台灣|香港|美国|美國|加拿大|canada|韓国|韩国|south park|paw patrol|汪汪队|汪汪隊|柯蒂斯总统|柯蒂斯總統|curtis|ninjago|lego|乐高|樂高|幻影忍者|喜羊羊|灰太狼|超能猩云队|大头儿子|大頭兒子|小头爸爸|小頭爸爸|無涯之約|无涯之约|東游記|东游记|开心超人|開心超人|熊出没|熊出沒|猪猪侠|豬豬俠|primal|genndy\s+tartakovsky|史前战纪|野蛮纪源|原始战纪|熊熊帮帮团|卡酷动画春晚|恶搞之家|family\s+guy|spider-man|spider man|蜘蛛侠与他的神奇朋友们|sealook|pinkfong|baby\s*shark)/iu;
  if (explicitNonJapanesePattern.test(haystack)) {
    return { isJapaneseAnime: false, reason: "Not Japanese anime" };
  }

  const explicitAdultPattern =
    /(r-?18|18\+|nsfw|adult|アダルト|成人|里番|裏番|僧侣档|僧侶枠|オンエア版|無修正|av女优|av女優|セックス|sex)/iu;
  if (explicitAdultPattern.test(haystack)) {
    return { isJapaneseAnime: false, reason: "R18 or adult content" };
  }

  if (/[ぁ-ゖァ-ヺー]/u.test(subject.name)) return { isJapaneseAnime: true };

  return { isJapaneseAnime: true };
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
  rating: number | null;
  updateTime: string | null;
}): AnimeItem["dataStatus"] {
  if (
    input.startDate === null ||
    input.scheduleCount === 0 ||
    input.hasEpisodeCountConflict ||
    input.rating === null ||
    input.updateTime === null
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

function inferEndDate(schedule: AnimeItem["schedule"], episodeCount: number | null): string | null {
  if (schedule.length === 0) return null;
  if (episodeCount !== null && schedule.length < episodeCount) return null;
  return schedule[schedule.length - 1]?.airDate ?? null;
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
  return [...new Set(aliases.filter((alias) => alias !== subject.name && alias !== subject.name_cn))];
}

function extractOfficialUrl(subject: BangumiSubject): string | null {
  return extractFirstStringFromInfobox(subject, ["官方网站", "官网", "公式サイト", "Official website"]);
}

function extractFirstStringFromInfobox(subject: BangumiSubject, keys: string[]): string | null {
  return extractStringListFromInfobox(subject, keys)[0] ?? null;
}

function extractStringListFromInfobox(subject: BangumiSubject, keys: string[]): string[] {
  if (!Array.isArray(subject.infobox)) return [];
  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  const result: string[] = [];

  for (const item of subject.infobox) {
    const key = item.key?.toLowerCase();
    if (!key || !normalizedKeys.has(key)) continue;
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
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function positiveNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function positiveIntegerOrNull(value: unknown): number | null {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : null;
}
