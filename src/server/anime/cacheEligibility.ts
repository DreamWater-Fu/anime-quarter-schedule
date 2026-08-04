import type { AnimeItem } from "../types/anime.ts";
import {
  hasExplicitExcludedBangumiSubjectId,
  hasExplicitNonJapaneseSignal,
  hasForeignPrimaryTitleSignal,
  hasKnownNonTvSpecialSignal,
  hasOverSeasonLimitSignal,
  hasTheatricalMovieSignal
} from "./contentRules.ts";

const ADULT_ANIME_PATTERN =
  /(インゴクダンチ|淫狱团地|淫獄団地|r-?18|18\+|nsfw|adult|アダルト|成人|里番|裏番|僧侣档|僧侶枠|オンエア版|無修正|av女优|av女優|セックス|sex)/iu;

export function isCacheEligibleAnime(item: AnimeItem): boolean {
  const textValues = getAnimeTextValues(item);
  const subjectId = item.bangumi.subjectId ?? item.externalIds.bangumiSubjectId;
  return (
    item.format === "tv" &&
    hasCatalogAdmissionSignal(item) &&
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

function hasCatalogAdmissionSignal(item: AnimeItem): boolean {
  if (!isBangumiOnlyItem(item)) return true;
  return hasStrongJapaneseTvEvidence(item);
}

function isBangumiOnlyItem(item: AnimeItem): boolean {
  return item.sources.length > 0 && item.sources.every((source) => source.name === "Bangumi");
}

function hasStrongJapaneseTvEvidence(item: AnimeItem): boolean {
  return (
    hasJapaneseKanaSignal(item.title.original) ||
    hasJapaneseKanaSignal(item.title.japanese) ||
    hasJapaneseOfficialSignal(item.officialUrl) ||
    hasJapaneseStaffSignal(item) ||
    hasNonBangumiScheduleSource(item)
  );
}

function hasNonBangumiScheduleSource(item: AnimeItem): boolean {
  return item.schedule.some((scheduleItem) => scheduleItem.source && scheduleItem.source.name !== "Bangumi");
}

function hasJapaneseKanaSignal(value: string | null | undefined): boolean {
  return typeof value === "string" && /[ぁ-ゖァ-ヺー]/u.test(value);
}

function hasJapaneseOfficialSignal(value: string | null | undefined): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  return (
    /\.jp(?:[/?#]|$)/iu.test(normalized) ||
    /(?:tv-tokyo|nhk|bs11|at-x|toei|shopro|vap\.co\.jp|tokyo-mx|mbs|tbs|fujitv|ytv|ntv|tv-asahi)/iu.test(normalized)
  );
}

function hasJapaneseStaffSignal(item: AnimeItem): boolean {
  const values = [
    ...(item.staff?.studio ?? []),
    ...(item.staff?.productionCommittee ?? []),
    item.staff?.originalWorkType
  ];
  return values.some((value) => hasJapaneseKanaSignal(value));
}

function isAdultAnime(item: AnimeItem): boolean {
  const haystack = getAnimeTextValues(item)
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .normalize("NFKC")
    .toLowerCase();
  return ADULT_ANIME_PATTERN.test(haystack);
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
