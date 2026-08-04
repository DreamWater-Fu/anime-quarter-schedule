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
