import type { AnimeCache } from "../types/anime.ts";
import type { UpdateLogEntry, UpdateStatusPayload } from "../types/api.ts";

export interface AnimeStorage {
  readAnimeCache(): Promise<AnimeCache>;
  writeAnimeCache(cache: AnimeCache): Promise<void>;
  readUpdateStatus(): Promise<UpdateStatusPayload>;
  writeUpdateStatus(status: UpdateStatusPayload): Promise<void>;
  appendUpdateLog(entry: UpdateLogEntry): Promise<void>;
}

export function createEmptyAnimeCache(): AnimeCache {
  return {
    schemaVersion: 1,
    updatedAt: null,
    generatedBy: "manual-edit",
    items: []
  };
}

export function createEmptyUpdateStatus(): UpdateStatusPayload {
  return {
    schemaVersion: 1,
    status: "idle",
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastError: null,
    currentJob: null,
    cache: {
      animeUpdatedAt: null,
      itemCount: 0
    }
  };
}
