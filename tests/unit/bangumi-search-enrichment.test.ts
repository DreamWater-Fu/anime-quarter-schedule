import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enrichMissingBangumiBySearch } from "../../src/server/sources/bangumi/searchEnrichment.ts";
import type { AnimeItem } from "../../src/server/types/anime.ts";
import type { BangumiSubject } from "../../src/server/sources/index.ts";

const retrievedAt = "2026-08-03T00:00:00Z";

describe("Bangumi search enrichment", () => {
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
    const item = createYucWikiItem({
      original: "BASTARD!! -暗黒の破壊神-",
      japanese: "BASTARD!! -暗黒の破壊神-",
      chinese: "BASTARD 暗黑破坏神",
      aliases: ["BASTARD 暗黑破坏神", "BASTARD!! -暗黒の破壊神-"],
      startDate: "2022-06-30"
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

function createYucWikiItem(input: {
  original: string;
  japanese: string;
  chinese: string;
  aliases: string[];
  startDate: string;
}): AnimeItem {
  return {
    id: "anime:yucwiki:202207:b09",
    title: {
      original: input.original,
      japanese: input.japanese,
      chinese: input.chinese,
      english: null,
      aliases: input.aliases
    },
    format: "tv",
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
        name: "YucWiki",
        type: "official",
        url: "https://yuc.wiki/202207/",
        retrievedAt,
        scope: "metadata"
      }
    ],
    dataStatus: "partial",
    inclusionStatus: "included",
    isJapaneseAnime: true,
    createdAt: retrievedAt,
    updatedAt: retrievedAt
  };
}
