import { seasonMonthToQuarter } from "../../anime/calculateSeason.ts";
import type { AnimeItem, SeasonMonth } from "../../types/anime.ts";
import { DataSourceError, toSourceIssue } from "../types.ts";
import type { AnimeSourceAdapter, SourceFetchInput, SourceFetchResult, SourceIssue } from "../types.ts";
import { BangumiApiClient } from "./client.ts";
import { mapBangumiSubjectToAnimeItem } from "./mapper.ts";
import type { BangumiClient, BangumiEpisode, BangumiSubject } from "./types.ts";

export interface BangumiAdapterOptions {
  client?: BangumiClient;
  enabled?: boolean;
  useFallbackOnFailure?: boolean;
  fallbackItems?: AnimeItem[];
  now?: () => Date;
}

export class BangumiSourceAdapter implements AnimeSourceAdapter {
  readonly name = "Bangumi";
  readonly sourceType = "bangumi" as const;
  readonly enabled: boolean;

  private readonly client: BangumiClient;
  private readonly useFallbackOnFailure: boolean;
  private readonly fallbackItems: AnimeItem[];
  private readonly now: () => Date;

  constructor(options: BangumiAdapterOptions = {}) {
    this.client = options.client ?? new BangumiApiClient();
    this.enabled = options.enabled ?? true;
    this.useFallbackOnFailure = options.useFallbackOnFailure ?? false;
    this.fallbackItems = options.fallbackItems ?? [];
    this.now = options.now ?? (() => new Date());
  }

  async fetchSeason(input: SourceFetchInput): Promise<SourceFetchResult> {
    const retrievedAt = this.now().toISOString();

    if (!this.enabled) {
      return {
        source: this.name,
        sourceType: this.sourceType,
        items: [],
        warnings: [
          {
            source: this.name,
            code: "SOURCE_DISABLED",
            message: "Bangumi adapter is disabled",
            retryable: false
          }
        ],
        fallbackUsed: false,
        retrievedAt
      };
    }

    const warnings: SourceIssue[] = [];

    try {
      const subjects = await this.fetchQuarterSubjects(input.year, input.season, warnings);
      if (subjects.length === 0) {
        throw new DataSourceError({
          source: this.name,
          code: "MISSING_FIELD",
          message: "Bangumi returned no subjects for target quarter",
          retryable: true
        });
      }

      const items: AnimeItem[] = [];
      for (const subject of subjects) {
        const item = await this.mapSubjectWithBestEffortEpisodes(subject, retrievedAt, warnings);
        items.push(item);
      }

      return {
        source: this.name,
        sourceType: this.sourceType,
        items,
        warnings,
        fallbackUsed: false,
        retrievedAt
      };
    } catch (error) {
      if (this.useFallbackOnFailure) {
        return {
          source: this.name,
          sourceType: this.sourceType,
          items: this.fallbackItems.length > 0 ? this.fallbackItems : createBangumiFallbackItems(input, retrievedAt),
          warnings: [toSourceIssue(this.name, error)],
          fallbackUsed: true,
          retrievedAt
        };
      }
      throw error;
    }
  }

  private async fetchQuarterSubjects(
    year: number,
    season: SeasonMonth,
    warnings: SourceIssue[]
  ): Promise<BangumiSubject[]> {
    const months = [season, season + 1, season + 2];
    const byId = new Map<number, BangumiSubject>();

    for (const month of months) {
      try {
        const subjects = await this.client.listSubjectsByMonth({ year, month });
        for (const subject of subjects) byId.set(subject.id, subject);
      } catch (error) {
        warnings.push(toSourceIssue(this.name, error));
      }
    }

    if (byId.size === 0 && warnings.length > 0) {
      throw new DataSourceError({
        source: this.name,
        code: warnings.some((warning) => warning.code === "RATE_LIMITED") ? "RATE_LIMITED" : "NETWORK_FAILED",
        message: "Bangumi quarter subject list could not be fetched",
        retryable: true,
        details: warnings
      });
    }

    return [...byId.values()];
  }

  private async mapSubjectWithBestEffortEpisodes(
    subject: BangumiSubject,
    retrievedAt: string,
    warnings: SourceIssue[]
  ): Promise<AnimeItem> {
    let detail = subject;
    let episodes: BangumiEpisode[] = [];

    try {
      detail = await this.client.getSubject(subject.id);
    } catch (error) {
      warnings.push(toSourceIssue(this.name, error));
    }

    try {
      episodes = await this.client.getEpisodes(subject.id);
    } catch (error) {
      warnings.push(toSourceIssue(this.name, error));
    }

    return mapBangumiSubjectToAnimeItem(detail, episodes, {
      retrievedAt,
      now: this.now()
    });
  }
}

export function createBangumiFallbackItems(input: SourceFetchInput, retrievedAt: string): AnimeItem[] {
  const quarter = input.quarter ?? seasonMonthToQuarter(input.season);
  const startDate = `${input.year}-${String(input.season).padStart(2, "0")}-01`;

  return [
    {
      id: `anime:mock-bangumi-${input.year}-${quarter}`,
      title: {
        original: `Mock Bangumi ${input.year} ${quarter}`,
        japanese: null,
        chinese: null,
        english: null,
        aliases: []
      },
      format: "unknown",
      status: "unknown",
      startDate,
      endDate: null,
      datePrecision: "day",
      primarySeason: { year: input.year, quarter },
      activeSeasons: [{ year: input.year, quarter }],
      updateWeekday: null,
      updateTime: null,
      timezone: "Asia/Tokyo",
      episodeCount: null,
      airedEpisodeCount: null,
      isJapaneseAnime: true,
      inclusionStatus: "needs_review",
      officialUrl: null,
      coverImage: null,
      externalIds: {
        bangumiSubjectId: null,
        bahamutSn: null
      },
      bangumi: {
        subjectId: null,
        url: null,
        rating: null,
        ratingCount: null,
        rank: null,
        lastSyncedAt: null
      },
      schedule: [],
      staff: null,
      sources: [],
      dataStatus: "unverified",
      updatedAt: retrievedAt,
      createdAt: retrievedAt
    }
  ];
}
