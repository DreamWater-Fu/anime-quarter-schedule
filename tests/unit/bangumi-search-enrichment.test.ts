import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  enrichMissingBangumiBySearch,
  shouldSearchMissingBangumi
} from "../../src/server/sources/bangumi/searchEnrichment.ts";
import type { AnimeItem } from "../../src/server/types/anime.ts";
import type { BangumiSubject } from "../../src/server/sources/index.ts";

const retrievedAt = "2026-08-03T00:00:00Z";

describe("Bangumi search enrichment", () => {
  it("matches an eligible cold-start YourAnimes Japan broadcast item", async () => {
    const keywords: string[] = [];
    const subject: BangumiSubject = {
      id: 600101,
      type: 2,
      name: "コールドスタート",
      name_cn: "冷启动动画",
      date: "2026-07-10",
      platform: "TV",
      eps: 12,
      rating: { score: 7.2, total: 120, rank: 1800 },
      images: { large: "https://img.example/cold-start.jpg" }
    };
    const item = createSearchItem({
      id: "anime:youranimes:cold-start",
      original: "コールドスタート",
      japanese: "コールドスタート",
      chinese: "冷启动动画",
      aliases: ["Cold Start Anime"],
      startDate: "2026-07-10",
      sourceName: "YourAnimes",
      sourceUrl: "https://youranimes.tw/animes/cold-start",
      sourceScope: "japan_broadcast",
      inclusionStatus: "needs_review"
    });

    assert.equal(shouldSearchMissingBangumi(item), true);

    const result = await enrichMissingBangumiBySearch([item], {
      now: () => new Date(retrievedAt),
      client: {
        searchSubjects: async ({ keyword }) => {
          keywords.push(keyword);
          return keyword === "コールドスタート" ? [subject] : [];
        },
        getSubject: async () => subject
      }
    });

    assert.equal(result.matched, 1);
    assert.equal(result.items[0]?.bangumi.subjectId, 600101);
    assert.equal(result.items[0]?.bangumi.rating, 7.2);
    assert.equal(result.items[0]?.coverImage?.source, "bangumi");
    assert.deepEqual(keywords, ["コールドスタート"]);
  });

  it("does not search Bangumi for items outside the cache boundary", async () => {
    let searchCalls = 0;
    const webItem = createSearchItem({
      id: "anime:youranimes:web",
      original: "配信アニメ",
      japanese: "配信アニメ",
      chinese: "配信动画",
      startDate: "2026-07-11",
      sourceName: "YourAnimes",
      sourceScope: "japan_broadcast",
      format: "web"
    });
    const excludedItem = createSearchItem({
      id: "anime:youranimes:excluded",
      original: "Manual Excluded TV",
      japanese: "Manual Excluded TV",
      chinese: "人工排除 TV",
      startDate: "2026-07-12",
      sourceName: "YourAnimes",
      sourceScope: "japan_broadcast",
      inclusionStatus: "excluded",
      exclusionReason: "Manual review exclusion"
    });
    const adultItem = createSearchItem({
      id: "anime:yucwiki:adult",
      original: "インゴクダンチ",
      japanese: "インゴクダンチ",
      chinese: "淫狱团地",
      startDate: "2026-07-13",
      sourceName: "YucWiki"
    });

    assert.equal(shouldSearchMissingBangumi(webItem), false);
    assert.equal(shouldSearchMissingBangumi(excludedItem), false);
    assert.equal(shouldSearchMissingBangumi(adultItem), false);

    const result = await enrichMissingBangumiBySearch([webItem, excludedItem, adultItem], {
      now: () => new Date(retrievedAt),
      client: {
        searchSubjects: async () => {
          searchCalls += 1;
          return [];
        }
      }
    });

    assert.equal(result.matched, 0);
    assert.equal(searchCalls, 0);
    assert.deepEqual(result.items.map((item) => item.id), [webItem.id, excludedItem.id, adultItem.id]);
  });

  it("keeps searching aliases when the primary Japanese title does not return an acceptable subject", async () => {
    const keywords: string[] = [];
    const subject: BangumiSubject = {
      id: 367726,
      type: 2,
      name: "BASTARD!! -暗黒の破壊神-",
      name_cn: "BASTARD!! 暗黑破坏神",
      date: "2022-06-30",
      platform: "TV",
      eps: 13,
      rating: { score: 5.4, total: 427, rank: 0 },
      images: { large: "https://img.example/bastard.jpg" }
    };
    const item = createSearchItem({
      original: "BASTARD!! -暗黒の破壊神-",
      japanese: "BASTARD!! -暗黒の破壊神-",
      chinese: "BASTARD 暗黑破坏神",
      aliases: ["BASTARD 暗黑破坏神", "BASTARD!! -暗黒の破壊神-"],
      startDate: "2022-06-30",
      sourceName: "YucWiki",
      sourceUrl: "https://yuc.wiki/202207/"
    });

    const result = await enrichMissingBangumiBySearch([item], {
      now: () => new Date(retrievedAt),
      client: {
        searchSubjects: async ({ keyword }) => {
          keywords.push(keyword);
          return keyword.includes("暗黑") ? [subject] : [];
        },
        getSubject: async () => subject
      }
    });

    assert.equal(result.matched, 1);
    assert.equal(result.items[0]?.bangumi.subjectId, 367726);
    assert.equal(result.items[0]?.bangumi.rating, 5.4);
    assert.equal(result.items[0]?.coverImage?.source, "bangumi");
    assert.equal(keywords.includes("BASTARD 暗黑破坏神"), true);
  });
});

function createSearchItem(input: {
  id?: string;
  original: string;
  japanese: string;
  chinese: string;
  aliases?: string[];
  startDate: string;
  sourceName: string;
  sourceUrl?: string;
  sourceScope?: AnimeItem["sources"][number]["scope"];
  format?: AnimeItem["format"];
  inclusionStatus?: AnimeItem["inclusionStatus"];
  exclusionReason?: string;
}): AnimeItem {
  return {
    id: input.id ?? "anime:yucwiki:202207:b09",
    title: {
      original: input.original,
      japanese: input.japanese,
      chinese: input.chinese,
      english: null,
      aliases: input.aliases ?? []
    },
    format: input.format ?? "tv",
    status: "finished",
    startDate: input.startDate,
    endDate: "2022-09-30",
    datePrecision: "day",
    primarySeason: { year: 2022, quarter: "summer" },
    activeSeasons: [{ year: 2022, quarter: "summer" }],
    updateWeekday: null,
    updateTime: null,
    timezone: "Asia/Shanghai",
    schedule: [],
    episodeCount: null,
    airedEpisodeCount: null,
    officialUrl: null,
    staff: { studio: [], productionCommittee: [], originalWorkType: null },
    bangumi: {
      subjectId: null,
      url: null,
      rating: null,
      ratingCount: null,
      rank: null,
      lastSyncedAt: null
    },
    externalIds: { bangumiSubjectId: null, bahamutSn: null },
    coverImage: null,
    sources: [
      {
        name: input.sourceName,
        type: "official",
        url: input.sourceUrl,
        retrievedAt,
        scope: input.sourceScope ?? "metadata"
      }
    ],
    dataStatus: "partial",
    inclusionStatus: input.inclusionStatus ?? "included",
    ...(input.exclusionReason ? { exclusionReason: input.exclusionReason } : {}),
    isJapaneseAnime: true,
    createdAt: retrievedAt,
    updatedAt: retrievedAt
  };
}
