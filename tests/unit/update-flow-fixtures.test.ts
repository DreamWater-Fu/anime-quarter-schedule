import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { updateAnimeData } from "../../src/server/anime/updateAnimeData.ts";
import { BahamutSourceAdapter, DataSourceError, type AnimeSourceAdapter, type SourceFetchInput, type SourceFetchResult } from "../../src/server/sources/index.ts";
import type { AnimeCache, AnimeItem, DataSourceType } from "../../src/server/types/anime.ts";
import type { UpdateStatusPayload } from "../../src/server/types/api.ts";
import { clone, findFixtureItem, MemoryStorage, readFixture } from "./test-utils.ts";

const runAt = "2026-07-28T12:00:00+09:00";
const summerSeason = { year: 2026, quarter: "summer" as const };

class StaticAdapter implements AnimeSourceAdapter {
  readonly enabled = true;
  readonly name: string;
  readonly sourceType: DataSourceType;
  private readonly items: AnimeItem[];
  private readonly warnings: SourceFetchResult["warnings"];

  constructor(
    name: string,
    sourceType: DataSourceType,
    items: AnimeItem[],
    warnings: SourceFetchResult["warnings"] = []
  ) {
    this.name = name;
    this.sourceType = sourceType;
    this.items = items;
    this.warnings = warnings;
  }

  async fetchSeason(input: SourceFetchInput): Promise<SourceFetchResult> {
    return {
      source: this.name,
      sourceType: this.sourceType,
      items: clone(this.items),
      warnings: clone(this.warnings),
      fallbackUsed: false,
      retrievedAt: input.now?.toISOString() ?? runAt
    };
  }
}

class FailingAdapter implements AnimeSourceAdapter {
  readonly name = "FailingPrimary";
  readonly sourceType = "bangumi" as const;
  readonly enabled = true;

  async fetchSeason(): Promise<SourceFetchResult> {
    throw new DataSourceError({
      source: this.name,
      code: "NETWORK_FAILED",
      message: "primary source offline",
      retryable: true
    });
  }
}

class FailingOptionalAdapter implements AnimeSourceAdapter {
  readonly name = "Bahamut Anime Crazy";
  readonly sourceType = "streaming_platform" as const;
  readonly enabled = true;

  async fetchSeason(): Promise<SourceFetchResult> {
    throw new DataSourceError({
      source: this.name,
      code: "NETWORK_FAILED",
      message: "optional source offline",
      retryable: true
    });
  }
}

function toSummerFixtureItem(cache: AnimeCache): AnimeItem {
  const item = findFixtureItem(cache, "anime:june-to-july");
  return {
    ...item,
    startDate: "2026-07-04",
    primarySeason: summerSeason,
    activeSeasons: [summerSeason],
    schedule: item.schedule.map((scheduleItem, index) => ({
      ...scheduleItem,
      airDate: index === 0 ? "2026-07-04" : "2026-07-11"
    }))
  };
}

