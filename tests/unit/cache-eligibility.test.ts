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
      chinese: "全球探险冲冲冲 第三季",
      subjectId: 658676
    });

    assert.equal(isCacheEligibleAnime(item), false);
  });

  it("keeps Bangumi-only rows when the item has strong Japanese evidence", () => {
    const japaneseTitle = createItem({
      id: "anime:bangumi-only-japanese-title",
      original: "かいじゅうステップ ワンダバダ",
      chinese: "小怪兽成长日记 蹒跚学步",
      subjectId: 302157
    });
    const japaneseOfficialSite = createItem({
      id: "anime:bangumi-only-official-site",
      original: "BEM",
      chinese: "BEM",
      subjectId: 274133,
      officialUrl: "https://newbem.jp/"
    });
    const japaneseStaff = createItem({
      id: "anime:bangumi-only-japanese-staff",
      original: "Business Fish",
      chinese: null,
      subjectId: 285517,
      staff: { studio: ["アイアンドエー"], productionCommittee: [], originalWorkType: null }
    });

    assert.equal(isCacheEligibleAnime(japaneseTitle), true);
    assert.equal(isCacheEligibleAnime(japaneseOfficialSite), true);
    assert.equal(isCacheEligibleAnime(japaneseStaff), true);
  });

  it("does not require extra evidence for trusted non-Bangumi catalog sources", () => {
    const item = createItem({
      id: "anime:yucwiki-catalog",
      original: "Catalog Title",
      chinese: "目录条目",
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
      chinese: null,
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
      ratingCount: null,
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
