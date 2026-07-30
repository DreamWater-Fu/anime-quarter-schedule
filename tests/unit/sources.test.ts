import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateAnimeItem } from "../../src/server/anime/index.ts";
import {
  BahamutSourceAdapter,
  BangumiApiClient,
  BangumiSourceAdapter,
  DataSourceError,
  mapBangumiSubjectToAnimeItem,
  mapYourAnimesReferenceToAnimeItem,
  parseBahamutTimetableText,
  parseYourAnimesHtml,
  YourAnimesSourceAdapter
} from "../../src/server/sources/index.ts";
import type { BangumiClient, BangumiSubject } from "../../src/server/sources/index.ts";

const retrievedAt = "2026-07-28T12:00:00+09:00";

const subject: BangumiSubject = {
  id: 2001,
  type: 2,
  name: "Example Anime",
  name_cn: "示例动画",
  date: "2026-07-03",
  platform: "TV",
  eps: 2,
  total_episodes: 2,
  rating: {
    score: 0,
    total: 0,
    rank: 0
  },
  images: {
    large: "https://img.example/large.jpg",
    medium: "https://img.example/medium.jpg",
    small: "https://img.example/small.jpg"
  },
  infobox: [
    { key: "别名", value: [{ v: "Example Alias" }] },
    { key: "官方网站", value: "https://anime.example/" }
  ]
};

