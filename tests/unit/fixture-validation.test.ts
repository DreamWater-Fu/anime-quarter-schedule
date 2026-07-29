import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calculateActiveSeasons,
  calculatePrimarySeason,
  hasBlockingValidationIssues,
  validateAnimeCache
} from "../../src/server/anime/index.ts";
import type { AnimeCache } from "../../src/server/types/anime.ts";
import { findFixtureItem, readFixture } from "./test-utils.ts";

describe("documented fixtures", () => {
  it("validate without blocking schema issues", () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const issues = validateAnimeCache(cache);

    assert.equal(hasBlockingValidationIssues(issues), false);
  });

  it("cover required quarter ownership cases", () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");

    const janToMar = findFixtureItem(cache, "anime:winter-jan-mar");
    assert.deepEqual(janToMar.primarySeason, { year: 2026, quarter: "winter" });
    assert.deepEqual(janToMar.activeSeasons, [{ year: 2026, quarter: "winter" }]);

    const marToApr = findFixtureItem(cache, "anime:march-to-april");
    assert.deepEqual(marToApr.primarySeason, { year: 2026, quarter: "spring" });
    assert.deepEqual(marToApr.activeSeasons, [
      { year: 2026, quarter: "winter" },
      { year: 2026, quarter: "spring" }
    ]);

    const junToJul = findFixtureItem(cache, "anime:june-to-july");
    assert.deepEqual(junToJul.primarySeason, { year: 2026, quarter: "summer" });
    assert.deepEqual(junToJul.activeSeasons, [
      { year: 2026, quarter: "spring" },
      { year: 2026, quarter: "summer" }
    ]);

    const octToJan = findFixtureItem(cache, "anime:october-to-next-january");
    assert.deepEqual(octToJan.primarySeason, { year: 2025, quarter: "fall" });
    assert.deepEqual(octToJan.activeSeasons, [
      { year: 2025, quarter: "fall" },
      { year: 2026, quarter: "winter" }
    ]);
  });

  it("derive primarySeason from startDate and activeSeasons from schedule coverage", () => {
    const fixture = readFixture<{
      candidates: Array<{
        caseId: string;
        startDate: string;
        schedule: Array<{ airDate: string }>;
      }>;
    }>("update-source.cross-quarter.json");
    const cases = new Map(fixture.candidates.map((item) => [item.caseId, item]));

    const marchToApril = cases.get("march-to-april");
    assert.ok(marchToApril);
    assert.deepEqual(calculatePrimarySeason(marchToApril.startDate), { year: 2026, quarter: "spring" });
    assert.deepEqual(
      calculateActiveSeasons({
        schedule: marchToApril.schedule,
        fallbackPrimarySeason: { year: 2026, quarter: "winter" }
      }),
      [
        { year: 2026, quarter: "winter" },
        { year: 2026, quarter: "spring" }
      ]
    );

    const octoberToJanuary = cases.get("october-to-next-january");
    assert.ok(octoberToJanuary);
    assert.deepEqual(calculatePrimarySeason(octoberToJanuary.startDate), { year: 2025, quarter: "fall" });
    assert.deepEqual(
      calculateActiveSeasons({
        schedule: octoberToJanuary.schedule,
        fallbackPrimarySeason: { year: 2025, quarter: "fall" }
      }),
      [
        { year: 2025, quarter: "fall" },
        { year: 2026, quarter: "winter" }
      ]
    );
  });

  it("keeps non-standard 24:30 only in raw source text", () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const item = findFixtureItem(cache, "anime:march-to-april");

    assert.equal(item.updateTime, "00:30");
    assert.equal(item.schedule.every((scheduleItem) => scheduleItem.airTime !== "24:30"), true);
    assert.equal(item.schedule.some((scheduleItem) => scheduleItem.rawTimeText === "24:30"), true);
  });
});
