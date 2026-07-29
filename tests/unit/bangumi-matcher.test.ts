import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  generateBangumiSearchTitles,
  matchBangumiAnime,
  mergeBangumiMatchIntoAnimeItem,
  normalizeTitle
} from "../../src/server/sources/bangumi/index.ts";
import type {
  BangumiSearchClient,
  BangumiSubject,
  MatchBangumiAnimeInput
} from "../../src/server/sources/bangumi/index.ts";
import type { AnimeItem } from "../../src/server/types/anime.ts";

const matchedAt = "2026-07-28T12:00:00+09:00";

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

function createAnimeItem(overrides: Partial<AnimeItem> = {}): AnimeItem {
  const base: AnimeItem = {
    id: "anime:local",
    title: {
      original: "完全一致アニメ",
      japanese: "完全一致アニメ",
      chinese: null,
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
    episodeCount: 12,
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
        name: "Official",
        type: "official",
        retrievedAt: matchedAt
      }
    ],
    dataStatus: "partial",
    updatedAt: matchedAt,
    createdAt: matchedAt
  };

  return { ...base, ...overrides };
}

describe("Bangumi title normalization", () => {
  it("creates keys for punctuation and season differences", () => {
    const normalized = normalizeTitle("SPY×FAMILY 第2期");

    assert.equal(normalized.compact, "spyfamily第2期");
    assert.equal(normalized.punctuationless, "spy family 第2期");
    assert.deepEqual(normalized.seasonToken, { kind: "season", number: 2, raw: "第2期" });
  });

  it("generates search titles from Japanese, Chinese, English and aliases", () => {
    const titles = generateBangumiSearchTitles({
      title: {
        original: "The Fable",
        japanese: "ザ・ファブル",
        chinese: "杀手寓言",
        english: "The Fable",
        aliases: ["ザ ファブル"]
      }
    });

    assert.equal(titles.includes("ザ・ファブル"), true);
    assert.equal(titles.includes("杀手寓言"), true);
    assert.equal(titles.some((title) => title.includes("fable")), true);
  });
});

