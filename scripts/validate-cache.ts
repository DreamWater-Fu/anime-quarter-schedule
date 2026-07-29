import { loadLocalEnv } from "../src/server/config/env.ts";
import { JsonFileStorage } from "../src/server/cache/jsonFileStorage.ts";
import { hasBlockingValidationIssues, validateAnimeCache } from "../src/server/anime/validateAnime.ts";

loadLocalEnv();

const storage = new JsonFileStorage();
const cache = await storage.readAnimeCache();
const issues = validateAnimeCache(cache);

for (const issue of issues) {
  const prefix = issue.severity === "error" ? "ERROR" : "WARN";
  console.log(`${prefix} ${issue.path} ${issue.code}: ${issue.message}`);
}

if (hasBlockingValidationIssues(issues)) {
  process.exitCode = 1;
} else {
  console.log(`cache valid: ${cache.items.length} items`);
}
