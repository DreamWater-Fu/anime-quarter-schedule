import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getAnimeApi, getStatusApi } from "../../src/server/api/routes.ts";
import { queryAnimeBySeason } from "../../src/server/anime/queryAnime.ts";
import { updateAnimeData } from "../../src/server/anime/updateAnimeData.ts";
import { createEmptyUpdateStatus, type AnimeStorage } from "../../src/server/cache/storage.ts";
import { DataSourceError, type AnimeSourceAdapter, type SourceFetchInput, type SourceFetchResult } from "../../src/server/sources/index.ts";
import type { AnimeCache, AnimeItem } from "../../src/server/types/anime.ts";
import type { UpdateLogEntry, UpdateStatusPayload } from "../../src/server/types/api.ts";

const cacheUpdatedAt = "2026-07-27T21:30:00+09:00";
const runAt = "2026-07-28T12:00:00+09:00";

class MemoryStorage implements AnimeStorage {
  logs: UpdateLogEntry[] = [];
  private animeCache: AnimeCache;
  private status: UpdateStatusPayload;

  constructor(animeCache: AnimeCache, status: UpdateStatusPayload = createEmptyUpdateStatus()) {
    this.animeCache = animeCache;
    this.status = status;
  }

  async readAnimeCache(): Promise<AnimeCache> {
    return structuredClone(this.animeCache);
  }

  async writeAnimeCache(cache: AnimeCache): Promise<void> {
    this.animeCache = structuredClone(cache);
  }

  async readUpdateStatus(): Promise<UpdateStatusPayload> {
    return structuredClone(this.status);
  }

  async writeUpdateStatus(status: UpdateStatusPayload): Promise<void> {
    this.status = structuredClone(status);
  }

  async appendUpdateLog(entry: UpdateLogEntry): Promise<void> {
    this.logs.push(structuredClone(entry));
  }
}

class StaticAdapter implements AnimeSourceAdapter {
  readonly name = "Static";
  readonly sourceType = "manual" as const;
  readonly enabled = true;
  private readonly items: AnimeItem[];

  constructor(items: AnimeItem[]) {
    this.items = items;
  }

  async fetchSeason(input: SourceFetchInput): Promise<SourceFetchResult> {
    return {
      source: this.name,
      sourceType: this.sourceType,
      items: this.items,
      warnings: [],
      fallbackUsed: false,
      retrievedAt: input.now?.toISOString() ?? runAt
    };
  }
}

class FailingAdapter implements AnimeSourceAdapter {
  readonly name = "Failing";
  readonly sourceType = "bangumi" as const;
  readonly enabled = true;

  async fetchSeason(): Promise<SourceFetchResult> {
    throw new DataSourceError({
      source: this.name,
      code: "NETWORK_FAILED",
      message: "offline",
      retryable: true
    });
  }
}

describe("anime query and api handlers", () => {
  it("queries TV season items and only shows continuations in the current season", async () => {
    const winterToCurrentSpring = createAnime({
      id: "anime:cross-quarter",
      startDate: "2026-01-20",
      primarySeason: { year: 2026, quarter: "winter" },
      activeSeasons: [
        { year: 2026, quarter: "winter" },
        { year: 2026, quarter: "spring" }
      ]
    });
    const springPremiere = createAnime({
      id: "anime:spring-premiere",
      startDate: "2026-04-10",
      primarySeason: { year: 2026, quarter: "spring" },
      activeSeasons: [{ year: 2026, quarter: "spring" }]
    });
    const optional = createAnime({
      id: "anime:optional",
      format: "movie",
      inclusionStatus: "optional",
      startDate: "2026-04-10",
      primarySeason: { year: 2026, quarter: "spring" },
      activeSeasons: [{ year: 2026, quarter: "spring" }]
    });
    const storage = new MemoryStorage({
      schemaVersion: 1,
      updatedAt: cacheUpdatedAt,
      generatedBy: "manual-edit",
      items: [winterToCurrentSpring, springPremiere, optional]
    });

    const payload = await queryAnimeBySeason({
      year: 2026,
      season: 4,
      now: new Date("2026-04-20T00:00:00+08:00"),
      storage
    });

    assert.deepEqual(payload.items.map((item) => item.id), ["anime:cross-quarter", "anime:spring-premiere"]);
    assert.equal(payload.meta.cacheUpdatedAt, cacheUpdatedAt);
    assert.equal(payload.meta.dataStatusSummary.partial, 2);

    const sameSeasonViewedLater = await queryAnimeBySeason({
      year: 2026,
      season: 4,
      now: new Date("2026-07-20T00:00:00+08:00"),
      storage
    });
    assert.deepEqual(sameSeasonViewedLater.items.map((item) => item.id), ["anime:spring-premiere"]);
  });

  it("wraps status and anime route results in the documented ok/data shape", async () => {
    process.env.DATA_DIR = "__missing_test_data_dir__";
    const anime = await getAnimeApi(new URLSearchParams("year=2026&season=7"));
    const status = await getStatusApi();

    assert.equal(anime.status, 200);
    assert.equal(anime.body.ok, true);
    assert.equal(status.status, 200);
    assert.equal(status.body.ok, true);
  });
});