describe("Bangumi mapper", () => {
  it("maps Bangumi subject and episodes to the unified AnimeItem model", () => {
    const item = mapBangumiSubjectToAnimeItem(
      subject,
      [
        { ep: 1, name_cn: "第一话", airdate: "2026-07-03", type: 0 },
        { ep: 2, name_cn: "第二话", airdate: "2026-07-10", type: 0 },
        { ep: 3, name_cn: "SP", airdate: "2026-07-17", type: 1 }
      ],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(item.id, "anime:2001");
    assert.equal(item.title.chinese, "示例动画");
    assert.deepEqual(item.title.aliases, ["Example Alias"]);
    assert.equal(item.format, "tv");
    assert.deepEqual(item.primarySeason, { year: 2026, quarter: "summer" });
    assert.deepEqual(item.activeSeasons, [{ year: 2026, quarter: "summer" }]);
    assert.equal(item.updateWeekday, 5);
    assert.equal(item.updateTime, null);
    assert.equal(item.bangumi.subjectId, 2001);
    assert.equal(item.bangumi.rating, null);
    assert.equal(item.bangumi.ratingCount, null);
    assert.equal(item.bangumi.rank, null);
    assert.equal(item.officialUrl, "https://anime.example/");
    assert.equal(item.coverImage?.source, "bangumi");
    assert.equal(item.schedule.length, 2);
    assert.equal(item.dataStatus, "complete");

    const blockingIssues = validateAnimeItem(item).filter((issue) => issue.severity === "error");
    assert.deepEqual(blockingIssues, []);
  });

  it("repairs UTF-8 text that was decoded as Latin-1 before mapping titles", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 2002,
        name: "\u00e3\u0083\u00a1\u00e3\u0083\u0080\u00e3\u0083\u00aa\u00e3\u0082\u00b9\u00e3\u0083\u0088",
        name_cn: "\u00e9\u0087\u0091\u00e7\u0089\u008c\u00e5\u00be\u0097\u00e4\u00b8\u00bb",
        infobox: [
          { key: "Alias", value: [{ v: "\u00e3\u0083\u00a1\u00e3\u0083\u0080\u00e3\u0083\u00aa\u00e3\u0082\u00b9\u00e3\u0083\u0088" }] }
        ]
      },
      [{ ep: 1, name_cn: "\u00e7\u00ac\u00ac\u00e4\u00b8\u0080\u00e8\u00af\u009d", airdate: "2025-01-04", type: 0 }],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(item.title.original, "メダリスト");
    assert.equal(item.title.japanese, "メダリスト");
    assert.equal(item.title.chinese, "金牌得主");
    assert.deepEqual(item.title.aliases, []);
    assert.equal(item.schedule[0]?.episodeTitle, "第一话");
  });

  it("does not write airedEpisodeCount greater than episodeCount when Bangumi counts conflict", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        eps: 1,
        total_episodes: 3
      },
      [
        { ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 },
        { ep: 2, name_cn: "Episode 2", airdate: "2026-07-10", type: 0 }
      ],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(item.episodeCount, null);
    assert.equal(item.airedEpisodeCount, 2);
    assert.equal(item.dataStatus, "partial");

    const blockingIssues = validateAnimeItem(item).filter((issue) => issue.severity === "error");
    assert.deepEqual(blockingIssues, []);
  });

  it("marks explicit non-Japanese Bangumi subjects as excluded", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 3001,
        name: "Ninjago: Dragons Rising Season 4",
        name_cn: "乐高幻影忍者：神龙崛起 第四季",
        platform: "TV",
        infobox: [{ key: "官方网站", value: "https://kids.lego.com/en-us/ninjago" }]
      },
      [{ ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 }],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(item.isJapaneseAnime, false);
    assert.equal(item.inclusionStatus, "excluded");
    assert.equal(item.exclusionReason, "Not Japanese anime");
  });

  it("excludes Paw Patrol and Curtis President as non-Japanese subjects", () => {
    for (const input of [
      { name: "PAW Patrol Season 13", name_cn: "汪汪队立大功 第十三季" },
      { name: "柯蒂斯总统", name_cn: "柯蒂斯总统" },
      { name: "冰球旋风 第2季", name_cn: "冰球旋风 第2季" },
      { name: "幸福公寓", name_cn: "幸福公寓" },
      { name: "Miraculous Ladybug Season 6", name_cn: "瓢虫雷迪 第六季" },
      { name: "Mickey Mouse Clubhouse+", name_cn: "米奇妙妙屋+" },
      { name: "Transformers: Earthspark Season 4", name_cn: "变形金刚:地球火种 第四季" },
      { name: "Primal Season 3", name_cn: "史前战纪 第三季" },
      { name: "熊熊帮帮团5", name_cn: "熊熊帮帮团 第5季" },
      { name: "Family Guy Season 24", name_cn: "恶搞之家 第二十四季" },
      { name: "Spidey and His Amazing Friends Season 5", name_cn: "蜘蛛侠与他的神奇朋友们 第五季" },
      { name: "SEALOOK 2nd season", name_cn: "SEALOOK 2nd season" }
    ]) {
      const item = mapBangumiSubjectToAnimeItem(
        {
          ...subject,
          id: 3100,
          name: input.name,
          name_cn: input.name_cn,
          platform: "TV",
          infobox: []
        },
        [{ ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 }],
        { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
      );

      assert.equal(item.isJapaneseAnime, false);
      assert.equal(item.inclusionStatus, "excluded");
    }
  });

  it("excludes NSFW and explicit adult subjects", () => {
    for (const input of [
      { name: "Adult Test Anime", name_cn: "成人动画", nsfw: true },
      { name: "Seminar Classmate", name_cn: "同一个研讨会的染谷同学是AV女优的事", nsfw: false }
    ]) {
      const item = mapBangumiSubjectToAnimeItem(
        {
          ...subject,
          id: 3200,
          name: input.name,
          name_cn: input.name_cn,
          platform: "TV",
          nsfw: input.nsfw,
          infobox: []
        },
        [{ ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 }],
        { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
      );

      assert.equal(item.isJapaneseAnime, false);
      assert.equal(item.inclusionStatus, "excluded");
    }
  });

  it("keeps a started show airing while its inferred end date is still in the future", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        eps: 3,
        total_episodes: 3
      },
      [
        { ep: 1, name_cn: "Episode 1", airdate: "2026-07-03", type: 0 },
        { ep: 2, name_cn: "Episode 2", airdate: "2026-08-10", type: 0 },
        { ep: 3, name_cn: "Episode 3", airdate: "2026-09-10", type: 0 }
      ],
      { retrievedAt, now: new Date("2026-07-28T00:00:00Z") }
    );

    assert.equal(item.status, "airing");
    assert.equal(item.endDate, "2026-09-10");
  });

  it("infers finished state for historical cached Bangumi list subjects with episode counts", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 3300,
        date: "2025-07-19",
        eps: 11,
        total_episodes: 11
      },
      [],
      { retrievedAt, now: new Date("2026-07-29T00:00:00Z") }
    );

    assert.equal(item.endDate, "2025-09-27");
    assert.equal(item.status, "finished");
  });

  it("marks stale historical seasonal subjects finished even when episode count is missing", () => {
    const item = mapBangumiSubjectToAnimeItem(
      {
        ...subject,
        id: 3301,
        date: "2025-07-15",
        eps: 0,
        total_episodes: 0
      },
      [],
      { retrievedAt, now: new Date("2026-07-29T00:00:00Z") }
    );

    assert.equal(item.endDate, "2025-09-30");
    assert.equal(item.status, "finished");
  });
});

