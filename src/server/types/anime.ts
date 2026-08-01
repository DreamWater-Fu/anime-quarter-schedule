export type AnimeQuarter = "winter" | "spring" | "summer" | "fall";
export type SeasonMonth = 1 | 4 | 7 | 10;

export type AnimeFormat =
  | "tv"
  | "web"
  | "ova"
  | "movie"
  | "sp"
  | "recap"
  | "pv"
  | "cm"
  | "music_video"
  | "rebroadcast"
  | "unknown";

export type AnimeStatus =
  | "announced"
  | "airing"
  | "finished"
  | "delayed"
  | "cancelled"
  | "unknown";

export type ScheduleStatus =
  | "confirmed"
  | "tentative"
  | "changed"
  | "delayed"
  | "unknown";

export type DataSourceType =
  | "official"
  | "tv_station"
  | "streaming_platform"
  | "bangumi"
  | "third_party"
  | "ai_inferred"
  | "manual";

export type DataStatus = "complete" | "partial" | "conflicting" | "unverified";
export type AnimeTimezone = "Asia/Tokyo" | "Asia/Shanghai";

export interface SeasonKey {
  year: number;
  quarter: AnimeQuarter;
}

export interface AnimeSource {
  name: string;
  type: DataSourceType;
  url?: string;
  retrievedAt: string;
  confidence?: number;
  scope?: "japan_broadcast" | "japan_streaming" | "taiwan_streaming" | "metadata" | "manual_review";
}

export interface AnimeTitle {
  original: string;
  japanese: string | null;
  chinese: string | null;
  english: string | null;
  aliases: string[];
}

export interface CoverImage {
  large: string | null;
  medium: string | null;
  small: string | null;
  source: "bangumi" | "official" | "manual" | null;
}

export interface ExternalIds {
  bangumiSubjectId: number | null;
  bahamutSn: string | null;
}

export interface BangumiInfo {
  subjectId: number | null;
  url: string | null;
  rating: number | null;
  ratingCount: number | null;
  rank: number | null;
  lastSyncedAt: string | null;
}

export interface AnimeScheduleItem {
  episodeNumber: number | null;
  episodeTitle: string | null;
  airDate: string;
  airTime: string | null;
  timezone: AnimeTimezone;
  status: ScheduleStatus;
  source?: AnimeSource;
  rawTimeText?: string | null;
}

export interface AnimeStaff {
  studio: string[];
  productionCommittee: string[];
  originalWorkType: string | null;
}

export type InclusionStatus = "included" | "optional" | "excluded" | "needs_review";
export type DatePrecision = "day" | "month" | "year" | "unknown";

export interface AnimeItem {
  id: string;
  title: AnimeTitle;
  format: AnimeFormat;
  status: AnimeStatus;
  startDate: string | null;
  endDate: string | null;
  datePrecision: DatePrecision;
  primarySeason: SeasonKey | null;
  activeSeasons: SeasonKey[];
  updateWeekday: number | null;
  updateTime: string | null;
  timezone: AnimeTimezone;
  episodeCount: number | null;
  airedEpisodeCount: number | null;
  isJapaneseAnime: boolean;
  inclusionStatus: InclusionStatus;
  exclusionReason?: string;
  officialUrl: string | null;
  coverImage: CoverImage | null;
  externalIds: ExternalIds;
  bangumi: BangumiInfo;
  schedule: AnimeScheduleItem[];
  staff: AnimeStaff | null;
  sources: AnimeSource[];
  dataStatus: DataStatus;
  updatedAt: string;
  createdAt: string;
}

export interface AnimeCache {
  schemaVersion: 1;
  updatedAt: string | null;
  generatedBy: "manual-update" | "manual-edit" | "migration";
  items: AnimeItem[];
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface AnimeSeasonPayload {
  year: number;
  season: SeasonMonth;
  quarter: AnimeQuarter;
  items: AnimeItem[];
  meta: {
    total: number;
    cacheUpdatedAt: string | null;
    dataStatusSummary: Record<DataStatus, number>;
  };
}

export interface AnimeSearchResult {
  id: string;
  title: AnimeTitle;
  displayTitle: string;
  secondaryTitle: string | null;
  matchedTitle: string;
  startDate: string | null;
  primarySeason: SeasonKey | null;
  status: AnimeStatus;
}

export interface AnimeSearchPayload {
  query: string;
  results: AnimeSearchResult[];
  meta: {
    total: number;
    cacheUpdatedAt: string | null;
  };
}

export interface AnimeItemsPayload {
  ids: string[];
  items: AnimeItem[];
  meta: {
    total: number;
    cacheUpdatedAt: string | null;
  };
}

export const DEFAULT_DISPLAY_FORMATS: readonly AnimeFormat[] = ["tv"];
export const OPTIONAL_DISPLAY_FORMATS: readonly AnimeFormat[] = [];
export const DEFAULT_HIDDEN_FORMATS: readonly AnimeFormat[] = [
  "recap",
  "pv",
  "cm",
  "music_video",
  "rebroadcast"
];
