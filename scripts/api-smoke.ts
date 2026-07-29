import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { loadLocalEnv } from "../src/server/config/env.ts";
import { JsonFileStorage } from "../src/server/cache/jsonFileStorage.ts";
import { getAnimeApi, getStatusApi } from "../src/server/api/routes.ts";

loadLocalEnv();

const dataDir = await mkdtemp(join(tmpdir(), "anime-api-smoke-"));
process.env.DATA_DIR = dataDir;

try {
  const storage = new JsonFileStorage({ dataDir });
  await storage.init();

  const anime = await getAnimeApi(new URLSearchParams("year=2026&season=7"));
  const status = await getStatusApi();

  if (!anime.body.ok || anime.status !== 200) throw new Error("GET /api/anime smoke failed");
  if (!status.body.ok || status.status !== 200) throw new Error("GET /api/status smoke failed");

  console.log("api smoke passed");
} finally {
  await rm(dataDir, { recursive: true, force: true });
}
