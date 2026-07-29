import { loadLocalEnv } from "../src/server/config/env.ts";
import { updateAnimeData } from "../src/server/anime/updateAnimeData.ts";
import { isSeasonMonth } from "../src/server/anime/calculateSeason.ts";

loadLocalEnv();

const args = parseArgs(process.argv.slice(2));
const year = Number(args.year);
const season = Number(args.season);

if (!Number.isInteger(year) || !isSeasonMonth(season)) {
  console.error("usage: npm run data:update -- --year 2026 --season 7 [--force]");
  process.exit(1);
}

const result = await updateAnimeData({
  year,
  season,
  force: args.force === "true"
});

console.log(JSON.stringify(result, null, 2));

function parseArgs(values: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value?.startsWith("--")) continue;
    const key = value.slice(2);
    const next = values[index + 1];
    if (next && !next.startsWith("--")) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = "true";
    }
  }
  return result;
}
