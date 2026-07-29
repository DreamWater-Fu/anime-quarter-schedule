import type { AnimeItem, AnimeQuarter, DataSourceType, SeasonMonth } from "../types/anime.ts";

export type SourceErrorCode =
  | "NETWORK_FAILED"
  | "SOURCE_SCHEMA_CHANGED"
  | "MISSING_FIELD"
  | "RATE_LIMITED"
  | "SOURCE_BLOCKED"
  | "SOURCE_DISABLED"
  | "API_ERROR";

export interface SourceIssue {
  source: string;
  code: SourceErrorCode;
  message: string;
  retryable: boolean;
  status?: number;
  details?: unknown;
}

export class DataSourceError extends Error {
  readonly source: string;
  readonly code: SourceErrorCode;
  readonly retryable: boolean;
  readonly status?: number;
  readonly details?: unknown;

  constructor(issue: SourceIssue) {
    super(issue.message);
    this.name = "DataSourceError";
    this.source = issue.source;
    this.code = issue.code;
    this.retryable = issue.retryable;
    this.status = issue.status;
    this.details = issue.details;
  }

  toIssue(): SourceIssue {
    return {
      source: this.source,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      status: this.status,
      details: this.details
    };
  }
}

export interface SourceFetchInput {
  year: number;
  season: SeasonMonth;
  quarter: AnimeQuarter;
  now?: Date;
}

export interface SourceFetchResult {
  source: string;
  sourceType: DataSourceType;
  items: AnimeItem[];
  warnings: SourceIssue[];
  fallbackUsed: boolean;
  retrievedAt: string;
}

export interface AnimeSourceAdapter {
  readonly name: string;
  readonly sourceType: DataSourceType;
  readonly enabled: boolean;
  fetchSeason(input: SourceFetchInput): Promise<SourceFetchResult>;
}

export function toSourceIssue(source: string, error: unknown): SourceIssue {
  if (error instanceof DataSourceError) return error.toIssue();

  return {
    source,
    code: "API_ERROR",
    message: error instanceof Error ? error.message : "unknown source error",
    retryable: false,
    details: error
  };
}

