import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isCacheEligibleAnime } from "../../src/server/anime/cacheEligibility.ts";
import type { AnimeItem } from "../../src/server/types/anime.ts";

const retrievedAt = "2026-08-04T00:00:00Z";

describe("cache eligibility", () => {
  it("blocks Bangumi-only catalog rows without strong Japanese TV evidence", () => {
    const item = createItem({
      id: "anime:bangumi-only-overseas",
      original: "Go Jetters Series 3",
      chinese: "Global Adventure Series 3",
      subjectId: 658676
    });

    assert.equal(isCacheEligibleAnime(item), false);
  });

  it("keeps Bangumi-only rows when the item has strong Japanese evidence", () => {
    const japaneseOfficialSite = createItem({
      id: "anime:bangumi-only-official-site",
      original: "BEM",
      chinese: "BEM",
      subjectId: 274133,
      officialUrl: "https://newbem.jp/"
    });
    const japaneseBroadcastSite = createItem({
      id: "anime:bangumi-only-tv-site",
      original: "Fixture Broadcast Title",
      chinese: "Fixture Broadcast Title",
      subjectId: 302157,
      officialUrl: "https://www.tv-tokyo.co.jp/anime/example/"
    });

    assert.equal(isCacheEligibleAnime(japaneseOfficialSite), true);
    assert.equal(isCacheEligibleAnime(japaneseBroadcastSite), true);
  });

  it("does not require extra evidence for trusted non-Bangumi catalog sources", () => {
    const item = createItem({
      id: "anime:yucwiki-catalog",
      original: "Catalog Title",
      chinese: "Catalog Title",
      subjectId: null,
      sources: [
        {
          name: "YucWiki",
          type: "third_party",
          retrievedAt,
          scope: "japan_broadcast"
        }
      ]
    });

    assert.equal(isCacheEligibleAnime(item), true);
  });

  it("keeps Bangumi-only rows when a non-Bangumi schedule source confirms the broadcast catalog", () => {
    const item = createItem({
      id: "anime:bangumi-only-with-schedule-source",
      original: "Fixture Broadcast Title",
      chinese: "Fixture Broadcast Title",
      subjectId: 1001,
      schedule: [
        {
          episodeNumber: 1,
          episodeTitle: null,
          airDate: "2019-07-01",
          airTime: "23:30",
          timezone: "Asia/Tokyo",
          status: "confirmed",
          source: {
            name: "Official Schedule",
            type: "official",
            retrievedAt
          }
        }
      ]
    });

    assert.equal(isCacheEligibleAnime(item), true);
  });

  it("blocks items without a Chinese title when Bangumi rating count is below 50", () => {
    assert.equal(
      isCacheEligibleAnime(createItem({
        id: "anime:missing-chinese-title-low-rating-count",
        original: "Missing Chinese Title",
        chinese: null,
        subjectId: 1002,
        ratingCount: 49,
        officialUrl: "https://example.jp/"
      })),
      false
    );
    assert.equal(
      isCacheEligibleAnime(createItem({
        id: "anime:missing-chinese-title-without-rating-count",
        original: "Missing Chinese Title",
        chinese: null,
        subjectId: 1003,
        officialUrl: "https://example.jp/"
      })),
      false
    );
  });

  it("keeps items without a Chinese title when Bangumi rating count reaches 50", () => {
    const item = createItem({
      id: "anime:228820",
      original: "Free!-Dive to the Future-",
      chinese: null,
      subjectId: 228820,
      ratingCount: 763,
      officialUrl: "https://example.jp/free/"
    });

    assert.equal(isCacheEligibleAnime(item), true);
  });

  it("keeps Japanese productions when Chinese aliases hit broad robot franchise wording", () => {
    const item = createItem({
      id: "anime:472386",
      original: "シンカリオン チェンジ ザ ワールド",
      chinese: "进化先锋 改变世界",
      subjectId: 472386,
      ratingCount: 120,
      staff: {
        studio: ["SIGNAL.MD＆Production I.G"],
        productionCommittee: [],
        originalWorkType: null
      }
    });
    item.title.aliases = ["新干线变形机器人 进化先锋 改变世界"];

    assert.equal(isCacheEligibleAnime(item), true);
  });

  it("still blocks broad robot franchise wording without Japanese production evidence", () => {
    const item = createItem({
      id: "anime:foreign-robot-franchise",
      original: "Robot Franchise",
      chinese: "新干线变形机器人 海外版",
      subjectId: null
    });

    assert.equal(isCacheEligibleAnime(item), false);
  });

  it("blocks explicit overseas brands even when Japanese production evidence is present", () => {
    const item = createItem({
      id: "anime:disney-japanese-production",
      original: "ディズニー ツイステッドワンダーランド",
      chinese: "迪士尼扭曲仙境",
      subjectId: 1004,
      ratingCount: 100,
      staff: {
        studio: ["ゆめ太カンパニー", "グラフィニカ"],
        productionCommittee: [],
        originalWorkType: "game"
      }
    });

    assert.equal(isCacheEligibleAnime(item), false);
  });

  it("applies 2019 manual review exclusions while keeping confirmed exceptions", () => {
    for (const subjectId of [259070, 270636, 267481, 267412, 279713, 274222, 249245, 244900, 279468, 239911]) {
      assert.equal(
        isCacheEligibleAnime(createItem({
          id: `anime:${subjectId}`,
          original: "Manual Excluded Title",
          chinese: "Manual Excluded Title",
          subjectId
        })),
        false,
        `subject ${subjectId} should be excluded`
      );
    }

    for (const subjectId of [262382, 270473, 251831]) {
      assert.equal(
        isCacheEligibleAnime(createItem({
          id: `anime:${subjectId}`,
          original: "Manual Confirmed Title",
          chinese: "Manual Confirmed Title",
          subjectId,
          officialUrl: "https://example.jp/manual-confirmed/"
        })),
        true,
        `subject ${subjectId} should be kept`
      );
    }
  });

  it("applies 2018 high-risk manual review exclusions", () => {
    for (const subjectId of [230295, 231887, 231888, 256278, 250558, 263756, 223127, 223407, 231067, 217239, 186180, 226986, 243923, 258390, 154771, 236597, 259135]) {
      assert.equal(
        isCacheEligibleAnime(createItem({
          id: `anime:${subjectId}`,
          original: "Manual Excluded Title",
          chinese: "Manual Excluded Title",
          subjectId
        })),
        false,
        `subject ${subjectId} should be excluded`
      );
    }
  });

  it("keeps 2018 manual review confirmations", () => {
    for (const subjectId of [205310, 199373, 239910, 257844, 246431]) {
      assert.equal(
        isCacheEligibleAnime(createItem({
          id: `anime:${subjectId}`,
          original: "Manual Confirmed Title",
          chinese: "Manual Confirmed Title",
          subjectId,
          officialUrl: "https://example.jp/manual-confirmed/"
        })),
        true,
        `subject ${subjectId} should be kept`
      );
    }
  });

  it("applies manually excluded short-form and long-running children series", () => {
    for (const subjectId of [227778, 233609, 237838, 238300, 238831, 247549, 239750, 239840, 239853, 240383, 241031, 240459, 294292, 279470, 279473, 239747, 262384, 301776, 302446, 302447]) {
      assert.equal(
        isCacheEligibleAnime(createItem({
          id: `anime:${subjectId}`,
          original: "Manual Excluded Title",
          chinese: "Manual Excluded Title",
          subjectId
        })),
        false,
        `subject ${subjectId} should be excluded`
      );
    }
  });
});

