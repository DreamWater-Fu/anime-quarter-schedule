import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleApiRequest } from "../../src/server/api/routes.ts";
import { classifySeasonMembership, queryAnimeBySeason, searchAnimeLibrary } from "../../src/server/anime/index.ts";
import type { AnimeCache } from "../../src/server/types/anime.ts";
import { MemoryStorage, readFixture } from "./test-utils.ts";

describe("quarter query coverage", () => {
  it("returns TV works by premiere quarter only for non-current seasons", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const storage = new MemoryStorage(cache);

    const winter = await queryAnimeBySeason({ year: 2026, season: 1, storage, now: new Date("2026-07-29T00:00:00+08:00") });
    assert.deepEqual(
      winter.items.map((item) => item.id),
      ["anime:winter-jan-mar"]
    );

    const spring = await queryAnimeBySeason({ year: 2026, season: 4, storage, now: new Date("2026-07-29T00:00:00+08:00") });
    assert.deepEqual(
      spring.items.map((item) => item.id),
      ["anime:march-to-april"]
    );

    const summer = await queryAnimeBySeason({ year: 2026, season: 7, storage, now: new Date("2026-07-29T00:00:00+08:00") });
    assert.deepEqual(summer.items.map((item) => item.id), ["anime:june-to-july"]);
  });

  it("shows active continuations only when the requested season is the current Beijing season", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const continuingIntoSummer = {
      ...cache.items[0]!,
      id: "anime:spring-continuing-into-summer",
      startDate: "2026-04-10",
      primarySeason: { year: 2026, quarter: "spring" as const },
      activeSeasons: [
        { year: 2026, quarter: "spring" as const },
        { year: 2026, quarter: "summer" as const }
      ]
    };
    const storage = new MemoryStorage({ ...cache, items: [...cache.items, continuingIntoSummer] });

    const currentSummer = await queryAnimeBySeason({
      year: 2026,
      season: 7,
      storage,
      now: new Date("2026-07-29T00:00:00+08:00")
    });
    assert.equal(currentSummer.items.some((item) => item.id === continuingIntoSummer.id), true);

    const futureFall = await queryAnimeBySeason({
      year: 2026,
      season: 10,
      storage,
      now: new Date("2026-07-29T00:00:00+08:00")
    });
    assert.equal(futureFall.items.some((item) => item.id === "anime:june-to-july"), false);
  });

  it("keeps continuing classification available for activeSeasons metadata", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const marchToApril = cache.items.find((item) => item.id === "anime:march-to-april");
    const juneToJuly = cache.items.find((item) => item.id === "anime:june-to-july");

    assert.ok(marchToApril);
    assert.ok(juneToJuly);
    assert.equal(classifySeasonMembership(marchToApril, { year: 2026, quarter: "spring" }), "new");
    assert.equal(classifySeasonMembership(juneToJuly, { year: 2026, quarter: "spring" }), "new");
  });

  it("does not return non-Japanese or explicitly excluded items", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const nonJapanese = {
      ...cache.items[2]!,
      id: "anime:non-japanese",
      isJapaneseAnime: false,
      inclusionStatus: "excluded" as const,
      exclusionReason: "Not Japanese anime"
    };
    const storage = new MemoryStorage({ ...cache, items: [...cache.items, nonJapanese] });

    const summer = await queryAnimeBySeason({
      year: 2026,
      season: 7,
      includeOptional: true,
      includeNeedsReview: true,
      storage
    });

    assert.equal(summer.items.some((item) => item.id === "anime:non-japanese"), false);
  });

  it("does not return non-TV formats", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const webItem = {
      ...cache.items[2]!,
      id: "anime:web-format",
      format: "web" as const
    };
    const storage = new MemoryStorage({ ...cache, items: [...cache.items, webItem] });

    const summer = await queryAnimeBySeason({
      year: 2026,
      season: 7,
      includeOptional: true,
      includeNeedsReview: true,
      storage
    });

    assert.equal(summer.items.some((item) => item.id === "anime:web-format"), false);
  });

  it("searches stored TV anime by title and returns premiere season", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const storage = new MemoryStorage(cache);

    const result = await searchAnimeLibrary({ query: "March", storage });

    assert.equal(result.results[0]?.id, "anime:march-to-april");
    assert.deepEqual(result.results[0]?.primarySeason, { year: 2026, quarter: "spring" });
    assert.equal(result.results[0]?.displayTitle, "March To April");
  });

  it("keeps hidden formats and excluded non-Japanese entries out of search", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const webItem = {
      ...cache.items[1]!,
      id: "anime:march-web-format",
      title: { ...cache.items[1]!.title, original: "March Search Hidden Web", japanese: "March Search Hidden Web" },
      format: "web" as const
    };
    const excludedItem = {
      ...cache.items[1]!,
      id: "anime:march-excluded",
      title: { ...cache.items[1]!.title, original: "March Search Hidden Excluded", japanese: "March Search Hidden Excluded" },
      isJapaneseAnime: false,
      inclusionStatus: "excluded" as const,
      exclusionReason: "Not Japanese anime"
    };
    const storage = new MemoryStorage({ ...cache, items: [...cache.items, webItem, excludedItem] });

    const result = await searchAnimeLibrary({ query: "Hidden", storage });

    assert.deepEqual(result.results.map((item) => item.id), []);
  });
});

describe("api response format", () => {
  it("wraps invalid query errors in ok/error shape", async () => {
    const result = await handleApiRequest({
      method: "GET",
      path: "/api/anime",
      query: new URLSearchParams("year=2026&season=2")
    });

    assert.equal(result.status, 400);
    assert.equal(result.body.ok, false);
    if (!result.body.ok) {
      assert.equal(result.body.error.code, "INVALID_QUERY");
      assert.match(result.body.error.message, /season must be one of/);
      assert.equal(String(result.body.error.message).includes("C:\\"), false);
    }
  });

  it("wraps unknown routes in ok/error shape", async () => {
    const result = await handleApiRequest({
      method: "POST",
      path: "/api/status",
      body: {}
    } as Parameters<typeof handleApiRequest>[0]);

    assert.equal(result.status, 404);
    assert.equal(result.body.ok, false);
    if (!result.body.ok) assert.equal(result.body.error.code, "NOT_FOUND");
  });
});
