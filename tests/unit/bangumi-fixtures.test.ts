import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  matchBangumiAnime,
  mergeBangumiMatchIntoAnimeItem
} from "../../src/server/sources/bangumi/index.ts";
import type {
  BangumiSearchClient,
  BangumiSubject,
  MatchBangumiAnimeInput
} from "../../src/server/sources/bangumi/index.ts";
import type { AnimeItem } from "../../src/server/types/anime.ts";
import { readFixture } from "./test-utils.ts";

const matchedAt = "2026-07-28T12:00:00+09:00";

interface MatchFixture {
  input: MatchBangumiAnimeInput;
  searchResponse: BangumiSubject[];
  expected?: {
    confidence: "high" | "medium" | "low";
    subjectId: number | null;
    needsManualReview: boolean;
    risk?: string;
  };
  expectedAnimePatch?: Pick<AnimeItem, "bangumi" | "dataStatus">;
}

function createClient(subjects: BangumiSubject[]): BangumiSearchClient {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  return {
    searchSubjects: async () => subjects,
    listSubjectsByMonth: async () => [],
    getSubject: async (subjectId) => {
      const subject = byId.get(subjectId);
      if (!subject) throw new Error(`missing subject ${subjectId}`);
      return subject;
    }
  };
}

describe("Bangumi fixture matching", () => {
  it("auto-binds complete Bangumi matches", async () => {
    const fixture = readFixture<MatchFixture>("bangumi.search.full-match.json");
    const result = await matchBangumiAnime(fixture.input, createClient(fixture.searchResponse), {
      now: () => new Date(matchedAt)
    });

    assert.equal(result.confidence, fixture.expected?.confidence);
    assert.equal(result.subjectId, fixture.expected?.subjectId);
    assert.equal(result.needsManualReview, fixture.expected?.needsManualReview);
  });

  it("keeps close multiple candidates for manual review", async () => {
    const fixture = readFixture<MatchFixture>("bangumi.search.multi-candidates.json");
    const result = await matchBangumiAnime(fixture.input, createClient(fixture.searchResponse), {
      now: () => new Date(matchedAt)
    });

    assert.equal(result.confidence, fixture.expected?.confidence);
    assert.equal(result.subjectId, undefined);
    assert.equal(result.needsManualReview, true);
    assert.equal(result.candidates[0]?.risks.includes("multiple_close_candidates"), true);
  });

  it("keeps Bangumi fields null when matching fails", async () => {
    const fixture = readFixture<MatchFixture>("bangumi.search.no-match.json");
    const result = await matchBangumiAnime(fixture.input, createClient(fixture.searchResponse), {
      now: () => new Date(matchedAt)
    });
    const item = mergeBangumiMatchIntoAnimeItem(createAnimeItem(fixture.input), result, matchedAt);

    assert.equal(result.confidence, "low");
    assert.equal(result.needsManualReview, true);
    assert.deepEqual(item.bangumi, fixture.expectedAnimePatch?.bangumi);
    assert.equal(item.dataStatus, fixture.expectedAnimePatch?.dataStatus);
  });
});

function createAnimeItem(input: MatchBangumiAnimeInput): AnimeItem {
  return {
    id: "anime:no-match",
    title: {
      original: input.title.original,
      japanese: input.title.japanese ?? null,
      chinese: input.title.chinese ?? null,
      english: input.title.english ?? null,
      aliases: input.title.aliases ?? []
    },
    format: input.format ?? "tv",
    status: "airing",
    startDate: input.startDate ?? null,
    endDate: null,
    datePrecision: input.startDate ? "day" : "unknown",
    primarySeason: null,
    activeSeasons: [],
    updateWeekday: null,
    updateTime: null,
    timezone: "Asia/Tokyo",
    episodeCount: input.episodeCount ?? null,
    airedEpisodeCount: null,
    isJapaneseAnime: true,
    inclusionStatus: "included",
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
    sources: [
      {
        name: "Fixture",
        type: "manual",
        retrievedAt: matchedAt
      }
    ],
    dataStatus: "partial",
    updatedAt: matchedAt,
    createdAt: matchedAt
  };
}