describe("Bangumi matcher", () => {
  it("returns high confidence for Japanese title, date, format and episode match", async () => {
    const subject: BangumiSubject = {
      id: 2001,
      type: 2,
      name: "完全一致アニメ",
      name_cn: "完全一致动画",
      date: "2026-07-03",
      platform: "TV",
      eps: 12,
      rating: { score: 7.8, total: 980, rank: 720 },
      images: { large: "https://img.example/large.jpg" }
    };

    const result = await matchBangumiAnime(
      {
        title: { original: "完全一致アニメ", japanese: "完全一致アニメ", chinese: null, english: null, aliases: [] },
        year: 2026,
        quarter: "summer",
        startDate: "2026-07-03",
        format: "tv",
        episodeCount: 12,
        sources: [{ name: "Official", type: "official", retrievedAt: matchedAt }]
      },
      createClient([subject]),
      { now: () => new Date(matchedAt) }
    );

    assert.equal(result.confidence, "high");
    assert.equal(result.subjectId, 2001);
    assert.equal(result.needsManualReview, false);
    assert.equal(result.selectedCandidate?.matchedFields.includes("name"), true);
  });

  it("treats punctuation differences like SPY x FAMILY as high confidence when auxiliary evidence matches", async () => {
    const subject: BangumiSubject = {
      id: 2002,
      type: 2,
      name: "SPY×FAMILY",
      name_cn: "间谍过家家",
      date: "2026-04-09",
      platform: "TV",
      eps: 12
    };

    const result = await matchBangumiAnime(
      {
        title: { original: "SPY FAMILY", japanese: "SPY FAMILY", chinese: null, english: null, aliases: [] },
        year: 2026,
        quarter: "spring",
        startDate: "2026-04-09",
        format: "tv",
        episodeCount: 12,
        sources: [{ name: "Official", type: "official", retrievedAt: matchedAt }]
      },
      createClient([subject]),
      { now: () => new Date(matchedAt) }
    );

    assert.equal(result.confidence, "high");
    assert.equal(result.subjectId, 2002);
  });

  it("does not auto-bind Chinese-title-only matches", async () => {
    const subject: BangumiSubject = {
      id: 2003,
      type: 2,
      name: "Japanese Title",
      name_cn: "间谍过家家",
      date: undefined,
      platform: "TV",
      eps: undefined
    };

    const result = await matchBangumiAnime(
      {
        title: { original: "间谍过家家", japanese: null, chinese: "间谍过家家", english: null, aliases: [] },
        format: "tv",
        sources: [{ name: "third-party import", type: "third_party", retrievedAt: matchedAt }]
      },
      createClient([subject]),
      { now: () => new Date(matchedAt) }
    );

    assert.equal(result.confidence, "medium");
    assert.equal(result.subjectId, undefined);
    assert.equal(result.needsManualReview, true);
    assert.equal(result.candidates[0]?.risks.includes("chinese_title_only"), true);
  });

  it("downgrades title matches with year conflicts to low", async () => {
    const subject: BangumiSubject = {
      id: 2004,
      type: 2,
      name: "同名作品",
      name_cn: "同名作品",
      date: "2024-07-03",
      platform: "TV",
      eps: 12
    };

    const result = await matchBangumiAnime(
      {
        title: { original: "同名作品", japanese: "同名作品", chinese: null, english: null, aliases: [] },
        year: 2026,
        quarter: "summer",
        startDate: "2026-07-03",
        format: "tv",
        episodeCount: 12
      },
      createClient([subject]),
      { now: () => new Date(matchedAt) }
    );

    assert.equal(result.confidence, "low");
    assert.equal(result.candidates[0]?.risks.includes("year_mismatch"), true);
    assert.equal(result.needsManualReview, true);
  });

  it("downgrades explicit season token conflicts to low", async () => {
    const subject: BangumiSubject = {
      id: 2005,
      type: 2,
      name: "作品 第1期",
      name_cn: "作品 第一季",
      date: "2026-07-03",
      platform: "TV",
      eps: 12
    };

    const result = await matchBangumiAnime(
      {
        title: { original: "作品 第2期", japanese: "作品 第2期", chinese: null, english: null, aliases: [] },
        year: 2026,
        quarter: "summer",
        startDate: "2026-07-03",
        format: "tv",
        episodeCount: 12
      },
      createClient([subject]),
      { now: () => new Date(matchedAt) }
    );

    assert.equal(result.confidence, "low");
    assert.equal(result.candidates[0]?.risks.includes("season_token_mismatch"), true);
  });

  it("marks close multiple candidates for manual review", async () => {
    const subjects: BangumiSubject[] = [
      {
        id: 2006,
        type: 2,
        name: "同名作品",
        name_cn: "同名作品",
        date: "2026-04-05",
        platform: "TV",
        eps: 12
      },
      {
        id: 2007,
        type: 2,
        name: "同名作品",
        name_cn: "同名作品",
        date: "2026-04-06",
        platform: "TV",
        eps: 12
      }
    ];

    const result = await matchBangumiAnime(
      {
        title: { original: "同名作品", japanese: "同名作品", chinese: null, english: null, aliases: [] },
        year: 2026,
        quarter: "spring",
        startDate: "2026-04-05",
        format: "tv",
        episodeCount: 12
      },
      createClient(subjects),
      { now: () => new Date(matchedAt) }
    );

    assert.equal(result.confidence, "medium");
    assert.equal(result.subjectId, undefined);
    assert.equal(result.needsManualReview, true);
    assert.equal(result.candidates[0]?.risks.includes("multiple_close_candidates"), true);
  });

  it("merges Bangumi rating, cover and subject URL only for high-confidence matches", async () => {
    const subject: BangumiSubject = {
      id: 2008,
      type: 2,
      name: "完全一致アニメ",
      name_cn: "完全一致动画",
      date: "2026-07-03",
      platform: "TV",
      eps: 12,
      rating: { score: 8.1, total: 1200, rank: 500 },
      images: { large: "https://img.example/large.jpg", medium: "https://img.example/medium.jpg" }
    };
    const result = await matchBangumiAnime(
      {
        title: { original: "完全一致アニメ", japanese: "完全一致アニメ", chinese: null, english: null, aliases: [] },
        year: 2026,
        quarter: "summer",
        startDate: "2026-07-03",
        format: "tv",
        episodeCount: 12,
        sources: [{ name: "Official", type: "official", retrievedAt: matchedAt }]
      },
      createClient([subject]),
      { now: () => new Date(matchedAt) }
    );

    const item = mergeBangumiMatchIntoAnimeItem(createAnimeItem(), result, matchedAt);

    assert.equal(item.bangumi.subjectId, 2008);
    assert.equal(item.bangumi.url, "https://bgm.tv/subject/2008");
    assert.equal(item.bangumi.rating, 8.1);
    assert.equal(item.bangumi.ratingCount, 1200);
    assert.equal(item.bangumi.rank, 500);
    assert.equal(item.coverImage?.large, "https://img.example/large.jpg");

    const unverified = mergeBangumiMatchIntoAnimeItem(createAnimeItem(), { ...result, confidence: "low" }, matchedAt);
    assert.equal(unverified.bangumi.subjectId, null);
    assert.equal(unverified.dataStatus, "unverified");
  });
});
