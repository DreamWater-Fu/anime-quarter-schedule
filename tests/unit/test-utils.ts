import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createEmptyUpdateStatus, type AnimeStorage } from "../../src/server/cache/storage.ts";
import type { AnimeCache, AnimeItem } from "../../src/server/types/anime.ts";
import type { UpdateLogEntry, UpdateStatusPayload } from "../../src/server/types/api.ts";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(testDir, "..", "..");

export function readFixture<T>(fixtureName: string): T {
  const text = readFileSync(resolve(rootDir, "tests", "fixtures", fixtureName), "utf8");
  return JSON.parse(text) as T;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryStorage implements AnimeStorage {
  logs: UpdateLogEntry[] = [];
  writeCount = 0;
  private animeCache: AnimeCache;
  private status: UpdateStatusPayload;

  constructor(animeCache: AnimeCache, status: UpdateStatusPayload = createEmptyUpdateStatus()) {
    this.animeCache = clone(animeCache);
    this.status = clone(status);
  }

  async readAnimeCache(): Promise<AnimeCache> {
    return clone(this.animeCache);
  }

  async writeAnimeCache(cache: AnimeCache): Promise<void> {
    this.writeCount += 1;
    this.animeCache = clone(cache);
  }

  async readUpdateStatus(): Promise<UpdateStatusPayload> {
    return clone(this.status);
  }

  async writeUpdateStatus(status: UpdateStatusPayload): Promise<void> {
    this.status = clone(status);
  }

  async appendUpdateLog(entry: UpdateLogEntry): Promise<void> {
    this.logs.push(clone(entry));
  }
}

export function findFixtureItem(cache: AnimeCache, id: string): AnimeItem {
  const item = cache.items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`fixture item not found: ${id}`);
  return item;
}
