import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildSeasonQuery,
  classifySeasonMembership,
  getCurrentSeasonMonth,
  getSeasonMonthByQuarter,
  parseSeasonFromUrl
} from "../../src/app/lib/season.ts";
import { formatUpdateDisplay } from "../../src/app/lib/format.ts";
import { getTodayFollowItems, sortAnimeItems } from "../../src/app/lib/listing.ts";
import { reconcilePrefsWithAnimeStatuses } from "../../src/app/lib/userAnimePrefs.ts";
import type { AnimeCache } from "../../src/server/types/anime.ts";
import { findFixtureItem, readFixture } from "./test-utils.ts";

describe("frontend season interaction helpers", () => {
  it("maps dates and URL params to documented season months", () => {
    assert.equal(getCurrentSeasonMonth(new Date("2026-01-15T00:00:00Z")), 1);
    assert.equal(getCurrentSeasonMonth(new Date("2026-04-15T00:00:00Z")), 4);
    assert.equal(getCurrentSeasonMonth(new Date("2026-07-15T00:00:00Z")), 7);
    assert.equal(getCurrentSeasonMonth(new Date("2026-10-15T00:00:00Z")), 10);
    assert.equal(parseSeasonFromUrl("7"), 7);
    assert.equal(parseSeasonFromUrl("2"), null);
    assert.equal(getSeasonMonthByQuarter("winter"), 1);
    assert.equal(getSeasonMonthByQuarter("spring"), 4);
    assert.equal(getSeasonMonthByQuarter("summer"), 7);
    assert.equal(getSeasonMonthByQuarter("fall"), 10);
  });

  it("builds API query strings for includeOptional and includeNeedsReview toggles", () => {
    assert.equal(
      buildSeasonQuery(2026, 7, true, false),
      "year=2026&season=7&includeOptional=true&includeNeedsReview=false"
    );
  });

  it("derives new versus continuing state for key UI filters", () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const marchToApril = findFixtureItem(cache, "anime:march-to-april");
    const juneToJuly = findFixtureItem(cache, "anime:june-to-july");

    assert.equal(classifySeasonMembership(marchToApril, { year: 2026, quarter: "spring" }), "new");
    assert.equal(classifySeasonMembership(juneToJuly, { year: 2026, quarter: "spring" }), "new");
  });

  it("formats update text by broadcast state without spillover season labels", () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const winterJanMar = findFixtureItem(cache, "anime:winter-jan-mar");
    const marchToApril = findFixtureItem(cache, "anime:march-to-april");
    const announcedOnly = {
      ...marchToApril,
      status: "announced" as const,
      updateWeekday: null,
      updateTime: null,
      activeSeasons: [{ year: 2026, quarter: "summer" as const }],
      primarySeason: { year: 2026, quarter: "summer" as const }
    };
    const weekdayOnly = {
      ...announcedOnly,
      updateWeekday: 5,
      updateTime: null
    };

    assert.equal(formatUpdateDisplay(weekdayOnly, { year: 2026, quarter: "summer" }), "周五 时间待定");

    assert.equal(formatUpdateDisplay(winterJanMar, { year: 2026, quarter: "winter" }), "已完结");
    assert.equal(formatUpdateDisplay(marchToApril, { year: 2026, quarter: "winter" }), "周四 23:30");
    assert.equal(formatUpdateDisplay(marchToApril, { year: 2026, quarter: "spring" }), "周四 23:30");
    assert.equal(formatUpdateDisplay(announcedOnly, { year: 2026, quarter: "summer" }), "暂未确定");
  });

  it("sorts season items by rating and premiere date", () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");

    assert.deepEqual(
      sortAnimeItems(cache.items, "ratingDesc").map((item) => item.id),
      ["anime:october-to-next-january", "anime:winter-jan-mar", "anime:june-to-july", "anime:march-to-april"]
    );
    assert.deepEqual(
      sortAnimeItems(cache.items, "ratingAsc").map((item) => item.id),
      ["anime:winter-jan-mar", "anime:october-to-next-january", "anime:june-to-july", "anime:march-to-april"]
    );
    assert.deepEqual(
      sortAnimeItems(cache.items, "startDateAsc").map((item) => item.id),
      ["anime:october-to-next-january", "anime:winter-jan-mar", "anime:march-to-april", "anime:june-to-july"]
    );
    assert.deepEqual(
      sortAnimeItems(cache.items, "startDateDesc").map((item) => item.id),
      ["anime:june-to-july", "anime:march-to-april", "anime:winter-jan-mar", "anime:october-to-next-january"]
    );
    assert.deepEqual(
      sortAnimeItems(cache.items, "updateTimeAsc").map((item) => item.id),
      ["anime:winter-jan-mar", "anime:march-to-april", "anime:october-to-next-january", "anime:june-to-july"]
    );
    assert.deepEqual(
      sortAnimeItems(cache.items, "updateTimeDesc").map((item) => item.id),
      ["anime:june-to-july", "anime:october-to-next-january", "anime:march-to-april", "anime:winter-jan-mar"]
    );
  });

  it("builds today's following schedule in Beijing update-time order", () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const thursdayInBeijing = new Date("2026-04-02T12:00:00+08:00");
    const fridayInBeijing = new Date("2026-04-03T12:00:00+08:00");

    assert.deepEqual(
      getTodayFollowItems(cache.items, thursdayInBeijing).map((item) => item.id),
      ["anime:march-to-april"]
    );
    assert.deepEqual(
      getTodayFollowItems(cache.items, fridayInBeijing).map((item) => item.id),
      ["anime:october-to-next-january"]
    );
  });

  it("clears followed state when a followed anime becomes finished without marking it completed", () => {
    const prefs = {
      followedIds: ["anime:airing", "anime:finished"],
      completedIds: []
    };

    const next = reconcilePrefsWithAnimeStatuses(prefs, [
      { id: "anime:airing", status: "airing" },
      { id: "anime:finished", status: "finished" }
    ]);

    assert.deepEqual(next.followedIds, ["anime:airing"]);
    assert.deepEqual(next.completedIds, []);
  });
});
