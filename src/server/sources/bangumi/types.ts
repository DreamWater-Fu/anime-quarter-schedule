import type { AnimeFormat } from "../../types/anime.ts";
import type { AnimeQuarter, AnimeSource, AnimeTitle } from "../../types/anime.ts";

export interface BangumiImageSet {
  large?: string;
  common?: string;
  medium?: string;
  small?: string;
  grid?: string;
}

export interface BangumiRating {
  score?: number;
  total?: number;
  rank?: number;
}

export interface BangumiInfoboxItem {
  key?: string;
  value?: unknown;
}

export interface BangumiSubject {
  id: number;
  type: number;
  name: string;
  name_cn?: string;
  date?: string;
  platform?: string;
  images?: BangumiImageSet;
  eps?: number;
  total_episodes?: number;
  rating?: BangumiRating;
  rank?: number;
  infobox?: BangumiInfoboxItem[];
}

export interface BangumiEpisode {
  id?: number;
  sort?: number;
  ep?: number;
  name?: string;
  name_cn?: string;
  airdate?: string;
  subject_id?: number;
  type?: number;
}

export interface BangumiClient {
  listSubjectsByMonth(input: {
    year: number;
    month: number;
    type?: 2;
    cat?: 1;
    limit?: number;
    offset?: number;
  }): Promise<BangumiSubject[]>;
  searchSubjects(input: {
    keyword: string;
    type?: 2[];
    limit?: number;
  }): Promise<BangumiSubject[]>;
  getSubject(subjectId: number): Promise<BangumiSubject>;
  getEpisodes(subjectId: number): Promise<BangumiEpisode[]>;
}

export interface BangumiMapperOptions {
  retrievedAt: string;
  now?: Date;
}

export interface BangumiFormatMapping {
  format: AnimeFormat;
  inclusionStatus: "included" | "optional" | "excluded" | "needs_review";
  exclusionReason?: string;
}

export interface NormalizedTitle {
  raw: string;
  nfkc: string;
  compact: string;
  punctuationless: string;
  simplified?: string;
  traditional?: string;
  tokens: string[];
  seasonToken?: {
    kind: "season" | "part" | "final" | "sequel" | "unknown";
    number?: number;
    raw: string;
  };
}

export type MatchConfidence = "high" | "medium" | "low";

export type CandidateMatchedField =
  | "name"
  | "name_cn"
  | "alias"
  | "english"
  | "date"
  | "quarter"
  | "format"
  | "episodeCount"
  | "officialUrl"
  | "studio"
  | "seasonToken";

export type CandidateRisk =
  | "year_mismatch"
  | "date_missing"
  | "date_conflict"
  | "season_token_mismatch"
  | "multiple_close_candidates"
  | "format_conflict"
  | "chinese_title_only"
  | "alias_only"
  | "weak_source";

export type DataSourceTypeForBangumiMatch =
  | "official"
  | "tv_station"
  | "streaming_platform"
  | "bangumi"
  | "third_party"
  | "ai_inferred"
  | "manual";

export interface MatchBangumiAnimeInput {
  title: AnimeTitle;
  year?: number | null;
  quarter?: AnimeQuarter | null;
  startDate?: string | null;
  format?: AnimeFormat | null;
  episodeCount?: number | null;
  officialUrl?: string | null;
  studios?: string[];
  sources?: AnimeSource[];
  existingBangumiId?: number | null;
}

export interface BangumiSearchClient {
  searchSubjects(input: {
    keyword: string;
    type?: 2[];
    limit?: number;
  }): Promise<BangumiSubject[]>;
  listSubjectsByMonth(input: {
    year: number;
    month: number;
    type: 2;
    cat: 1;
    limit?: number;
    offset?: number;
  }): Promise<BangumiSubject[]>;
  getSubject(subjectId: number): Promise<BangumiSubject>;
}

export interface Candidate {
  subjectId: number;
  url: string;
  name: string;
  nameCn: string | null;
  date: string | null;
  type: number;
  platform: string | null;
  score: number;
  confidence: MatchConfidence;
  matchedFields: CandidateMatchedField[];
  risks: CandidateRisk[];
  reason: string;
  subject: BangumiSubject;
}

export interface BangumiMatchResult {
  subjectId?: number;
  confidence: MatchConfidence;
  score: number;
  reason: string;
  candidates: Candidate[];
  needsManualReview: boolean;
  selectedCandidate?: Candidate;
  reviewedBy?: "auto" | "manual";
  matchedAt: string;
}
