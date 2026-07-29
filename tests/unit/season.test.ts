import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateActiveSeasons,
  getCurrentSeasonKey,
  calculatePrimarySeason,
  classifySeasonMembership,
  hasBlockingValidationIssues,
  inferUpdateWeekday,
  isCrossQuarterContinuing,
  isValidDateString,
  seasonKeyFromDate,
  validateAnimeCache,
  validateAnimeItem
} from "../../src/server/anime/index.ts";
import type { AnimeItem, AnimeSource } from "../../src/server/types/anime.ts";

const source: AnimeSource = {
  name: "Bangumi",
  type: "bangumi",
  url: "https://bgm.tv/subject/1001",
  retrievedAt: "2026-07-27T21:30:00+09:00"
};

function createAnime(overrides: Partial<AnimeItem> = {}): AnimeItem {
  const base: AnimeItem = {
    id: "anime:1001",
    title: {
      original: "冬の一作",
      japanese: "冬の一作",
      chinese: "冬季作品",
      english: null,
      aliases: []
    },
    format: "tv",
    status: "finished",
    startDate: "2026-01-05",
    endDate: "2026-03-23",
    datePrecision: "day",
    primarySeason: { year: 2026, quarter: "winter" },
    activeSeasons: [{ year: 2026, quarter: "winter" }],
    updateWeekday: 1,
    updateTime: "23:30",
    timezone: "Asia/Tokyo",
    episodeCount: 12,
    airedEpisodeCount: 12,
    isJapaneseAnime: true,
    inclusionStatus: "included",
    officialUrl: null,
    coverImage: null,
    externalIds: {
      bangumiSubjectId: 1001,
      bahamutSn: null
    },
    bangumi: {
      subjectId: 1001,
      url: "https://bgm.tv/subject/1001",
      rating: 7.6,
      ratingCount: 1200,
      rank: 880,
      lastSyncedAt: "2026-07-27T21:30:00+09:00"
    },
    schedule: [
      {
        episodeNumber: 1,
        episodeTitle: null,
        airDate: "2026-01-05",
        airTime: "23:30",
        timezone: "Asia/Tokyo",
        status: "confirmed",
        source
      },
      {
        episodeNumber: 12,
        episodeTitle: null,
        airDate: "2026-03-23",
        airTime: "23:30",
        timezone: "Asia/Tokyo",
        status: "confirmed",
        source
      }
    ],
    staff: {
      studio: ["Example Studio"],
      productionCommittee: [],
      originalWorkType: null
    },
    sources: [source],
    dataStatus: "complete",
    updatedAt: "2026-07-27T21:30:00+09:00",
    createdAt: "2026-07-20T10:00:00+09:00"
  };

  return { ...base, ...overrides };
}

