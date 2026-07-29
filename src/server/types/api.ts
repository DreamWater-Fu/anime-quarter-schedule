import type { AnimeQuarter, SeasonMonth } from "./anime.ts";

export interface PublicApiError {
  code: string;
  message: string;
  details?: unknown;
}

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: PublicApiError };

export interface UpdateInput {
  year: number;
  season: SeasonMonth;
  force?: boolean;
}

export interface UpdateSummary {
  fetched: number;
  matchedBangumi: number;
  missingBangumi: number;
  missingRating: number;
  conflicting: number;
  incomplete: number;
  skippedNonJapanese: number;
  written: number;
}

export interface UpdateWarning {
  source: string;
  code: string;
  message: string;
  retryable: boolean;
  status?: number;
  details?: unknown;
}

export interface UpdateResult {
  jobId: string;
  status: "success";
  year: number;
  season: SeasonMonth;
  quarter: AnimeQuarter;
  startedAt: string;
  finishedAt: string;
  summary: UpdateSummary;
  warnings: UpdateWarning[];
}

export interface UpdateStatusPayload {
  schemaVersion: 1;
  status: "idle" | "running" | "success" | "failed";
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: (PublicApiError & { at?: string }) | null;
  currentJob: null | {
    jobId: string;
    year: number;
    season: SeasonMonth;
    quarter: AnimeQuarter;
    startedAt: string;
  };
  cache: {
    animeUpdatedAt: string | null;
    itemCount: number;
  };
}

export interface UpdateLogEntry {
  jobId: string;
  at: string;
  level: "info" | "error";
  event: string;
  error?: PublicApiError;
  summary?: UpdateSummary;
}
