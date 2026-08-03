import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { getDefaultStorage } from "../src/server/cache/jsonFileStorage.ts";
import { BangumiApiClient } from "../src/server/sources/bangumi/client.ts";
import type { BangumiSubject } from "../src/server/sources/bangumi/types.ts";
import type { AnimeQuarter } from "../src/server/types/anime.ts";

const PAGE_LIMIT = 100;

async function main() {
  const storage = getDefaultStorage();
  const cache = await storage.readAnimeCache();
  const client = new BangumiApiClient();
  const months = [
    ...new Set(
      cache.items.flatMap((item) => {
        if (!item.primarySeason) return [];
        return getBangumiLookupMonths(item.primarySeason.year, item.primarySeason.quarter);
      }).map(({ year, month }) => `${year}-${month}`)
    )
  ]
    .map((key) => {
      const [year, month] = key.split("-").map(Number);
      return { year: year!, month: month! };
    })
    .sort((left, right) => left.year - right.year || left.month - right.month);

  const rows: Array<{ year: number; month: number; count: number; status: "updated" | "failed"; error?: string }> = [];
  for (const { year, month } of months) {
    try {
      const subjects = await fetchAllMonthSubjects(client, year, month);
      await writeMonthSnapshot(year, month, subjects);
      rows.push({ year, month, count: subjects.length, status: "updated" });
    } catch (error) {
      rows.push({
        year,
        month,
        count: 0,
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
    await delay(500);
  }

  console.log(JSON.stringify({
    months: rows.length,
    updated: rows.filter((row) => row.status === "updated").length,
    failed: rows.filter((row) => row.status === "failed").length,
    rows
  }, null, 2));
}

async function fetchAllMonthSubjects(client: BangumiApiClient, year: number, month: number): Promise<BangumiSubject[]> {
  const byId = new Map<number, BangumiSubject>();
  for (let offset = 0; offset <= 1_000; offset += PAGE_LIMIT) {
    const subjects = await client.listSubjectsByMonth({
      year,
      month,
      limit: PAGE_LIMIT,
      offset
    });
    for (const subject of subjects) byId.set(subject.id, subject);
    if (subjects.length < PAGE_LIMIT) break;
    await delay(350);
  }
  return [...byId.values()];
}

async function writeMonthSnapshot(year: number, month: number, subjects: BangumiSubject[]): Promise<void> {
  const file = `${process.env.DATA_DIR ?? "data"}/bangumi-${year}${String(month).padStart(2, "0")}-subjects.json`;
  const absoluteFile = resolve(/* turbopackIgnore: true */ process.cwd(), file);
  await mkdir(dirname(absoluteFile), { recursive: true });
  await writeFile(absoluteFile, `${JSON.stringify(subjects, null, 2)}\n`, "utf8");
}

function getBangumiLookupMonths(year: number, quarter: AnimeQuarter): Array<{ year: number; month: number }> {
  const seasonMonth = quarterToSeasonMonth(quarter);
  const months = seasonMonth === 1 ? [12, 1, 2, 3] : [seasonMonth - 1, seasonMonth, seasonMonth + 1, seasonMonth + 2];
  return months.map((month) => ({
    year: seasonMonth === 1 && month === 12 ? year - 1 : year,
    month
  }));
}

function quarterToSeasonMonth(quarter: AnimeQuarter): number {
  switch (quarter) {
    case "winter":
      return 1;
    case "spring":
      return 4;
    case "summer":
      return 7;
    case "fall":
      return 10;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