describe("season calculation", () => {
  it("maps quarter boundary dates to documented quarters", () => {
    assert.deepEqual(seasonKeyFromDate("2026-01-01"), { year: 2026, quarter: "winter" });
    assert.deepEqual(seasonKeyFromDate("2026-03-31"), { year: 2026, quarter: "winter" });
    assert.deepEqual(seasonKeyFromDate("2026-04-01"), { year: 2026, quarter: "spring" });
    assert.deepEqual(seasonKeyFromDate("2026-06-30"), { year: 2026, quarter: "spring" });
    assert.deepEqual(seasonKeyFromDate("2026-07-01"), { year: 2026, quarter: "summer" });
    assert.deepEqual(seasonKeyFromDate("2026-09-30"), { year: 2026, quarter: "summer" });
    assert.deepEqual(seasonKeyFromDate("2026-10-01"), { year: 2026, quarter: "fall" });
    assert.deepEqual(seasonKeyFromDate("2026-12-31"), { year: 2026, quarter: "fall" });
  });

  it("calculates primarySeason from premiere date with a two-week lead window", () => {
    assert.deepEqual(calculatePrimarySeason("2026-03-17"), { year: 2026, quarter: "winter" });
    assert.deepEqual(calculatePrimarySeason("2026-03-18"), { year: 2026, quarter: "spring" });
    assert.deepEqual(calculatePrimarySeason("2026-06-16"), { year: 2026, quarter: "spring" });
    assert.deepEqual(calculatePrimarySeason("2026-06-17"), { year: 2026, quarter: "summer" });
    assert.deepEqual(calculatePrimarySeason("2026-09-16"), { year: 2026, quarter: "summer" });
    assert.deepEqual(calculatePrimarySeason("2026-09-17"), { year: 2026, quarter: "fall" });
    assert.deepEqual(calculatePrimarySeason("2026-12-17"), { year: 2026, quarter: "fall" });
    assert.deepEqual(calculatePrimarySeason("2026-12-18"), { year: 2027, quarter: "winter" });
    assert.equal(calculatePrimarySeason(null), null);
  });

  it("uses the same lead window for the current Beijing season", () => {
    assert.deepEqual(getCurrentSeasonKey(new Date("2026-03-17T15:59:59Z")), { year: 2026, quarter: "winter" });
    assert.deepEqual(getCurrentSeasonKey(new Date("2026-03-17T16:00:00Z")), { year: 2026, quarter: "spring" });
  });

  it("calculates activeSeasons from actual schedule coverage", () => {
    const activeSeasons = calculateActiveSeasons({
      schedule: [
        { airDate: "2026-03-20" },
        { airDate: "2026-03-27" },
        { airDate: "2026-04-03" }
      ],
      fallbackPrimarySeason: { year: 2026, quarter: "winter" }
    });

    assert.deepEqual(activeSeasons, [
      { year: 2026, quarter: "winter" },
      { year: 2026, quarter: "spring" }
    ]);
  });

  it("keeps cross-year activeSeasons sorted and unique", () => {
    const activeSeasons = calculateActiveSeasons({
      schedule: [
        { airDate: "2026-01-02" },
        { airDate: "2025-10-10" },
        { airDate: "2025-12-26" },
        { airDate: "2026-01-09" }
      ],
      fallbackPrimarySeason: { year: 2025, quarter: "fall" }
    });

    assert.deepEqual(activeSeasons, [
      { year: 2025, quarter: "fall" },
      { year: 2026, quarter: "winter" }
    ]);
  });

  it("uses schedule to derive activeSeasons when startDate is missing", () => {
    assert.deepEqual(
      calculateActiveSeasons({
        schedule: [{ airDate: "2026-07-01" }],
        fallbackPrimarySeason: null
      }),
      [{ year: 2026, quarter: "summer" }]
    );
  });

  it("falls back to primarySeason only when schedule is missing", () => {
    assert.deepEqual(
      calculateActiveSeasons({
        schedule: [],
        fallbackPrimarySeason: { year: 2026, quarter: "spring" }
      }),
      [{ year: 2026, quarter: "spring" }]
    );
  });

  it("infers update weekday from premiere or schedule dates when no delay is known", () => {
    assert.equal(
      inferUpdateWeekday({
        schedule: [{ airDate: "2026-07-03", status: "confirmed" }],
        startDate: null
      }),
      5
    );
    assert.equal(inferUpdateWeekday({ schedule: [], startDate: "2026-07-04" }), 6);
    assert.equal(
      inferUpdateWeekday({
        schedule: [{ airDate: "2026-07-03", status: "delayed" }],
        startDate: "2026-07-03"
      }),
      null
    );
  });

  it("classifies cross-quarter continuation for quarter pages", () => {
    const item = createAnime({
      startDate: "2026-03-20",
      primarySeason: { year: 2026, quarter: "winter" },
      activeSeasons: [
        { year: 2026, quarter: "winter" },
        { year: 2026, quarter: "spring" }
      ]
    });

    assert.equal(isCrossQuarterContinuing(item, { year: 2026, quarter: "spring" }), true);
    assert.equal(classifySeasonMembership(item, { year: 2026, quarter: "winter" }), "new");
    assert.equal(classifySeasonMembership(item, { year: 2026, quarter: "spring" }), "continuing");
    assert.equal(classifySeasonMembership(item, { year: 2026, quarter: "summer" }), "not_active");
  });

  it("rejects invalid calendar dates", () => {
    assert.equal(isValidDateString("2026-02-29"), false);
    assert.equal(isValidDateString("2024-02-29"), true);
    assert.throws(() => seasonKeyFromDate("2026-13-01"), /YYYY-MM-DD/);
  });
});