describe("Bangumi API client", () => {
  it("sets a clear User-Agent and maps HTTP 429 to RATE_LIMITED", async () => {
    let userAgent = "";
    const fetchImpl: typeof fetch = async (_url, init) => {
      userAgent = new Headers(init?.headers).get("User-Agent") ?? "";
      return new Response("{}", { status: 429 });
    };

    const client = new BangumiApiClient({
      fetchImpl,
      userAgent: "anime-quarter-test/0.1",
      rateLimitPerMinute: 0
    });

    await assert.rejects(
      () => client.listSubjectsByMonth({ year: 2026, month: 7 }),
      (error) => error instanceof DataSourceError && error.code === "RATE_LIMITED"
    );
    assert.equal(userAgent, "anime-quarter-test/0.1");
  });

  it("reports subject list schema changes", async () => {
    const client = new BangumiApiClient({
      fetchImpl: async () => Response.json({ unexpected: true }),
      rateLimitPerMinute: 0
    });

    await assert.rejects(
      () => client.listSubjectsByMonth({ year: 2026, month: 7 }),
      (error) => error instanceof DataSourceError && error.code === "SOURCE_SCHEMA_CHANGED"
    );
  });

  it("falls back to a configured GET fetch when the primary Bangumi fetch fails", async () => {
    let fallbackUrl = "";
    const client = new BangumiApiClient({
      fetchImpl: async () => {
        throw new TypeError("connect timeout");
      },
      fallbackFetchImpl: async (url) => {
        fallbackUrl = String(url);
        return Response.json({ data: [subject] });
      },
      usePowerShellFallback: false,
      rateLimitPerMinute: 0
    });

    const result = await client.listSubjectsByMonth({ year: 2025, month: 7, limit: 1 });

    assert.equal(result.length, 1);
    assert.equal(result[0]?.id, subject.id);
    assert.match(fallbackUrl, /year=2025/);
    assert.match(fallbackUrl, /month=7/);
  });
});