describe("update data merge and rollback", () => {
  it("merges duplicate items from multiple sources into one main record", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const baseItem = toSummerFixtureItem(cache);
    const officialItem = {
      ...baseItem,
      sources: [{ name: "Official", type: "official" as const, retrievedAt: runAt }],
      schedule: [baseItem.schedule[0]!]
    };
    const officialScheduleItem = {
      ...baseItem,
      title: {
        ...baseItem.title,
        aliases: ["June July Alias"]
      },
      sources: [
        {
          name: "Official Schedule",
          type: "official" as const,
          url: "https://anime.example/schedule",
          retrievedAt: runAt
        }
      ],
      schedule: [baseItem.schedule[1]!]
    };
    const storage = new MemoryStorage({ ...cache, items: [] });

    const result = await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [
          new StaticAdapter("Official", "official", [officialItem]),
          new StaticAdapter("Official Schedule", "official", [officialScheduleItem])
        ],
        now: () => new Date(runAt)
      }
    );

    const nextCache = await storage.readAnimeCache();
    const item = nextCache.items[0];

    assert.equal(result.summary.fetched, 1);
    assert.equal(nextCache.items.length, 1);
    assert.equal(item?.id, "anime:june-to-july");
    assert.deepEqual(item?.activeSeasons, [summerSeason]);
    assert.equal(item?.schedule.length, 2);
    assert.equal(item?.sources.length, 2);
    assert.equal(item?.title.aliases.includes("June July Alias"), true);
  });

  it("continues when a non-primary source returns warnings and marks source warnings in the log", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const item = {
      ...toSummerFixtureItem(cache),
      dataStatus: "partial" as const
    };
    const storage = new MemoryStorage({ ...cache, items: [] });

    const result = await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [
          new StaticAdapter("Bangumi", "bangumi", [item]),
          new StaticAdapter("Optional Mirror", "third_party", [], [
            {
              source: "Optional Mirror",
              code: "NETWORK_FAILED",
              message: "optional source timeout",
              retryable: true
            }
          ])
        ],
        now: () => new Date(runAt)
      }
    );

    const nextCache = await storage.readAnimeCache();

    assert.equal(result.status, "success");
    assert.equal(nextCache.items[0]?.dataStatus, "partial");
    assert.equal(storage.logs.some((entry) => entry.event === "source_warnings"), true);
  });

  it("continues when an optional source throws and records a source warning", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const item = {
      ...toSummerFixtureItem(cache),
      sources: [{ name: "Bangumi", type: "bangumi" as const, retrievedAt: runAt }]
    };
    const storage = new MemoryStorage({ ...cache, items: [] });

    const result = await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [new StaticAdapter("Bangumi", "bangumi", [item]), new FailingOptionalAdapter()],
        now: () => new Date(runAt)
      }
    );

    assert.equal(result.status, "success");
    assert.equal(storage.logs.some((entry) => entry.event === "source_warnings"), true);
  });

  it("does not let an old airing cache overwrite a newly inferred finished status", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const oldItem = {
      ...toSummerFixtureItem(cache),
      status: "airing" as const,
      endDate: null,
      updateWeekday: 5,
      updateTime: "22:30",
      sources: [{ name: "Bangumi", type: "bangumi" as const, retrievedAt: "2025-07-01T00:00:00Z" }]
    };
    const finishedItem = {
      ...oldItem,
      status: "finished" as const,
      endDate: "2025-09-27",
      updatedAt: runAt
    };
    const storage = new MemoryStorage({ ...cache, items: [oldItem] });

    await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [new StaticAdapter("Bangumi", "bangumi", [finishedItem])],
        now: () => new Date(runAt)
      }
    );

    const nextCache = await storage.readAnimeCache();
    const item = nextCache.items.find((candidate) => candidate.id === oldItem.id);
    assert.equal(item?.status, "finished");
    assert.equal(item?.updateWeekday, null);
    assert.equal(item?.updateTime, null);
  });

  it("does not keep reference update times after the catalog item is already finished", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const baseItem = toSummerFixtureItem(cache);
    const bangumiItem = {
      ...baseItem,
      status: "finished" as const,
      endDate: "2025-09-27",
      updateWeekday: null,
      updateTime: null,
      sources: [{ name: "Bangumi", type: "bangumi" as const, retrievedAt: runAt }]
    };
    const referenceItem = {
      ...baseItem,
      status: "airing" as const,
      updateWeekday: 5,
      updateTime: "22:30",
      sources: [{ name: "YourAnimes", type: "third_party" as const, retrievedAt: runAt, scope: "japan_broadcast" as const }]
    };
    const storage = new MemoryStorage({ ...cache, items: [] });

    await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [
          new StaticAdapter("Bangumi", "bangumi", [bangumiItem]),
          new StaticAdapter("YourAnimes", "third_party", [referenceItem])
        ],
        now: () => new Date(runAt)
      }
    );

    const item = (await storage.readAnimeCache()).items.find((candidate) => candidate.id === baseItem.id);
    assert.equal(item?.status, "finished");
    assert.equal(item?.updateWeekday, null);
    assert.equal(item?.updateTime, null);
  });

  it("merges Bahamut reference update time into the Bangumi main record", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const baseItem = toSummerFixtureItem(cache);
    const subjectId = 777000;
    const bangumiItem = {
      ...baseItem,
      bangumi: {
        ...baseItem.bangumi,
        subjectId,
        url: `https://bgm.tv/subject/${subjectId}`
      },
      externalIds: {
        ...baseItem.externalIds,
        bangumiSubjectId: subjectId
      },
      updateTime: null,
      schedule: [],
      sources: [{ name: "Bangumi", type: "bangumi" as const, retrievedAt: runAt }]
    };
    const storage = new MemoryStorage({ ...cache, items: [] });

    await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [
          new StaticAdapter("Bangumi", "bangumi", [bangumiItem]),
          new BahamutSourceAdapter({
            enabled: true,
            entries: [
              {
                title: baseItem.title.chinese ?? baseItem.title.original,
                url: "https://ani.gamer.com.tw/animeVideo.php?sn=777",
                sn: "777",
                uploadDate: "2026-07-04",
                uploadTime: "22:30",
                bangumiSubjectId: subjectId,
                format: "tv",
                retrievedAt: runAt
              }
            ],
            now: () => new Date(runAt)
          })
        ],
        now: () => new Date(runAt)
      }
    );

    const nextCache = await storage.readAnimeCache();
    const item = nextCache.items[0];

    assert.equal(nextCache.items.length, 1);
    assert.equal(item?.id, `anime:${subjectId}`);
    assert.equal(item?.updateTime, "22:30");
    assert.equal(item?.timezone, "Asia/Shanghai");
    assert.equal(item?.externalIds.bahamutSn, "777");
    assert.equal(item?.sources.some((source) => source.name === "Bahamut Anime Crazy"), true);
  });

  it("merges Bahamut Chinese title rows into matched Bangumi records", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const baseItem = toSummerFixtureItem(cache);
    const bangumiItem = {
      ...baseItem,
      updateTime: null,
      schedule: [],
      sources: [{ name: "Bangumi", type: "bangumi" as const, retrievedAt: runAt }]
    };
    const storage = new MemoryStorage({ ...cache, items: [] });

    await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [
          new StaticAdapter("Bangumi", "bangumi", [bangumiItem]),
          new BahamutSourceAdapter({
            enabled: true,
            entries: [
              {
                title: baseItem.title.chinese ?? baseItem.title.original,
                url: "https://ani.gamer.com.tw/animeVideo.php?sn=778",
                sn: "778",
                uploadDate: "2026-07-05",
                uploadTime: "21:30",
                format: "tv",
                retrievedAt: runAt
              }
            ],
            now: () => new Date(runAt)
          })
        ],
        now: () => new Date(runAt)
      }
    );

    const nextCache = await storage.readAnimeCache();
    const item = nextCache.items[0];

    assert.equal(nextCache.items.length, 1);
    assert.equal(item?.id, baseItem.id);
    assert.equal(item?.updateTime, "21:30");
    assert.equal(item?.externalIds.bahamutSn, "778");
  });

  it("does not merge title-matched reference rows when Bangumi subject IDs differ", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const oldItem = {
      ...toSummerFixtureItem(cache),
      id: "anime:100001",
      title: {
        original: "Series Title",
        japanese: "Series Title",
        chinese: "Series Title",
        english: null,
        aliases: ["Shared Base Title"]
      },
      bangumi: {
        ...toSummerFixtureItem(cache).bangumi,
        subjectId: 100001,
        url: "https://bgm.tv/subject/100001"
      },
      externalIds: {
        ...toSummerFixtureItem(cache).externalIds,
        bangumiSubjectId: 100001
      }
    };
    const secondCourReference = {
      ...oldItem,
      id: "anime:200002",
      title: {
        ...oldItem.title,
        original: "Shared Base Title Second Cour",
        aliases: ["Shared Base Title"]
      },
      bangumi: {
        ...oldItem.bangumi,
        subjectId: 200002,
        url: "https://bgm.tv/subject/200002"
      },
      externalIds: {
        ...oldItem.externalIds,
        bangumiSubjectId: 200002
      },
      updateTime: "22:30",
      timezone: "Asia/Shanghai" as const,
      sources: [
        {
          name: "YourAnimes",
          type: "third_party" as const,
          url: "https://youranimes.tw/animes/200002",
          retrievedAt: runAt,
          scope: "japan_broadcast" as const
        }
      ]
    };
    const storage = new MemoryStorage({ ...cache, items: [oldItem] });

    await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [new StaticAdapter("YourAnimes", "third_party", [secondCourReference])],
        now: () => new Date(runAt)
      }
    );

    const nextCache = await storage.readAnimeCache();

    assert.equal(nextCache.items.some((item) => item.id === "anime:200002"), true);
    assert.equal(nextCache.items.some((item) => item.id === "anime:100001"), true);
  });

  it("does not write non-Japanese or excluded fetched items into cache", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const japaneseItem = toSummerFixtureItem(cache);
    const nonJapaneseItem = {
      ...japaneseItem,
      id: "anime:ninjago",
      title: {
        ...japaneseItem.title,
        original: "Ninjago: Dragons Rising Season 4",
        chinese: "乐高幻影忍者：神龙崛起 第四季"
      },
      isJapaneseAnime: false,
      inclusionStatus: "excluded" as const,
      exclusionReason: "Not Japanese anime"
    };
    const storage = new MemoryStorage({ ...cache, items: [] });

    const result = await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [new StaticAdapter("Bangumi", "bangumi", [japaneseItem, nonJapaneseItem])],
        now: () => new Date(runAt)
      }
    );

    const nextCache = await storage.readAnimeCache();

    assert.equal(result.summary.skippedNonJapanese, 1);
    assert.equal(nextCache.items.some((item) => item.id === "anime:ninjago"), false);
  });

  it("only writes candidates that belong to the requested season and preserves other seasons", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const summerItem = toSummerFixtureItem(cache);
    const springItem = findFixtureItem(cache, "anime:march-to-april");
    const storage = new MemoryStorage({
      ...cache,
      items: [springItem]
    });

    const result = await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [new StaticAdapter("Bangumi", "bangumi", [summerItem, springItem])],
        now: () => new Date(runAt)
      }
    );

    const nextCache = await storage.readAnimeCache();

    assert.equal(result.summary.fetched, 1);
    assert.deepEqual(
      nextCache.items.map((item) => item.id).sort(),
      ["anime:june-to-july", "anime:march-to-april"]
    );
  });

  it("uses old season cache when the primary data source fails", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const summerItem = toSummerFixtureItem(cache);
    const storage = new MemoryStorage({ ...cache, items: [summerItem] });

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
    assert.equal(nextCache.items.some((item) => item.id === "anime:june-to-july"), true);
    assert.equal(storage.writeCount, 1);
    assert.equal(status.status, "success");
    assert.equal(status.cache.itemCount, 1);
    assert.equal(storage.logs.some((entry) => entry.event === "source_warnings"), true);
  });

  it("fails clearly when external sources are unavailable and the target season has no old cache", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const storage = new MemoryStorage({ ...cache, items: [] });

    await assert.rejects(
      () =>
        updateAnimeData(
          { year: 2025, season: 1 },
          {
            storage,
            adapters: [new FailingAdapter()],
            now: () => new Date(runAt)
          }
        ),
      (error: unknown) =>
        error instanceof Error &&
        "code" in error &&
        (error as { code: unknown }).code === "SOURCE_UNAVAILABLE"
    );

    const nextCache = await storage.readAnimeCache();
    const status = await storage.readUpdateStatus();

    assert.deepEqual(nextCache.items, []);
    assert.equal(storage.writeCount, 0);
    assert.equal(status.status, "failed");
    assert.equal(status.lastError?.code, "SOURCE_UNAVAILABLE");
    assert.equal(storage.logs.some((entry) => entry.event === "update_failed"), true);
  });

  it("treats an empty requested season as a successful empty refresh", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const storage = new MemoryStorage(cache);

    const result = await updateAnimeData(
      { year: 2026, season: 10 },
      {
        storage,
        adapters: [new StaticAdapter("Bangumi", "bangumi", [])],
        now: () => new Date(runAt)
      }
    );

    const nextCache = await storage.readAnimeCache();

    assert.equal(result.status, "success");
    assert.equal(result.summary.fetched, 0);
    assert.equal(
      nextCache.items.some((item) => item.primarySeason?.year === 2026 && item.primarySeason.quarter === "fall"),
      false
    );
  });

  it("releases stale running update locks after the configured TTL", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const item = {
      ...toSummerFixtureItem(cache),
      sources: [{ name: "Bangumi", type: "bangumi" as const, retrievedAt: runAt }]
    };
    const staleStatus: UpdateStatusPayload = {
      schemaVersion: 1,
      status: "running",
      lastSuccessAt: null,
      lastAttemptAt: "2026-07-28T10:00:00+09:00",
      lastError: null,
      currentJob: {
        jobId: "stale",
        year: 2026,
        season: 7,
        quarter: "summer",
        startedAt: "2026-07-28T10:00:00+09:00"
      },
      cache: {
        animeUpdatedAt: cache.updatedAt,
        itemCount: cache.items.length
      }
    };
    const storage = new MemoryStorage({ ...cache, items: [] }, staleStatus);

    const result = await updateAnimeData(
      { year: 2026, season: 7 },
      {
        storage,
        adapters: [new StaticAdapter("Bangumi", "bangumi", [item])],
        now: () => new Date(runAt)
      }
    );

    assert.equal(result.status, "success");
  });

  it("does not replace old cache when candidate cache validation fails", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const badItem = {
      ...toSummerFixtureItem(cache),
      updateTime: "24:30"
    };
    const storage = new MemoryStorage(cache);

    await assert.rejects(
      () =>
        updateAnimeData(
          { year: 2026, season: 7 },
          {
            storage,
            adapters: [new StaticAdapter("Bangumi", "bangumi", [badItem])],
            now: () => new Date(runAt)
          }
        ),
      /schema validation/
    );

    const nextCache = await storage.readAnimeCache();
    const status = await storage.readUpdateStatus();

    assert.deepEqual(nextCache.items.map((item) => item.id), cache.items.map((item) => item.id));
    assert.equal(storage.writeCount, 0);
    assert.equal(status.status, "failed");
    assert.equal(status.lastError?.code, "CACHE_VALIDATION_FAILED");
  });
});