describe("anime validation", () => {
  it("accepts a complete item matching the documented model", () => {
    const issues = validateAnimeItem(createAnime());
    assert.deepEqual(issues, []);
  });

  it("reports missing schedule, missing rating and non-complete status requirements", () => {
    const item = createAnime({
      bangumi: {
        subjectId: null,
        url: null,
        rating: null,
        ratingCount: null,
        rank: null,
        lastSyncedAt: null
      },
      schedule: [],
      activeSeasons: [{ year: 2026, quarter: "winter" }],
      dataStatus: "complete"
    });

    const issues = validateAnimeItem(item);
    assert.equal(issues.some((item) => item.code === "MISSING_BANGUMI_RATING"), true);
    assert.equal(issues.some((item) => item.code === "COMPLETE_WITH_MISSING_KEY_FIELDS"), true);
    assert.equal(hasBlockingValidationIssues(issues), false);
  });

  it("does not warn when a matched Bangumi subject has too few votes for a rating", () => {
    const issues = validateAnimeItem(
      createAnime({
        bangumi: {
          subjectId: 1001,
          url: "https://bgm.tv/subject/1001",
          rating: null,
          ratingCount: 2,
          rank: null,
          lastSyncedAt: "2026-07-27T21:30:00+09:00"
        },
        dataStatus: "complete"
      })
    );

    assert.equal(issues.some((item) => item.code === "MISSING_BANGUMI_RATING"), false);
    assert.equal(issues.some((item) => item.code === "COMPLETE_WITH_MISSING_KEY_FIELDS"), false);
    assert.equal(hasBlockingValidationIssues(issues), false);
  });

  it("rejects placeholder Bangumi rating values", () => {
    const issues = validateAnimeItem(
      createAnime({
        bangumi: {
          subjectId: 1001,
          url: "https://bgm.tv/subject/1001",
          rating: 0,
          ratingCount: 0,
          rank: 0,
          lastSyncedAt: "2026-07-27T21:30:00+09:00"
        }
      })
    );

    assert.equal(issues.some((item) => item.code === "INVALID_BANGUMI_RATING"), true);
    assert.equal(issues.some((item) => item.code === "INVALID_BANGUMI_RATINGCOUNT"), true);
    assert.equal(issues.some((item) => item.code === "INVALID_BANGUMI_RANK"), true);
    assert.equal(hasBlockingValidationIssues(issues), true);
  });

  it("rejects invalid dates, non-standard 24:30 times and mismatched seasons", () => {
    const issues = validateAnimeItem(
      createAnime({
        startDate: "2026-04-31",
        primarySeason: { year: 2026, quarter: "winter" },
        updateTime: "24:30",
        schedule: [
          {
            episodeNumber: 1,
            episodeTitle: null,
            airDate: "2026-04-31",
            airTime: "24:30",
            timezone: "Asia/Tokyo",
            status: "confirmed",
            source
          }
        ]
      })
    );

    assert.equal(issues.some((item) => item.code === "INVALID_DATE"), true);
    assert.equal(issues.some((item) => item.code === "INVALID_TIME"), true);
    assert.equal(issues.some((item) => item.code === "INVALID_AIR_DATE"), true);
  });

  it("requires ai_inferred sources to include confidence", () => {
    const issues = validateAnimeItem(
      createAnime({
        sources: [
          {
            name: "AI inferred",
            type: "ai_inferred",
            retrievedAt: "2026-07-27T21:30:00+09:00"
          }
        ]
      })
    );

    assert.equal(issues.some((item) => item.code === "MISSING_AI_CONFIDENCE"), true);
  });

  it("validates cache-level uniqueness and nullable cache updatedAt", () => {
    const issues = validateAnimeCache({
      schemaVersion: 1,
      updatedAt: null,
      generatedBy: "manual-edit",
      items: [createAnime(), createAnime()]
    });

    assert.equal(issues.some((item) => item.code === "DUPLICATE_ID"), true);
  });
});