describe("source adapters", () => {
  it("uses Bangumi fallback data when configured and the source fails", async () => {
    const failingClient: BangumiClient = {
      listSubjectsByMonth: async () => {
        throw new DataSourceError({
          source: "Bangumi",
          code: "NETWORK_FAILED",
          message: "offline",
          retryable: true
        });
      },
      searchSubjects: async () => [],
      getSubject: async () => {
        throw new Error("unused");
      },
      getEpisodes: async () => []
    };

    const adapter = new BangumiSourceAdapter({
      client: failingClient,
      useFallbackOnFailure: true,
      usePowerShellSubjectListFallback: false,
      now: () => new Date(retrievedAt)
    });
    const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });

    assert.equal(result.fallbackUsed, true);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.bangumi.subjectId, null);
    assert.equal(result.items[0]?.dataStatus, "unverified");
    assert.equal(result.warnings[0]?.code, "NETWORK_FAILED");
  });

  it("uses Bangumi month subject fallback before reporting quarter list failure", async () => {
    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = "tests/fixtures/missing-bangumi-cache";
    const failingClient: BangumiClient = {
      listSubjectsByMonth: async () => {
        throw new DataSourceError({
          source: "Bangumi",
          code: "NETWORK_FAILED",
          message: "offline",
          retryable: true
        });
      },
      searchSubjects: async () => [],
      getSubject: async () => {
        throw new Error("unused");
      },
      getEpisodes: async () => {
        throw new Error("unused");
      }
    };
    const adapter = new BangumiSourceAdapter({
      client: failingClient,
      monthSubjectFallback: async ({ month }) => (month === 7 ? [subject] : []),
      now: () => new Date(retrievedAt)
    });

    try {
      const result = await adapter.fetchSeason({ year: 2025, season: 7, quarter: "summer" });

      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.id, "anime:2001");
      assert.equal(result.items[0]?.bangumi.subjectId, 2001);
      assert.equal(result.warnings.some((warning) => warning.message === "Bangumi quarter subject list could not be fetched"), false);
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
    }
  });

  it("can explicitly disable Bahamut as a reference-only source", async () => {
    const adapter = new BahamutSourceAdapter({ enabled: false });
    const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });

    assert.equal(result.items.length, 0);
    assert.equal(result.warnings[0]?.code, "SOURCE_DISABLED");
  });

  it("enables Bahamut by default when no environment override is set", async () => {
    const adapter = new BahamutSourceAdapter({
      referencesPath: "tests/fixtures/missing-bahamut-references.json",
      timetableFiles: [],
      timetableUrls: [],
      now: () => new Date(retrievedAt)
    });
    const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });

    assert.equal(result.items.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  it("maps enabled Bahamut reference times into Beijing update slots", async () => {
    const adapter = new BahamutSourceAdapter({
      enabled: true,
      entries: [
        {
          title: "Bahamut Reference Anime",
          url: "https://ani.gamer.com.tw/animeVideo.php?sn=123",
          sn: "123",
          uploadDate: "2026-07-03",
          uploadTime: "23:30",
          bangumiSubjectId: 2001,
          format: "tv",
          retrievedAt
        }
      ],
      now: () => new Date(retrievedAt)
    });

    const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });
    const item = result.items[0];

    assert.equal(item?.id, "anime:2001");
    assert.equal(item?.updateTime, "23:30");
    assert.equal(item?.updateWeekday, 5);
    assert.equal(item?.timezone, "Asia/Shanghai");
    assert.equal(item?.schedule[0]?.airDate, "2026-07-03");
    assert.equal(item?.schedule[0]?.timezone, "Asia/Shanghai");
    assert.equal(item?.sources[0]?.scope, "taiwan_streaming");
    assert.equal(result.warnings.length, 0);
  });

  it("parses Bahamut timetable text into structured reference slots", () => {
    const entries = parseBahamutTimetableText(
      [
        "07/04（週六）19:00 《Timetable Anime A》更新",
        "7/12 起每週日 23:00 更新《Timetable Anime B》"
      ].join("\n"),
      { year: 2026, url: "https://gnn.gamer.com.tw/detail.php?sn=307681", retrievedAt }
    );

    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.title, "Timetable Anime A");
    assert.equal(entries[0]?.uploadDate, "2026-07-04");
    assert.equal(entries[0]?.uploadTime, "19:00");
    assert.equal(entries[1]?.title, "Timetable Anime B");
    assert.equal(entries[1]?.uploadDate, "2026-07-12");
    assert.equal(entries[1]?.uploadTime, "23:00");
    assert.equal(entries[1]?.format, "tv");
  });

  it("parses Bahamut date headings followed by time-title rows", () => {
    const entries = parseBahamutTimetableText(
      [
        "07/05（週日）",
        "21:30 《Date Header Anime》更新",
        "22:5 《Single Digit Minute Anime》更新"
      ].join("\n"),
      { year: 2026, season: 7, url: "https://forum.gamer.com.tw/C.php?bsn=60037&snA=82874", retrievedAt }
    );

    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.title, "Date Header Anime");
    assert.equal(entries[0]?.uploadDate, "2026-07-05");
    assert.equal(entries[0]?.uploadTime, "21:30");
    assert.equal(entries[1]?.title, "Single Digit Minute Anime");
    assert.equal(entries[1]?.uploadTime, "22:05");
  });

  it("fetches configured Bahamut timetable pages without failing the whole source on blocked pages", async () => {
    const adapter = new BahamutSourceAdapter({
      enabled: true,
      referencesPath: "tests/fixtures/missing-bahamut-references.json",
      timetableUrls: ["https://example.test/timetable", "https://example.test/blocked"],
      fetchImpl: async (url) => {
        if (String(url).includes("blocked")) return new Response("blocked", { status: 403 });
        return new Response("<p>07/04（週六）19:00 《Fetched Timetable Anime》更新</p>");
      },
      now: () => new Date(retrievedAt)
    });

    const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });
    const item = result.items.find((candidate) => candidate.title.original === "Fetched Timetable Anime");

    assert.equal(item?.updateTime, "19:00");
    assert.equal(item?.updateWeekday, 6);
    assert.equal(item?.schedule[0]?.airDate, "2026-07-04");
    assert.equal(result.warnings.some((warning) => warning.code === "SOURCE_BLOCKED"), true);
  });

  it("parses YourAnimes JSON-LD entries with Bangumi IDs", () => {
    const entries = parseYourAnimesHtml(
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "ItemList",
        itemListElement: [
          {
            "@type": "ListItem",
            item: {
              "@type": "TVSeries",
              name: "YourAnimes Reference",
              url: "https://youranimes.tw/animes/1",
              datePublished: "2026-07-17T23:30:00+09:00",
              sameAs: ["https://bangumi.tv/subject/517106"]
            }
          }
        ]
      })}</script>`,
      { url: "https://youranimes.tw/bangumi/202607", retrievedAt }
    );

    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.bangumiSubjectId, 517106);
    assert.equal(entries[0]?.publishedAt, "2026-07-17T23:30:00+09:00");
    assert.deepEqual(entries[0]?.aliases, []);
  });

  it("maps YourAnimes Japan broadcast times into Beijing update slots", () => {
    const item = mapYourAnimesReferenceToAnimeItem(
      {
        title: "YourAnimes Reference",
        aliases: ["YourAnimes Alias"],
        url: "https://youranimes.tw/animes/1",
        publishedAt: "2026-07-17T23:30:00+09:00",
        bangumiSubjectId: 517106,
        retrievedAt
      },
      retrievedAt
    );

    assert.equal(item?.id, "anime:517106");
    assert.equal(item?.startDate, "2026-07-17");
    assert.equal(item?.updateWeekday, 5);
    assert.equal(item?.updateTime, "22:30");
    assert.equal(item?.timezone, "Asia/Shanghai");
    assert.equal(item?.sources[0]?.scope, "japan_broadcast");
  });

  it("reads YourAnimes timetable files as a low-priority reference source", async () => {
    const adapter = new YourAnimesSourceAdapter({
      timetableFiles: ["tests/fixtures/youranimes-sample.html"],
      timetableUrls: [],
      now: () => new Date(retrievedAt)
    });

    const result = await adapter.fetchSeason({ year: 2026, season: 7, quarter: "summer" });

    assert.equal(result.items.length, 1);
    assert.equal(result.items[0]?.id, "anime:517106");
    assert.equal(result.items[0]?.updateTime, "22:30");
    assert.equal(result.warnings.length, 0);
  });

  it("falls back to dynamic YourAnimes quarter URLs when the implicit local cache file is missing", async () => {
    const previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = "tests/fixtures/missing-youranimes-cache";
    let requestedUrl = "";
    const adapter = new YourAnimesSourceAdapter({
      fetchImpl: async (url) => {
        requestedUrl = String(url);
        return new Response(`<script type="application/ld+json">${JSON.stringify({
          "@type": "ItemList",
          itemListElement: [
            {
              "@type": "ListItem",
              item: {
                "@type": "TVSeries",
                name: "YourAnimes 2025 Reference",
                url: "https://youranimes.tw/animes/2025",
                datePublished: "2025-07-05T00:30:00+09:00",
                sameAs: ["https://bangumi.tv/subject/202507"]
              }
            }
          ]
        })}</script>`);
      },
      now: () => new Date(retrievedAt)
    });

    try {
      const result = await adapter.fetchSeason({ year: 2025, season: 7, quarter: "summer" });

      assert.equal(requestedUrl, "https://youranimes.tw/bangumi/202507");
      assert.equal(result.items.length, 1);
      assert.equal(result.items[0]?.id, "anime:202507");
      assert.equal(result.items[0]?.startDate, "2025-07-04");
      assert.equal(result.items[0]?.updateTime, "23:30");
      assert.equal(result.warnings.length, 0);
    } finally {
      if (previousDataDir === undefined) {
        delete process.env.DATA_DIR;
      } else {
        process.env.DATA_DIR = previousDataDir;
      }
    }
  });

  it("keeps warning for explicitly configured missing YourAnimes timetable files", async () => {
    const adapter = new YourAnimesSourceAdapter({
      timetableFiles: ["tests/fixtures/missing-youranimes.html"],
      timetableUrls: [],
      now: () => new Date(retrievedAt)
    });

    const result = await adapter.fetchSeason({ year: 2025, season: 7, quarter: "summer" });

    assert.equal(result.items.length, 0);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]?.message, "failed to read YourAnimes timetable file: tests/fixtures/missing-youranimes.html");
  });
});