function createItem(input: {
  id: string;
  original: string;
  chinese: string | null;
  subjectId: number | null;
  officialUrl?: string | null;
  staff?: AnimeItem["staff"];
  sources?: AnimeItem["sources"];
  schedule?: AnimeItem["schedule"];
  ratingCount?: number | null;
}): AnimeItem {
  return {
    id: input.id,
    title: {
      original: input.original,
      japanese: input.original,
      chinese: input.chinese,
      english: null,
      aliases: []
    },
    format: "tv",
    status: "finished",
    startDate: "2019-07-01",
    endDate: "2019-09-30",
    datePrecision: "day",
    primarySeason: { year: 2019, quarter: "summer" },
    activeSeasons: [{ year: 2019, quarter: "summer" }],
    updateWeekday: null,
    updateTime: null,
    timezone: "Asia/Tokyo",
    episodeCount: 12,
    airedEpisodeCount: 12,
    officialUrl: input.officialUrl ?? null,
    staff: input.staff ?? { studio: [], productionCommittee: [], originalWorkType: null },
    bangumi: {
      subjectId: input.subjectId,
      url: input.subjectId === null ? null : `https://bgm.tv/subject/${input.subjectId}`,
      rating: null,
      ratingCount: input.ratingCount ?? null,
      rank: null,
      lastSyncedAt: null
    },
    externalIds: { bangumiSubjectId: input.subjectId, bahamutSn: null },
    coverImage: null,
    sources: input.sources ?? [
      {
        name: "Bangumi",
        type: "bangumi",
        url: input.subjectId === null ? undefined : `https://bgm.tv/subject/${input.subjectId}`,
        retrievedAt,
        scope: "metadata"
      }
    ],
    schedule: input.schedule ?? [],
    dataStatus: "partial",
    inclusionStatus: "included",
    isJapaneseAnime: true,
    createdAt: retrievedAt,
    updatedAt: retrievedAt
  };
}