describe("manual update flow", () => {
  it("writes a successful update through the cache and status files", async () => {
    const storage = new MemoryStorage(createCache([]));
    const item = createAnime({ id: "anime:summer", activeSeasons: [{ year: 2026, quarter: "summer" }] });

    const result = await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [new StaticAdapter([item])],
        now: () => new Date(runAt)
      }
    );

    const nextCache = await storage.readAnimeCache();
    const status = await storage.readUpdateStatus();

    assert.equal(result.status, "success");
    assert.equal(nextCache.items.length, 1);
    assert.equal(nextCache.items[0]?.id, "anime:summer");
    assert.equal(status.status, "success");
    assert.equal(status.cache.itemCount, 1);
    assert.equal(storage.logs.some((entry) => entry.event === "update_success"), true);
  });

  it("uses old season cache when the primary source is offline", async () => {
    const oldItem = createAnime({ id: "anime:old", activeSeasons: [{ year: 2026, quarter: "summer" }] });
    const storage = new MemoryStorage(createCache([oldItem]));

    const result = await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [new FailingAdapter()],
        now: () => new Date(runAt)
      }
    );

    const nextCache = await storage.readAnimeCache();
    const status = await storage.readUpdateStatus();

    assert.equal(result.status, "success");
    assert.deepEqual(nextCache.items.map((item) => item.id), ["anime:old"]);
    assert.equal(status.status, "success");
    assert.equal(status.cache.itemCount, 1);
    assert.equal(storage.logs.some((entry) => entry.event === "source_warnings"), true);
  });
});

function createCache(items: AnimeItem[]): AnimeCache {
  return {
    schemaVersion: 1,
    updatedAt: cacheUpdatedAt,
    generatedBy: "manual-edit",
    items
  };
}

function createAnime(overrides: Partial<AnimeItem> = {}): AnimeItem {
  const base: AnimeItem = {
    id: "anime:base",
    title: {
      original: "Example Anime",
      japanese: "Example Anime",
      chinese: "Example Anime",
      english: null,
      aliases: []
    },
    format: "tv",
    status: "airing",
    startDate: "2026-07-03",
    endDate: null,
    datePrecision: "day",
    primarySeason: { year: 2026, quarter: "summer" },
    activeSeasons: [{ year: 2026, quarter: "summer" }],
    updateWeekday: null,
    updateTime: null,
    timezone: "Asia/Tokyo",
    episodeCount: null,
    airedEpisodeCount: null,
    isJapaneseAnime: true,
    inclusionStatus: "included",
    officialUrl: "https://example.jp/anime/",
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
    sources: [
      {
        name: "Manual",
        type: "manual",
        retrievedAt: cacheUpdatedAt
      }
    ],
    dataStatus: "partial",
    updatedAt: cacheUpdatedAt,
    createdAt: cacheUpdatedAt
  };

  return { ...base, ...overrides };
}
