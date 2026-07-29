import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { handleApiRequest } from "../../src/server/api/routes.ts";
import { classifySeasonMembership, queryAnimeBySeason } from "../../src/server/anime/index.ts";
import type { AnimeCache } from "../../src/server/types/anime.ts";
import { MemoryStorage, readFixture } from "./test-utils.ts";

describe("quarter query coverage", () => {
  it("returns works by premiere quarter instead of spillover schedule dates", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const storage = new MemoryStorage(cache);

    const winter = await queryAnimeBySeason({ year: 2026, season: 1, storage });
    assert.deepEqual(
      winter.items.map((item) => item.id),
      ["anime:winter-jan-mar", "anime:march-to-april"]
    );

    const spring = await queryAnimeBySeason({ year: 2026, season: 4, storage });
    assert.deepEqual(
      spring.items.map((item) => item.id),
      ["anime:june-to-july"]
    );

    const summer = await queryAnimeBySeason({ year: 2026, season: 7, storage });
    assert.deepEqual(summer.items.map((item) => item.id), []);
  });

  it("keeps continuing classification available for activeSeasons metadata", async () => {
    const cache = readFixture<AnimeCache>("anime-cache.base.json");
    const marchToApril = cache.items.find((item) => item.id === "anime:march-to-april");
    const juneToJuly = cache.items.find((item) => item.id === "anime:june-to-july");

    assert.ok(marchToApril);
    assert.ok(juneToJuly);
    assert.equal(classifySeasonMembership(marchToApril, { year: 2026, quarter: "spring" }), "continuing");
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
